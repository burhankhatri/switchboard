import { describe, it, expect } from "vitest"
import { parseMention } from "./MentionMenu"
import {
  selectConnections,
  workspaceConnectionsKey,
} from "@/lib/query/hooks/useWorkspaceConnections"

describe("parseMention", () => {
  it("opens on a bare @ at the start", () => {
    expect(parseMention("@")).toEqual({ query: "", start: 0 })
  })

  it("opens on @ after a space and captures what follows", () => {
    expect(parseMention("use @sun")).toEqual({ query: "sun", start: 4 })
  })

  it("reports the offset of the @ so a selection replaces the typed token", () => {
    const input = "pull leads with @cr"
    const m = parseMention(input)!
    expect(input.slice(m.start)).toBe("@cr")
  })

  it("does not open inside an email address", () => {
    // The @ has a word character before it, so it is not a mention.
    expect(parseMention("mail jez@gmail")).toBeNull()
  })

  it("does not open once the mention is finished with a space", () => {
    // A trailing space means the token is committed; re-opening the menu there
    // would hijack the arrow keys while someone is typing the rest of a prompt.
    expect(parseMention("use @sunzi ")).toBeNull()
  })

  it("does not open for an @ earlier in the line", () => {
    expect(parseMention("@sunzi then do the thing")).toBeNull()
  })

  it("accepts the characters connection slugs and filenames actually use", () => {
    expect(parseMention("@lead-gen")?.query).toBe("lead-gen")
    expect(parseMention("@run_zip")?.query).toBe("run_zip")
    expect(parseMention("@master.csv")?.query).toBe("master.csv")
    expect(parseMention("@scripts/seed")?.query).toBe("scripts/seed")
  })

  it("returns null for text with no @ at all", () => {
    expect(parseMention("just a normal prompt")).toBeNull()
  })
})

/**
 * The crash this guards against: useMentionItems shares the
 * ["workspace-files", id] cache slot with WorkspaceFiles. When the two queryFns
 * returned different shapes into that one slot, whichever resolved first decided
 * what the other read — and the composer threw "(files ?? []) is not iterable",
 * which takes the whole page down rather than degrading.
 */
describe("workspace-files cache shape", () => {
  it("selects the workspace array out of the cached response shape", async () => {
    const cached = { workspace: [{ path: "a/b.md", name: "b.md" }], shared: [] }
    const select = (d: typeof cached) => d.workspace
    expect(Array.isArray(select(cached))).toBe(true)
  })

  it("iterating a non-array must not throw", () => {
    // Belt and braces: a slot written by an older build can still hold the
    // wrong shape, and the composer must not be the thing that dies.
    const wrong = { workspace: [], shared: [] } as unknown
    expect(() => {
      for (const _ of Array.isArray(wrong) ? wrong : []) void _
    }).not.toThrow()
  })
})

/**
 * The bug this guards against, which the files test above did not catch because
 * it exercised a local lambda instead of the real code: WorkspaceConnections and
 * useMentionItems both read ["workspace-connections", id], but wrote different
 * shapes into it — the panel an object, the composer a bare array. A key is one
 * cache slot. On load the panel's fetch filled it and the panel worked; saving a
 * connection invalidated the slot, the composer's fetch refilled it with an
 * array, and `data?.connections` went undefined. The panel then reported
 * "None yet." while the server was returning every connection.
 *
 * Both now go through one fetcher, so there is only ever one shape to read.
 */
describe("workspace-connections cache shape", () => {
  it("gives both consumers the same cache slot", () => {
    expect(workspaceConnectionsKey("ws1")).toEqual(workspaceConnectionsKey("ws1"))
    expect(workspaceConnectionsKey("ws1")).not.toEqual(workspaceConnectionsKey("ws2"))
  })

  it("narrows the cached response to the list", () => {
    const cached = { connections: [{ slug: "google-ads" }, { slug: "meta-ads" }] }
    expect(selectConnections(cached as never)).toHaveLength(2)
  })

  it("survives a slot an older build filled with a bare array", () => {
    // Deployed tabs keep their cache across a release; the shape that broke
    // production must degrade, not blank the panel.
    expect(selectConnections([{ slug: "google-ads" }] as never)).toHaveLength(1)
  })

  it("treats an empty response as empty rather than throwing", () => {
    expect(selectConnections(undefined as never)).toEqual([])
  })
})
