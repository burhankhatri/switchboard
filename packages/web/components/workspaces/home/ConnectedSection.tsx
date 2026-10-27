"use client"

import { Plug } from "lucide-react"

interface ConnectionSummary {
  id: string
  name: string
  description: string | null
  baseUrl: string | null
  kind: string
}

export function ConnectedSection({ connections }: { connections: ConnectionSummary[] }) {
  if (connections.length === 0) return null
  return (
    <section className="mt-8">
      <h2 className="text-[11px] uppercase tracking-wide text-ink-3">Connected</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {connections.map((c) => (
          <div key={c.id} className="rounded-xl border border-line bg-surface p-3 shadow-hairline">
            <div className="flex items-center gap-1.5">
              <Plug className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate text-[13px] font-medium text-ink">{c.name}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-3">
              {c.description ?? c.baseUrl ?? (c.kind === "mcp" ? "MCP server" : "REST API")}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
