import { afterEach, describe, expect, it, vi } from "vitest"
import { sendMessageToApi } from "./chat-messages"
import { stageFile, forgetStagedFile } from "./direct-upload"
vi.mock("./direct-upload", () => ({ stageFile: vi.fn(), forgetStagedFile: vi.fn() }))

describe("sendMessageToApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("preserves the subscription plan from a daily-limit response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        error: "DAILY_LIMIT_EXCEEDED",
        plan: "pro",
        provider: "gemini",
        unit: "messages",
        used: 200,
        limit: 200,
        resetAt: "2026-08-02T00:00:00.000Z",
      }, { status: 429 })
    ))

    const result = await sendMessageToApi("chat-1", {
      message: "Continue",
      agent: "gemini",
      model: "gemini-2.5-flash",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    })

    expect(result).toMatchObject({
      ok: false,
      isDailyLimit: true,
      plan: "pro",
      provider: "gemini",
      limit: 200,
    })
  })

  it("sends upload IDs instead of file bytes and clears staged cache only on success", async () => {
    vi.mocked(stageFile).mockResolvedValue("private-upload")
    const fetch = vi.fn().mockResolvedValue(Response.json({ uploadedFiles: ["/uploads/data.csv"] }))
    vi.stubGlobal("fetch", fetch)
    const file = new File(["private bytes"], "data.csv")
    const result = await sendMessageToApi("chat", { message: "read it", agent: "opencode", model: "model", userMessageId: "u", assistantMessageId: "a" }, [file])
    expect(result.ok).toBe(true)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.uploadIds).toEqual(["private-upload"])
    expect(JSON.stringify(body)).not.toContain("private bytes")
    expect(forgetStagedFile).toHaveBeenCalledWith(file, { kind: "chat", id: "chat" })
  })

  it("does not start a turn if direct upload fails", async () => {
    vi.mocked(stageFile).mockRejectedValue(new Error("Upload failed"))
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const result = await sendMessageToApi("chat", { message: "read it", agent: "opencode", model: "model", userMessageId: "u", assistantMessageId: "a" }, [new File(["abc"], "data.csv")])
    expect(result).toMatchObject({ ok: false, error: "Upload failed" })
    expect(fetch).not.toHaveBeenCalled()
    expect(forgetStagedFile).not.toHaveBeenCalled()
  })
})
