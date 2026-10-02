"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { ChevronRight, Trash2 } from "lucide-react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { buildFileTree, childrenOf, type FileNode, type TreeFile } from "@/lib/file-tree"
import { formatBytes } from "@/lib/format-bytes"
import { writeCachedFile, clearWorkspaceFile } from "@/lib/workspace-file-cache"
import { workspaceSkillsKey } from "@/lib/query/hooks/useWorkspaceSkills"
import { cn } from "@/lib/utils"
import { FileIcon, FolderIcon, SkillsFolderIcon } from "./FileIcon"
import { DeleteFileDialog } from "./DeleteFileDialog"

export type { TreeFile as RepoFile } from "@/lib/file-tree"

function parentDir(rel: string): string {
  return rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ""
}

interface FileTreeProps {
  files: TreeFile[]
  expanded: Set<string>
  onToggle: (rel: string) => void
  /** The folder a drag is hovering, "" for the workspace root, null for none. */
  dropTarget: string | null
  onDragTarget: (dir: string) => void
  onDropInto: (dir: string, data: DataTransfer) => void
}

/**
 * The workspace as Finder's list view: disclosure triangles, blue folders,
 * documents marked by kind, sizes on the right. Every row is also a drop
 * target — onto a folder drops into it, onto a file drops beside it.
 */
export function FileTree(props: FileTreeProps) {
  const { activeWorkspace, openFile, setOpenFile } = useWorkspace()
  const qc = useQueryClient()
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [deletePath, setDeletePath] = useState<string | null>(null)
  const latest = useRef({ activeWorkspace, openFile })
  latest.current = { activeWorkspace, openFile }
  useEffect(() => { setMenu(null); setDeletePath(null) }, [activeWorkspace?.id])
  const showMenu = (file: TreeFile, x: number, y: number) => {
    if (activeWorkspace && file.path.startsWith(`${activeWorkspace.path}/`)) setMenu({ path: file.path, x, y })
  }
  const root = buildFileTree(props.files)
  return (
    <>
    <div role="tree" aria-label="Workspace files" className="px-2">
      {childrenOf(root).map((node) => (
        <TreeRow key={node.rel} node={node} depth={0} {...props} onFileMenu={showMenu} />
      ))}
    </div>
    <DropdownMenu open={!!menu} onOpenChange={open => { if (!open) setMenu(null) }} modal={false}>
      <DropdownMenuTrigger asChild>
        <button tabIndex={-1} aria-hidden style={{ position: "fixed", left: menu?.x ?? 0, top: menu?.y ?? 0, width: 1, height: 1, pointerEvents: "none", opacity: 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0} onCloseAutoFocus={event => event.preventDefault()}>
        <DropdownMenuItem className="text-destructive" onSelect={() => { if (menu) setDeletePath(menu.path) }}>
          <Trash2 className="mr-2 h-4 w-4" />Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {deletePath && activeWorkspace && (
      <DeleteFileDialog key={`${activeWorkspace.id}:${deletePath}`} workspaceId={activeWorkspace.id} path={deletePath} onCancel={() => setDeletePath(null)} onDeleted={() => {
        const wsId = activeWorkspace.id
        clearWorkspaceFile(wsId, deletePath)
        void qc.cancelQueries({ queryKey: ["workspace-file", wsId, deletePath] }).then(() => qc.removeQueries({ queryKey: ["workspace-file", wsId, deletePath] }))
        void qc.invalidateQueries({ queryKey: ["workspace-files", wsId] })
        void qc.invalidateQueries({ queryKey: workspaceSkillsKey(wsId) })
        if (latest.current.activeWorkspace?.id === wsId && latest.current.openFile === deletePath) setOpenFile(null)
        setDeletePath(null)
      }} />
    )}
    </>
  )
}

function TreeRow({ node, depth, ...props }: { node: FileNode; depth: number; onFileMenu: (file: TreeFile, x: number, y: number) => void } & FileTreeProps) {
  const { activeWorkspace, openFile, requestOpenFile } = useWorkspace()
  const qc = useQueryClient()
  const isFolder = !node.file
  const open = isFolder && props.expanded.has(node.rel)
  const dir = isFolder ? node.rel : parentDir(node.rel)
  const selected = !isFolder && openFile === node.file!.path
  const targeted = isFolder && props.dropTarget === node.rel

  // Fetch on the way to the click. Reading a file is a GitHub round trip, and
  // the ~300ms between pointing at a row and pressing it is enough to hide
  // most of it — by the time the editor mounts the content is usually cached.
  const prefetch = () => {
    const wsId = activeWorkspace?.id
    if (!wsId || !node.file) return
    const path = node.file.path
    void qc.prefetchQuery({
      queryKey: ["workspace-file", wsId, path],
      queryFn: async () => {
        const r = await fetch(`/api/workspaces/${wsId}/files?path=${encodeURIComponent(path)}`)
        if (!r.ok) throw new Error(String(r.status))
        const file = await r.json()
        if (!file.storageAsset) writeCachedFile(wsId, path, { content: file.content, sha: file.sha, truncated: file.truncated })
        return file
      },
      staleTime: 30 * 1000,
    })
  }

  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isFolder ? open : undefined}
        aria-selected={isFolder ? undefined : selected}
        onClick={() => (isFolder ? props.onToggle(node.rel) : void requestOpenFile(node.file!.path))}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        onContextMenu={event => {
          if (!node.file || !activeWorkspace || !node.file.path.startsWith(`${activeWorkspace.path}/`)) return
          event.preventDefault()
          props.onFileMenu(node.file, event.clientX, event.clientY)
        }}
        onKeyDown={event => {
          if (!node.file || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          props.onFileMenu(node.file, rect.left + 20, rect.bottom)
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return
          e.preventDefault()
          e.stopPropagation()
          props.onDragTarget(dir)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          props.onDropInto(dir, e.dataTransfer)
        }}
        style={{ paddingLeft: depth * 16 + 4 }}
        className={cn(
          "flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] cursor-default select-none",
          selected ? "bg-blue-500/15 text-foreground" : "text-foreground hover:bg-accent/60",
          targeted && "bg-blue-500/20 ring-1 ring-inset ring-blue-500/60"
        )}
      >
        <span className="flex h-4 w-3.5 shrink-0 items-center justify-center">
          {isFolder && (
            <ChevronRight
              className={cn("h-3 w-3 text-muted-foreground/80 transition-transform", open && "rotate-90")}
            />
          )}
        </span>
        {node.isSkillsFolder ? (
          <SkillsFolderIcon />
        ) : isFolder ? (
          <FolderIcon open={open} />
        ) : (
          <FileIcon path={node.file!.path} />
        )}
        {/* Dotfiles read dimmed, the way Finder shows hidden items once revealed. */}
        <span className={cn("min-w-0 flex-1 truncate", node.name.startsWith(".") && "opacity-60")}>
          {node.name}
        </span>
        {node.file && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatBytes(node.file.size)}
          </span>
        )}
      </button>
      {open &&
        childrenOf(node).map((child) => (
          <TreeRow key={child.rel} node={child} depth={depth + 1} {...props} />
        ))}
    </>
  )
}
