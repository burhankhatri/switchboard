import { describe, it, expect } from "vitest"
import {
  batchForRequests,
  planFolderImport,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_FILES,
  IMPORT_MAX_REQUEST_BYTES,
  IMPORT_MAX_TOTAL_BYTES,
} from "./workspace-import"
import { formatBytes } from "./format-bytes"

const base = "workspaces/gtm"
const entry = (relativePath: string, size = 10) => ({ relativePath, size })

describe("planFolderImport", () => {
  it("keeps the folder's shape instead of flattening it", () => {
    // The existing per-file upload commits `f.name`, so a nested folder lost
    // its structure. Importing a folder that does that is not importing it.
    const plan = planFolderImport(
      [entry("audit/scripts/run.py"), entry("audit/README.md")],
      base
    )
    expect(plan.files.map((f) => f.path)).toEqual([
      "workspaces/gtm/audit/README.md",
      "workspaces/gtm/audit/scripts/run.py",
    ])
    expect(plan.skipped).toEqual([])
  })

  it("orders files deterministically so a retried import is the same commit", () => {
    const plan = planFolderImport([entry("b.txt"), entry("a.txt"), entry("a/b.txt")], base)
    expect(plan.files.map((f) => f.relativePath)).toEqual(["a.txt", "a/b.txt", "b.txt"])
  })

  it("leaves out the noise every real folder carries", () => {
    // Picking a project directory sweeps in .git and node_modules. Committing
    // another repo's .git internals into the workspaces repo is not a mistake
    // worth making once.
    const plan = planFolderImport(
      [
        entry("p/.git/HEAD"),
        entry("p/node_modules/lib/index.js"),
        entry("p/.DS_Store"),
        entry("p/__pycache__/x.pyc"),
        entry("p/keep.py"),
      ],
      base
    )
    expect(plan.files.map((f) => f.relativePath)).toEqual(["p/keep.py"])
    // Which ones were dropped is the contract; the order they are reported in
    // is whatever the sort produced, so compare as a set.
    expect(plan.skipped.map((s) => s.relativePath).sort()).toEqual(
      [
        "p/.DS_Store",
        "p/.git/HEAD",
        "p/__pycache__/x.pyc",
        "p/node_modules/lib/index.js",
      ].sort()
    )
  })

  it("does not commit a secrets file into a shared repo", () => {
    // The workspace has an encrypted env store for this. A .env swept in by a
    // folder pick would land in git history for everyone, permanently.
    const plan = planFolderImport(
      [entry("p/.env"), entry("p/.env.local"), entry("p/.env.example")],
      base
    )
    expect(plan.files.map((f) => f.relativePath)).toEqual(["p/.env.example"])
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      "looks like a secrets file",
      "looks like a secrets file",
    ])
  })

  it("reports an oversized file rather than dropping it quietly", () => {
    const plan = planFolderImport(
      [entry("p/big.csv", IMPORT_MAX_FILE_BYTES + 1), entry("p/ok.csv", IMPORT_MAX_FILE_BYTES)],
      base
    )
    expect(plan.files.map((f) => f.relativePath)).toEqual(["p/ok.csv"])
    expect(plan.skipped).toEqual([
      { relativePath: "p/big.csv", reason: `larger than ${formatBytes(IMPORT_MAX_FILE_BYTES)}` },
    ])
  })

  it("takes a lead list far bigger than the old 256KB cap", () => {
    // 256KB was a policy guess, not a limit anything imposed: a 1MB CSV of
    // leads is exactly what a GTM workspace is for, and it was refused.
    const plan = planFolderImport([entry("leads.csv", 1024 * 1024)], base)
    expect(plan.files.map((f) => f.relativePath)).toEqual(["leads.csv"])
    expect(plan.skipped).toEqual([])
  })

  it("lets one file be as large as one request can carry", () => {
    expect(IMPORT_MAX_FILE_BYTES).toBe(IMPORT_MAX_REQUEST_BYTES)
  })

  it("refuses a path that would escape the workspace", () => {
    // webkitRelativePath is browser-supplied and the request body is hand
    // editable, so containment is checked here as well as at the route.
    const plan = planFolderImport(
      [entry("../../etc/passwd"), entry("/absolute"), entry("p/ok.txt")],
      base
    )
    expect(plan.files.map((f) => f.relativePath)).toEqual(["p/ok.txt"])
    expect(plan.skipped.map((s) => s.reason)).toEqual(["unsafe path", "unsafe path"])
  })

  it("stops at the file cap instead of committing a home directory", () => {
    const many = Array.from({ length: IMPORT_MAX_FILES + 5 }, (_, i) =>
      entry(`p/f${String(i).padStart(4, "0")}.txt`)
    )
    const plan = planFolderImport(many, base)
    expect(plan.files).toHaveLength(IMPORT_MAX_FILES)
    expect(plan.skipped).toHaveLength(5)
    expect(plan.skipped.every((s) => s.reason === `over the ${IMPORT_MAX_FILES} file limit`)).toBe(true)
  })

  it("stops once the upload would exceed its total", () => {
    // Each file is exactly at the per-file cap, so only the total can reject
    // one — otherwise this would be testing the per-file cap by accident.
    const fits = Math.floor(IMPORT_MAX_TOTAL_BYTES / IMPORT_MAX_FILE_BYTES)
    const plan = planFolderImport(
      Array.from({ length: fits + 1 }, (_, i) =>
        entry(`p/f${String(i).padStart(3, "0")}`, IMPORT_MAX_FILE_BYTES)
      ),
      base
    )
    expect(plan.files).toHaveLength(fits)
    expect(plan.skipped).toEqual([
      { relativePath: `p/f${String(fits).padStart(3, "0")}`, reason: "over the total size limit" },
    ])
    expect(plan.totalBytes).toBe(fits * IMPORT_MAX_FILE_BYTES)
  })

  it("lets the server hold one request to what one request can carry", () => {
    const plan = planFolderImport(
      [entry("p/a", IMPORT_MAX_REQUEST_BYTES), entry("p/b", 1)],
      base,
      IMPORT_MAX_REQUEST_BYTES
    )
    expect(plan.files.map((f) => f.relativePath)).toEqual(["p/a"])
    expect(plan.skipped).toEqual([{ relativePath: "p/b", reason: "over the total size limit" }])
  })

  it("counts only what is actually being committed", () => {
    const plan = planFolderImport([entry("p/a", 100), entry("p/.DS_Store", 6000)], base)
    expect(plan.totalBytes).toBe(100)
  })
})

describe("batchForRequests", () => {
  const planned = (relativePath: string, size: number) => ({ relativePath, path: `${base}/${relativePath}`, size })

  it("sends a small upload as one request, so it lands as one commit", () => {
    const files = [planned("a", 10), planned("b", 20)]
    expect(batchForRequests(files)).toEqual([files])
  })

  it("splits an upload no single request could carry, keeping its order", () => {
    const half = IMPORT_MAX_REQUEST_BYTES / 2
    const files = [planned("a", half), planned("b", half), planned("c", half)]
    expect(batchForRequests(files).map((b) => b.map((f) => f.relativePath))).toEqual([["a", "b"], ["c"]])
  })

  it("gives a file at the cap a request of its own", () => {
    const files = [planned("small", 1), planned("big", IMPORT_MAX_REQUEST_BYTES), planned("tail", 1)]
    expect(batchForRequests(files).map((b) => b.map((f) => f.relativePath))).toEqual([
      ["small"],
      ["big"],
      ["tail"],
    ])
  })

  it("has nothing to send for nothing", () => {
    expect(batchForRequests([])).toEqual([])
  })
})
