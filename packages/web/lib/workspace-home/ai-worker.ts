import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { createWidget, updateWidget } from "./widget-store"
import { homeContext } from "./ai-context"
import { generateHomePlan, homeAiEnabled, cleanupHomeRuntime } from "./ai-model"
import { ACTIVE_HOME_STATUSES, groundPlan, planSchema, type HomePlan } from "./ai-contract"

const json = (value: unknown) => value as Prisma.InputJsonValue
type DB = Prisma.TransactionClient

async function member(db: DB, workspaceId: string, userId: string) {
  const ws = await db.workspace.findFirst({ where: { id: workspaceId, archived: false, members: { some: { userId } } }, select: { id: true, path: true } })
  if (!ws) throw new Error("Workspace access has changed. Join the workspace to continue.")
  return ws
}

async function stage(id: string, token: string, label: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "HomeOperation" WHERE "id" = ${id} FOR UPDATE`
    const op = await tx.homeOperation.findUniqueOrThrow({ where: { id } })
    if (op.leaseToken !== token || op.status !== "running") throw new Error("Operation stopped")
    if (op.stage === label) return
    const sequence = op.sequence + 1
    await tx.homeOperation.update({ where: { id }, data: { stage: label, sequence,
      events: json([...(op.events as unknown[]), { sequence, stage: label, at: new Date().toISOString() }].slice(-40)) } })
  })
}

/** A lease fences stale workers; each widget and its receipt commit together. */
export async function runHomeOperation(id: string) {
  const token = randomUUID()
  const claimed = await prisma.homeOperation.updateMany({ where: { id, status: { in: ACTIVE_HOME_STATUSES },
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
    data: { status: "running", leaseToken: token, leaseUntil: new Date(Date.now() + 150_000), attempts: { increment: 1 } } })
  if (!claimed.count) return
  try {
    let op = await prisma.homeOperation.findUniqueOrThrow({ where: { id } })
    await member(prisma, op.workspaceId, op.userId)
    if (!op.generationComplete && op.kind !== "accept") {
      let context = op.context as unknown as Awaited<ReturnType<typeof homeContext>> | null
      if (!context) {
        await stage(id, token, "Reading workspace conversations")
        context = await homeContext(op.workspaceId)
        if (op.targetId && !(op.kind === "edit-insight" ? context.insights : context.widgets).some(w => w.id === op.targetId && w.updatedAt === op.targetVersion)) {
          throw new Error("This component changed. Open its pencil again to edit the latest version.")
        }
        await prisma.homeOperation.updateMany({ where: { id, leaseToken: token, status: "running" }, data: { context: json(context), contextVersion: context.version } })
      }
      await stage(id, token, op.runtime ? "Agent is preparing changes" : "Starting workspace agent")
      const generated = await generateHomePlan(op, context, token)
      const plan = groundPlan(generated.plan, context.sources, context.widgets, op.kind === "edit-insight" ? null : op.targetId)
      if (["insights", "edit-insight"].includes(op.kind)) plan.changes = []
      else plan.insights = []
      if (op.kind === "edit-insight") {
        const selected = context.insights.find(i => i.id === op.targetId)?.key
        const proposed = plan.insights.length
        plan.insights = plan.insights.filter(i => i.key === selected)
        if (proposed && !plan.insights.length) throw new Error("Edit only the selected finding")
      }
      // An unsupported suggestion is not shown; it must not cost the supported ones.
      if (op.kind === "suggestions") plan.changes = plan.changes.filter(c => c.evidence.length)
      await prisma.homeOperation.updateMany({ where: { id, leaseToken: token, status: "running" },
        data: { plan: json(plan), generationComplete: generated.complete } })
    }
    op = await prisma.homeOperation.findUniqueOrThrow({ where: { id } })
    const plan = planSchema.parse(op.plan)
    let refused: string | null = null
    if (op.kind !== "suggestions") {
      for (let i = op.cursor; i < plan.changes.length + plan.insights.length; i++) {
        await stage(id, token, plan.changes[i] ? `Saving ${plan.changes[i].title}` : "Updating workspace findings")
        const skipped = await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "HomeOperation" WHERE "id" = ${id} FOR UPDATE`
          const current = await tx.homeOperation.findUniqueOrThrow({ where: { id } })
          if (current.status !== "running" || current.leaseToken !== token) throw new Error("Operation stopped")
          if (current.cursor !== i) return
          const ws = await member(tx, op.workspaceId, op.userId)
          await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${ws.id} FOR UPDATE`
          const change = plan.changes[i]
          let receipt: { id: string; title: string }
          if (change) {
            if (change.targetId) {
              await tx.$queryRaw`SELECT "id" FROM "WorkspaceWidget" WHERE "id" = ${change.targetId} AND "workspaceId" = ${ws.id} FOR UPDATE`
              const target = await tx.workspaceWidget.findFirst({ where: { id: change.targetId, workspaceId: ws.id } })
              if (!target || target.updatedAt.toISOString() !== change.version) throw new Error("A component changed since this preview. Refresh suggestions or reopen the pencil.")
            }
            const actor = { userId: op.userId, via: "agent" as const, chatId: change.evidence[0]?.chatId, messageId: change.evidence[0]?.messageId }
            const result = change.targetId
              ? await updateWidget(ws, { id: change.targetId }, change, actor, tx)
              : await createWidget(ws, { ...change, content: change.content }, actor, tx)
            if (!result.ok) {
              // Accepting is a person's explicit choice, so they hear why it failed.
              // In a generated run the store's refusal (a missing file, a key taken
              // meanwhile, a full home) costs only that component.
              if (op.kind === "accept") throw new Error(result.error)
              await tx.homeOperation.update({ where: { id }, data: { cursor: i + 1 } })
              return result.error
            }
            receipt = { id: result.value.id, title: change.title }
          } else {
            const insight = plan.insights[i - plan.changes.length]
            if (op.kind === "edit-insight") {
              await tx.$queryRaw`SELECT "id" FROM "HomeInsight" WHERE "id" = ${op.targetId} AND "workspaceId" = ${ws.id} FOR UPDATE`
              const target = await tx.homeInsight.findFirst({ where: { id: op.targetId!, workspaceId: ws.id } })
              if (!target || target.updatedAt.toISOString() !== op.targetVersion) throw new Error("This finding changed. Reopen its pencil to use the latest version.")
            }
            const saved = await tx.homeInsight.upsert({ where: { workspaceId_key: { workspaceId: ws.id, key: insight.key } },
              create: { workspaceId: ws.id, ...insight, evidence: json(insight.evidence) },
              update: { ...insight, evidence: json(insight.evidence) } })
            receipt = { id: saved.id, title: saved.title }
          }
          await tx.homeOperation.update({ where: { id }, data: { cursor: i + 1, receipts: json([...(current.receipts as unknown[]), receipt]) } })
          return null
        }, { timeout: 15_000 })
        refused = skipped ?? refused
      }
    }
    if (!op.generationComplete && op.kind !== "accept") {
      await prisma.homeOperation.updateMany({ where: { id, leaseToken: token, status: "running" }, data: { leaseToken: null, leaseUntil: null } })
      return
    }
    const saved = await prisma.homeOperation.findUniqueOrThrow({ where: { id } })
    if (op.kind !== "suggestions" && plan.changes.length + plan.insights.length && !(saved.receipts as unknown[]).length) {
      // Every record was refused. Replaying them would be refused again, so a
      // retry starts the generation over instead of reporting "Up to date".
      await prisma.homeOperation.updateMany({ where: { id, leaseToken: token, status: "running" },
        data: { cursor: 0, plan: json({ changes: [], insights: [] }), generationComplete: false } })
      throw new Error(refused ?? "None of the agent's changes could be saved. Retry to regenerate them.")
    }
    await stage(id, token, op.kind === "suggestions" ? (plan.changes.length ? "Suggestions ready" : "No new suggestions from the available evidence") : "Up to date")
    await prisma.homeOperation.updateMany({ where: { id, leaseToken: token, status: "running" }, data: { status: "completed", leaseToken: null, leaseUntil: null } })
  } catch (error) {
    const op = await prisma.homeOperation.findUnique({ where: { id } })
    await prisma.homeOperation.updateMany({ where: { id, leaseToken: token, status: "running" }, data: {
      // The cursor also advances past refused records, so only receipts mean something was saved.
      status: (op?.receipts as unknown[] | undefined)?.length ? "partial" : "failed", stage: "Needs attention", leaseToken: null, leaseUntil: null,
      error: error instanceof Error ? error.message.slice(0, 500) : "Home AI could not finish. Please retry.",
    } })
  } finally {
    await cleanupHomeRuntime(id)
  }
}

/** Both home visits and the lifecycle cron discover completed turns. No write
 * hook is required in either agent finalizer, and interrupted finalizers recover. */
export async function enqueueHomeInsights(workspaceId: string) {
  if (!homeAiEnabled()) return
  const [chat, last, ws] = await Promise.all([
    prisma.chat.findFirst({ where: { workspaceId, status: { in: ["ready", "error"] }, messages: { some: { role: "assistant", isError: false } } }, orderBy: { lastActiveAt: "desc" }, select: { id: true, userId: true, lastActiveAt: true } }),
    prisma.homeOperation.findFirst({ where: { workspaceId, kind: "insights" }, orderBy: { createdAt: "desc" } }),
    prisma.workspace.findFirst({ where: { id: workspaceId, archived: false }, select: { members: { orderBy: { userId: "asc" }, select: { userId: true } } } }),
  ])
  if (!chat || !ws?.members[0]) return
  if (last && (ACTIVE_HOME_STATUSES.includes(last.status) || Date.now() - last.createdAt.getTime() < 300_000 || chat.lastActiveAt <= last.createdAt)) return
  const requestKey = `insights:${chat.id}:${chat.lastActiveAt.getTime()}`
  await prisma.homeOperation.upsert({ where: { workspaceId_requestKey: { workspaceId, requestKey } }, update: {},
    create: { workspaceId, userId: ws.members.find(m => m.userId === chat.userId)?.userId ?? ws.members[0].userId, requestKey, kind: "insights", prompt: "Surface important issues, blockers and decisions across members. Update existing findings when new evidence supports it." } })
}

export async function tickHomeAi() {
  if (!homeAiEnabled()) return
  const workspaces = await prisma.workspace.findMany({ where: { archived: false, chats: { some: { lastActiveAt: { gt: new Date(Date.now() - 86_400_000) } } } }, select: { id: true }, take: 50 })
  for (const ws of workspaces) await enqueueHomeInsights(ws.id)
  const pending = await prisma.homeOperation.findMany({ where: { status: { in: ACTIVE_HOME_STATUSES }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, orderBy: { createdAt: "asc" }, take: 3, select: { id: true } })
  await Promise.all(pending.map(op => runHomeOperation(op.id)))
  const cleanup = await prisma.homeOperation.findMany({ where: { status: { notIn: ACTIVE_HOME_STATUSES }, runtime: { not: Prisma.DbNull } }, take: 5, select: { id: true } })
  await Promise.all(cleanup.map(op => cleanupHomeRuntime(op.id)))
}

export function oneChangePlan(plan: HomePlan, index: number): HomePlan {
  if (!plan.changes[index]) throw new Error("Suggestion no longer exists")
  return { changes: [plan.changes[index]], insights: [] }
}
