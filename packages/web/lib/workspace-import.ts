/**
 * Deciding what a folder import is allowed to commit.
 *
 * Importing a folder is not the per-file upload in a loop. A folder picked from
 * a real machine carries things nobody means to share — another repo's `.git`,
 * a `node_modules`, a `.env` — and it arrives as browser-supplied relative
 * paths, which are no more trustworthy than any other request body. So the
 * import is planned first: every entry is either placed at a repo path or
 * skipped with a reason the user can read.
 *
 * Pure on purpose. The caps are the interesting part and they are all decided
 * here, so they can be tested without a GitHub round trip.
 */

/**
 * Per-file cap, matching the single-file upload. Anything bigger is data that
 * belongs somewhere a git repo is the wrong home for.
 */
export const IMPORT_MAX_FILE_BYTES = 256 * 1024

/**
 * How much one import may carry in total, counted in raw bytes.
 *
 * The whole folder goes up as one request so it can become one commit, and a
 * serverless request body is capped somewhere around 4.5MB. The wire carries
 * base64, which is 4/3 of raw — so this is 3MB rather than 4MB, landing near
 * 4MB encoded with room for the path names around it. Staying under the limit
 * turns "your folder is too big" into a message with a number in it rather than
 * a 413 from the platform.
 */
export const IMPORT_MAX_TOTAL_BYTES = 3 * 1024 * 1024

/**
 * Ceiling on file count, independent of size.
 *
 * Every file is a blob call, so a thousand tiny files is a slow import rather
 * than a large one. This is also the backstop for someone picking their home
 * directory by accident.
 */
export const IMPORT_MAX_FILES = 200

/**
 * Directories and files that are never what someone meant to import.
 *
 * Matched as a path segment, not a substring: a folder legitimately called
 * `my-node_modules-notes` is not this.
 */
const IGNORED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".DS_Store",
  "Thumbs.db",
])

/** Compiled artefacts that only make sense next to the machine that built them. */
const IGNORED_SUFFIXES = [".pyc", ".pyo"]

/**
 * A secrets file, as opposed to the example that documents one.
 *
 * `.env` and `.env.local` hold live credentials; `.env.example` is checked into
 * every repo on purpose. The workspace has an encrypted env store for the
 * former, and a commit is forever, so the guess errs toward skipping.
 */
function looksLikeSecrets(name: string): boolean {
  if (!name.startsWith(".env")) return false
  return !name.endsWith(".example") && !name.endsWith(".sample") && !name.endsWith(".template")
}

export interface ImportEntry {
  /** Path relative to the picked folder, e.g. `audit/scripts/run.py`. */
  relativePath: string
  size: number
}

export interface PlannedFile {
  /** Where it will be committed, inside the workspace folder. */
  path: string
  /** What the user sees, relative to what they picked. */
  relativePath: string
  size: number
}

export interface SkippedFile {
  relativePath: string
  reason: string
}

export interface ImportPlan {
  files: PlannedFile[]
  skipped: SkippedFile[]
  /** Bytes actually being committed — skipped entries do not count. */
  totalBytes: number
}

/** Traversal, absolute paths, and anything that cannot name a file. */
function isUnsafe(relativePath: string): boolean {
  if (!relativePath || relativePath.startsWith("/")) return true
  const parts = relativePath.split("/")
  return parts.some((p) => p === "" || p === "." || p === "..")
}

function isIgnored(relativePath: string): boolean {
  const parts = relativePath.split("/")
  if (parts.some((p) => IGNORED_SEGMENTS.has(p))) return true
  return IGNORED_SUFFIXES.some((s) => relativePath.endsWith(s))
}

/**
 * Decide where each picked file lands, and why the rest did not.
 *
 * Entries are sorted before the caps are applied, so an import that runs into a
 * limit takes the same files every time rather than whatever order the file
 * picker happened to produce.
 */
export function planFolderImport(entries: ImportEntry[], base: string): ImportPlan {
  const sorted = [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  const files: PlannedFile[] = []
  const skipped: SkippedFile[] = []
  let totalBytes = 0

  for (const e of sorted) {
    const skip = (reason: string) => skipped.push({ relativePath: e.relativePath, reason })

    if (isUnsafe(e.relativePath)) {
      skip("unsafe path")
      continue
    }
    if (isIgnored(e.relativePath)) {
      skip("not useful in a workspace")
      continue
    }
    if (looksLikeSecrets(e.relativePath.split("/").pop() ?? "")) {
      skip("looks like a secrets file")
      continue
    }
    if (e.size > IMPORT_MAX_FILE_BYTES) {
      skip(`larger than ${IMPORT_MAX_FILE_BYTES / 1024}KB`)
      continue
    }
    if (files.length >= IMPORT_MAX_FILES) {
      skip(`over the ${IMPORT_MAX_FILES} file limit`)
      continue
    }
    if (totalBytes + e.size > IMPORT_MAX_TOTAL_BYTES) {
      skip("over the total size limit")
      continue
    }

    files.push({
      path: `${base}/${e.relativePath}`,
      relativePath: e.relativePath,
      size: e.size,
    })
    totalBytes += e.size
  }

  return { files, skipped, totalBytes }
}
