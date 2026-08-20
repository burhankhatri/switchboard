"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * Registering this browser for Web Push.
 *
 * Permission is only ever requested from an explicit user action. Asking on
 * page load is the single most reliable way to get permanently denied — the
 * browser remembers "block" and there is no second chance from inside the page.
 */

export type PushState =
  | "unsupported" // no service worker / PushManager, or served over plain http
  | "unconfigured" // server has no VAPID keys
  | "denied" // the user said no; only recoverable via browser settings
  | "subscribed"
  | "unsubscribed"

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function usePushSubscription() {
  const [state, setState] = useState<PushState>("unsupported")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    const detect = async () => {
      // isSecureContext covers the http-on-a-LAN-IP case, where the APIs exist
      // but every call fails.
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !window.isSecureContext
      ) {
        return setState("unsupported")
      }

      const res = await fetch("/api/notifications/subscribe").catch(() => null)
      const config = res?.ok ? await res.json() : null
      if (cancelled) return
      if (!config?.enabled) return setState("unconfigured")

      if (Notification.permission === "denied") return setState("denied")

      const registration = await navigator.serviceWorker.getRegistration()
      const existing = await registration?.pushManager.getSubscription()
      if (cancelled) return
      setState(existing ? "subscribed" : "unsubscribed")
    }

    void detect()
    return () => {
      cancelled = true
    }
  }, [])

  const subscribe = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/notifications/subscribe")
      const { enabled, publicKey } = await res.json()
      if (!enabled || !publicKey) return setState("unconfigured")

      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        return setState(permission === "denied" ? "denied" : "unsubscribed")
      }

      const registration = await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready

      const subscription = await registration.pushManager.subscribe({
        // Chrome refuses a subscription without this, and a silent push would
        // be a tracking vector anyway.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })

      const saved = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      })
      setState(saved.ok ? "subscribed" : "unsubscribed")
    } catch (err) {
      console.error("[push] subscribe failed", err)
      setState("unsubscribed")
    } finally {
      setBusy(false)
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        // Tell the server first: if the browser-side unsubscribe succeeds and
        // the request then fails, the row is orphaned and keeps receiving sends
        // that can never be delivered.
        await fetch("/api/notifications/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => null)
        await subscription.unsubscribe()
      }
      setState("unsubscribed")
    } finally {
      setBusy(false)
    }
  }, [])

  return { state, busy, subscribe, unsubscribe }
}
