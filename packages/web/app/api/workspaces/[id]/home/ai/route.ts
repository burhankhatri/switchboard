import { after } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, badRequest, internalError } from "@/lib/db/api-helpers"
import { gateWorkspace } from "@/lib/workspace-gate"
import { homeAiEnabled, cleanupHomeRuntime } from "@/lib/workspace-home/ai-model"
import { homeAiView } from "@/lib/workspace-home/ai-view"
import { enqueueHomeInsights, oneChangePlan, runHomeOperation } from "@/lib/workspace-home/ai-worker"
import { planSchema, ACTIVE_HOME_STATUSES } from "@/lib/workspace-home/ai-contract"

export const maxDuration = 180
type Ctx = { params: Promise<{ id: string }> }
const bodySchema = z.object({
  action: z.enum(["start", "accept", "dismiss", "cancel", "retry"]),
  kind: z.enum(["edit", "edit-insight", "create", "suggestions"]).optional(), prompt: z.string().trim().min(1).max(4000).optional(),
  targetId: z.string().max(100).optional(), targetVersion: z.string().datetime().optional(),
  requestKey: z.string().min(1).max(100).optional(), operationId: z.string().optional(), index: z.number().int().min(0).max(5).optional(),
}).strict()

export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const gate = await gateWorkspace(id, auth.userId); if (!gate.ok) return gate.response
  try {
    const view = await homeAiView(id, auth.userId, homeAiEnabled())
    after(async () => {
      try {
        await enqueueHomeInsights(id)
        const pending = await prisma.homeOperation.findFirst({ where: { workspaceId: id, status: { in: ACTIVE_HOME_STATUSES }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, orderBy: { createdAt: "asc" } })
        if (pending) await runHomeOperation(pending.id)
      } catch (e) { console.error("[home-ai] recovery failed", e) }
    })
    return Response.json(view)
  } catch (e) { return internalError(e) }
}

export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const gate = await gateWorkspace(id, auth.userId); if (!gate.ok) return gate.response
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest("Invalid home AI request")
  const body = parsed.data
  try {
    let operationId: string
    if (body.action === "start") {
      if (!homeAiEnabled()) return badRequest("The workspace agent runtime is unavailable.")
      if (!body.prompt || !body.requestKey || !body.kind) return badRequest("Prompt, kind and request key are required")
      if (["edit", "edit-insight"].includes(body.kind) && (!body.targetId || !body.targetVersion)) return badRequest("Select a component to edit")
      if (body.targetId) {
        const target = body.kind === "edit-insight"
          ? await prisma.homeInsight.findFirst({ where: { id: body.targetId, workspaceId: id } })
          : await prisma.workspaceWidget.findFirst({ where: { id: body.targetId, workspaceId: id } })
        if (!target) return badRequest("Component not found")
      }
      const pending = await prisma.homeOperation.count({ where: { workspaceId: id, status: { in: ACTIVE_HOME_STATUSES } } })
      if (pending >= 4) return badRequest("Four operations are already running. Wait for one to finish.")
      const op = await prisma.homeOperation.upsert({ where: { workspaceId_requestKey: { workspaceId: id, requestKey: `${auth.userId}:${body.requestKey}` } }, update: {},
        create: { workspaceId: id, userId: auth.userId, requestKey: `${auth.userId}:${body.requestKey}`, kind: body.kind, prompt: body.prompt, targetId: body.targetId, targetVersion: body.targetVersion } })
      operationId = op.id
    } else {
      if (!body.operationId) return badRequest("Operation is required")
      operationId = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "HomeOperation" WHERE "id" = ${body.operationId!} AND "workspaceId" = ${id} FOR UPDATE`
        const op = await tx.homeOperation.findFirst({ where: { id: body.operationId, workspaceId: id } })
        if (!op) throw new Error("Operation not found")
        if (body.action === "accept" || body.action === "dismiss") {
          if (op.kind !== "suggestions" || op.status !== "completed" || body.index === undefined) throw new Error("Suggestion is not ready")
          const plan = oneChangePlan(planSchema.parse(op.plan), body.index)
          if (body.action === "dismiss") {
            await tx.homeOperation.update({ where: { id: op.id }, data: { dismissed: [...new Set([...(op.dismissed as number[]), body.index])] } })
            return op.id
          }
          const accepted = await tx.homeOperation.upsert({ where: { workspaceId_requestKey: { workspaceId: id, requestKey: `accept:${op.id}:${body.index}` } }, update: {},
            create: { workspaceId: id, userId: auth.userId, requestKey: `accept:${op.id}:${body.index}`, kind: "accept", generationComplete: true, prompt: plan.changes[0].reason, plan: plan as unknown as Prisma.InputJsonValue, targetId: plan.changes[0].targetId } })
          await tx.homeOperation.update({ where: { id: op.id }, data: { dismissed: [...new Set([...(op.dismissed as number[]), body.index])] } })
          return accepted.id
        }
        if (op.userId !== auth.userId) throw new Error("Only the person who started this operation can manage it")
        if (body.action === "cancel") {
          await tx.homeOperation.updateMany({ where: { id: op.id, status: { in: ACTIVE_HOME_STATUSES } }, data: { status: "cancelled", stage: "Stopped; saved changes kept", leaseToken: null, leaseUntil: null } })
        } else if (["failed", "partial", "cancelled"].includes(op.status)) {
          if (op.runtime) throw new Error("The previous agent is still stopping. Retry in a moment.")
          await tx.homeOperation.update({ where: { id: op.id }, data: { status: "queued", stage: "Waiting to retry", error: null, attempts: 0, leaseToken: null, leaseUntil: null } })
        }
        return op.id
      })
    }
    if (body.action === "cancel") after(() => cleanupHomeRuntime(operationId))
    else if (body.action !== "dismiss") after(() => runHomeOperation(operationId))
    return Response.json({ operationId })
  } catch (e) { return badRequest(e instanceof Error ? e.message : "Unable to start home AI") }
}
