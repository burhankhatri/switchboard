import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { HomeEvidence } from "./ai-contract"

// Extractive digests preserve the actual source text. They are rebuilt only for
// changed conversations; bounded coverage is explicit in the model context.
export async function homeContext(workspaceId: string) {
  const [chats, widgets, insights, total] = await Promise.all([
    prisma.chat.findMany({ where: { workspaceId, status: { notIn: ["running", "creating"] } },
      orderBy: { lastActiveAt: "desc" }, take: 40,
      select: { id: true, user: { select: { name: true } }, lastActiveAt: true,
        messages: { orderBy: { timestamp: "desc" }, take: 12,
          where: { isError: false, content: { not: "" } }, select: { id: true, role: true, content: true, timestamp: true } } } }),
    prisma.workspaceWidget.findMany({ where: { workspaceId }, orderBy: { position: "asc" } }),
    prisma.homeInsight.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" }, take: 30 }),
    prisma.chat.count({ where: { workspaceId } }),
  ])
  const sources: HomeEvidence[] = []
  const conversations = []
  let remaining = 90_000
  for (const chat of chats) {
    const version = createHash("sha256").update(JSON.stringify({ author: chat.user.name, messages: chat.messages }, (_, v) => typeof v === "bigint" ? String(v) : v)).digest("hex")
    const cached = await prisma.homeDigest.findUnique({ where: { workspaceId_chatId: { workspaceId, chatId: chat.id } } })
    const extracted = chat.messages.slice().reverse().map(m => ({
      chatId: chat.id, messageId: m.id, author: chat.user.name ?? "Workspace member",
      date: new Date(Number(m.timestamp)).toISOString(), role: m.role,
      text: m.content.slice(0, 1800), clipped: m.content.length > 1800,
    }))
    const content = cached?.version === version ? cached.content as typeof extracted : extracted
    if (cached?.version !== version) await prisma.homeDigest.upsert({
      where: { workspaceId_chatId: { workspaceId, chatId: chat.id } },
      create: { workspaceId, chatId: chat.id, version, content }, update: { version, content },
    })
    for (const m of content) {
      if (remaining < m.text.length) continue
      remaining -= m.text.length
      sources.push({ chatId: m.chatId, messageId: m.messageId, author: m.author, date: m.date })
      conversations.push(m)
    }
  }
  const version = createHash("sha256").update(JSON.stringify(conversations)).digest("hex")
  return { version, sources, conversations, coverage: `Recent excerpts from up to 40 of ${total} conversations; at most 12 messages per chat. Missing evidence is unknown, not resolved.`,
    widgets: widgets.map(w => ({ id: w.id, key: w.key, type: w.type, title: w.title, content: w.content, updatedAt: w.updatedAt.toISOString() })),
    insights: insights.map(i => ({ id: i.id, updatedAt: i.updatedAt.toISOString(), key: i.key, title: i.title, detail: i.detail, status: i.status, kind: i.kind, evidence: i.evidence as Prisma.JsonValue })),
  }
}
