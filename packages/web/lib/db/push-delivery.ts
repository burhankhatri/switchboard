import webpush from "web-push"
import { prisma } from "./prisma"
import {
  buildPushPayload,
  isPushConfigured,
  shouldPruneSubscription,
  type PushableNotification,
} from "@/lib/push"

/**
 * Sending a notification to a user's registered devices.
 *
 * Split from lib/push.ts so the payload/prune logic stays unit-testable without
 * pulling in the prisma singleton, which throws at import time when there is no
 * DATABASE_URL.
 */

let configured = false

function ensureConfigured(): boolean {
  if (!isPushConfigured()) return false
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    )
    configured = true
  }
  return true
}

/**
 * Push a notification to every device this user has registered.
 *
 * Never throws. Push is a best-effort second channel — the notification is
 * already recorded and the bell will show it regardless, so a push failure must
 * not fail the request that produced it.
 */
export async function sendPushToUser(
  userId: string,
  notification: PushableNotification
): Promise<void> {
  if (!ensureConfigured()) return

  let subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[]
  try {
    subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })
  } catch (err) {
    console.error("[push] could not load subscriptions", err)
    return
  }
  if (subscriptions.length === 0) return

  const payload = buildPushPayload(notification)
  const dead: string[] = []

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode ?? 0
        if (shouldPruneSubscription(statusCode)) {
          dead.push(sub.id)
        } else {
          console.error("[push] send failed", statusCode, err)
        }
      }
    })
  )

  // Without this the table only grows, and every later send retries endpoints
  // that can never deliver again.
  if (dead.length > 0) {
    try {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } })
    } catch (err) {
      console.error("[push] could not prune dead subscriptions", err)
    }
  }
}
