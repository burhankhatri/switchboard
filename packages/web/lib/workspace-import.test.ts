import { describe, it, expect } from "vitest"
import {
  planFolderImport,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_FILES,
  IMPORT_MAX_TOTAL_BYTES,
} from "./workspace-import"

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
    expect(plan.skipped.map((s) => s.relativePath)).toEqual([
      "p/.DS_Store",
      "p/.git/HEAD",
      "p/__pycache__/x.pyc",
      "p/node_modules/lib/index.js",
    ])
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
      { relativePath: "p/big.csv", reason: `larger than ${IMPORT_MAX_FILE_BYTES / 1024}KB` },
    ])
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

  it("stops once the import would exceed what one request can carry", () => {
    const half = Math.floor(IMPORT_MAX_TOTAL_BYTES / 2)
    const plan = planFolderImport(
      [entry("p/a", half), entry("p/b", half), entry("p/c", 1024)],
      base
    )
    expect(plan.files.map((f) => f.relativePath)).toEqual(["p/a", "p/b"])
    expect(plan.skipped).toEqual([{ relativePath: "p/c", reason: "over the total size limit" }])
    expect(plan.totalBytes).toBe(half * 2)
  })

  it("counts only what is actually being committed", () => {
    const plan = planFolderImport([entry("p/a", 100), entry("p/.DS_Store", 6000)], base)
    expect(plan.totalBytes).toBe(100)
  })
})
