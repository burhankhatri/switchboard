/**
 * Web Push delivery.
 *
 * The point of push is the case in-app polling deliberately does not cover: a
 * scheduled run stops to ask a question at 3am with nobody in the app. Push is
 * server-initiated, so it costs nothing while idle — which is why the badge is
 * allowed to stop polling entirely when the tab is not focused.
 *
 * Everything here degrades to a no-op when VAPID keys are absent, so the app
 * runs unchanged on an installation that has not configured push.
 */

export interface PushableNotification {
  kind: string
  title: string
  body: string | null
  chatId: string | null
  workspaceId: string | null
}

/** Where clicking the system notification should land. */
export function pushTargetUrl({
  chatId,
  workspaceId,
}: {
  chatId: string | null
  workspaceId: string | null
}): string {
  if (chatId) return `/?chat=${encodeURIComponent(chatId)}`
  if (workspaceId) return `/?workspace=${encodeURIComponent(workspaceId)}`
  return "/"
}

export function buildPushPayload(n: PushableNotification): string {
  return JSON.stringify({
    title: n.title,
    body: n.body ?? "",
    url: pushTargetUrl(n),
    // Tagging by kind and target collapses repeats: five scheduled runs asking
    // questions overnight should leave one notification to deal with, not five
    // to dismiss individually.
    tag: `${n.kind}:${n.chatId ?? n.workspaceId ?? "app"}`,
  })
}

/**
 * Does this send failure mean the endpoint is gone for good?
 *
 * 404/410 is the push service saying the subscription is dead — a cleared site
 * setting, an uninstalled PWA. Anything else (429, 5xx) is "try later", and
 * deleting on those would silently unsubscribe people whose push service had a
 * bad minute.
 */
export function shouldPruneSubscription(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410
}

export function isPushConfigured(): boolean {
  return !!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  )
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null
}
