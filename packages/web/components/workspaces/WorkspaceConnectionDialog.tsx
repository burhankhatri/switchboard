"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plug } from "lucide-react"
import { BaseDialog } from "@/components/modals/BaseDialog"
import { DialogLabel, dialogIconClass } from "@/components/ui/dialog-parts"
import { Input } from "@/components/ui/input"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import { workspaceConnectionsKey } from "@/lib/query/hooks/useWorkspaceConnections"
import { useMobile } from "@/lib/hooks/useMobile"
import { cn } from "@/lib/utils"

const AUTH_TYPES = ["none", "bearer", "header", "query", "basic"] as const

const AUTH_LABELS: Record<(typeof AUTH_TYPES)[number], string> = {
  none: "None",
  bearer: "Bearer token",
  header: "Custom header",
  query: "Query parameter",
  basic: "Basic auth",
}

const EMPTY_FORM = {
  name: "",
  description: "",
  baseUrl: "",
  authType: "bearer",
  authParam: "",
  mcpUrl: "",
  secret: "",
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
  return res.json()
}

interface WorkspaceConnectionDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Add a REST API or MCP server to the active workspace.
 *
 * Lives in a dialog rather than the sidebar so the connections list stays a
 * compact roster. Secrets are write-only — the API never returns a value.
 */
export function WorkspaceConnectionDialog({ open, onClose }: WorkspaceConnectionDialogProps) {
  const { activeWorkspace } = useWorkspace()
  const isMobile = useMobile()
  const qc = useQueryClient()
  const nameRef = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<"rest" | "mcp">("rest")
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setKind("rest")
    setForm(EMPTY_FORM)
    setError(null)
  }, [open])

  const add = useMutation({
    mutationFn: () =>
      fetch(`/api/workspaces/${activeWorkspace!.id}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...form }),
      }).then(json),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workspaceConnectionsKey(activeWorkspace?.id) })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  if (!activeWorkspace) return null

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Add connection"
      icon={<Plug className={dialogIconClass(isMobile)} />}
      isMobile={isMobile}
      initialFocusRef={nameRef}
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
      >
        <div className="flex gap-1 rounded-md bg-muted/60 p-0.5">
          {(["rest", "mcp"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "flex-1 text-xs py-1.5 rounded cursor-pointer transition-colors",
                kind === k
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {k === "rest" ? "REST API" : "MCP server"}
            </button>
          ))}
        </div>

        <div>
          <DialogLabel isMobile={isMobile}>Name</DialogLabel>
          <Input
            ref={nameRef}
            required
            placeholder="e.g. Sunzi CRM"
            value={form.name}
            onChange={set("name")}
          />
        </div>

        <div>
          <DialogLabel isMobile={isMobile}>
            What is it for? <span className="opacity-60">(shown to the agent)</span>
          </DialogLabel>
          <Input
            placeholder="Optional"
            value={form.description}
            onChange={set("description")}
          />
        </div>

        {kind === "rest" ? (
          <>
            <div>
              <DialogLabel isMobile={isMobile}>Base URL</DialogLabel>
              <Input
                required
                placeholder="https://api.example.com"
                value={form.baseUrl}
                onChange={set("baseUrl")}
              />
            </div>
            <div>
              <DialogLabel isMobile={isMobile}>Auth</DialogLabel>
              <select
                value={form.authType}
                onChange={set("authType")}
                className={cn(
                  "flex h-8 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm",
                  "outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/40"
                )}
              >
                {AUTH_TYPES.map((a) => (
                  <option key={a} value={a}>{AUTH_LABELS[a]}</option>
                ))}
              </select>
            </div>
            {(form.authType === "header" || form.authType === "query") && (
              <div>
                <DialogLabel isMobile={isMobile}>
                  {form.authType === "header" ? "Header name" : "Query parameter"}
                </DialogLabel>
                <Input
                  required
                  placeholder={form.authType === "header" ? "X-Api-Key" : "api_key"}
                  value={form.authParam}
                  onChange={set("authParam")}
                />
              </div>
            )}
          </>
        ) : (
          <div>
            <DialogLabel isMobile={isMobile}>MCP URL</DialogLabel>
            <Input
              required
              placeholder="https://mcp.example.com/mcp"
              value={form.mcpUrl}
              onChange={set("mcpUrl")}
            />
          </div>
        )}

        {(kind === "mcp" || form.authType !== "none") && (
          <div>
            <DialogLabel isMobile={isMobile}>Secret / token</DialogLabel>
            <Input
              type="password"
              autoComplete="off"
              placeholder="Stored encrypted; never shown again"
              value={form.secret}
              onChange={set("secret")}
            />
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <p className="text-[11px] text-muted-foreground leading-snug">
          Stored encrypted. Never shown again, and never sent to the browser.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "rounded-md hover:bg-accent transition-colors cursor-pointer",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={add.isPending || !form.name.trim()}
            className={cn(
              "rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 cursor-pointer",
              isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Add
          </button>
        </div>
      </form>
    </BaseDialog>
  )
}
