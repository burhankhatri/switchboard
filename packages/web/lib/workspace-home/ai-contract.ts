import { z } from "zod"
import { validateWidgetContent, WIDGET_TYPES } from "./widgets"

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

/** Validate identity against server context; model-supplied attribution is never trusted. */
export function groundPlan(plan: HomePlan, sources: HomeEvidence[], widgets: { id: string; updatedAt: string }[], targetId?: string | null) {
  const sourceMap = new Map(sources.map(s => [s.messageId, s]))
  const ground = (items: HomeEvidence[]) => items.map(item => {
    const source = sourceMap.get(item.messageId)
    if (!source || source.chatId !== item.chatId) throw new Error("AI cited an unavailable conversation. Please try again.")
    return source
  })
  const seen = new Set<string>()
  for (const change of plan.changes) {
    if (targetId && change.targetId !== targetId) throw new Error("The edit must target only the selected component.")
    if (seen.has(change.targetId ?? change.key)) throw new Error("AI proposed duplicate components. Please try again.")
    seen.add(change.targetId ?? change.key)
    if (change.targetId) {
      const widget = widgets.find(w => w.id === change.targetId)
      if (!widget) throw new Error("The target component is unavailable.")
      change.version = widget.updatedAt
    } else change.version = null
    change.evidence = ground(change.evidence)
  }
  const insightKeys = new Set<string>()
  for (const insight of plan.insights) {
    if (insightKeys.has(insight.key)) throw new Error("AI proposed duplicate findings. Please retry.")
    insightKeys.add(insight.key)
    insight.evidence = ground(insight.evidence)
  }
  return plan
}
