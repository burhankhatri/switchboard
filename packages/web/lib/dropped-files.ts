/**
 * The slice of the browser's FileSystemEntry that a drop hands over. Declared
 * here rather than using the DOM type so the walk can be tested without one.
 */
export interface DroppedEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  /** "/folder/file.txt" — rooted at the drop, not at the user's disk. */
  fullPath: string
  file?: (ok: (file: File) => void, fail?: (err: unknown) => void) => void
  createReader?: () => {
    readEntries: (ok: (entries: DroppedEntry[]) => void, fail?: (err: unknown) => void) => void
  }
}

export interface DroppedFile {
  relativePath: string
  file: File
}

function readFile(entry: DroppedEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file!(resolve, reject))
}

/**
 * Every entry in a directory. readEntries returns them in pages — 100 at a
 * time in Chrome — and an empty page is the only end-of-list signal, so a
 * single call quietly drops everything after the first hundred.
 */
async function readAllEntries(dir: DroppedEntry): Promise<DroppedEntry[]> {
  const reader = dir.createReader!()
  const all: DroppedEntry[] = []
  for (;;) {
    const page = await new Promise<DroppedEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject)
    )
    if (page.length === 0) return all
    all.push(...page)
  }
}

/**
 * Flatten dropped files and folders into files with their paths relative to
 * the drop, so a dropped folder lands with its structure the way a picked one
 * does.
 */
export async function collectDroppedFiles(entries: DroppedEntry[]): Promise<DroppedFile[]> {
  const out: DroppedFile[] = []
  const walk = async (entry: DroppedEntry): Promise<void> => {
    if (entry.isFile && entry.file) {
      out.push({ relativePath: entry.fullPath.replace(/^\/+/, ""), file: await readFile(entry) })
    } else if (entry.isDirectory && entry.createReader) {
      for (const child of await readAllEntries(entry)) await walk(child)
    }
  }
  for (const entry of entries) await walk(entry)
  return out
}

/**
 * Pull entries out of a drop event. Must run synchronously inside the drop
 * handler: the browser empties the DataTransfer as soon as the handler returns.
 * A browser without entries (or a synthetic drop) falls back to plain files.
 */
export function entriesFromDataTransfer(dt: DataTransfer): { entries: DroppedEntry[]; loose: File[] } {
  const entries: DroppedEntry[] = []
  const loose: File[] = []
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue
    const entry = item.webkitGetAsEntry?.() as DroppedEntry | null | undefined
    if (entry) {
      entries.push(entry)
      continue
    }
    const file = item.getAsFile()
    if (file) loose.push(file)
  }
  return { entries, loose }
}
