import { parseDelimited, parseSpreadsheet, type SheetModel } from "./spreadsheet"

export type ParseRequest = { bytes: Uint8Array; name: string; kind: "spreadsheet" | "csv" }
export type ParseResult = { sheets: SheetModel[] } | { error: string }

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { bytes, name, kind } = event.data
  let result: ParseResult
  try {
    result = {
      sheets: kind === "csv"
        ? parseDelimited(new TextDecoder().decode(bytes), /\.tsv$/i.test(name) ? "tsv" : "csv")
        : parseSpreadsheet(bytes, name),
    }
  } catch (err) {
    result = { error: err instanceof Error ? err.message : "Could not read this spreadsheet" }
  }
  self.postMessage(result)
}
