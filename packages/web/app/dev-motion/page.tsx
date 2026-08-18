"use client"

import { LoadingState } from "@/components/ui/LoadingState"
import { DictationControl } from "@/components/chat/DictationControl"
import { useModelSweep } from "@/components/chat/ModelSweep"
import { SelectionActions } from "@/components/workspaces/SelectionActions"
import { GlassContainer } from "@/components/glass-ui/GlassContainer"
import { PillButton, IconButton, PrimaryAction } from "@/components/glass-ui/Buttons"
import { TextInputArea } from "@/components/glass-ui/TextInputArea"
import { Plus, Pencil, ArrowUp } from "lucide-react"

/**
 * Visual harness for the motion primitives.
 *
 * Not linked from anywhere — it exists so the loaders, keyframes and token
 * scale can be checked in a real browser without needing a signed-in session
 * and a running agent to reach them.
 */
function SweepDemo() {
  const { canvas, play } = useModelSweep()
  return (
    <div
      className="relative isolate overflow-hidden rounded-[28px] border border-line bg-surface p-6 shadow-card"
      style={{ backdropFilter: "blur(40px) saturate(140%)" }}
      data-testid="sweep"
    >
      {canvas}
      <p className="relative z-10 text-ink text-sm">Composer surface</p>
      <button
        type="button"
        onClick={play}
        data-testid="sweep-play"
        className="relative z-10 mt-3 rounded-full bg-ink px-3 py-1.5 text-[12px] text-white cursor-pointer"
      >
        Play sweep
      </button>
    </div>
  )
}

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
        <h2 className="text-ink-2 text-sm">Composer chrome</h2>
        <div className="w-full max-w-[52rem]" data-testid="composer">
          <GlassContainer className="flex flex-col relative">
            <div className="relative z-10 w-full">
              <TextInputArea value="" onChange={() => {}} placeholder="Enter prompt or /merge..." />
            </div>
            <div className="relative z-10 flex justify-between items-center w-full gap-1 px-1 pb-0.5">
              <div className="flex items-center gap-1">
                <IconButton type="button" icon={<Plus className="h-3.5 w-3.5" />} />
                <PillButton type="button" icon={<Pencil className="h-3.5 w-3.5" />} label="Edit" />
              </div>
              <div className="flex items-center gap-1">
                <DictationControl isListening={false} permissionDenied={false} transcript="" error={null} onToggle={() => {}} />
                <PrimaryAction type="button" icon={<ArrowUp className="h-3.5 w-3.5" />} />
              </div>
            </div>
          </GlassContainer>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-ink-2 text-sm">SelectionActions</h2>
        <div className="rounded-xl bg-surface p-6 shadow-card">
          <SelectionActions
            workspaceId="dev"
            selection="Churn it first thing Saturday so the batch has time to firm up."
            onApply={() => {}}
            onDismiss={() => {}}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-ink-2 text-sm">Model sweep (glimm)</h2>
        <SweepDemo />
      </section>

      <section className="space-y-4">
        <h2 className="text-ink-2 text-sm">DictationControl</h2>
        <div className="flex flex-wrap items-center gap-4 rounded-xl bg-surface p-6 shadow-card" data-testid="dictation">
          <DictationControl isListening={false} permissionDenied={false} transcript="" error={null} onToggle={() => {}} />
          <DictationControl isListening permissionDenied={false} transcript="" error={null} onToggle={() => {}} />
          <DictationControl isListening permissionDenied={false} transcript="compare pistachio weekends to last summer" error={null} onToggle={() => {}} />
          <DictationControl isListening={false} permissionDenied transcript="" error={null} onToggle={() => {}} />
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
