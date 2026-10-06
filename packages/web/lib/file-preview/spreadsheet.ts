import * as XLSX from "xlsx"
import { MAX_COLUMNS, MAX_ROWS } from "./spreadsheet-limits"

export { MAX_COLUMNS, MAX_ROWS }

export interface SheetModel {
  name: string
  /** Display strings as Excel shows them, with formulas as their last computed value. */
  rows: string[][]
  truncatedColumns: boolean
  truncatedRows: boolean
}

/** Zip-based formats. Anything else with these extensions is corrupt or mislabelled. */
const ZIP_WORKBOOK = /\.(xlsx|xlsm|xlsb|xltx|xltm|ods|numbers)$/i

/**
 * Read a workbook into plain rows.
 *
 * Formulas are never evaluated: SheetJS returns the value Excel cached when the
 * file was last saved, which is what the author saw. SheetJS also falls back to
 * reading unknown bytes as text, so a corrupt .xlsx would come out as a sheet of
 * noise — the zip signature check turns that into a readable error instead.
 */
export function parseSpreadsheet(bytes: Uint8Array, fileName = "workbook.xlsx"): SheetModel[] {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  if (ZIP_WORKBOOK.test(fileName) && !isZip) {
    throw new Error(`${fileName.split("/").pop()} is not a valid workbook`)
  }
  return toModels(XLSX.read(bytes, { type: "array", dense: true, sheetRows: MAX_ROWS + 1, cellStyles: false, cellHTML: false }))
}

/** CSV and TSV, decoded as UTF-8 first so accented text survives. */
export function parseDelimited(text: string, kind: "csv" | "tsv"): SheetModel[] {
  return toModels(XLSX.read(text, { type: "string", dense: true, sheetRows: MAX_ROWS + 1, FS: kind === "tsv" ? "\t" : "," }))
}

function toModels(wb: XLSX.WorkBook): SheetModel[] {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]
    if (!ws?.["!ref"]) return { name, rows: [], truncatedColumns: false, truncatedRows: false }
    const range = XLSX.utils.decode_range(ws["!ref"])
    const lastColumn = Math.min(range.e.c, MAX_COLUMNS - 1)
    const lastRow = Math.min(range.e.r, MAX_ROWS - 1)
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
      range: { s: { r: range.s.r, c: range.s.c }, e: { r: lastRow, c: lastColumn } },
    })
    return {
      name,
      rows: rows.map((row) => row.map((cell) => (cell == null ? "" : String(cell)))),
      truncatedColumns: range.e.c > lastColumn,
      // sheetRows stops the reader one past the cap, so reaching it means more exist.
      truncatedRows: range.e.r > lastRow,
    }
  })
}
