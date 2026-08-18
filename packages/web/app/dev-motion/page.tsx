"use client"

import { LoadingState } from "@/components/ui/LoadingState"

/**
 * Visual harness for the motion primitives.
 *
 * Not linked from anywhere — it exists so the loaders, keyframes and token
 * scale can be checked in a real browser without needing a signed-in session
 * and a running agent to reach them.
 */
export default function MotionDevPage() {
  return (
    <div className="min-h-screen bg-canvas p-10 space-y-8">
      <h1 className="text-ink text-xl font-semibold">Motion</h1>

      <section className="space-y-4">
        <h2 className="text-ink-2 text-sm">LoadingState</h2>
        <div className="space-y-3 rounded-xl bg-surface p-6 shadow-card" data-testid="loaders">
          <LoadingState label="Creating sandbox" variant="Drive" />
          <LoadingState label="Responding" variant="Dots" />
          <LoadingState label="Thinking" variant="Orbit" />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-ink-2 text-sm">Ink scale</h2>
        <p className="text-ink">ink — primary text</p>
        <p className="text-ink-2">ink-2 — secondary text</p>
        <p className="text-ink-3">ink-3 — tertiary text</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-ink-2 text-sm">Surfaces</h2>
        <div className="flex gap-3">
          <div className="rounded-chip bg-surface p-4 shadow-raised text-ink text-sm">raised</div>
          <div className="rounded-chip bg-inset p-4 text-ink text-sm">inset</div>
          <div className="rounded-chip bg-field p-4 shadow-hairline text-ink text-sm">field</div>
          <div className="rounded-chip border border-line-strong p-4 text-ink text-sm">line-strong</div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-ink-2 text-sm">streaming-markdown</h2>
        <div className="streaming-markdown rounded-xl bg-surface p-4 text-ink text-sm">
          <p>Each direct child resolves out of blur.</p>
          <p>Second block.</p>
        </div>
      </section>
    </div>
  )
}
