import type { Sandbox } from "@daytonaio/sdk"
import { describe, expect, it, vi } from "vitest"
import { createSandboxJobs } from "../src/jobs.js"
import { parsePid } from "../src/shell.js"

function fakeSandbox(cgroupAvailable = false) {
  let meta: Record<string, unknown> = {}
  const executeCommand = vi.fn(async (command: string) => {
    if (command.startsWith("mkdir -p")) {
      const path = command.match(/CGROUP:%s\\n' '([^']+)'/)?.[1]
      return { exitCode: 0, result: `CGROUP:${cgroupAvailable ? path : ""}\n` }
    }
    if (command.startsWith("nohup env ")) return { exitCode: 0, result: "12345\n" }
    if (command.startsWith("printf %s")) {
      const encoded = command.match(/printf %s '([^']+)'/)![1]
      meta = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))
    }
    if (command.startsWith("cat ")) return { exitCode: 0, result: JSON.stringify(meta) }
    return { exitCode: 0, result: "" }
  })
  return { sandbox: { process: { executeCommand } } as unknown as Sandbox, executeCommand, meta: () => meta }
}

describe("job startup and cancellation modes", () => {
  it("starts without cgroups and preserves the fallback on cold attach", async () => {
    const fake = fakeSandbox()
    const jobs = createSandboxJobs(fake.sandbox)
    const handle = await jobs.start({ command: "sleep 30", processName: "claude" })
    expect(handle.cgroup).toBeNull()
    expect(handle.processTag).toBe(`SWITCHBOARD_JOB_ID=${handle.jobId}`)
    expect(fake.meta().version).toBe(2)
    const cold = createSandboxJobs(fake.sandbox)
    expect(await cold.attach(handle.jobId)).toEqual(handle)
    await cold.cancel(handle)
    const cancel = fake.executeCommand.mock.calls.at(-1)![0]
    expect(cancel).toContain(handle.processTag!)
    expect(cancel).not.toContain("cgroup.kill")
    expect(cancel).not.toContain("pkill")
    expect(cancel).toContain(`kill -KILL -${handle.pgid}`)
  })

  it("uses writable cgroups and preserves them on cold attach", async () => {
    const fake = fakeSandbox(true)
    const jobs = createSandboxJobs(fake.sandbox)
    const handle = await jobs.start({ command: "sleep 30" })
    expect(handle.cgroup).toBe(`/sys/fs/cgroup/sbj-${handle.jobId}`)
    expect(await jobs.attach(handle.jobId)).toEqual(handle)
    await jobs.cancel(handle)
    expect(fake.executeCommand.mock.calls.at(-1)![0]).toContain(`${handle.cgroup}/cgroup.kill`)
  })

  it("reattaches version-1 jobs with their legacy cancellation behavior", async () => {
    const fake = fakeSandbox()
    fake.executeCommand.mockResolvedValueOnce({ exitCode: 0, result: JSON.stringify({
      pgid: 123, outputFile: "/tmp/old/output.log", exitFile: "/tmp/old/exit", processName: "claude", version: 1,
    }) })
    const jobs = createSandboxJobs(fake.sandbox)
    const handle = await jobs.attach("old")
    expect(handle?.cgroup).toBe("/sys/fs/cgroup/sbj-old")
    await jobs.cancel(handle!)
    expect(fake.executeCommand.mock.calls.at(-1)![0]).toContain("pkill -9 -f 'claude'")
  })

  it("reports the real setup failure instead of trying to parse a PID", async () => {
    const fake = fakeSandbox()
    fake.executeCommand.mockResolvedValueOnce({ exitCode: 1, result: "mkdir: Permission denied" })
    await expect(createSandboxJobs(fake.sandbox).start({ command: "echo no" }))
      .rejects.toThrow("job setup failed (exit 1): mkdir: Permission denied")
    expect(fake.executeCommand).toHaveBeenCalledTimes(1)
  })

  it("reports a launcher exit failure before parsing its output", async () => {
    const fake = fakeSandbox()
    fake.executeCommand.mockResolvedValueOnce({ exitCode: 0, result: "CGROUP:\n" })
    fake.executeCommand.mockResolvedValueOnce({ exitCode: 127, result: "sh: launcher not found" })
    await expect(createSandboxJobs(fake.sandbox).start({ command: "echo no" }))
      .rejects.toThrow("job launch failed (exit 127): sh: launcher not found")
  })

  it("reaps the launched job if its durable metadata cannot be written", async () => {
    const fake = fakeSandbox()
    fake.executeCommand.mockResolvedValueOnce({ exitCode: 0, result: "CGROUP:\n" })
    fake.executeCommand.mockResolvedValueOnce({ exitCode: 0, result: "12345\n" })
    fake.executeCommand.mockResolvedValueOnce({ exitCode: 1, result: "No space left on device" })
    await expect(createSandboxJobs(fake.sandbox).start({ command: "sleep 30" }))
      .rejects.toThrow("job metadata failed (exit 1): No space left on device")
    expect(fake.executeCommand.mock.calls.at(-1)![0]).toContain("kill -KILL -12345")
  })
})

describe("parsePid", () => {
  it("accepts only a positive safe integer with surrounding whitespace", () => {
    expect(parsePid(" 42\n")).toBe(42)
    for (const output of [undefined, "", "0", "-1", "1.5", "error 42", "9007199254740992"]) {
      expect(() => parsePid(output)).toThrow("could not parse pid")
    }
  })
})
