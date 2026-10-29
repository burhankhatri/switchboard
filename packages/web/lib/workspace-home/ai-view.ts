import { prisma } from "@/lib/db/prisma"
import { workspaceVisibleChatIds } from "./chat-visibility"
import { planSchema, type HomeEvidence, type HomePlan } from "./ai-contract"

export interface HomeAiView {
  enabled: boolean
  operations: { id: string; kind: string; targetId: string | null; request: string | null; status: string; stage: string; sequence: number; error: string | null;
    plan: HomePlan | null; dismissed: number[]; receipts: { id: string; title: string }[]; canManage: boolean; createdAt: string }[]
  insights: { id: string; key: string; title: string; detail: string; kind: string; status: string; evidence: HomeEvidence[]; updatedAt: string }[]
}

export async function homeAiView(workspaceId: string, userId: string, enabled: boolean): Promise<HomeAiView> {
  const [operations, insights] = await Promise.all([
    prisma.homeOperation.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.homeInsight.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" }, take: 20 }),
  ])
  const evidence = insights.flatMap(i => i.evidence as HomeEvidence[])
  const plans = new Map(operations.map(op => [op.id, op.plan ? planSchema.parse(op.plan) : null]))
  for (const plan of plans.values()) if (plan) evidence.push(...plan.changes.flatMap(c => c.evidence), ...plan.insights.flatMap(i => i.evidence))
  const visible = await workspaceVisibleChatIds(workspaceId, evidence.map(e => e.chatId))
  const safe = (items: HomeEvidence[]) => items.map(e => ({ ...e, chatId: visible.has(e.chatId) ? e.chatId : "", messageId: visible.has(e.chatId) ? e.messageId : "" }))
  return { enabled, operations: operations.map(op => {
    const plan = plans.get(op.id) ?? null
    if (plan) { plan.changes.forEach(c => { c.evidence = safe(c.evidence) }); plan.insights.forEach(i => { i.evidence = safe(i.evidence) }) }
    // Only the requester sees what they typed; other members see what the work is for.
    const typed = op.userId === userId && ["create", "edit", "edit-insight"].includes(op.kind)
    const request = typed ? (op.prompt.length > 160 ? `${op.prompt.slice(0, 159).trimEnd()}…` : op.prompt) : null
    return { id: op.id, kind: op.kind, targetId: op.targetId, request, status: op.status, stage: op.stage, sequence: op.sequence,
      error: op.error, plan, dismissed: op.dismissed as number[], receipts: op.receipts as { id: string; title: string }[], canManage: op.userId === userId, createdAt: op.createdAt.toISOString() }
  }), insights: insights.map(i => ({ id: i.id, key: i.key, title: i.title, detail: i.detail, kind: i.kind, status: i.status, evidence: safe(i.evidence as HomeEvidence[]), updatedAt: i.updatedAt.toISOString() })) }
}
