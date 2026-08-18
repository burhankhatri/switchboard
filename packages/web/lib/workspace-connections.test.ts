import { describe, it, expect } from "vitest"
import { encryptSecret } from "@/lib/db/encryption"
import {
  restConnectionEnv, describeRestConnections, mcpConnectionServers,
  restEnvNames, slugToEnvPrefix, isValidConnectionSlug, type StoredConnection,
} from "./workspace-connections"

const conn = (o: Partial<StoredConnection>): StoredConnection => ({
  id: "c1", kind: "rest", name: "Sunzi CRM", slug: "sunzi", description: null,
  baseUrl: null, authType: null, authParam: null, mcpUrl: null, encryptedSecret: null, ...o,
})

describe("env var naming", () => {
  it("derives a stable shell-safe prefix", () => {
    expect(slugToEnvPrefix("sunzi-crm")).toBe("SUNZI_CRM")
    expect(restEnvNames("edge")).toEqual({ baseUrl: "EDGE_BASE_URL", token: "EDGE_TOKEN" })
  })

  it("rejects slugs that would not be safe as identifiers", () => {
    for (const bad of ["Sunzi", "1crm", "-crm", "crm_x", "crm key", "crm;id", ""]) {
      expect(isValidConnectionSlug(bad)).toBe(false)
    }
    expect(isValidConnectionSlug("sunzi-crm")).toBe(true)
  })
})

describe("restConnectionEnv", () => {
  it("exposes base URL and decrypted token under derived names", () => {
    const env = restConnectionEnv(
      [conn({ baseUrl: "https://crm.example.com", encryptedSecret: encryptSecret("sk-live-1") })],
      "lead-gen"
    )
    expect(env).toEqual({ SUNZI_BASE_URL: "https://crm.example.com", SUNZI_TOKEN: "sk-live-1" })
  })

  it("ignores MCP connections", () => {
    expect(restConnectionEnv([conn({ kind: "mcp", mcpUrl: "https://x/mcp" })], "w")).toEqual({})
  })

  it("throws rather than injecting an unverifiable credential", () => {
    expect(() =>
      restConnectionEnv([conn({ encryptedSecret: "not-really-encrypted" })], "lead-gen")
    ).toThrow(/Could not decrypt lead-gen\.sunzi/)
  })
})

describe("describeRestConnections", () => {
  it("tells the agent how to authenticate without revealing the value", () => {
    const text = describeRestConnections([
      conn({
        baseUrl: "https://crm.example.com", authType: "header", authParam: "X-Api-Key",
        description: "Sunzi CRM. Create and update leads.",
        encryptedSecret: encryptSecret("super-secret-value"),
      }),
    ])
    expect(text).toContain("X-Api-Key: $SUNZI_TOKEN")
    expect(text).toContain("SUNZI_BASE_URL")
    expect(text).toContain("Create and update leads.")
    // the value itself must never appear in the prompt
    expect(text).not.toContain("super-secret-value")
  })

  it("renders each auth scheme distinctly", () => {
    const scheme = (authType: string, authParam?: string) =>
      describeRestConnections([conn({ baseUrl: "https://x", authType, authParam: authParam ?? null })])
    expect(scheme("bearer")).toContain("Authorization: Bearer $SUNZI_TOKEN")
    expect(scheme("query", "api_key")).toContain("api_key=$SUNZI_TOKEN")
    expect(scheme("basic")).toContain("HTTP Basic")
    expect(scheme("none")).toContain("Auth: none")
  })

  it("is empty when there are no REST connections", () => {
    expect(describeRestConnections([])).toBe("")
    expect(describeRestConnections([conn({ kind: "mcp" })])).toBe("")
  })
})

describe("mcpConnectionServers", () => {
  it("produces the AgentMcpServer shape with a decrypted token", () => {
    const out = mcpConnectionServers(
      [conn({ kind: "mcp", slug: "airtable", mcpUrl: "https://mcp.example.com", encryptedSecret: encryptSecret("tok") })],
      "lead-gen"
    )
    expect(out).toEqual([{ name: "airtable", url: "https://mcp.example.com", bearerToken: "tok" }])
  })

  it("skips rows with no endpoint and ignores REST connections", () => {
    expect(mcpConnectionServers([conn({ kind: "mcp", mcpUrl: null })], "w")).toEqual([])
    expect(mcpConnectionServers([conn({ kind: "rest", baseUrl: "https://x" })], "w")).toEqual([])
  })
})
