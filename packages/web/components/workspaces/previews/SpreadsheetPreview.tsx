"use client"

import { useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { SheetModel } from "@/lib/file-preview/spreadsheet"
import { MAX_COLUMNS, MAX_ROWS } from "@/lib/file-preview/spreadsheet-limits"
import { cn } from "@/lib/utils"

const ROW_HEIGHT = 26
const GUTTER_WIDTH = 52
const NUMERIC = /^[-+(]?[$€£]?[\d,]*\.?\d+%?\)?$/

/** A, B, … Z, AA, AB — the labels Excel shows, so a member can say "column F". */
function columnLabel(index: number): string {
  let label = ""
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label
  return label
}

/** Width from the widest value near the top; sampling keeps a 23k-row sheet instant. */
function columnWidths(rows: string[][], count: number): number[] {
  const widths = Array.from({ length: count }, () => 56)
  for (const row of rows.slice(0, 400)) {
    row.forEach((cell, i) => { widths[i] = Math.max(widths[i], Math.min(320, cell.length * 7 + 18)) })
  }
  return widths
}

export function SpreadsheetPreview({ sheets }: { sheets: SheetModel[] }) {
  const [active, setActive] = useState(0)
  const sheet = sheets[Math.min(active, sheets.length - 1)]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sheet && sheet.rows.length > 0 ? (
        <SheetGrid key={sheet.name} sheet={sheet} />
      ) : (
        <p className="flex-1 p-6 text-sm text-muted-foreground">This sheet is empty.</p>
      )}
      {(sheet?.truncatedRows || sheet?.truncatedColumns) && (
        <p className="shrink-0 border-t border-border bg-muted/30 px-3 py-1 text-[11px] text-muted-foreground">
          Showing the first {sheet.truncatedRows ? `${MAX_ROWS.toLocaleString()} rows` : ""}
          {sheet.truncatedRows && sheet.truncatedColumns ? " and " : ""}
          {sheet.truncatedColumns ? `${MAX_COLUMNS} columns` : ""}. Download the file to see everything.
        </p>
      )}
      {sheets.length > 1 && (
        <div role="tablist" aria-label="Sheets" className="flex shrink-0 gap-px overflow-x-auto border-t border-border bg-muted/40 px-2">
          {sheets.map((s, i) => (
            <button
              key={`${i}-${s.name}`}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "shrink-0 cursor-pointer border-x border-b-2 border-transparent px-3 py-1 text-[12px]",
                i === active ? "border-b-primary bg-background font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SheetGrid({ sheet }: { sheet: SheetModel }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnCount = useMemo(() => sheet.rows.reduce((max, row) => Math.max(max, row.length), 0), [sheet])
  const widths = useMemo(() => columnWidths(sheet.rows, columnCount), [sheet, columnCount])
  const template = `${GUTTER_WIDTH}px ${widths.map((w) => `${w}px`).join(" ")}`
  const totalWidth = GUTTER_WIDTH + widths.reduce((sum, w) => sum + w, 0)
  const rows = useVirtualizer({
    count: sheet.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  return (
    <div ref={scrollRef} role="table" aria-label={sheet.name} aria-rowcount={sheet.rows.length} className="relative min-h-0 flex-1 overflow-auto text-[12px]">
      <div style={{ width: totalWidth, height: rows.getTotalSize() + ROW_HEIGHT }} className="relative">
        <div role="row" style={{ gridTemplateColumns: template, height: ROW_HEIGHT }} className="sticky top-0 z-20 grid border-b border-border bg-muted text-muted-foreground">
          <div className="sticky left-0 z-10 border-r border-border bg-muted" />
          {widths.map((_, i) => (
            <div key={i} role="columnheader" className="flex items-center justify-center border-r border-border font-medium">{columnLabel(i)}</div>
          ))}
        </div>
        {rows.getVirtualItems().map((item) => {
          const cells = sheet.rows[item.index]
          return (
            <div
              key={item.key}
              role="row"
              aria-rowindex={item.index + 1}
              style={{ gridTemplateColumns: template, height: ROW_HEIGHT, transform: `translateY(${item.start + ROW_HEIGHT}px)` }}
              className="absolute left-0 top-0 grid w-full border-b border-border/60"
            >
              <div className="sticky left-0 z-10 flex items-center justify-end border-r border-border bg-muted pr-2 tabular-nums text-muted-foreground">{item.index + 1}</div>
              {widths.map((_, i) => {
                const value = cells[i] ?? ""
                return (
                  <div
                    key={i}
                    role="cell"
                    title={value.length * 7 + 18 > widths[i] ? value : undefined}
                    className={cn("truncate border-r border-border/60 px-2 leading-[26px]", NUMERIC.test(value) && "text-right tabular-nums")}
                  >
                    {value}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
