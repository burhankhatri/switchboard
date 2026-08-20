import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { isPushConfigured, vapidPublicKey } from "@/lib/push"

/**
 * GET — the public VAPID key, and whether push is configured at all.
 *
 * The client needs the key to subscribe, and needs to know when push is
 * unavailable so it can hide the control rather than offering a button that
 * cannot work.
 */
export async function GET(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  return Response.json({
    enabled: isPushConfigured(),
    publicKey: vapidPublicKey(),
  })
}

/**
 * POST — register this device.
 *
 * Upserts on endpoint: re-subscribing on the same device returns the same
 * endpoint, which must update rather than accumulate a row per permission
 * prompt. The upsert also re-points an endpoint at whoever is signed in now,
 * which matters on a shared machine — otherwise the previous user keeps
 * receiving notifications on it.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth

  if (!isPushConfigured()) {
    return badRequest("Push is not configured on this server")
  }

  try {
    const body = await req.json().catch(() => null)
    const endpoint = body?.endpoint
    const p256dh = body?.keys?.p256dh
    const authKey = body?.keys?.auth

    if (
      typeof endpoint !== "string" ||
      typeof p256dh !== "string" ||
      typeof authKey !== "string"
    ) {
      return badRequest("endpoint and keys.p256dh / keys.auth are required")
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh, auth: authKey },
      update: { userId, p256dh, auth: authKey },
    })

    return Response.json({ subscribed: true })
  } catch (err) {
    return internalError(err)
  }
}

/** DELETE — unregister this device. */
export async function DELETE(req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth

  try {
    const body = await req.json().catch(() => null)
    const endpoint = body?.endpoint
    if (typeof endpoint !== "string") return badRequest("endpoint is required")

    // Scoped to the caller so an endpoint string cannot be used to unsubscribe
    // somebody else's device.
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } })
    return Response.json({ subscribed: false })
  } catch (err) {
    return internalError(err)
  }
}
