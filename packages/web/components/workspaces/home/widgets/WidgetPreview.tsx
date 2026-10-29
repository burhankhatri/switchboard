"use client"
import dynamic from "next/dynamic"
import type { HomeChange } from "@/lib/workspace-home/ai-contract"
import type { SummaryContent, KpisContent, StatContent, TableContent, ChartContent, FunnelContent, TimelineContent, ActionsContent, NoteContent, FileContent, JobContent } from "@/lib/workspace-home/widgets"
import { SummaryBody, KpisBody, FunnelBody, TimelineBody, ActionsBody } from "./visuals"
import { StatBody, TableBody, NoteBody } from "./bodies"
const ChartBody = dynamic(() => import("./ChartBody"), { ssr: false, loading: () => <p role="status" className="py-6 text-xs text-ink-3">Preparing chart preview…</p> })

export function WidgetPreview({ change }: { change: HomeChange }) {
  const c = change.content
  switch (change.type) {
    case "summary": return <SummaryBody content={c as SummaryContent} />
    case "kpis": return <KpisBody content={c as KpisContent} />
    case "stat": return <StatBody content={c as StatContent} />
    case "table": return <TableBody content={c as TableContent} />
    case "chart": return <ChartBody content={c as ChartContent} />
    case "funnel": return <FunnelBody content={c as FunnelContent} />
    case "timeline": return <TimelineBody content={c as TimelineContent} />
    case "actions": return <ActionsBody content={c as ActionsContent} />
    case "note": return <NoteBody content={c as NoteContent} />
    case "file": return <p className="break-all text-xs">File: {(c as FileContent).path}</p>
    case "job": return <p className="text-xs">Live status for job {(c as JobContent).jobId}</p>
  }
}
