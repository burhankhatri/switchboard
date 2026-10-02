import { afterEach, describe, expect, it, vi } from "vitest"
import { stageFile, forgetStagedFile } from "./direct-upload"

class FakeXHR {
  status = 200
  timeout = 0
  upload = { onprogress: null as null | ((event: { loaded: number }) => void) }
  onload: (() => void) | null = null
  open = vi.fn()
  setRequestHeader = vi.fn()
  send(file: File) { this.upload.onprogress?.({ loaded: file.size }); this.onload?.() }
}

describe("direct browser uploads", () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it("uploads directly, reports progress, and reuses the object for retry", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ uploadId: "id", uploadUrl: "https://storage.test/signed?token=short-lived", expiresAt: new Date(Date.now() + 86400000).toISOString() }))
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("XMLHttpRequest", FakeXHR)
    const file = new File(["abc"], "file.csv")
    const progress = vi.fn()
    const scope = { kind: "chat" as const, id: "chat" }
    expect(await stageFile(file, scope, progress)).toBe("id")
    expect(await stageFile(file, scope)).toBe("id")
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledWith(3)
    forgetStagedFile(file, scope)
    await stageFile(file, scope)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it("does not reuse an upload ID in another chat", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ uploadId: "id", uploadUrl: "https://storage.test/signed", expiresAt: new Date(Date.now() + 86400000).toISOString() })))
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("XMLHttpRequest", FakeXHR)
    const file = new File(["abc"], "file.csv")
    await stageFile(file, { kind: "chat", id: "one" })
    await stageFile(file, { kind: "chat", id: "two" })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it("does not cache a failed direct upload", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ uploadId: "id", uploadUrl: "https://storage.test/signed", expiresAt: new Date(Date.now() + 86400000).toISOString() })))
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("XMLHttpRequest", class extends FakeXHR { status = 500 })
    const file = new File(["abc"], "file.csv")
    await expect(stageFile(file, { kind: "chat", id: "one" })).rejects.toThrow("500")
    await expect(stageFile(file, { kind: "chat", id: "one" })).rejects.toThrow("500")
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
