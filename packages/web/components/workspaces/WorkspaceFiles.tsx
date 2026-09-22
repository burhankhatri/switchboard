"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight, FilePlus, FileText, FolderPlus, Folder, FolderUp, Loader2, Sparkles, Upload,
} from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { writeCachedFile } from "@/lib/workspace-file-cache"
import { planFolderImport, type SkippedFile } from "@/lib/workspace-import"
import { cn } from "@/lib/utils"

interface RepoFile { path: string; name: string; size: number }

interface Node { name: string; path?: string; children: Map<string, Node> }
function toTree(files: RepoFile[]): Node {
  const root: Node = { name: "", children: new Map() }
  for (const f of files) {
    let node = root
    const parts = f.name.split("/")
    parts.forEach((part, i) => {
      if (!node.children.has(part)) node.children.set(part, { name: part, children: new Map() })
      node = node.children.get(part)!
      if (i === parts.length - 1) node.path = f.path
    })
  }
  return root
}

/**
 * Uploads are committed as UTF-8 text, so this is for skills, scripts and data
 * files — not binaries. The cap keeps a stray large file from being turned into
 * a commit.
 */
const MAX_UPLOAD_BYTES = 256 * 1024

/** git has no empty directories, so a new folder is a folder with a .gitkeep. */
const GITKEEP = ".gitkeep"

/**
 * A file's bytes as base64.
 *
 * readAsDataURL rather than reading text: an imported folder contains images
 * and fixtures as readily as scripts, and `.text()` would turn every one of
 * them into replacement characters. Base64 travels through JSON unchanged and
 * is what the git blob API wants anyway.
 */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.onload = () => {
      const s = String(reader.result)
      resolve(s.slice(s.indexOf(",") + 1))
    }
    reader.readAsDataURL(file)
  })
}

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  const { activeWorkspace, openFile, requestOpenFile } = useWorkspace()
  const [open, setOpen] = useState(depth < 2)
  const qc = useQueryClient()
  const pad = { paddingLeft: `${depth * 12 + 8}px` }

  // Fetch on the way to the click. Reading a file is a GitHub round trip, and
  // the ~300ms between pointing at a row and pressing it is enough to hide
  // most of it — by the time the editor mounts the content is usually cached.
  const prefetch = (path: string) => {
    const wsId = activeWorkspace?.id
    if (!wsId) return
    void qc.prefetchQuery({
      queryKey: ["workspace-file", wsId, path],
      queryFn: async () => {
        const r = await fetch(`/api/workspaces/${wsId}/files?path=${encodeURIComponent(path)}`)
        if (!r.ok) throw new Error(String(r.status))
        const file = await r.json()
        writeCachedFile(wsId, path, {
          content: file.content,
          sha: file.sha,
          truncated: file.truncated,
        })
        return file
      },
      staleTime: 30 * 1000,
    })
  }

  if (node.path) {
    if (node.name === GITKEEP) return null // placeholder, not content
    const active = openFile === node.path
    return (
      <button
        data-workspace-file
        onClick={() => void requestOpenFile(node.path!)}
        onMouseEnter={() => prefetch(node.path!)}
        onFocus={() => prefetch(node.path!)}
        style={pad}
        className={cn(
          "flex items-center gap-1.5 w-full py-1 pr-2 rounded text-left text-xs cursor-pointer",
          active ? "bg-accent text-foreground" : "hover:bg-accent/50 text-muted-foreground"
        )}
      >
        {node.name === "SKILL.md" ? (
          <Sparkles className="h-3 w-3 shrink-0 text-primary" />
        ) : (
          <FileText className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
    )
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        style={pad}
        className="flex items-center gap-1 w-full py-1 pr-2 rounded text-left text-xs text-muted-foreground hover:bg-accent/50 cursor-pointer"
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")} />
        <Folder className="h-3 w-3 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
      {open &&
        [...node.children.values()].map((c) => (
          <TreeNode key={c.name + (c.path ?? "")} node={c} depth={depth + 1} />
        ))}
    </>
  )
}

/**
 * The workspace's files.
 *
 * One tree, not two. Files live in the workspace repo and everyone in the
 * workspace sees the same ones — "shared" is not a separate place, it is what a
 * workspace already is. (The repo-root skills that also load are a platform
 * detail; surfacing them as a second `.claude` only invited the question of
 * which one you were editing.)
 *
 * Collapsed by default. A raw git tree is the honest view of a workspace and
 * the only way to reach a script or a fixture, but it is not what most people
 * open a workspace to do — `WorkspaceSkills` is, and a tree of dotfiles above
 * it buried the thing that mattered.
 *
 * Anything added here is committed, so the next run clones it.
 */
export function WorkspaceFiles() {
  const { activeWorkspace } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // What an import left behind, shown after it finishes. A folder pick sweeps
  // in junk by definition, so "committed 12, skipped 4" is the honest result —
  // reporting only the successes would look like files vanishing.
  const [skipped, setSkipped] = useState<SkippedFile[]>([])
  // What is being created inline, if anything. null means the row is not shown.
  const [creating, setCreating] = useState<"file" | "folder" | null>(null)
  const [newName, setNewName] = useState("")
  const [nameError, setNameError] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  // React has no typed prop for these and they must be present as real
  // attributes for the picker to open in directory mode. `directory` is the
  // standards-track name; `webkitdirectory` is what every current browser
  // actually honours.
  useEffect(() => {
    const el = folderInput.current
    if (!el) return
    el.setAttribute("webkitdirectory", "")
    el.setAttribute("directory", "")
  }, [])

  const { data, isLoading, error } = useQuery({
    queryKey: ["workspace-files", activeWorkspace?.id],
    queryFn: () =>
      fetch(`/api/workspaces/${activeWorkspace!.id}/files`).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<{ workspace: RepoFile[]; shared: RepoFile[] }>
      }),
    // Collapsed means nobody is looking, and the listing is a GitHub round
    // trip on every workspace switch.
    enabled: !!activeWorkspace && open,
    retry: false,
  })

  const write = useMutation({
    mutationFn: async ({ path, content }: { path: string; content: string }) => {
      const res = await fetch(`/api/workspaces/${activeWorkspace!.id}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed")
      return res.json() as Promise<{ path: string }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace-files", activeWorkspace?.id] }),
  })

  if (!activeWorkspace) return null

  // A workspace persisted by an older build may lack `path`. Without it every
  // write would post "undefined/<file>" and be refused by the containment
  // check — which looked exactly like the upload doing nothing.
  // Top-level names already taken, so a clash is caught before a commit that
  // GitHub would reject anyway.
  const existingNames = new Set(
    (data?.workspace ?? []).map((f) => f.name.split("/")[0])
  )

  const base = activeWorkspace.path
  if (!base) {
    return (
      <div className="px-2 pb-2">
        <p className="px-2 py-2 text-xs text-destructive">
          This workspace is missing its path. Re-pick it from the dropdown.
        </p>
      </div>
    )
  }

  async function addFiles(files: File[]) {
    // Sequential: each write is a commit, and GitHub rejects concurrent writes
    // to the same branch with a 409.
    const failed: string[] = []
    for (const f of files) {
      setBusy(f.name)
      try {
        if (f.size > MAX_UPLOAD_BYTES) {
          throw new Error(`${f.name} is larger than ${MAX_UPLOAD_BYTES / 1024}KB`)
        }
        await write.mutateAsync({ path: `${base}/${f.name}`, content: await f.text() })
      } catch (e) {
        // Collect and report: a swallowed failure in a loop looked to the user
        // like the upload silently doing nothing.
        failed.push(`${f.name}: ${(e as Error).message}`)
      }
    }
    setBusy(null)
    setUploadError(failed.length ? failed.join("; ") : null)
  }

  /**
   * Import a picked folder: one request, one commit.
   *
   * Not addFiles in a loop. That commits per file, loses the nesting because it
   * only ever sees `f.name`, and puts a folder's worth of commits into the
   * history of a repo other people read. The whole tree goes up together and
   * lands as one commit instead.
   *
   * The plan is computed here as well as on the server so the skip list can be
   * shown without a round trip; the server recomputes it and is the authority.
   */
  async function importFolder(picked: File[]) {
    setUploadError(null)
    setSkipped([])
    if (!picked.length) return

    // webkitRelativePath is "<picked folder>/<path within it>". It is empty for
    // a browser that ignored the directory attribute, and then the flat name is
    // the honest fallback.
    const entries = picked.map((f) => ({
      relativePath: f.webkitRelativePath || f.name,
      size: f.size,
      file: f,
    }))
    const folder = entries[0].relativePath.split("/")[0] || "folder"

    const plan = planFolderImport(
      entries.map(({ relativePath, size }) => ({ relativePath, size })),
      base!
    )
    if (!plan.files.length) {
      setUploadError(`Nothing in ${folder} could be imported.`)
      setSkipped(plan.skipped)
      return
    }

    const byPath = new Map(entries.map((e) => [e.relativePath, e.file]))
    setBusy(`${folder} — reading ${plan.files.length} files`)

    try {
      const files = await Promise.all(
        plan.files.map(async (f) => ({
          relativePath: f.relativePath,
          contentBase64: await toBase64(byPath.get(f.relativePath)!),
        }))
      )

      setBusy(`${folder} — committing ${files.length} files`)
      const res = await fetch(`/api/workspaces/${activeWorkspace!.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, files }),
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? "Import failed")
      }
      const result = (await res.json()) as { committed: number; skipped: SkippedFile[] }
      setSkipped(result.skipped)
      await qc.invalidateQueries({ queryKey: ["workspace-files", activeWorkspace!.id] })
    } catch (e) {
      setUploadError((e as Error).message)
      setSkipped(plan.skipped)
    } finally {
      setBusy(null)
    }
  }

  /**
   * Names are validated here rather than by the browser, so the reason can be
   * shown next to the field instead of silently refusing. Traversal and
   * absolute paths are rejected for the same reason the API rejects them; this
   * is the friendly half of that check, not a replacement for it.
   */
  function validateName(raw: string): string | null {
    const v = raw.trim()
    if (!v) return "Give it a name"
    if (v.startsWith("/")) return "Leave off the leading slash"
    if (v.includes("..")) return "No .. in names"
    if (existingNames.has(v)) return "Something with that name already exists"
    return null
  }

  function submitNew() {
    const problem = validateName(newName)
    if (problem) {
      setNameError(problem)
      return
    }
    const name = newName.trim()
    write.mutate(
      creating === "folder"
        ? { path: `${base}/${name}/${GITKEEP}`, content: "" }
        : { path: `${base}/${name}`, content: "" }
    )
    setCreating(null)
    setNewName("")
    setNameError(null)
  }

  function startCreating(kind: "file" | "folder") {
    setCreating(kind)
    setNewName("")
    setNameError(null)
    // The row mounts this render; focus on the next tick.
    requestAnimationFrame(() => nameInput.current?.focus())
  }

  return (
    <div
      className={cn("px-2 pb-2 rounded-lg", dragging && "ring-2 ring-primary/60 bg-primary/5")}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        // Reveal the panel: otherwise the progress line, and any per-file
        // failure, lands inside a collapsed section nobody can see.
        setOpen(true)
        void addFiles([...e.dataTransfer.files])
      }}
    >
      <div className="flex items-center gap-0.5 px-2 py-1">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1 rounded py-0.5 text-left text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")} />
          Files
        </button>
        {open && (
          <>
            <button
              onClick={() => startCreating("file")}
              title="New file"
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <FilePlus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => startCreating("folder")}
              title="New folder"
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              title="Add files from your computer"
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => folderInput.current?.click()}
              title="Import a folder — keeps its structure, lands as one commit"
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <FolderUp className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = "" }}
        />
        {/* Directory mode is set as an attribute in an effect — see above. */}
        <input
          ref={folderInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            setOpen(true)
            void importFolder([...(e.target.files ?? [])])
            e.target.value = ""
          }}
        />
      </div>

      {open && (
        <>
        {(isLoading || busy || write.isPending) && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {busy ? `Uploading ${busy}…` : isLoading ? "Loading…" : "Committing…"}
          </div>
        )}
        {error && <p className="px-2 py-1.5 text-xs text-muted-foreground">Could not load files.</p>}
        {(write.error || uploadError) && (
          <p className="px-2 py-1.5 text-xs text-destructive break-words">
            {uploadError ?? (write.error as Error).message}
          </p>
        )}

        {/* An import that dropped things says so. Left until the next action
            rather than auto-dismissed: "why is my .env not here" is exactly the
            question this answers. */}
        {skipped.length > 0 && (
          <details className="px-2 py-1.5">
            <summary className="text-xs text-muted-foreground cursor-pointer">
              Skipped {skipped.length} file{skipped.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-1 space-y-0.5">
              {skipped.map((s) => (
                <li key={s.relativePath} className="text-[11px] text-muted-foreground break-all">
                  <span className="text-ink-3">{s.relativePath}</span> — {s.reason}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Inline creator. Replaces window.prompt(), which put a Chrome dialog in
            front of the app and asked for a path when a name is what is wanted. */}
        {creating && (
          <div
            className="flex items-center gap-1.5 px-2 py-1"
            style={{ animation: "fade-up 200ms var(--ease-spring) both" }}
          >
            {creating === "folder" ? (
              <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <input
              ref={nameInput}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setNameError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submitNew()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  setCreating(null)
                  setNameError(null)
                }
              }}
              onBlur={() => {
                // Blur cancels rather than commits. Creating a file is a commit to
                // a shared repo; clicking away should not be enough to do that.
                if (!newName.trim()) setCreating(null)
              }}
              placeholder={creating === "folder" ? "folder name" : "name.py"}
              aria-label={creating === "folder" ? "New folder name" : "New file name"}
              className="min-w-0 flex-1 rounded-chip border border-line bg-field px-1.5 py-0.5 text-xs text-ink outline-none focus:border-line-strong placeholder:text-ink-3"
            />
          </div>
        )}
        {nameError && (
          <p className="px-2 pb-1 pl-7 text-[11px] text-destructive">{nameError}</p>
        )}

        {data && [...toTree(data.workspace).children.values()].map((c) => (
          <TreeNode key={c.name} node={c} depth={0} />
        ))}

        {data && data.workspace.length === 0 && !isLoading && (
          <p className="px-2 py-2 text-xs text-muted-foreground leading-snug">
            No files yet. Drop text files here — they commit for everyone on the next run.
          </p>
        )}
        </>
      )}
    </div>
  )
}
