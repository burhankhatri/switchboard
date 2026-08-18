import CryptoJS from "crypto-js"

const IS_PRODUCTION = process.env.NODE_ENV === "production"
const IS_BUILD_TIME = process.env.NEXT_PHASE === "phase-production-build"

// In production we require an explicit ENCRYPTION_KEY. In dev/build we fall
// back to a known constant so the AES code paths always run (no silent
// plaintext storage) without forcing every dev to generate a key.
const DEV_DEFAULT_KEY = "dev-only-encryption-key-not-for-production"

const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ??
  (IS_PRODUCTION && !IS_BUILD_TIME ? undefined : DEV_DEFAULT_KEY)

if (!ENCRYPTION_KEY && IS_PRODUCTION && !IS_BUILD_TIME) {
  // Fail loudly at module load. Storing user API keys in plaintext is not
  // an acceptable production fallback. We skip this check at build time
  // since the key isn't needed to compile the application.
  throw new Error(
    "ENCRYPTION_KEY environment variable is required in production"
  )
}

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY!).toString()
}

export function decrypt(ciphertext: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY!)
    const decrypted = bytes.toString(CryptoJS.enc.Utf8)
    // If decryption fails (wrong key or value isn't actually encrypted),
    // return the original — same shape as the prior plaintext fallback.
    return decrypted || ciphertext
  } catch {
    return ciphertext
  }
}

/**
 * Decrypt, or throw.
 *
 * `decrypt` above returns the ciphertext when decryption fails, to stay
 * compatible with values written before encryption existed. That fallback is
 * actively dangerous for a workspace connection: after a key rotation every
 * secret silently "decrypts" to its own ciphertext, and the agent would send
 * that to the CRM as an API key. The write would fail somewhere far away from
 * the cause, or — worse — succeed against the wrong thing.
 *
 * Workspace secrets are written by this app only, so there is no legacy
 * plaintext to accommodate and no reason to guess.
 */
export function decryptStrict(ciphertext: string, label: string): string {
  let plaintext: string
  try {
    plaintext = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY!).toString(
      CryptoJS.enc.Utf8
    )
  } catch (err) {
    throw new Error(`Could not decrypt ${label}: ${(err as Error).message}`)
  }
  if (!plaintext) {
    throw new Error(
      `Could not decrypt ${label} — wrong ENCRYPTION_KEY, or the stored value is corrupt.`
    )
  }
  return plaintext
}

/**
 * Authenticated-ish secret storage for workspace connections.
 *
 * CryptoJS's passphrase mode is AES-CBC with PKCS7 and NO MAC, so nothing
 * authenticates the ciphertext. "Did it decrypt?" can only be inferred from
 * whether the unpadded bytes are valid UTF-8 — and under a wrong key that
 * succeeds by chance often enough to matter: encrypting 3000 secrets under one
 * key and decrypting under another yields a handful of short, valid,
 * entirely-wrong strings. decryptStrict would return those, and the agent would
 * send one to the CRM as a credential.
 *
 * Prefixing a known marker before encryption turns that probabilistic check
 * into a deterministic one: garbage from a wrong key will not begin with the
 * marker, so it is rejected instead of used.
 */
const SECRET_MARKER = "sw1:"

export function encryptSecret(plaintext: string): string {
  return encrypt(SECRET_MARKER + plaintext)
}

export function decryptSecret(ciphertext: string, label: string): string {
  let candidate: string
  try {
    candidate = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY!).toString(
      CryptoJS.enc.Utf8
    )
  } catch (err) {
    throw new Error(`Could not decrypt ${label}: ${(err as Error).message}`)
  }
  if (!candidate.startsWith(SECRET_MARKER)) {
    throw new Error(
      `Could not decrypt ${label} — wrong ENCRYPTION_KEY, or the stored value is corrupt. ` +
        `Re-enter this connection to fix it.`
    )
  }
  return candidate.slice(SECRET_MARKER.length)
}
