"use client"

import { useEffect, useRef } from "react"
import { useSession, signOut } from "next-auth/react"
import { clearAllStorage } from "@/lib/storage"
import { clearActiveWorkspace } from "@/lib/contexts/WorkspaceContext"

/** Set just before signing out, so the landing page can say why. */
export const SIGNED_OUT_REASON_KEY = "switchboard.signedOutReason"

/**
 * End the session when the GitHub token behind it is dead.
 *
 * The JWT and the GitHub token expire on unrelated clocks — the login cookie
 * lasts weeks, a GitHub App user token about eight hours — so the app could sit
 * there looking signed in while every repo, branch and sandbox call 401'd. This
 * used to raise a dismissable corner banner, which left the broken state as the
 * user's problem to notice and act on. Signing out states it plainly: the
 * session is over, and signing in again is what mints a working token.
 *
 * Runs once per page load rather than on a timer. The token dies mid-session
 * often enough, but a reload is where the damage would otherwise start, and
 * polling to eject someone mid-sentence is worse than letting the next load
 * catch it.
 *
 * `/api/github/validate-token` only answers `valid: false` on a definitive 401
 * or a missing account — network failures and GitHub 5xx come back `valid:
 * true`. That conservatism is what makes signing out safe here rather than
 * merely aggressive: an outage must not log everybody out.
 */
/**
 * Does this `/api/github/validate-token` body prove the session is dead?
 *
 * Only a literal `valid: false` counts. Anything else — an error object, an
 * empty body, a payload from a proxy or a future field rename — leaves the
 * session alone. Checking `!data.valid` instead would treat every one of those
 * as a dead token and sign the user out on a shape change, which is the kind of
 * failure nobody would connect back to this line.
 */
export function shouldEndSession(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { valid?: unknown }).valid === false
  )
}

export function useGitHubSessionGuard(): void {
  const { status } = useSession()
  const checked = useRef(false)

  useEffect(() => {
    if (status !== "authenticated" || checked.current) return
    checked.current = true

    fetch("/api/github/validate-token")
      .then((res) => res.json())
      .then((body: unknown) => {
        if (!shouldEndSession(body)) return

        try {
          sessionStorage.setItem(SIGNED_OUT_REASON_KEY, "github-expired")
        } catch {
          // Storage disabled — they get a silent sign-out rather than none.
        }

        // Same teardown as the sign-out button. Leaving the cached chats and
        // the active workspace behind would show them to whoever signs in next
        // on this browser.
        clearAllStorage()
        clearActiveWorkspace()
        signOut({ callbackUrl: "/" })
      })
      .catch(() => {
        // Could not reach our own API. Nothing has been proven about the token,
        // and guessing costs the user their session.
      })
  }, [status])
}
