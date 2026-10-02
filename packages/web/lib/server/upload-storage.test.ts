import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { downloadStoredFile, signedUploadUrl, signedDownloadUrl } from "./upload-storage"
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/upload-limits"

describe("private Storage transfers", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-secret")
    vi.stubEnv("SUPABASE_UPLOAD_BUCKET", "private-files")
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it("issues a scoped signed URL without including the server key", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ public: false, file_size_limit: MAX_UPLOAD_FILE_BYTES }))
      .mockResolvedValueOnce(Response.json({ url: "/object/upload/sign/private-files/u/object?token=temporary" }))
    vi.stubGlobal("fetch", fetch)
    const url = await signedUploadUrl("u/object")
    expect(url).toBe("https://project.supabase.co/storage/v1/object/upload/sign/private-files/u/object?token=temporary")
    expect(url).not.toContain("server-secret")
  })
  it("refuses a public bucket", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ public: true, file_size_limit: MAX_UPLOAD_FILE_BYTES }))
    vi.stubGlobal("fetch", fetch)
    await expect(signedUploadUrl("u/object")).rejects.toThrow("private")
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("rejects a size mismatch before downloading bytes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { headers: { "content-length": "20" } }))
    vi.stubGlobal("fetch", fetch)
    await expect(downloadStoredFile("u/object", 10)).rejects.toThrow("size")
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("bounds actual streamed bytes even if HEAD lies", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { "content-length": "3" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4])))
    vi.stubGlobal("fetch", fetch)
    await expect(downloadStoredFile("u/object", 3)).rejects.toThrow("exceeds")
  })
  it("preserves binary bytes", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { "content-length": "3" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 255, 128]))))
    expect(await downloadStoredFile("u/object", 3)).toEqual(Buffer.from([0, 255, 128]))
  })
  it("rejects truncated downloads", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { "content-length": "3" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]))))
    await expect(downloadStoredFile("u/object", 3)).rejects.toThrow("incomplete")
  })
  it("returns a short-lived download with the original filename", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ signedURL: "/object/sign/private-files/object?token=temporary" })))
    const url = new URL(await signedDownloadUrl("object", "my data.csv"))
    expect(url.searchParams.get("download")).toBe("my data.csv")
  })
  it("does not expose response bodies on error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("server-secret", { status: 403 })))
    await expect(signedDownloadUrl("object", "file.csv")).rejects.toThrow("HTTP 403")
  })
})
