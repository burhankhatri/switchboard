"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUp, Check, CircleAlert, Lightbulb, Loader2, Pencil, Sparkles, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { workspaceHomeKey } from "@/lib/query/hooks/useWorkspaceHome"
import { isHomeActive, type HomeEvidence } from "@/lib/workspace-home/ai-contract"
import type { HomeAiView } from "@/lib/workspace-home/ai-view"
import type { WidgetDto } from "@/lib/workspace-home/widget-dto"
import { cn } from "@/lib/utils"
import { ago } from "./time"
import { WidgetPreview } from "./widgets/WidgetPreview"

type AiContext = { data?: HomeAiView; send: (body: Record<string, unknown>) => Promise<void>; error: string | null }
const Context = createContext<AiContext | null>(null)
export const useHomeAi = () => useContext(Context)

export function HomeAiProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const cache = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const queryKey = ["home-ai", workspaceId]
  const query = useQuery<HomeAiView>({ queryKey, queryFn: async () => {
    const r = await fetch(`/api/workspaces/${workspaceId}/home/ai`)
    if (!r.ok) throw new Error("Home AI could not load. Please retry.")
    return r.json()
  }, refetchInterval: q => q.state.data?.operations.some(op => isHomeActive(op.status)) ? 2500 : 15_000, retry: false })
  useEffect(() => {
    const events = new EventSource(`/api/workspaces/${workspaceId}/home/ai/events`)
    events.onmessage = () => {
      void cache.invalidateQueries({ queryKey: ["home-ai", workspaceId] })
      void cache.invalidateQueries({ queryKey: workspaceHomeKey(workspaceId) })
    }
    return () => events.close()
  }, [workspaceId, cache])
  // Also invalidate on polling receipts, so a proxy blocking SSE cannot hide a save.
  const receiptVersion = query.data?.operations.map(op => `${op.id}:${op.receipts.length}:${op.status}`).join("|")
  useEffect(() => { void cache.invalidateQueries({ queryKey: workspaceHomeKey(workspaceId) }) }, [receiptVersion, workspaceId, cache])
  const send = async (body: Record<string, unknown>) => {
    setError(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/home/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error ?? "Unable to start home AI")
      await cache.invalidateQueries({ queryKey })
    } catch (e) { const message = e instanceof Error ? e.message : "Unable to start home AI"; setError(message); throw e }
  }
  return <Context.Provider value={{ data: query.data, send, error: error ?? query.error?.message ?? null }}>{children}</Context.Provider>
}

const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium hover:bg-hover disabled:opacity-50 cursor-pointer"

export function HomeAiPrompt({ prompt: initial, widget, insight, children, className, label }: {
  prompt: string; widget?: WidgetDto; insight?: HomeAiView["insights"][number]; children?: ReactNode; className?: string; label?: string
}) {
  const ai = useHomeAi()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState(initial)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestKey = useRef<string | null>(null)
  if (!ai) return null
  const submit = async () => {
    if (!prompt.trim() || sending) return
    setSending(true); setError(null)
    requestKey.current ??= crypto.randomUUID()
    try {
      await ai.send({ action: "start", kind: insight ? "edit-insight" : widget ? "edit" : "create", prompt,
        requestKey: requestKey.current, ...((widget ?? insight) ? { targetId: (widget ?? insight)!.id, targetVersion: (widget ?? insight)!.updatedAt } : {}) })
      setOpen(false); requestKey.current = null
    } catch (e) { setError(e instanceof Error ? e.message : "Please retry") }
    finally { setSending(false) }
  }
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) { setPrompt(initial); setError(null); requestKey.current = null } }}>
    <PopoverTrigger asChild><button type="button" aria-label={label ?? ((widget ?? insight) ? `Edit ${(widget ?? insight)!.title} with AI` : "Ask agent")} className={cn(buttonClass, className)}>
      {children ?? <Pencil className="h-3.5 w-3.5" />}
    </button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] rounded-2xl border-line bg-surface p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-medium">{(widget ?? insight) ? `Edit ${(widget ?? insight)!.title}` : "Ask your workspace agent"}</p><button aria-label="Close prompt" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div>
      <label className="sr-only" htmlFor={`home-prompt-${widget?.id ?? "create"}`}>Describe the change</label>
      <textarea id={`home-prompt-${widget?.id ?? "create"}`} value={prompt} onChange={e => { setPrompt(e.target.value); requestKey.current = null }} maxLength={4000}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() } }}
        className="min-h-32 w-full resize-y rounded-xl border border-line bg-inset p-3 text-sm outline-none focus:border-primary" />
      <p className="mt-2 text-[11px] text-ink-3">Uses conversations from everyone in this workspace. Changes appear here as they are saved.</p>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex justify-end"><button onClick={() => void submit()} disabled={sending || !prompt.trim()} className={cn(buttonClass, "bg-primary text-primary-foreground hover:opacity-90")}>
        {sending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="h-4 w-4" />} {sending ? "Starting…" : "Send"}
      </button></div>
    </PopoverContent>
  </Popover>
}

export function HomeAiCardProgress({ widgetId }: { widgetId: string }) {
  const ai = useHomeAi()
  const op = ai?.data?.operations.find(o => isHomeActive(o.status) && (o.targetId === widgetId || o.plan?.changes.some(c => c.targetId === widgetId)))
  if (!op) return null
  return <div className="mb-4 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2" role="status" aria-live="polite">
    <span className="flex items-center gap-2 text-xs"><Sparkles className="h-3.5 w-3.5 motion-safe:animate-pulse" />{op.stage}</span>
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-primary/10"><div className="h-full w-1/2 rounded-full bg-primary/60 motion-safe:animate-pulse" /></div>
  </div>
}

function Sources({ evidence, onOpenChat }: { evidence: HomeEvidence[]; onOpenChat: (id: string) => void }) {
  return <div className="mt-3 flex flex-wrap gap-1.5">{evidence.map((e, i) => <span key={i} className="rounded-full bg-inset px-2 py-1 text-[10px] text-ink-2">
    {e.chatId ? <button className="hover:underline" onClick={() => onOpenChat(e.chatId)}>{e.author} · {new Date(e.date).toLocaleDateString()}</button> : `${e.author} · ${new Date(e.date).toLocaleDateString()}`}
  </span>)}</div>
}

export function HomeAiPanel({ onOpenChat }: { onOpenChat: (id: string) => void }) {
  const ai = useHomeAi()
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(false)
  if (!ai) return null
  const act = (body: Record<string, unknown>) => { void ai.send(body).catch(() => {}) }
  const latest = ai.data?.operations.find(o => o.kind === "suggestions" && o.status === "completed")
  const active = ai.data?.operations.filter(o => isHomeActive(o.status)) ?? []
  const failed = ai.data?.operations.filter(o => ["failed", "partial"].includes(o.status)) ?? []
  const suggest = async () => {
    setSuggestionsOpen(true); setBusy(true)
    try { await ai.send({ action: "start", kind: "suggestions", prompt: "Suggest useful home improvements based on workspace conversations and current components. Prefer updating existing components when relevant; include a summary if missing. Use real evidence only.", requestKey: crypto.randomUUID() }) } catch { /* Error is rendered below. */ }
    finally { setBusy(false) }
  }
  return <section className="mt-5 space-y-3" aria-label="Workspace AI">
    <div className="flex flex-wrap items-center gap-2">
      <HomeAiPrompt prompt="Improve this workspace home using recent team conversations. Update existing components where possible and surface important changes."><Sparkles className="h-4 w-4" />Ask agent</HomeAiPrompt>
      <button className={cn(buttonClass, "border border-line bg-surface")} disabled={busy || active.some(o => o.kind === "suggestions")} onClick={() => { if (latest && !suggestionsOpen) setSuggestionsOpen(true); else void suggest() }}><Lightbulb className="h-4 w-4" />{busy ? "Starting…" : "Suggestions"}</button>
      <button className={cn(buttonClass, "ml-auto text-ink-3")} onClick={() => setHistory(!history)}>{history ? "Hide activity" : "AI activity"}</button>
    </div>
    <p className="text-[11px] text-ink-3">Home AI reads all workspace members’ conversations, including unshared chats, to produce findings visible to the team. Private transcripts stay private.</p>
    {ai.error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{ai.error}</p>}
    {ai.data && !ai.data.enabled && <p className="text-xs text-ink-3">Home AI is unavailable until the server’s AI provider is configured.</p>}
    {active.map(op => <div key={op.id} className="relative overflow-hidden rounded-2xl border border-primary/25 bg-primary/5 p-4" role="status" aria-live="polite">
      <div className="flex items-center gap-3"><Loader2 className="h-5 w-5 text-primary motion-safe:animate-spin" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{op.stage}</p><p className="mt-0.5 text-xs text-ink-3">{op.receipts.length ? `${op.receipts.length} changes saved · ` : ""}You can keep working while AI updates this page.</p></div>
        {op.canManage && <button className={buttonClass} onClick={() => act({ action: "cancel", operationId: op.id })}>Stop</button>}</div>
      <ol className="mt-3 flex gap-2 text-[10px] text-ink-3">{["Read context", "Prepare", "Save"].map((s, i) => <li key={s} className={cn("flex-1 border-t-2 pt-2", (op.stage.startsWith("Saving") || op.stage.startsWith("Updating") ? 2 : /[Pp]repar/.test(op.stage) ? 1 : 0) >= i ? "border-primary text-ink" : "border-line")}>{s}</li>)}</ol>
    </div>)}
    {failed.slice(0, 3).map(op => <div key={op.id} role="alert" className="rounded-xl border border-destructive/25 p-3 text-xs"><p className="font-medium">{op.status === "partial" ? `${op.receipts.length} changes saved; remaining work needs attention` : "AI could not finish"}</p><p className="mt-1 text-ink-2">{op.error}</p>{op.canManage && <button className={buttonClass} onClick={() => act({ action: "retry", operationId: op.id })}>Retry remaining work</button>}</div>)}
    {suggestionsOpen && <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium">Suggested improvements</h2><div className="flex items-center gap-2"><button className={buttonClass} onClick={() => void suggest()} disabled={busy || active.some(o => o.kind === "suggestions")}>Refresh</button><button aria-label="Close suggestions" onClick={() => setSuggestionsOpen(false)}><X className="h-4 w-4" /></button></div></div>
      {!latest && <p className="text-xs text-ink-3">Reading conversations and comparing them with your current home…</p>}
      {latest && !latest.plan?.changes.filter((_, i) => !latest.dismissed.includes(i)).length && <p className="text-xs text-ink-3">No new suggestions to review. Refresh after more workspace activity.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{latest?.plan?.changes.map((c, i) => latest.dismissed.includes(i) ? null : <article key={i} className="rounded-xl border border-line p-4">
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{c.targetId ? "Update" : "Create"} · {c.type}</span><h3 className="mt-1 text-sm font-medium">{c.title}</h3><p className="mt-2 text-xs text-ink-2">{c.reason}</p>
        <details className="mt-3 text-xs"><summary className="cursor-pointer text-ink-2">Preview content</summary><div className="mt-3 min-w-0 rounded-lg bg-inset/40 p-3"><WidgetPreview change={c} /></div></details>
        <Sources evidence={c.evidence} onOpenChat={onOpenChat} />
        <div className="mt-3 flex gap-2"><button className={cn(buttonClass, "bg-primary text-primary-foreground")} onClick={() => act({ action: "accept", operationId: latest.id, index: i })}><Check className="h-3.5 w-3.5" />Accept</button><button className={buttonClass} onClick={() => act({ action: "dismiss", operationId: latest.id, index: i })}>Dismiss</button></div>
      </article>)}</div>
    </div>}
    {!!ai.data?.insights.length && <div><h2 className="mb-3 mt-5 text-[11px] uppercase tracking-wide text-ink-3">On the team’s radar</h2><div className="grid gap-3 sm:grid-cols-2">{ai.data.insights.map(insight => <article key={insight.id} className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        {insight.status === "resolved" ? <Check className="h-4 w-4 text-emerald-600" /> : <CircleAlert className="h-4 w-4 text-amber-600" />}
        <span className="text-[10px] uppercase tracking-wide text-ink-3">{insight.kind} · {insight.status}</span>
        <HomeAiPrompt className="ml-auto p-1" insight={insight} prompt={`Update this finding (${insight.title}) based on the workspace conversations. Describe the change you want.`} />
      </div>
      <HomeAiCardProgress widgetId={insight.id} />
      <h3 className="mt-2 text-sm font-medium">{insight.title}</h3><p className="mt-1 text-xs leading-relaxed text-ink-2">{insight.detail}</p><Sources evidence={insight.evidence} onOpenChat={onOpenChat} /><p className="mt-2 text-[10px] text-ink-3">Updated {ago(insight.updatedAt)}</p>
    </article>)}</div></div>}
    {history && <ul className="divide-y divide-line rounded-xl border border-line p-3">{ai.data?.operations.map(op => <li key={op.id} className="py-2 text-xs"><span className="font-medium">{op.kind} · {op.status}</span><p className="text-ink-3">{op.stage} · {ago(op.createdAt)}</p>{op.receipts.map(r => <p key={r.id} className="mt-1 text-ink-2">✓ {r.title}</p>)}</li>)}</ul>}
  </section>
}

export function HomeSkeleton() {
  return <div className="mt-6 space-y-3" role="status" aria-label="Loading workspace home"><span className="text-xs text-ink-3">Bringing your workspace up to date…</span><div className="rounded-2xl border border-line p-6 motion-safe:animate-pulse"><div className="h-3 w-24 rounded bg-inset" /><div className="mt-5 h-7 w-3/4 rounded bg-inset" /><div className="mt-5 grid grid-cols-2 gap-3"><div className="h-16 rounded-xl bg-inset" /><div className="h-16 rounded-xl bg-inset" /></div></div><div className="grid grid-cols-2 gap-3">{[0, 1].map(i => <div key={i} className="h-40 rounded-2xl border border-line bg-inset/40 motion-safe:animate-pulse" />)}</div></div>
}
