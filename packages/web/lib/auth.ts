import { NextAuthOptions } from "next-auth"
import GitHubProvider from "next-auth/providers/github"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db/prisma"
import { logActivityAsync } from "@/lib/db/activity-log"
import { invalidateGitHubToken } from "@/lib/db/api-helpers"
import { claimInvitesForLogin } from "@/lib/db/workspace-invites"

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
      const login = (profile as { login?: string } | undefined)?.login

      // Who may sign in at all.
      //
      // This matters more here than in most apps: any signed-in user can see
      // the workspace list and join one, and joining a workspace is what causes
      // its decrypted credentials to be injected into a sandbox. Deployed to a
      // public URL without this, a stranger could sign in, join, and receive
      // someone's CRM or ad-platform credential — and spend the org's sandbox
      // quota doing it.
      //
      // Unset means "allow anyone", which is right for local development and
      // wrong for anything reachable from the internet. Set
      // ALLOWED_GITHUB_LOGINS to a comma-separated list of handles.
      const allowed = (process.env.ALLOWED_GITHUB_LOGINS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
      if (allowed.length > 0) {
        if (!login || !allowed.includes(login.toLowerCase())) {
          console.warn(`[auth] refused sign-in for ${login ?? "unknown login"}`)
          return false
        }
      }

      // The handle is captured in the jwt callback, not here. For a new user
      // this runs before the adapter has created the row, so `user.id` is
      // GitHub's numeric account id and any update keyed on it matches nothing.
      return true
    },
    async jwt({ token, user, account, profile }) {
      // On initial sign in, persist user id
      if (user) {
        token.sub = user.id
        // Re-read on every sign-in so a promotion or demotion lands on the next
        // login instead of being pinned for the life of the token.
        token.isAdmin = undefined
      }
      if (account) {
        // The GitHub handle, and anything keyed off it, has to be done HERE.
        //
        // next-auth hands this callback the raw provider payload, which carries
        // `login`. The signIn *event* gets the normalised profile instead — the
        // GitHub provider's own profile() mapping, which returns only id, name,
        // email and image (see next-auth/providers/github.js). So `profile.login`
        // read from that event is always undefined, and the capture that lived
        // there stored nothing: a first-time user ended up with a null
        // githubLogin and any invite waiting on their handle stayed pending.
        //
        // The signIn *callback* does receive the raw profile, but it runs before
        // the adapter has created the row, so for a new user its `user.id` is
        // GitHub's numeric account id rather than ours and the update matches
        // nothing. This callback is the only point with both the raw login and a
        // real user id — it runs after the row exists and before the event.
        const login = (profile as { login?: string } | undefined)?.login
        if (token.sub && login) {
          try {
            await prisma.user.update({
              where: { id: token.sub },
              data: { githubLogin: login },
            })
          } catch (err) {
            // Never block a sign-in over this.
            console.error("[auth] could not store githubLogin:", err)
          }

          // Turn any invite addressed to this handle into real membership.
          // Awaited rather than fired off: the point of the feature is that the
          // workspace is already there when they land, and it costs one indexed
          // query when there is nothing waiting.
          await claimInvitesForLogin(token.sub, login)
        }

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

      // The handle and any invite keyed to it are handled in the jwt callback.
      // This event receives the provider's *normalised* profile, which for
      // GitHub is {id, name, email, image} — there is no `login` here to read.
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
