import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchPreviewBytes, MAX_PREVIEW_BYTES, previewMime } from "./preview-bytes"

describe("previewMime", () => {
  it("types the formats the browser renders natively", () => {
    expect(previewMime("deck.pdf")).toBe("application/pdf")
    expect(previewMime("logo.PNG")).toBe("image/png")
    expect(previewMime("icon.svg")).toBe("image/svg+xml")
    expect(previewMime("call.mp3")).toBe("audio/mpeg")
    expect(previewMime("demo.mov")).toBe("video/quicktime")
  })

  it("never types a file as a page, so an object URL cannot run its scripts", () => {
    for (const name of ["report.html", "report.htm", "page.xhtml", "feed.xml", "Chariot.xlsm"]) {
      expect(previewMime(name)).toBe("application/octet-stream")
    }
  })
})

describe("fetchPreviewBytes", () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it("returns the file's bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([80, 75, 3, 4]))))
    expect(await fetchPreviewBytes("/raw", new AbortController().signal)).toEqual(new Uint8Array([80, 75, 3, 4]))
  })

  it("refuses a file over the preview cap without downloading it", async () => {
    const body = new ReadableStream<Uint8Array>({ pull() {} })
    const cancel = vi.spyOn(body, "cancel")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-length": String(MAX_PREVIEW_BYTES + 1) } })))
    await expect(fetchPreviewBytes("/raw", new AbortController().signal)).rejects.toThrow(/too large to preview/)
    expect(cancel).toHaveBeenCalled()
  })

  it("surfaces the server's reason when the file cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "File not found. Refresh the file list." }, { status: 404 })))
    await expect(fetchPreviewBytes("/raw", new AbortController().signal)).rejects.toThrow("File not found. Refresh the file list.")
  })
})
