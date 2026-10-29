import assert from "node:assert/strict"
import { prisma } from "@/lib/db/prisma"
import { runHomeOperation } from "@/lib/workspace-home/ai-worker"
import { homeContext } from "@/lib/workspace-home/ai-context"
import { homeAiView } from "@/lib/workspace-home/ai-view"
import type { Prisma } from "@prisma/client"

async function main() {
  const user = await prisma.user.create({ data: { name: "Wayne" } })
  const colleague = await prisma.user.create({ data: { name: "Burhan" } })
  const ws = await prisma.workspace.create({ data: { slug: "home-check", name: "Home check", path: "workspaces/test", repo: "test/workspaces", createdById: user.id, members: { create: [{ userId: user.id, role: "owner" }, { userId: colleague.id }] } } })
  const other = await prisma.workspace.create({ data: { slug: "other-check", name: "Other", path: "workspaces/other", repo: "test/workspaces", createdById: user.id } })
  const chat = await prisma.chat.create({ data: { userId: colleague.id, workspaceId: ws.id, repo: ws.repo, status: "ready", messages: { create: { role: "assistant", content: "Wayne and Burhan found a CRM sync issue.", timestamp: BigInt(Date.now()) } } }, include: { messages: true } })
  await prisma.chat.create({ data: { userId: user.id, workspaceId: other.id, repo: ws.repo, status: "ready", messages: { create: { role: "assistant", content: "UNRELATED SECRET", timestamp: BigInt(Date.now()) } } } })
  const context = await homeContext(ws.id)
  assert.equal(context.conversations.length, 1)
  assert.equal(context.conversations[0].author, "Burhan")
  assert(!JSON.stringify(context).includes("UNRELATED SECRET"))
  assert.equal(await prisma.homeDigest.count({ where: { workspaceId: ws.id } }), 1)
  const evidence = context.sources
  const change = (key: string) => ({ targetId: null, version: null, key, type: "note", title: key, content: { markdown: "Team issue" }, reason: "Team discussion", evidence })
  let counter = 0
  const operation = async (changes: unknown[], overrides = {}) => prisma.homeOperation.create({ data: { workspaceId: ws.id, userId: user.id, requestKey: `check-${counter++}`, kind: "accept", prompt: "Apply", generationComplete: true, plan: { changes, insights: [] } as Prisma.InputJsonValue, ...overrides } })
  const op = await operation([change("one"), change("two")])
  await Promise.all([runHomeOperation(op.id), runHomeOperation(op.id)])
  assert.equal(await prisma.workspaceWidget.count({ where: { workspaceId: ws.id } }), 2)
  const done = await prisma.homeOperation.findUniqueOrThrow({ where: { id: op.id } })
  assert.equal(done.status, "completed"); assert.equal(done.cursor, 2)
  await runHomeOperation(op.id)
  assert.equal(await prisma.workspaceWidget.count({ where: { workspaceId: ws.id } }), 2)
  const target = await prisma.workspaceWidget.findFirstOrThrow({ where: { workspaceId: ws.id, key: "one" } })
  const stale = await operation([{ ...change("one"), targetId: target.id, version: new Date(0).toISOString(), content: { markdown: "Overwrite" } }])
  await runHomeOperation(stale.id)
  assert.equal((await prisma.homeOperation.findUniqueOrThrow({ where: { id: stale.id } })).status, "failed")
  assert.deepEqual((await prisma.workspaceWidget.findUniqueOrThrow({ where: { id: target.id } })).content, { markdown: "Team issue" })
  const partial = await operation([change("three"), change("one")])
  await runHomeOperation(partial.id)
  const partiallyDone = await prisma.homeOperation.findUniqueOrThrow({ where: { id: partial.id } })
  assert.equal(partiallyDone.status, "partial"); assert.equal(partiallyDone.cursor, 1)
  const stopped = await operation([change("stopped")], { status: "cancelled" })
  await runHomeOperation(stopped.id)
  assert.equal(await prisma.workspaceWidget.count({ where: { key: "stopped" } }), 0)
  const finding = { key: "crm-sync", title: "CRM sync", detail: "Missing records", kind: "issue", status: "open", evidence }
  const insightOp = await operation([], { kind: "insights", plan: { changes: [], insights: [finding] } })
  await runHomeOperation(insightOp.id)
  const resolved = await operation([], { kind: "insights", plan: { changes: [], insights: [{ ...finding, status: "resolved", detail: "Records restored" }] } })
  await runHomeOperation(resolved.id)
  assert.equal(await prisma.homeInsight.count({ where: { workspaceId: ws.id } }), 1)
  const view = await homeAiView(ws.id, user.id, true)
  assert.equal(view.insights[0].status, "resolved")
  assert.equal(view.insights[0].evidence[0].chatId, "", "private transcript link hidden")
  assert.equal(view.insights[0].evidence[0].author, "Burhan")
  await prisma.chat.update({ where: { id: chat.id }, data: { sharedToWorkspaceAt: new Date() } })
  assert.equal((await homeAiView(ws.id, user.id, true)).insights[0].evidence[0].chatId, chat.id)
  const revoked = await operation([change("revoked")])
  await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } } })
  await runHomeOperation(revoked.id)
  assert.equal((await prisma.homeOperation.findUniqueOrThrow({ where: { id: revoked.id } })).status, "failed")
  assert.equal(await prisma.workspaceWidget.count({ where: { key: "revoked" } }), 0)
  console.log("PASS: migration, cross-user context, workspace isolation, digest persistence, concurrent claims, idempotency, stale edits, partial commits, cancellation, insight deduplication/resolution, private links, revoked membership.")
}
main().finally(() => prisma.$disconnect()).catch(e => { console.error(e); process.exitCode = 1 })
