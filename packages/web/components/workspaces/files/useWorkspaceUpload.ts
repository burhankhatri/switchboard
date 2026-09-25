"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { workspaceSkillsKey } from "@/lib/query/hooks/useWorkspaceSkills"
import { batchForRequests, planFolderImport, type SkippedFile } from "@/lib/workspace-import"

export interface UploadItem {
  /** Where it lands, relative to the drop or pick — "campaign/brief.md". */
  relativePath: string
  file: File
}

export interface UploadProgress {
  label: string
  doneBytes: number
  totalBytes: number
}

export interface UploadResult {
  committed: number
  skipped: SkippedFile[]
  error: string | null
}

/**
 * A file's bytes as base64.
 *
 * readAsDataURL rather than reading text: uploads are PDFs and images as often
 * as scripts, and `.text()` would turn every one of them into replacement
 * characters. Base64 travels through JSON unchanged and is what the git blob
 * API wants anyway.
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

/** What the commit message calls the upload: the folder, the file, or a count. */
function labelFor(items: UploadItem[]): string {
  const tops = new Set(items.map((i) => i.relativePath.split("/")[0]))
  if (tops.size === 1 && items.every((i) => i.relativePath.includes("/"))) return [...tops][0]
  return items.length === 1 ? items[0].relativePath : `${items.length} files`
}

/**
 * Every way of adding files — picking files, picking a folder, dropping either
 * — ends here, so they share one set of caps and one binary-safe route.
 *
 * The plan runs first so a file that cannot go is named before anything is
 * sent. The rest goes up in request-sized batches, one commit each, which keeps
 * a small upload to a single commit.
 */
export function useWorkspaceUpload() {
  const { activeWorkspace } = useWorkspace()
  const qc = useQueryClient()
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)

  async function upload(items: UploadItem[], into = "") {
    const wsId = activeWorkspace?.id
    const base = activeWorkspace?.path
    if (!wsId || !base || items.length === 0 || progress) return

    const prefix = into ? `${into}/` : ""
    const byPath = new Map(items.map((i) => [prefix + i.relativePath, i.file]))
    const plan = planFolderImport(
      [...byPath].map(([relativePath, file]) => ({ relativePath, size: file.size })),
      base
    )
    setResult(null)
    if (plan.files.length === 0) {
      setResult({ committed: 0, skipped: plan.skipped, error: null })
      return
    }

    const label = labelFor(items)
    const outcome: UploadResult = { committed: 0, skipped: [...plan.skipped], error: null }
    setProgress({ label, doneBytes: 0, totalBytes: plan.totalBytes })
    try {
      for (const batch of batchForRequests(plan.files)) {
        const files = await Promise.all(
          batch.map(async (f) => ({
            relativePath: f.relativePath,
            contentBase64: await toBase64(byPath.get(f.relativePath)!),
          }))
        )
        const res = await fetch(`/api/workspaces/${wsId}/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: label, files }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Upload failed")
        const done = (await res.json()) as { committed: number; skipped: SkippedFile[] }
        outcome.committed += done.committed
        outcome.skipped.push(...done.skipped)
        const sent = batch.reduce((n, f) => n + f.size, 0)
        setProgress((p) => p && { ...p, doneBytes: p.doneBytes + sent })
      }
    } catch (e) {
      // Stop at the first failed batch: the usual cause (auth, a moved branch)
      // fails every later batch the same way, and the batches already
      // committed are real and stay reported.
      outcome.error = (e as Error).message
    } finally {
      setProgress(null)
      setResult(outcome)
      void qc.invalidateQueries({ queryKey: ["workspace-files", wsId] })
      // A dropped skill folder is a new skill.
      void qc.invalidateQueries({ queryKey: workspaceSkillsKey(wsId) })
    }
  }

  return { upload, progress, result, dismissResult: () => setResult(null) }
}
