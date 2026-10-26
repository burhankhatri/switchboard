import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "./widgets"

/**
 * What a chat message could become on the home page, best guess first.
 *
 * Done on the client from the message text, with no model call: an agent's
 * answer that contains a table should pin as that table, and a one-line
 * answer that is a single number should pin as that number. Everything else
 * pins as a note. The person sees the proposal and can switch before saving.
 */

export type PinProposal =
  | { type: "table"; title: string; content: { columns: string[]; rows: (string | number | null)[][] } }
  | { type: "stat"; title: string; content: { value: number | string; note?: string } }
  | { type: "note"; title: string; content: { markdown: string } }

const CELL_MAX = 300
const NOTE_MAX = 8000

const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith("|")) s = s.slice(1)
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1)
  // Split on unescaped pipes; an escaped one is part of the cell.
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim())
}

/** Bold and code markers are formatting, not data. */
function plain(cell: string): string {
  return cell.replace(/^\*\*(.*)\*\*$/, "$1").replace(/^`(.*)`$/, "$1").trim()
}

function asCell(raw: string): string | number | null {
  const text = plain(raw)
  if (text === "" || text === "-" || text === "—") return null
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$|^-?\d+(\.\d+)?$/.test(text)) return Number(text.replace(/,/g, ""))
  return text.length > CELL_MAX ? `${text.slice(0, CELL_MAX - 1)}…` : text
}

function titleFrom(line: string | undefined, fallback: string): string {
  const t = (line ?? "").replace(/^#+\s*/, "").replace(/[*_`]/g, "").replace(/:$/, "").trim()
  return (t || fallback).slice(0, 120)
}

export function findMarkdownTable(
  text: string
): { title: string; columns: string[]; rows: (string | number | null)[][] } | null {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].includes("|") || !SEPARATOR.test(lines[i + 1])) continue
    const columns = splitRow(lines[i]).map(plain).slice(0, MAX_TABLE_COLUMNS)
    if (columns.length === 0 || columns.every((c) => !c)) continue
    const rows: (string | number | null)[][] = []
    for (let j = i + 2; j < lines.length && lines[j].includes("|"); j++) {
      if (rows.length >= MAX_TABLE_ROWS) break
      const cells = splitRow(lines[j]).slice(0, columns.length)
      while (cells.length < columns.length) cells.push("")
      rows.push(cells.map(asCell))
    }
    // The nearest non-empty line above the table usually names it.
    let k = i - 1
    while (k >= 0 && !lines[k].trim()) k--
    return {
      title: titleFrom(k >= 0 ? lines[k] : undefined, "Pinned table"),
      columns: columns.map((c, n) => c || `Column ${n + 1}`),
      rows,
    }
  }
  return null
}

const NUMBER = /-?\$?\d[\d,]*(\.\d+)?%?/g

/** A short answer that is essentially one number, e.g. "342 new leads this week." */
export function findHeadlineNumber(text: string): { value: number | string; note?: string } | null {
  const flat = text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim()
  if (!flat || flat.length > 120) return null
  const numbers = flat.match(NUMBER) ?? []
  if (numbers.length !== 1) return null
  const token = numbers[0]
  const bare = token.replace(/[$,%]/g, "")
  const value = token === bare && Number.isFinite(Number(bare)) ? Number(bare) : token
  const note = flat.replace(token, "").replace(/\s+/g, " ").replace(/^[\s:,.-]+|[\s:,.]+$/g, "")
  return note ? { value, note: note.slice(0, 300) } : { value }
}

export function pinProposals(text: string): PinProposal[] {
  const proposals: PinProposal[] = []
  const table = findMarkdownTable(text)
  if (table) {
    proposals.push({ type: "table", title: table.title, content: { columns: table.columns, rows: table.rows } })
  }
  const stat = findHeadlineNumber(text)
  if (stat) {
    // The words around the number are what it counts, so they become the title.
    const title = stat.note ? stat.note.charAt(0).toUpperCase() + stat.note.slice(1) : "Pinned number"
    proposals.push({ type: "stat", title: title.slice(0, 120), content: { value: stat.value } })
  }
  const firstLine = text.split(/\r?\n/).find((l) => l.trim())
  proposals.push({
    type: "note",
    title: titleFrom(firstLine, "Pinned note").slice(0, 60),
    content: { markdown: text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX - 1)}…` : text },
  })
  return proposals
}
