"use client"

import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight, FilePlus, FileText, FolderPlus, Folder, Loader2, Sparkles, Upload,
} from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { writeCachedFile } from "@/lib/workspace-file-cache"
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

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  const { activeWorkspace, openFile, setOpenFile } = useWorkspace()
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
        onClick={() => setOpenFile(node.path!)}
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
 * Anything added here is committed, so the next run clones it.
 */
export function WorkspaceFiles() {
  const { activeWorkspace, setOpenFile } = useWorkspace()
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // What is being created inline, if anything. null means the row is not shown.
  const [creating, setCreating] = useState<"file" | "folder" | null>(null)
  const [newName, setNewName] = useState("")
  const [nameError, setNameError] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ["workspace-files", activeWorkspace?.id],
    queryFn: () =>
      fetch(`/api/workspaces/${activeWorkspace!.id}/files`).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<{ workspace: RepoFile[]; shared: RepoFile[] }>
      }),
    enabled: !!activeWorkspace,
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
        void addFiles([...e.dataTransfer.files])
      }}
    >
      <div className="flex items-center gap-0.5 px-2 py-1">
        <p className="flex-1 text-[11px] uppercase tracking-wide text-muted-foreground">Files</p>
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
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = "" }}
        />
      </div>

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
        <p className="px-2 py-2 text-xs text-muted-foreground">
          No files yet. Drop text files here.
        </p>
      )}

      <p className="px-2 pt-2 text-[10px] text-muted-foreground/70 leading-snug">
        Drag files here from your computer, or use the upload button. Shared with
        everyone in this workspace; changes commit and load on the next run.
      </p>
    </div>
  )
}
