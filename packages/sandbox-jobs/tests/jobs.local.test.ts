/** Real Linux shell regression tests, with cgroup creation forced to fail.
 * On Windows run with SBJ_LOCAL_WSL=1 and an installed Ubuntu WSL distro. */
import { execFile, spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, writeFile, readFile, rename, unlink, rmdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { Sandbox } from "@daytonaio/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createSandboxJobs } from "../src/jobs.js"
import { q } from "../src/shell.js"
import type { JobHandle } from "../src/types.js"

const useWsl = process.platform === "win32" && process.env.SBJ_LOCAL_WSL === "1"
const runFile = promisify(execFile)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(process.platform !== "linux" && !useWsl)("jobs on Linux with read-only cgroups", () => {
  let root: string
  let scriptsDir: string
  let wslExecutor: ChildProcess | undefined
  let wslError = ""
  let callNumber = 0
  const linuxPath = (file: string) => file.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive: string) => `/mnt/${drive.toLowerCase()}`)
  async function request(message: Record<string, unknown>) {
    const file = join(scriptsDir, "request.json")
    await writeFile(`${file}.tmp`, JSON.stringify(message))
    await rename(`${file}.tmp`, file)
  }
  const handles: JobHandle[] = []
  async function shell(command: string) {
    // This reproduces the screenshot without changing the host's cgroup mount.
    const script = `sudo() { echo 'Read-only file system' >&2; return 1; }; ${command}`
    // Use a script file on WSL to avoid Windows command-line translation of
    // nested shell quotes and its handling of redirected standard input.
    const file = join(scriptsDir, `call-${callNumber++}.sh`)
    await writeFile(file, script + "\n")
    try {
      if (useWsl) {
        // All Linux commands must belong to ONE WSL invocation: WSL reaps
        // descendants when a Windows invocation exits, regardless of setsid.
        const response = `${file}.json`
        await request({ script: linuxPath(file), response: linuxPath(response) })
        const deadline = Date.now() + 25_000
        for (;;) {
          try {
            const result = JSON.parse(await readFile(response, "utf8"))
            await unlink(response)
            return result as { exitCode: number; result: string }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            if (Date.now() > deadline || wslExecutor?.exitCode !== null) throw new Error(`WSL executor unavailable: ${wslError}`)
            await sleep(30)
          }
        }
      }
      const { stdout, stderr } = await runFile("/bin/sh", [file], { timeout: 20_000, maxBuffer: 1024 * 1024 })
      return { exitCode: 0, result: stdout + stderr }
    } catch (error) {
      const e = error as { code: number; stdout: string; stderr: string; message: string }
      return { exitCode: typeof e.code === "number" ? e.code : 1, result: (e.stdout ?? "") + (e.stderr ?? e.message ?? "") }
    } finally {
      await unlink(file)
    }
  }
  const sandbox = { process: { executeCommand: shell } } as unknown as Sandbox
  const jobs = createSandboxJobs(sandbox)
  const start = async (command: string, extra = {}) => {
    const handle = await jobs.start({ command, root, ...extra })
    handles.push(handle)
    return handle
  }
  const alive = async (pid: number) => {
    const { result } = await shell(`ps -o state= -p ${pid} 2>/dev/null; true`)
    return result.replace(/[Z\s]/g, "").length > 0
  }
  async function waitUntil(check: () => Promise<boolean>) {
    const deadline = Date.now() + 10_000
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error("Linux job test deadline exceeded")
      await sleep(100)
    }
  }

  beforeAll(async () => {
    scriptsDir = await mkdtemp(join(tmpdir(), "sbj-scripts-"))
    if (useWsl) {
      // A tiny file-based test transport avoids WSL's stdin/argument rewriting.
      // Python is only used by this optional Windows test harness.
      const server = join(scriptsDir, "executor.py")
      await writeFile(server, [
        "import json, os, subprocess, sys, time",
        "request = os.path.join(sys.argv[1], 'request.json')",
        "while True:",
        "    try:",
        "        with open(request) as f: message = json.load(f)",
        "    except FileNotFoundError:",
        "        time.sleep(0.02)",
        "        continue",
        "    os.unlink(request)",
        "    if message.get('stop'): break",
        "    result = subprocess.run(['/bin/sh', message['script']], capture_output=True, text=True, timeout=20)",
        "    response = message['response']",
        "    with open(response + '.tmp', 'w') as f:",
        "        json.dump({'exitCode': result.returncode, 'result': result.stdout + result.stderr}, f)",
        "    os.replace(response + '.tmp', response)",
      ].join("\n") + "\n")
      wslExecutor = spawn("wsl.exe", ["-d", "Ubuntu", "--exec", "python3", linuxPath(server), linuxPath(scriptsDir)])
      wslExecutor.stderr?.on("data", (chunk) => { wslError += chunk.toString() })
    }
    const created = await shell("mktemp -d /tmp/sbj-test.XXXXXX")
    root = created.result.trim()
    if (created.exitCode !== 0 || !/^\/tmp\/sbj-test\.[a-zA-Z0-9]+$/.test(root)) {
      throw new Error(`Cannot create Linux test directory: ${created.result}`)
    }
  })
  afterAll(async () => {
    for (const handle of handles) await jobs.cancel(handle)
    if (/^\/tmp\/sbj-test\.[a-zA-Z0-9]+$/.test(root)) await shell(`rm -rf -- ${q(root)}`)
    if (wslExecutor) {
      if (wslExecutor.exitCode === null) {
        await request({ stop: true })
        await new Promise((resolve) => {
          wslExecutor!.once("exit", resolve)
          setTimeout(() => { wslExecutor!.kill(); resolve(undefined) }, 5000).unref()
        })
      }
      await unlink(join(scriptsDir, "executor.py"))
    }
    await rmdir(scriptsDir)
  })

  it("detaches immediately, reattaches cold, and reads the true exit code", async () => {
    const t0 = Date.now()
    const handle = await start(`test "$PWD" = ${q(root)} || exit 17; printf 'one\\n'; sleep 8; printf '%s\\n' "$SBJ_TEST_MESSAGE"; exit 3`, {
      cwd: root,
      env: { SBJ_TEST_MESSAGE: "spaces 'quoted'" },
    })
    // Leave room for WSL filesystem/transport overhead while still proving
    // that launch returns before the eight-second command completes.
    expect(Date.now() - t0).toBeLessThan(6000)
    expect(handle.cgroup).toBeNull()
    const cold = createSandboxJobs(sandbox)
    expect(await cold.attach(handle.jobId, root)).toEqual(handle)
    try {
      await waitUntil(async () => (await cold.status(handle)).state === "exited")
    } catch (error) {
      throw new Error(`${error}: ${JSON.stringify(await cold.read(handle))}`)
    }
    const read = await cold.read(handle)
    expect(read.raw).toBe("one\nspaces 'quoted'\n")
    expect(read.status.exitCode).toBe(3)
    expect((await cold.read(handle, read.cursor)).raw).toBe("")
  })

  it("kills a reparented setsid child and a TERM-resistant child without touching another job", async () => {
    const other = await start("sleep 120", { processName: "sleep" })
    const pidFile = `${root}/escapee.pid`
    const resistantFile = `${root}/resistant.pid`
    const handle = await start(
      `setsid sh -c ${q(`echo $$ > ${q(pidFile)}; exec sleep 120`)} & ` +
      `setsid sh -c ${q(`trap '' TERM; echo $$ > ${q(resistantFile)}; exec sleep 120`)} & wait`,
      { processName: "sleep", env: { SWITCHBOARD_JOB_ID: "must-not-override-job-tag" } }
    )
    try {
      await waitUntil(async () => (await shell(`test -s ${q(pidFile)} && test -s ${q(resistantFile)}`)).exitCode === 0)
    } catch (error) {
      throw new Error(`${error}: ${JSON.stringify(await jobs.read(handle))}`)
    }
    const escapee = Number((await shell(`cat ${q(pidFile)}`)).result.trim())
    const resistant = Number((await shell(`cat ${q(resistantFile)}`)).result.trim())
    expect(await alive(escapee)).toBe(true)
    expect(await alive(resistant)).toBe(true)
    expect(Number((await shell(`ps -o pgid= -p ${escapee}`)).result.trim())).not.toBe(handle.pgid)
    // Kill only the leader, leaving its detached children reparented. A cold
    // caller must still find them without relying on ancestry or agent names.
    await shell(`kill -KILL ${handle.pgid}`)
    const cold = createSandboxJobs(sandbox)
    const attached = await cold.attach(handle.jobId, root)
    await cold.cancel(attached!)
    await waitUntil(async () => !(await alive(escapee)) && !(await alive(resistant)))
    expect((await jobs.status(other)).state).toBe("running")
    expect((await jobs.status(handle)).state).toBe("exited")
  })
})
