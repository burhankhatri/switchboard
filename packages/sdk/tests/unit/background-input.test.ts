import { describe, expect, it, vi } from "vitest"
import { createBackgroundSession } from "../../src/background/session"
import { claudeAgent } from "../../src/agents/claude"
import { opencodeAgent } from "../../src/agents/opencode"
import type { CodeAgentSandbox } from "../../src/types/provider"

describe("large background prompts", () => {
  for (const agent of [claudeAgent, opencodeAgent]) {
    it(`${agent.name} keeps complete context in stdin and model/resume options in argv`, async () => {
      const start = vi.fn(async (_options: unknown) => ({ jobId: "job", pgid: 123, outputFile: "/tmp/output" }))
      const sandbox = { jobs: { start }, executeCommand: vi.fn(async () => ({ exitCode: 0, output: "" })) } as unknown as CodeAgentSandbox
      const session = createBackgroundSession(agent, sandbox, "/tmp/test", { systemPrompt: "System instructions", model: "test-model", sessionId: "resume-id" })
      const prompt = "\n日本語 ' \" $(echo injected) ".repeat(20_000)
      await session.start(prompt, { history: [{ role: "user", content: "Previous request" }] })
      const options = start.mock.calls[0][0] as unknown as { stdin: string; command: string }
      expect(options.stdin).toContain(prompt)
      expect(options.stdin).toContain("Previous request")
      expect(options.command).toContain("test-model")
      expect(options.command).toContain("resume-id")
      expect(options.command).not.toContain("injected")
      expect(Buffer.byteLength(options.command)).toBeLessThan(8192)
      expect(agent.name === "opencode" ? options.stdin : options.command).toContain("System instructions")
    })
  }
})
