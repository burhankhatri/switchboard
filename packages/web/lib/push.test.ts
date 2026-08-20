import { describe, it, expect } from "vitest"
import { buildPushPayload, shouldPruneSubscription, pushTargetUrl } from "./push"

describe("buildPushPayload", () => {
  it("carries what the service worker needs to render a notification", () => {
    const payload = JSON.parse(
      buildPushPayload({
        kind: "agent_needs_input",
        title: "GTM push needs your input",
        body: "The agent asked a question.",
        chatId: "c1",
        workspaceId: null,
      })
    )
    expect(payload.title).toBe("GTM push needs your input")
    expect(payload.body).toBe("The agent asked a question.")
    expect(payload.url).toContain("c1")
  })

  it("tags by kind so a second notification replaces the first", () => {
    // Without a tag, five scheduled runs asking questions overnight stack five
    // system notifications the user has to dismiss one at a time.
    const payload = JSON.parse(
      buildPushPayload({ kind: "agent_needs_input", title: "x", body: null, chatId: "c1", workspaceId: null })
    )
    expect(payload.tag).toContain("agent_needs_input")
  })

  it("survives a missing body", () => {
    const payload = JSON.parse(
      buildPushPayload({ kind: "workspace_member_added", title: "Added", body: null, chatId: null, workspaceId: "w1" })
    )
    expect(payload.title).toBe("Added")
    expect(payload.body ?? "").toBe("")
  })
})

describe("pushTargetUrl", () => {
  it("uses the app's real chat route", () => {
    // Must be a path the router actually understands. The app matches
    // /chat/:chatId and ignores query strings entirely, so an earlier
    // "/?chat=<id>" form silently dropped the user on the home page and the
    // notification looked like it did nothing.
    expect(pushTargetUrl({ chatId: "c1", workspaceId: "w1" })).toBe("/chat/c1")
  })

  it("sends a workspace notification to the home page", () => {
    // There is no workspace route — the active workspace lives in
    // localStorage. Home is where the picker is, so it is the honest target.
    expect(pushTargetUrl({ chatId: null, workspaceId: "w1" })).toBe("/")
  })

  it("falls back to the app root when neither is set", () => {
    expect(pushTargetUrl({ chatId: null, workspaceId: null })).toBe("/")
  })

  it("encodes an id that would otherwise break the path", () => {
    expect(pushTargetUrl({ chatId: "a/b", workspaceId: null })).toBe("/chat/a%2Fb")
  })
})

describe("shouldPruneSubscription", () => {
  it("prunes on 404 and 410", () => {
    // The push service reports a dead endpoint this way — a cleared site
    // setting or an uninstalled PWA. Without pruning the table only grows, and
    // every future send retries endpoints that can never deliver.
    expect(shouldPruneSubscription(404)).toBe(true)
    expect(shouldPruneSubscription(410)).toBe(true)
  })

  it("keeps the subscription on a transient failure", () => {
    // 429 and 5xx mean try later, not "this device is gone". Deleting on those
    // silently unsubscribes people whose push service had a bad minute.
    expect(shouldPruneSubscription(429)).toBe(false)
    expect(shouldPruneSubscription(500)).toBe(false)
    expect(shouldPruneSubscription(503)).toBe(false)
  })
})
