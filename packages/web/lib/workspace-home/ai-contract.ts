import { z } from "zod"
import { MAX_WIDGETS_PER_WORKSPACE, validateWidgetContent, WIDGET_TYPES } from "./widgets"

export const evidenceSchema = z.object({
  chatId: z.string(), messageId: z.string(), author: z.string().max(100), date: z.string().max(40),
}).strict()
export const MAX_EVIDENCE = 8
export const changeSchema = z.object({
  targetId: z.string().nullable(), version: z.string().nullable(),
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  type: z.enum(WIDGET_TYPES), title: z.string().min(1).max(120),
  content: z.unknown(), reason: z.string().max(300), evidence: z.array(evidenceSchema).max(MAX_EVIDENCE),
}).strict().superRefine((c, ctx) => {
  const result = validateWidgetContent(c.type, c.content)
  if (!result.ok) ctx.addIssue({ code: "custom", message: result.error })
})
export const insightSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/), title: z.string().min(1).max(120),
  detail: z.string().max(400), kind: z.enum(["issue", "blocker", "decision"]),
  status: z.enum(["open", "resolved", "noted"]), evidence: z.array(evidenceSchema).min(1).max(MAX_EVIDENCE),
}).strict()
export const MAX_CHANGES = 6
export const MAX_INSIGHTS = 12
export const planSchema = z.object({
  changes: z.array(changeSchema).max(MAX_CHANGES), insights: z.array(insightSchema).max(MAX_INSIGHTS),
}).strict()
export type HomeChange = z.infer<typeof changeSchema>
export type HomePlan = z.infer<typeof planSchema>
export type HomeEvidence = z.infer<typeof evidenceSchema>
export const ACTIVE_HOME_STATUSES = ["queued", "running"]
export function isHomeActive(status: string) { return ACTIVE_HOME_STATUSES.includes(status) }

/**
 * Validate identity against server context; model-supplied attribution is never
 * trusted. A record the server cannot stand behind is dropped rather than failing
 * the run, because one bad citation or a stale id would otherwise throw away
 * every other correct record: citations outside the context are removed, a
 * finding left with none is dropped, and so is a change to a component that does
 * not exist. An edit still fails when nothing targets the selected component.
 */
export function groundPlan(plan: HomePlan, sources: HomeEvidence[], widgets: { id: string; updatedAt: string; key?: string | null }[], targetId?: string | null) {
  const sourceMap = new Map(sources.map(s => [s.messageId, s]))
  const ground = (items: HomeEvidence[]) => {
    const kept = new Map<string, HomeEvidence>()
    for (const item of items) {
      const source = sourceMap.get(item.messageId)
      if (source && source.chatId === item.chatId) kept.set(source.messageId, source)
    }
    return [...kept.values()]
  }
  const seen = new Set<string>()
  let room = MAX_WIDGETS_PER_WORKSPACE - widgets.length
  const proposed = plan.changes.length
  plan.changes = plan.changes.filter(change => {
    // Creating a key that already exists would be refused at save; it is an update.
    const byKey = !change.targetId ? widgets.find(w => w.key && w.key === change.key) : undefined
    if (byKey) change.targetId = byKey.id
    if (targetId && change.targetId !== targetId) return false
    const widget = change.targetId ? widgets.find(w => w.id === change.targetId) : undefined
    if (change.targetId && !widget) return false
    if (seen.has(change.targetId ?? change.key)) return false
    if (!widget && room-- <= 0) return false
    seen.add(change.targetId ?? change.key)
    change.version = widget?.updatedAt ?? null
    change.evidence = ground(change.evidence)
    return true
  })
  if (targetId && proposed && !plan.changes.length) throw new Error("The edit must target only the selected component.")
  const insightKeys = new Set<string>()
  plan.insights = plan.insights.filter(insight => {
    if (insightKeys.has(insight.key)) return false
    insight.evidence = ground(insight.evidence)
    if (!insight.evidence.length) return false
    insightKeys.add(insight.key)
    return true
  })
  return plan
}
