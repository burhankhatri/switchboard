import "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      isAdmin?: boolean
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub?: string
    /**
     * Cached on the token so the `session` callback does not query Postgres on
     * every getServerSession() — which is every API request. Undefined on tokens
     * issued before this existed; the callback back-fills those from the DB once.
     */
    isAdmin?: boolean
  }
}
