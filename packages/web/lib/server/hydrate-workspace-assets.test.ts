import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, symlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ access: vi.fn(), assets: vi.fn(), download: vi.fn() }))
vi.mock("@/lib/db/prisma", () => ({ prisma: { workspaceAsset: { findMany: mocks.assets } } }))
vi.mock("./file-uploads", () => ({ assertUploadAccess: mocks.access }))
vi.mock("./upload-storage", () => ({ downloadStoredFile: mocks.download }))
import { HYDRATION_SCRIPT, hydrateWorkspaceAssets } from "./hydrate-workspace-assets"
import type { Sandbox } from "@daytonaio/sdk"

function pythonExecutable() {
  if (process.env.TEST_PYTHON) return process.env.TEST_PYTHON
  if (process.platform !== "win32") return "python3"
  const managed = path.join(process.env.APPDATA || "", "uv/python")
  if (existsSync(managed)) {
    for (const name of readdirSync(managed).filter(name => name.startsWith("cpython-")).sort().reverse()) {
      const binary = path.join(managed, name, "python.exe")
      if (existsSync(binary)) return binary
    }
  }
  return "python"
}

let fixture: string
const options = { repoPath: "/sandbox/project", workspaceId: "ws", workspacePath: "workspaces/demo", userId: "user" }
const asset = { path: "workspaces/demo/data [1].csv", uploadId: "asset-one", upload: { objectPath: "private/object", size: 3 } }
let sandbox: Sandbox
beforeEach(() => {
  vi.clearAllMocks()
  fixture = mkdtempSync(path.join(os.tmpdir(), "switchboard-assets-test-"))
  execFileSync("git", ["init", fixture], { stdio: "ignore" })
  mocks.access.mockResolvedValue(undefined)
  mocks.assets.mockResolvedValue([asset])
  mocks.download.mockResolvedValue(Buffer.from("abc"))
  sandbox = {
    process: { executeCommand: vi.fn(async (command: string) => {
      const encoded = command.match(/'([A-Za-z0-9+/=]+)'$/)?.[1]
      if (!encoded) throw new Error("Missing hydration metadata")
      const metadata = JSON.parse(Buffer.from(encoded, "base64").toString())
      metadata.root = fixture
      try {
        const result = execFileSync(pythonExecutable(), ["-B", "-c", HYDRATION_SCRIPT, Buffer.from(JSON.stringify(metadata)).toString("base64")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
        return { exitCode: 0, result }
      } catch (error) {
        return { exitCode: 1, result: (error as { stderr: Buffer }).stderr?.toString() }
      }
    }) },
    fs: { uploadFile: vi.fn(async (bytes: Buffer, target: string) => {
      writeFileSync(path.join(fixture, target.slice(options.repoPath.length + 1)), bytes)
    }) },
  } as unknown as Sandbox
})
afterEach(() => {
  // Only remove the exact temporary fixture created by this test.
  const target = realpathSync(fixture)
  if (path.dirname(target).toLowerCase() !== realpathSync(os.tmpdir()).toLowerCase() || !path.basename(target).startsWith("switchboard-assets-test-")) throw new Error("Unsafe fixture cleanup target")
  rmSync(target, { recursive: true, force: true })
})

describe("real sandbox asset filesystem preparation", () => {
  it("hydrates bytes and Git ignores a literal filename with spaces and brackets", async () => {
    await hydrateWorkspaceAssets(sandbox, options)
    expect(readFileSync(path.join(fixture, asset.path), "utf8")).toBe("abc")
    const ignored = execFileSync("git", ["-C", fixture, "check-ignore", "--", asset.path], { encoding: "utf8" })
    expect(ignored).toContain("data [1].csv")
    expect(readFileSync(path.join(fixture, ".git/info/exclude"), "utf8")).toContain("/workspaces/demo/data\\ \\[1\\].csv")
  })
  it("preserves local agent edits when the retained asset version is unchanged", async () => {
    await hydrateWorkspaceAssets(sandbox, options)
    writeFileSync(path.join(fixture, asset.path), "agent edits")
    await hydrateWorkspaceAssets(sandbox, options)
    expect(mocks.download).toHaveBeenCalledTimes(1)
    expect(readFileSync(path.join(fixture, asset.path), "utf8")).toBe("agent edits")
  })
  it("refuses to overwrite a tracked Git file", async () => {
    mkdirSync(path.join(fixture, "workspaces/demo"), { recursive: true })
    writeFileSync(path.join(fixture, asset.path), "tracked")
    execFileSync("git", ["-C", fixture, "add", "--", asset.path])
    await expect(hydrateWorkspaceAssets(sandbox, options)).rejects.toThrow("tracked Git file")
    expect(mocks.download).not.toHaveBeenCalled()
    expect(readFileSync(path.join(fixture, asset.path), "utf8")).toBe("tracked")
  })
  it("refuses a symlink or junction into a sibling directory", async () => {
    const outside = path.join(fixture, "sibling")
    mkdirSync(outside)
    mkdirSync(path.join(fixture, "workspaces/demo"), { recursive: true })
    symlinkSync(outside, path.join(fixture, "workspaces/demo/linked"), process.platform === "win32" ? "junction" : "dir")
    mocks.assets.mockResolvedValue([{ ...asset, path: "workspaces/demo/linked/data.csv" }])
    await expect(hydrateWorkspaceAssets(sandbox, options)).rejects.toThrow("symlink")
    expect(mocks.download).not.toHaveBeenCalled()
    expect(existsSync(path.join(outside, "data.csv"))).toBe(false)
  })
  it("rejects another workspace's metadata before touching the filesystem", async () => {
    mocks.assets.mockResolvedValue([{ ...asset, path: "workspaces/other/secrets.csv" }])
    await expect(hydrateWorkspaceAssets(sandbox, options)).rejects.toThrow("outside this workspace")
    expect(sandbox.process.executeCommand).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it("blocks revoked membership before reading object metadata", async () => {
    mocks.access.mockRejectedValue(new Error("Join this workspace first"))
    await expect(hydrateWorkspaceAssets(sandbox, options)).rejects.toThrow("Join")
    expect(mocks.assets).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it("propagates download failure without recording a completed hydration", async () => {
    mocks.download.mockRejectedValue(new Error("storage unavailable"))
    await expect(hydrateWorkspaceAssets(sandbox, options)).rejects.toThrow("storage unavailable")
    expect(existsSync(path.join(fixture, ".git/switchboard-assets-ws.json"))).toBe(false)
  })
})
