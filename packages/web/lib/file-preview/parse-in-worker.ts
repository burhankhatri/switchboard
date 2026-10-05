import type { SheetModel } from "./spreadsheet"
import type { ParseRequest, ParseResult } from "./spreadsheet.worker"

/**
 * Parse a workbook off the main thread. The real Chariot.xlsm takes about 1.7 s
 * to parse, which would freeze the whole app; in a worker only the preview
 * waits. A fresh worker per parse keeps SheetJS's memory from outliving it.
 */
export function parseInWorker(request: ParseRequest, signal: AbortSignal): Promise<SheetModel[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./spreadsheet.worker.ts", import.meta.url), { type: "module" })
    const finish = () => { worker.terminate(); signal.removeEventListener("abort", onAbort) }
    const onAbort = () => { finish(); reject(new DOMException("Aborted", "AbortError")) }
    signal.addEventListener("abort", onAbort)
    worker.onmessage = (event: MessageEvent<ParseResult>) => {
      finish()
      if ("error" in event.data) reject(new Error(event.data.error))
      else resolve(event.data.sheets)
    }
    worker.onerror = (event) => { finish(); reject(new Error(event.message || "Could not read this spreadsheet")) }
    // Copied, not transferred: the caller's bytes stay cached for the next open.
    worker.postMessage(request)
  })
}
