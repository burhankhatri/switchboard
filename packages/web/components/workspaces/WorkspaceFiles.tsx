"use client"

import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight, FilePlus, FileText, FolderPlus, Folder, Loader2, Sparkles, Upload,
} from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
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
  const { openFile, setOpenFile } = useWorkspace()
  const [open, setOpen] = useState(depth < 2)
  const pad = { paddingLeft: `${depth * 12 + 8}px` }

  if (node.path) {
    if (node.name === GITKEEP) return null // placeholder, not content
    const active = openFile === node.path
    return (
      <button
        onClick={() => setOpenFile(node.path!)}
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

  const prompt = (label: string, placeholder: string) => {
    const v = window.prompt(label, placeholder)?.trim()
    return v && !v.includes("..") && !v.startsWith("/") ? v : null
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
          onClick={() => {
            const name = prompt("New file (path inside the workspace)", "scripts/new.py")
            if (name) write.mutate({ path: `${base}/${name}`, content: "" })
          }}
          title="New file"
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <FilePlus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => {
            const name = prompt("New folder", "scripts")
            if (name) write.mutate({ path: `${base}/${name}/${GITKEEP}`, content: "" })
          }}
          title="New folder"
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          title="Upload files"
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

      {data && [...toTree(data.workspace).children.values()].map((c) => (
        <TreeNode key={c.name} node={c} depth={0} />
      ))}

      {data && data.workspace.length === 0 && !isLoading && (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          No files yet. Drop text files here.
        </p>
      )}

      <p className="px-2 pt-2 text-[10px] text-muted-foreground/70 leading-snug">
        Shared with everyone in this workspace. Changes commit and load on the next run.
      </p>
    </div>
  )
}
