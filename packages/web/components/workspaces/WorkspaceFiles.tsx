"use client"

import { useEffect, useRef, useState, type DragEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FilePlus, FolderPlus, FolderUp, Loader2, Plus, Upload, X } from "lucide-react"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { collectDroppedFiles, entriesFromDataTransfer } from "@/lib/dropped-files"
import { formatBytes } from "@/lib/format-bytes"
import { IMPORT_MAX_FILE_BYTES } from "@/lib/workspace-import"
import { AnchoredMenu } from "@/components/ui/AnchoredMenu"
import { PanelBody, PanelHeader } from "@/components/sidebar/Panel"
import { GITKEEP } from "@/lib/file-tree"
import { SKILLS_DIR } from "@/lib/workspace-skills"
import { FileTree, type RepoFile } from "./files/FileTree"
import { FileIcon, FolderIcon } from "./files/FileIcon"
import { useWorkspaceUpload, type UploadItem } from "./files/useWorkspaceUpload"

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files")

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent cursor-pointer"

/**
 * The Files panel: the workspace the way Finder shows a folder.
 *
 * Its own panel, behind Skills rather than above them. A raw git tree is the
 * honest view of a workspace and the only way to reach a script or a fixture,
 * but it is not what most people open a workspace to do. It is mounted only
 * while the panel is open, so the listing — a GitHub round trip — never runs
 * for someone who did not ask for it.
 *
 * Files arrive three ways — picked, a picked folder, or dropped onto the panel
 * or onto a folder in it — and all three go through useWorkspaceUpload, so they
 * share one set of caps and the binary-safe import route. Anything added here
 * is committed, so the next run clones it.
 */
export function WorkspaceFiles() {
  const { activeWorkspace } = useWorkspace()
  const { upload, progress, result, dismissResult } = useWorkspaceUpload()
  const [menuOpen, setMenuOpen] = useState(false)
  // Skills open by default: they are what a workspace is for, and seeing each
  // one without clicking is the point of lifting them to the top.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([SKILLS_DIR]))
  // null: no drag over the panel. "": the workspace root. Otherwise a folder.
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // dragenter/leave fire for every child the pointer crosses, so presence is a count.
  const dragDepth = useRef(0)
  const [creating, setCreating] = useState<"file" | "folder" | null>(null)
  const [newName, setNewName] = useState("")
  const [nameError, setNameError] = useState<string | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
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
    enabled: !!activeWorkspace,
    retry: false,
  })

  // New files and folders are empty text, so the editor's text route suits
  // them; uploads go through the import route instead.
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
      <>
        <PanelHeader title="Files" />
        <p className="px-4 py-2 text-xs text-destructive">
          This workspace is missing its path. Re-pick it from the workspace menu.
        </p>
      </>
    )
  }

  const files = data?.workspace ?? []
  const isEmpty = files.every((f) => f.name === GITKEEP)
  const existingNames = new Set(files.map((f) => f.name.split("/")[0]))

  const uploadInto = (items: UploadItem[], dir: string) => {
    // Show where it went: a drop into a collapsed folder opens it.
    if (dir) setExpanded((prev) => new Set(prev).add(dir))
    void upload(items, dir)
  }

  const dropInto = (dir: string, dt: DataTransfer) => {
    dragDepth.current = 0
    setDropTarget(null)
    // Entries must be taken now — the browser empties the DataTransfer once
    // this handler returns. Reading them can wait.
    const { entries, loose } = entriesFromDataTransfer(dt)
    void collectDroppedFiles(entries).then((dropped) =>
      uploadInto([...dropped, ...loose.map((file) => ({ relativePath: file.name, file }))], dir)
    )
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
    if (problem) return setNameError(problem)
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
    setMenuOpen(false)
    setCreating(kind)
    setNewName("")
    setNameError(null)
    requestAnimationFrame(() => nameInput.current?.focus())
  }

  function pick(input: HTMLInputElement | null) {
    setMenuOpen(false)
    input?.click()
  }

  return (
    <div
      data-testid="files-drop-zone"
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current++
        setDropTarget((t) => t ?? "")
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
        setDropTarget("")
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDropTarget(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dropInto("", e.dataTransfer)
      }}
    >
      <PanelHeader title="Files">
        <button
          ref={addButton}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Add files or folders"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Add files or folders"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-accent cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </PanelHeader>

      <AnchoredMenu
        anchorRef={addButton}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        align="right"
        placement="below"
        width={200}
      >
        <button role="menuitem" className={MENU_ITEM} onClick={() => pick(fileInput.current)}>
          <Upload className="h-4 w-4 text-muted-foreground" /> Upload files…
        </button>
        <button role="menuitem" className={MENU_ITEM} onClick={() => pick(folderInput.current)}>
          <FolderUp className="h-4 w-4 text-muted-foreground" /> Upload folder…
        </button>
        <div className="my-1 border-t border-border" />
        <button role="menuitem" className={MENU_ITEM} onClick={() => startCreating("file")}>
          <FilePlus className="h-4 w-4 text-muted-foreground" /> New file
        </button>
        <button role="menuitem" className={MENU_ITEM} onClick={() => startCreating("folder")}>
          <FolderPlus className="h-4 w-4 text-muted-foreground" /> New folder
        </button>
      </AnchoredMenu>

      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          uploadInto([...(e.target.files ?? [])].map((file) => ({ relativePath: file.name, file })), "")
          e.target.value = ""
        }}
      />
      {/* Directory mode is set as an attribute in an effect — see above. */}
      <input
        ref={folderInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          // webkitRelativePath is "<picked folder>/<path within it>", so the
          // folder lands under its own name with its structure intact.
          const picked = [...(e.target.files ?? [])].map((file) => ({
            relativePath: file.webkitRelativePath || file.name,
            file,
          }))
          uploadInto(picked, "")
          e.target.value = ""
        }}
      />

      <PanelBody>
        {progress && (
          <div className="mx-3 mb-2 rounded-md border border-border px-3 py-2" role="status">
            <div className="flex items-center gap-2 text-xs text-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Uploading {progress.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatBytes(progress.doneBytes)} of {formatBytes(progress.totalBytes)}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-blue-500 transition-[width]"
                style={{ width: `${Math.max(4, (progress.doneBytes / progress.totalBytes) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {result && (
          <div className="mx-3 mb-2 rounded-md border border-border px-3 py-2 text-xs" role="status">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1">
                {result.committed > 0 && (
                  <span className="text-foreground">
                    Added {result.committed} file{result.committed === 1 ? "" : "s"}.{" "}
                  </span>
                )}
                {result.error && <span className="text-destructive">{result.error}</span>}
                {!result.error && result.committed === 0 && (
                  <span className="text-foreground">Nothing was added.</span>
                )}
              </p>
              <button
                onClick={dismissResult}
                aria-label="Dismiss"
                className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Named rather than counted: "why is my .env not here" is exactly
                the question this answers. */}
            {result.skipped.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {result.skipped.map((s) => (
                  <li key={s.relativePath} className="break-all text-muted-foreground">
                    {`${s.relativePath} — ${s.reason}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {creating && (
          <div
            className="flex items-center gap-1.5 px-3 py-1"
            style={{ animation: "fade-up 200ms var(--ease-spring) both" }}
          >
            {creating === "folder" ? <FolderIcon /> : <FileIcon path={newName || "untitled"} />}
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
                // Blur cancels rather than commits. Creating a file is a commit
                // to a shared repo; clicking away should not be enough to do that.
                if (!newName.trim()) setCreating(null)
              }}
              placeholder={creating === "folder" ? "Folder name" : "name.py"}
              aria-label={creating === "folder" ? "New folder name" : "New file name"}
              className="min-w-0 flex-1 rounded-md border border-line bg-field px-1.5 py-0.5 text-[13px] text-ink outline-none focus:border-blue-500 placeholder:text-ink-3"
            />
          </div>
        )}
        {nameError && <p className="px-3 pb-1 pl-9 text-[11px] text-destructive">{nameError}</p>}
        {write.error && <p className="px-3 py-1.5 text-xs text-destructive">{(write.error as Error).message}</p>}

        {isLoading && (
          <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        )}
        {error && <p className="px-4 py-1.5 text-xs text-muted-foreground">Could not load files.</p>}

        {!isEmpty && (
          <FileTree
            files={files}
            expanded={expanded}
            onToggle={(rel) =>
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(rel)) next.delete(rel)
                else next.add(rel)
                return next
              })
            }
            dropTarget={dropTarget}
            onDragTarget={setDropTarget}
            onDropInto={dropInto}
          />
        )}

        {data && isEmpty && (
          <div className="mx-3 mt-2 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <FolderIcon className="h-8 w-8" />
            <p className="text-sm text-foreground">Drop files or folders here</p>
            <p className="text-xs text-muted-foreground">They commit for everyone on the next run.</p>
          </div>
        )}
      </PanelBody>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">Drop files or folders</span>
        <span className="shrink-0">{formatBytes(IMPORT_MAX_FILE_BYTES)} max each</span>
      </div>

      {/* Finder's drop highlight: the whole panel when dropping at the top
          level, just the folder row when dropping into one. */}
      {dropTarget === "" && (
        <div className="pointer-events-none absolute inset-1 flex items-end justify-center rounded-lg border-2 border-dashed border-blue-500/70 bg-blue-500/5 pb-12">
          <span className="rounded-full bg-blue-500 px-3 py-1 text-xs font-medium text-white shadow-sm">
            Add to {activeWorkspace.name}
          </span>
        </div>
      )}
    </div>
  )
}
