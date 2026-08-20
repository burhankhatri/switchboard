/**
 * Service worker — push notifications only.
 *
 * Deliberately does NOT cache anything. A caching service worker on an app that
 * ships as often as this one serves stale JS to people who have not reloaded,
 * and the resulting bugs look like anything except a cache. Push needs a worker;
 * it does not need offline support.
 */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close, so a
  // freshly granted permission works without a restart.
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: "Switchboard", body: event.data.text(), url: "/" }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Switchboard", {
      body: payload.body || "",
      // Collapses repeats: five overnight questions leave one notification to
      // deal with rather than five to dismiss.
      tag: payload.tag || "switchboard",
      renotify: true,
      icon: "/maloewe-logo.png",
      badge: "/maloewe-logo.png",
      data: { url: payload.url || "/" },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url || "/"

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab rather than opening a duplicate — someone who
      // already has the app open does not want a second copy of it.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
