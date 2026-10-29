import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import { gateWorkspace } from "@/lib/workspace-gate"
import { prisma } from "@/lib/db/prisma"
import { createHash } from "node:crypto"

export const maxDuration = 30
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const gate = await gateWorkspace(id, auth.userId); if (!gate.ok) return gate.response
  const encoder = new TextEncoder()
  let cancelled = false
  const stream = new ReadableStream({ async start(controller) {
    let previous = req.headers.get("last-event-id") ?? ""
    try {
      const until = Date.now() + 24_000
      while (!cancelled && !req.signal.aborted && Date.now() < until) {
        const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId: auth.userId } } })
        if (!membership) break
        const [ops, widgets] = await Promise.all([
          prisma.homeOperation.findMany({ where: { workspaceId: id }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, sequence: true, status: true, cursor: true } }),
          prisma.workspaceWidget.findMany({ where: { workspaceId: id }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true } }),
        ])
        const version = createHash("sha256").update(JSON.stringify({ ops, widgets })).digest("hex")
        if (version !== previous) {
          controller.enqueue(encoder.encode(`id: ${version}\ndata: changed\n\n`)); previous = version
        } else controller.enqueue(encoder.encode(": heartbeat\n\n"))
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    } catch { /* EventSource reconnects; polling remains available. */ }
    finally { if (!cancelled) controller.close() }
  }, cancel() { cancelled = true } })
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } })
}
