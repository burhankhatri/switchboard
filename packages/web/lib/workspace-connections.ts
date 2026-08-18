import { decryptSecret } from "@/lib/db/encryption"

/**
 * Turning stored connections into something an agent can use.
 *
 * REST connections become environment variables plus a written description, so
 * the agent knows the base URL, how to authenticate, and when to reach for it.
 * MCP connections become entries in the agent's MCP config.
 *
 * The env-var names are derived from the slug and are stable, because skills in
 * the workspace repo reference them by name.
 */

export type ConnectionKind = "rest" | "mcp"
export type AuthType = "none" | "bearer" | "header" | "query" | "basic"

export interface StoredConnection {
  id: string
  kind: string
  name: string
  slug: string
  description: string | null
  baseUrl: string | null
  authType: string | null
  authParam: string | null
  mcpUrl: string | null
  encryptedSecret: string | null
}

export const CONNECTION_SELECT = {
  id: true,
  kind: true,
  name: true,
  slug: true,
  description: true,
  baseUrl: true,
  authType: true,
  authParam: true,
  mcpUrl: true,
  encryptedSecret: true,
} as const

/** Slugs become env var prefixes, so they must be safe as shell identifiers. */
export function slugToEnvPrefix(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")
}

export function isValidConnectionSlug(slug: string): boolean {
  return /^[a-z][a-z0-9-]{0,40}$/.test(slug)
}

/** `<PREFIX>_BASE_URL` and `<PREFIX>_TOKEN` for a REST connection. */
export function restEnvNames(slug: string): { baseUrl: string; token: string } {
  const p = slugToEnvPrefix(slug)
  return { baseUrl: `${p}_BASE_URL`, token: `${p}_TOKEN` }
}

/**
 * Environment for the REST connections of a workspace.
 *
 * Throws on an undecryptable secret — a run that cannot authenticate should
 * fail at spin-up, not partway through a task against a system of record.
 */
export function restConnectionEnv(
  connections: StoredConnection[],
  workspaceSlug: string
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const c of connections) {
    if (c.kind !== "rest") continue
    const names = restEnvNames(c.slug)
    if (c.baseUrl) env[names.baseUrl] = c.baseUrl
    if (c.encryptedSecret) {
      env[names.token] = decryptSecret(c.encryptedSecret, `${workspaceSlug}.${c.slug}`)
    }
  }
  return env
}

/**
 * Prose the agent can read describing each REST connection.
 *
 * Without this the agent has a token in its environment and no idea what it is
 * for — it would either ignore the connection or guess at the API. The variable
 * VALUES are deliberately never included; only their names.
 */
export function describeRestConnections(connections: StoredConnection[]): string {
  const rest = connections.filter((c) => c.kind === "rest")
  if (rest.length === 0) return ""

  const blocks = rest.map((c) => {
    const names = restEnvNames(c.slug)
    const lines = [`### ${c.name}`]
    if (c.description) lines.push(c.description)
    if (c.baseUrl) lines.push(`- Base URL: \`${names.baseUrl}\` (\`${c.baseUrl}\`)`)
    switch (c.authType) {
      case "bearer":
        lines.push(`- Auth: send \`Authorization: Bearer $${names.token}\``)
        break
      case "header":
        lines.push(`- Auth: send header \`${c.authParam}: $${names.token}\``)
        break
      case "query":
        lines.push(`- Auth: append query parameter \`${c.authParam}=$${names.token}\``)
        break
      case "basic":
        lines.push(`- Auth: HTTP Basic, password is \`$${names.token}\``)
        break
      default:
        lines.push("- Auth: none")
    }
    return lines.join("\n")
  })

  return `

## Connections
These APIs are reachable from this workspace. Their credentials are already in
your environment under the names below — read them from the environment, never
print them, and never write them into a file.

${blocks.join("\n\n")}`
}

/** MCP connections in the shape the agent-configuration package expects. */
export function mcpConnectionServers(
  connections: StoredConnection[],
  workspaceSlug: string
): { name: string; url: string; bearerToken: string }[] {
  const out: { name: string; url: string; bearerToken: string }[] = []
  for (const c of connections) {
    if (c.kind !== "mcp" || !c.mcpUrl) continue
    out.push({
      name: c.slug,
      url: c.mcpUrl,
      bearerToken: c.encryptedSecret
        ? decryptSecret(c.encryptedSecret, `${workspaceSlug}.${c.slug}`)
        : "",
    })
  }
  return out
}
