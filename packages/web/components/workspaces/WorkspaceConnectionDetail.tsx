"use client"

import { Plug, Cloud, Check, Minus, FlaskConical } from "lucide-react"
import { BaseDialog } from "@/components/modals/BaseDialog"
/**
 * Structural rather than imported: two components hold their own Connection
 * shape and both should be able to open this. Only the fields actually shown
 * are required.
 */
export interface ConnectionConfig {
  kind: string
  name: string
  slug: string
  description: string | null
  baseUrl: string | null
  authType: string | null
  authParam: string | null
  mcpUrl: string | null
  hasSecret: boolean
  env: { baseUrl: string; token: string } | null
}

/**
 * What a connection is configured as.
 *
 * Deliberately read-only, and deliberately shows the environment variable
 * NAMES rather than any value. The names are the useful part: they are what a
 * script in this workspace references, so this panel answers "what do I write
 * in my code" without ever putting a credential on screen. Whether a secret
 * exists is shown; the secret itself is never sent to the browser at all.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-start gap-3 py-2 border-b border-border/60 last:border-0">
      <span className="text-xs text-muted-foreground pt-0.5">{label}</span>
      <div className="min-w-0 text-sm text-foreground break-words">{children}</div>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] break-all">
      {children}
    </code>
  )
}

export function WorkspaceConnectionDetail({
  connection,
  onClose,
  isMobile = false,
  /**
   * The workspace's own env var names. A `*_MOCK` flag among them means the
   * workspace's scripts serve fixtures rather than calling this API, and the
   * dialog must say so — a real base URL and "Secret: set" otherwise reads as a
   * live integration, which is exactly the wrong thing to believe when you are
   * deciding whether the numbers on screen are real.
   */
  envKeys = [],
}: {
  connection: ConnectionConfig | null
  onClose: () => void
  isMobile?: boolean
  envKeys?: string[]
}) {
  if (!connection) return null
  const isRest = connection.kind === "rest"
  const mockFlag = envKeys.find((k) => k.endsWith("_MOCK"))

  return (
    <BaseDialog
      open
      onClose={onClose}
      title={connection.name}
      isMobile={isMobile}
      icon={
        isRest ? (
          <Plug className="h-4 w-4 text-primary" />
        ) : (
          <Cloud className="h-4 w-4 text-primary" />
        )
      }
    >
      <div className="px-4 pb-4">
        {mockFlag && (
          <div
            className="mb-3 flex items-start gap-2 rounded-chip bg-accent-tint px-2.5 py-2 text-[12px] text-accent-ink"
            style={{ animation: "fade-up 200ms var(--ease-spring) both" }}
          >
            <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <strong className="font-medium">Demo data.</strong> This workspace
              sets <code className="font-mono">{mockFlag}</code>, so its scripts
              read committed fixtures and never call this API. Clear that
              variable and supply a real secret to go live.
            </span>
          </div>
        )}

        {connection.description && (
          <p className="pb-3 text-sm text-muted-foreground">{connection.description}</p>
        )}

        <Row label="Type">{isRest ? "REST API" : "MCP server"}</Row>
        <Row label="Reference">
          <Code>@{connection.slug}</Code>
        </Row>

        {isRest ? (
          <>
            <Row label="Base URL">
              <Code>{connection.baseUrl}</Code>
            </Row>
            <Row label="Auth">
              {connection.authType === "none" ? (
                "No authentication"
              ) : connection.authType === "bearer" ? (
                <>
                  <Code>Authorization: Bearer …</Code>
                </>
              ) : connection.authType === "header" ? (
                <>
                  Header <Code>{connection.authParam}</Code>
                </>
              ) : connection.authType === "query" ? (
                <>
                  Query parameter <Code>{connection.authParam}</Code>
                </>
              ) : (
                connection.authType
              )}
            </Row>
          </>
        ) : (
          <Row label="Server URL">
            <Code>{connection.mcpUrl}</Code>
          </Row>
        )}

        <Row label="Secret">
          {connection.hasSecret ? (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <Check className="h-3.5 w-3.5 text-primary" />
              Set — encrypted, and never shown here or sent to your browser
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Minus className="h-3.5 w-3.5" />
              None
            </span>
          )}
        </Row>

        {isRest && connection.env && (
          <Row label="In the sandbox">
            {/* The whole point of the panel: these are the names a script in
                this workspace reads, and they are stable for the connection. */}
            <div className="space-y-1">
              <div>
                <Code>{connection.env.baseUrl}</Code>
              </div>
              {connection.hasSecret && (
                <div>
                  <Code>{connection.env.token}</Code>
                </div>
              )}
            </div>
          </Row>
        )}

        <p className="pt-3 text-xs text-muted-foreground leading-snug">
          Everyone in this workspace can use this connection. Its values are
          injected as environment variables when an agent runs — no one needs a
          key of their own.
        </p>
      </div>
    </BaseDialog>
  )
}
