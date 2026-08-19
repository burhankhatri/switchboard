import { describe, expect, it } from "vitest"
import { serversPollInterval } from "./useServersQuery"

/**
 * This poll is what a Neon bill is made of.
 *
 * Neon suspends a compute after five minutes with no queries. Each tick here
 * costs three database queries, so any interval under five minutes pins the
 * compute awake permanently — a browser tab left open on a chat with a sandbox
 * bills 24 hours a day at .25–2 CU while nobody is using the app. The idle
 * heartbeat used to be 30s, which bought nothing: a dev server cannot appear in
 * a sandbox unless the agent is doing something, and when it starts the status
 * flips to running and the fast poll resumes on its own.
 */
describe("serversPollInterval", () => {
  it("polls fast while the agent could start or stop a server", () => {
    expect(serversPollInterval({ active: true, previewOpen: false })).toBe(5_000)
    expect(serversPollInterval({ active: true, previewOpen: true })).toBe(5_000)
  })

  it("keeps a slow watch while a preview is on screen", () => {
    // A server the user is looking at can stop; that has to be noticed.
    expect(serversPollInterval({ active: false, previewOpen: true })).toBe(30_000)
  })

  it("stops entirely when the agent is idle and nothing is being previewed", () => {
    expect(serversPollInterval({ active: false, previewOpen: false })).toBe(false)
  })

  it("never idles at a rate that defeats a five-minute autosuspend", () => {
    // The invariant, stated as a rule rather than a number: if we poll at all
    // while idle, it must be because something on screen depends on it.
    const idle = serversPollInterval({ active: false, previewOpen: false })
    expect(idle).toBe(false)
  })
})
