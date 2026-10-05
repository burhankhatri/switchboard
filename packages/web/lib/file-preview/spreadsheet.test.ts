import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { parseSpreadsheet, parseDelimited, MAX_COLUMNS } from "./spreadsheet"

/** A real workbook, written by the same library the app reads with. */
function workbook(bookType: XLSX.BookType, sheets: Record<string, XLSX.WorkSheet>): Uint8Array {
  const wb = XLSX.utils.book_new()
  for (const [name, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, name)
  return new Uint8Array(XLSX.write(wb, { bookType, type: "array" }) as ArrayBuffer)
}

describe("parseSpreadsheet", () => {
  it("reads every sheet of a macro-enabled workbook in order, showing cached formula results", () => {
    const rates = XLSX.utils.aoa_to_sheet([["Utility", "kWh", "Rate", "Cost"], ["Chariot", 1200, 0.085, null]])
    rates.D2 = { t: "n", v: 102, f: "B2*C2", w: "102" }
    const notes = XLSX.utils.aoa_to_sheet([["Updated", "Oct 5"]])

    const sheets = parseSpreadsheet(workbook("xlsm", { Rates: rates, Notes: notes }))

    expect(sheets.map((s) => s.name)).toEqual(["Rates", "Notes"])
    expect(sheets[0].rows).toEqual([["Utility", "kWh", "Rate", "Cost"], ["Chariot", "1200", "0.085", "102"]])
    expect(sheets[1].rows).toEqual([["Updated", "Oct 5"]])
  })

  it("reads OpenDocument spreadsheets", () => {
    const sheets = parseSpreadsheet(workbook("ods", { Budget: XLSX.utils.aoa_to_sheet([["Line", "Total"], ["Fees", 40]]) }))
    expect(sheets[0].rows).toEqual([["Line", "Total"], ["Fees", "40"]])
  })

  it(`caps very wide sheets at ${MAX_COLUMNS} columns and says so`, () => {
    const wide = XLSX.utils.aoa_to_sheet([Array.from({ length: MAX_COLUMNS + 50 }, (_, i) => `c${i}`)])
    const [sheet] = parseSpreadsheet(workbook("xlsx", { Wide: wide }))
    expect(sheet.rows[0]).toHaveLength(MAX_COLUMNS)
    expect(sheet.truncatedColumns).toBe(true)
  })

  it("refuses bytes that are not a workbook instead of showing them as cells", () => {
    expect(() => parseSpreadsheet(new TextEncoder().encode("not a workbook at all"), "Chariot.xlsm")).toThrow(/not a valid workbook/)
  })
})

describe("parseDelimited", () => {
  it("keeps quoted commas and UTF-8 text intact", () => {
    const [sheet] = parseDelimited('Customer,Note\n"Acme, Inc.",Café rate\n', "csv")
    expect(sheet.rows).toEqual([["Customer", "Note"], ["Acme, Inc.", "Café rate"]])
  })

  it("splits TSV on tabs, not commas", () => {
    const [sheet] = parseDelimited("Name\tAmount\nA, B\t1,200\n", "tsv")
    expect(sheet.rows).toEqual([["Name", "Amount"], ["A, B", "1,200"]])
  })
})
