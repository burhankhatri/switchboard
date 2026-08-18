import { NextAuthOptions } from "next-auth"
import GitHubProvider from "next-auth/providers/github"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db/prisma"
import { logActivityAsync } from "@/lib/db/activity-log"
import { invalidateGitHubToken } from "@/lib/db/api-helpers"

/**
 * Cache of the isAdmin flag, for sessions whose token predates it carrying one.
 *
 * Admin status changes roughly never, and the cost of being a minute stale is
 * that a just-promoted user waits a minute for a nav link — against a database
 * round trip on every single authenticated request.
 */
const IS_ADMIN_TTL_MS = 60_000
const isAdminCache = new Map<string, { value: boolean; expires: number }>()

async function lookupIsAdmin(userId: string): Promise<boolean> {
  const hit = isAdminCache.get(userId)
  if (hit && hit.expires > Date.now()) return hit.value

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  })
  const value = user?.isAdmin ?? false
  isAdminCache.set(userId, { value, expires: Date.now() + IS_ADMIN_TTL_MS })
  return value
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  providers: [
    {
      ...GitHubProvider({
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        authorization: {
          params: {
            scope: "repo read:user user:email",
          },
        },
        allowDangerousEmailAccountLinking: true,
      }),
      // GitHub now sends `iss=https://github.com/login/oauth` in the OAuth
      // callback. openid-client validates this against the issuer config, but
      // next-auth's GitHub provider doesn't set one. Adding it here satisfies
      // the check.
      issuer: "https://github.com/login/oauth",
    },
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Allow redirects to the electron callback URL
      if (url.startsWith("/api/auth/electron-callback")) {
        return `${baseUrl}${url}`
      }
      // Allow relative URLs
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`
      }
      // Allow URLs on the same origin
      try {
        if (new URL(url).origin === baseUrl) {
          return url
        }
      } catch {
        // url is not a valid absolute URL, fall through to default
      }
      return baseUrl
    },
    async signIn({ user, profile }) {
      // Capture the GitHub handle. NextAuth's adapter stores name/email/image
      // but not the login, and the login is the only identifier a teammate
      // actually knows — "add burhankhatri" rather than an account id nobody
      // has seen. Best-effort: a failure here must not block signing in.
      const login = (profile as { login?: string } | undefined)?.login
      if (user?.id && login) {
        prisma.user
          .update({ where: { id: user.id }, data: { githubLogin: login } })
          .catch((err) => console.error("[auth] could not store githubLogin:", err))
      }
      return true
    },
    async jwt({ token, user, account }) {
      // On initial sign in, persist user id
      if (user) {
        token.sub = user.id
        // Re-read on every sign-in so a promotion or demotion lands on the next
        // login instead of being pinned for the life of the token.
        token.isAdmin = undefined
      }
      if (account) {
        // Sync the fresh token to the Account table. The PrismaAdapter only
        // writes Account rows on the very first link (create, not upsert), so
        // on re-authorization the DB row keeps the old, revoked token. All
        // routes that need the GitHub token read it from the Account table.
        if (token.sub && account.access_token) {
          prisma.account
            .updateMany({
              where: {
                userId: token.sub,
                provider: account.provider,
                providerAccountId: account.providerAccountId,
              },
              data: { access_token: account.access_token },
            })
            .then(() => {
              // The token cache in api-helpers is keyed by user and outlives
              // this write, so a re-authorization would otherwise keep serving
              // the revoked token until its TTL expired.
              if (token.sub) invalidateGitHubToken(token.sub)
            })
            .catch((err) => {
              console.error("[auth] Failed to sync access_token to Account table:", err)
            })
        }
      }
      return token
    },
    async session({ session, token }) {
      // Send user id to client
      if (session.user && token.sub) {
        session.user.id = token.sub

        // isAdmin used to be a findUnique right here, which meant EVERY
        // getServerSession() — so every authenticated API request — paid a round
        // trip to a cross-region Neon pooler before the route did any of its own
        // work. It is read by exactly two client components (the admin link in
        // the sidebar and the user menu); nothing on the request path needs it,
        // and admin API routes do their own check via requireAdmin().
        //
        // Prefer the value on the token. Tokens minted before this existed have
        // none, and a route handler cannot write a refreshed cookie back, so
        // those would re-query forever — hence the process-local cache.
        session.user.isAdmin = token.isAdmin ?? (await lookupIsAdmin(token.sub))
      }
      return session
    },
  },
  events: {
    async signIn({ user }) {
      // Log user login activity
      if (user?.id) {
        logActivityAsync(user.id, "login")
      }
    },
    async signOut({ token }) {
      // Log user logout activity
      if (token?.sub) {
        logActivityAsync(token.sub, "logout")
      }
    },
    async createUser({ user }) {
      // When a new user is created via OAuth, update with GitHub ID
      // The adapter creates the user, but we need to ensure githubId is set
      const account = await prisma.account.findFirst({
        where: { userId: user.id, provider: "github" },
        select: { providerAccountId: true },
      })
      if (account) {
        await prisma.user.update({
          where: { id: user.id },
          data: { githubId: account.providerAccountId },
        })
      }
    },
  },
  pages: {
    signIn: "/",
  },
  session: {
    strategy: "jwt",
  },
}

// Type extensions are in types/next-auth.d.ts
