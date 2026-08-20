import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import { markRead, unreadCount } from "@/lib/db/notifications"

/** Cap on a single page. The bell shows a short list, not an archive. */
const MAX_LIMIT = 50

/**
 * GET — the bell's contents.
 *
 * Returns the newest notifications plus the unread count. The count is a
 * separate number rather than `items.filter(unread).length` because the badge
 * must stay correct when there are more unread than fit in one page.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth

  try {
    const limitParam = Number(new URL(req.url).searchParams.get("limit"))
    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : 20

    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          chatId: true,
          workspaceId: true,
          readAt: true,
          createdAt: true,
        },
      }),
      unreadCount(userId),
    ])

    return Response.json({ notifications: items, unreadCount: unread })
  } catch (err) {
    return internalError(err)
  }
}

/**
 * POST — mark read.
 *
 * `{ ids: [...] }` marks those; an empty body marks everything unread. Both are
 * scoped to the caller inside markRead, so passing someone else's id does
 * nothing rather than clearing their badge.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth

  try {
    const body = await req.json().catch(() => ({}))
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === "string")
      : undefined

    const updated = await markRead(userId, ids)
    return Response.json({ updated, unreadCount: await unreadCount(userId) })
  } catch (err) {
    return internalError(err)
  }
}
