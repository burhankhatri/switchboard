/**
 * Refusing a run when the provider already told us the credential is bad.
 *
 * claudeCredentialStatus catches the credentials we can judge locally — missing,
 * malformed, expired — and resolveSendCredentials runs it before any sandbox
 * exists. What it cannot catch is a credential that parses, has not expired,
 * and is still rejected: revoked, wrong account, subscription lapsed. That only
 * surfaces when the agent calls the provider, by which point a sandbox has been
 * created and up to two minutes spent.
 *
 * The provider's verdict is already recorded — logLlmProviderError writes an
 * activity row with category "auth". This decides whether that verdict still
 * applies, so the next send can fail in milliseconds instead of repeating the
 * spin-up to learn the same thing.
 */

export interface CredentialHealthInput {
  /** When the provider last rejected this user's credential for this agent. */
  lastAuthFailureAt: Date | null
  /**
   * When the user's stored credentials last changed. Approximate: it is the
   * User row's updatedAt, which also moves for unrelated settings. That is the
   * safe direction — it clears a block early rather than holding one after the
   * credential was fixed.
   */
  credentialsUpdatedAt: Date | null
}

export function shouldBlockForAuthFailure({
  lastAuthFailureAt,
  credentialsUpdatedAt,
}: CredentialHealthInput): boolean {
  if (!lastAuthFailureAt) return false

  // Nothing known about when the credential was written: trust the failure.
  if (!credentialsUpdatedAt) return true

  // Anything the user has touched since the rejection deserves another attempt.
  // Blocking past that would strand someone who has just pasted a working key
  // with no way to prove it, which is far worse than one wasted sandbox.
  return lastAuthFailureAt.getTime() > credentialsUpdatedAt.getTime()
}
