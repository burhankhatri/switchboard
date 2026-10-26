"use client"

import { useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { ChartContent } from "@/lib/workspace-home/widgets"
import { TableBody, WidgetFooter } from "./bodies"

// Fixed order, never cycled: the validator passed this order for adjacent
// series in both themes, and the schema caps a chart at six series.
const SERIES = [1, 2, 3, 4, 5, 6].map((n) => `var(--series-${n})`)

const axisTick = { fill: "var(--ink-3)", fontSize: 11 }

/**
 * Loaded on demand: recharts is heavy, and most home pages have no chart.
 *
 * Three light-theme series colours sit under 3:1 against the surface, so a
 * chart always has a table view and, for two or more series, a legend —
 * identity never rests on colour alone.
 */
export default function ChartBody({ content }: { content: ChartContent }) {
  const [asTable, setAsTable] = useState(false)
  const data = content.labels.map((label, i) => {
    const row: Record<string, string | number | null> = { label }
    content.series.forEach((s, j) => {
      row[`s${j}`] = s.values[i] ?? null
    })
    return row
  })
  const many = content.series.length > 1

  const common = (
    <>
      <CartesianGrid stroke="var(--line)" vertical={false} />
      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={16} />
      <YAxis
        tick={axisTick}
        tickLine={false}
        axisLine={false}
        width={44}
        label={
          content.yLabel
            ? { value: content.yLabel, angle: -90, position: "insideLeft", fill: "var(--ink-3)", fontSize: 11 }
            : undefined
        }
      />
      <Tooltip
        cursor={content.kind === "bar" ? { fill: "var(--hover)" } : { stroke: "var(--line-strong)" }}
        contentStyle={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          fontSize: 12,
          color: "var(--ink)",
        }}
        labelStyle={{ color: "var(--ink-2)" }}
      />
      {many && <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} iconSize={8} />}
    </>
  )

  return (
    <div>
      {asTable ? (
        <TableBody
          content={{
            columns: ["", ...content.series.map((s) => s.name)],
            rows: content.labels.map((label, i) => [label, ...content.series.map((s) => s.values[i] ?? null)]),
          }}
        />
      ) : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            {content.kind === "line" ? (
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                {common}
                {content.series.map((s, j) => (
                  <Line
                    key={j}
                    dataKey={`s${j}`}
                    name={s.name}
                    stroke={SERIES[j]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
                {common}
                {content.series.map((s, j) => (
                  <Bar
                    key={j}
                    dataKey={`s${j}`}
                    name={s.name}
                    fill={SERIES[j]}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-1 flex justify-end">
        <button
          onClick={() => setAsTable((v) => !v)}
          className="text-[11px] text-ink-3 hover:text-ink-2 cursor-pointer"
        >
          {asTable ? "View as chart" : "View as table"}
        </button>
      </div>
      <WidgetFooter note={content.note} link={content.link} />
    </div>
  )
}
