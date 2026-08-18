"use client"

import { SessionProvider } from "next-auth/react"
import type { Session } from "next-auth"
import { ThemeProvider } from "next-themes"
import { QueryProvider } from "@/components/providers/QueryProvider"
import { WorkspaceProvider } from "@/lib/contexts/WorkspaceContext"
import { Toaster } from "@/components/Toaster"

interface ProvidersProps {
  children: React.ReactNode
  /**
   * Session resolved on the server. Without it SessionProvider fetches
   * /api/auth/session from the client after mount, so every hard refresh has a
   * window where useSession() reports "loading" and anything gated on
   * "authenticated" renders its signed-out state first. Passing it in means the
   * very first render already knows who you are.
   */
  session: Session | null
}

export function Providers({ children, session }: ProvidersProps) {
  return (
    <SessionProvider session={session}>
      <QueryProvider>
        {/* The app has a single light "premium" theme: .premium-bg is always
            light with no dark variant, so following the OS into dark mode left
            dark popovers/cards clashing over the light background. Force light
            until a real dark theme exists. */}
        <ThemeProvider
          attribute="class"
          forcedTheme="light"
          disableTransitionOnChange
        >
          <WorkspaceProvider>{children}</WorkspaceProvider>
          <Toaster />
        </ThemeProvider>
      </QueryProvider>
    </SessionProvider>
  )
}
