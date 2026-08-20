import { prisma } from "./prisma"

/**
 * The one place notifications are written.
 *
 * Deliberately a single writer: Web Push delivery hangs off `notify` rather
 * than off each caller, so a route that records a notification does not also
 * have to know that push exists.
 *
 * Distinct from ActivityLog, which is an audit trail nobody reads during work.
 * This is an inbox — per recipient, with a read state, meant to be emptied.
 */

export type NotificationKind =
  | "workspace_member_added"
  | "workspace_member_removed"
  | "agent_needs_input"

export interface NotifyInput {
  /** Who receives it. */
  userId: string
  /**
   * Who caused it, when a person did. If this is the recipient, nothing is
   * written — being told about your own action is noise, and it is the thing
   * that makes a notification centre feel broken.
   */
  actorId?: string
  kind: NotificationKind
  title: string
  body?: string
  /** Where clicking it should land. */
  chatId?: string
  workspaceId?: string
}

/**
 * Record a notification.
 *
 * Never throws. The triggering action — being added to a workspace, an agent
 * finishing a turn — matters more than the record of it, and a failed insert
 * must not fail the request that caused it.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (input.actorId && input.actorId === input.userId) return

  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        chatId: input.chatId ?? null,
        workspaceId: input.workspaceId ?? null,
      },
    })
  } catch (err) {
    console.error("[notifications] failed to record", input.kind, err)
    // No push either: pushing a notification the bell will never show would
    // send the user to look for something that is not there.
    return
  }

  // Imported lazily so this module — and everything that records a
  // notification — does not pull the web-push dependency into paths that never
  // send one. Also a no-op when VAPID keys are unset.
  try {
    const { sendPushToUser } = await import("./push-delivery")
    await sendPushToUser(input.userId, {
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      chatId: input.chatId ?? null,
      workspaceId: input.workspaceId ?? null,
    })
  } catch (err) {
    console.error("[notifications] push delivery failed", err)
  }
}

/** Fire-and-forget, mirroring logActivityAsync. */
export function notifyAsync(input: NotifyInput): void {
  void notify(input)
}

/**
 * Unread count for the badge.
 *
 * Returns 0 on failure rather than throwing: a database hiccup should not blank
 * the page the badge is rendered into.
 */
export async function unreadCount(userId: string): Promise<number> {
  try {
    return await prisma.notification.count({
      where: { userId, readAt: null },
    })
  } catch (err) {
    console.error("[notifications] failed to count", err)
    return 0
  }
}

/**
 * Mark notifications read. Omit `ids` to clear everything unread.
 *
 * Always scoped by userId — without that, passing an id you do not own would
 * mark someone else's notification read.
 */
export async function markRead(userId: string, ids?: string[]): Promise<number> {
  const where = ids?.length
    ? { userId, id: { in: ids } }
    : { userId, readAt: null }

  try {
    const { count } = await prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    })
    return count
  } catch (err) {
    console.error("[notifications] failed to mark read", err)
    return 0
  }
}
