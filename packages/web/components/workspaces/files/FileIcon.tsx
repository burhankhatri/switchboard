import { Sparkles } from "lucide-react"
import { fileKind, type FileKind } from "@/lib/file-kind"
import { cn } from "@/lib/utils"

/**
 * Finder's document icons carry a coloured band naming the kind — the red PDF,
 * the green spreadsheet — which is what lets someone find a file by glancing
 * rather than by reading every name. Kinds without a band are plain paper.
 */
const BAND: Partial<Record<FileKind, string>> = {
  pdf: "#E5483B",
  spreadsheet: "#2E9E5B",
  document: "#2F6FD6",
  code: "#8B5CF6",
  data: "#D99A1E",
  image: "#0EA5E9",
  archive: "#9A6B2F",
  media: "#DB2777",
}

/** Text-like kinds show ruled lines on the page instead of a band. */
const RULED = new Set<FileKind>(["markdown", "text"])

export function FolderIcon({ open = false, className }: { open?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("h-4 w-4 shrink-0", className)}>
      <path d="M1.5 3.6c0-.6.4-1 1-1h3.4l1.5 1.5h6.1c.6 0 1 .4 1 1v7.3c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1z" fill="#4E9CE6" />
      <path
        d={open ? "M2.6 6.2c.1-.5.5-.8 1-.8h11c.6 0 1 .5.9 1.1l-1 5.9c-.1.5-.5.8-1 .8H2.5c-.6 0-1-.5-.9-1.1z" : "M1.5 5.9c0-.6.4-1 1-1h11c.6 0 1 .4 1 1v6.5c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1z"}
        fill="#8CC6F6"
      />
    </svg>
  )
}

/** The Skills folder: a folder carrying the sparkle skills wear everywhere else. */
export function SkillsFolderIcon({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex h-4 w-4 shrink-0", className)} aria-hidden="true">
      <FolderIcon />
      <Sparkles className="absolute -right-1 -top-1 h-2.5 w-2.5 fill-primary text-primary" />
    </span>
  )
}

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const kind = fileKind(path)
  if (kind === "skill") return <Sparkles className={cn("h-4 w-4 shrink-0 text-primary", className)} aria-hidden="true" />

  const band = BAND[kind]
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("h-4 w-4 shrink-0", className)}>
      <path d="M3.5 1.5h6l3 3v10h-9z" fill="#FFFFFF" stroke="#A9A9B0" strokeWidth="1" strokeLinejoin="round" />
      <path d="M9.5 1.5v3h3" fill="#EDEDF0" stroke="#A9A9B0" strokeWidth="1" strokeLinejoin="round" />
      {band && <rect x="4" y="10" width="8" height="3.5" rx=".5" fill={band} />}
      {RULED.has(kind) && (
        <path d="M5 7.5h6M5 9.5h6M5 11.5h4" stroke="#B9B9C0" strokeWidth="1" strokeLinecap="round" />
      )}
    </svg>
  )
}
