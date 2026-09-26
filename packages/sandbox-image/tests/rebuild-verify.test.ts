import { describe, expect, it } from "vitest"
import { rebuildSnapshot } from "../src/rebuild"

/**
 * An in-memory stand-in for Daytona's snapshot API, recording the order of
 * builds and deletes — the order is the whole guarantee under test.
 */
function fakeDaytona(existing: string[]) {
  const snapshots = new Map(existing.map((name) => [name, { name, state: "active" }]))
  const log: string[] = []
  const daytona = {
    snapshot: {
      get: async (name: string) => {
        const s = snapshots.get(name)
        if (!s) throw new Error(`no snapshot ${name}`)
        return s
      },
      delete: async (s: { name: string }) => {
        log.push(`delete ${s.name}`)
        snapshots.delete(s.name)
      },
      create: async ({ name }: { name: string }) => {
        log.push(`build ${name}`)
        const s = { name, state: "active" }
        snapshots.set(name, s)
        return s
      },
    },
  }
  return { daytona: daytona as never, log, snapshots }
}

describe("rebuildSnapshot verification", () => {
  it("verifies the new image while the live one is still serving", async () => {
    const { daytona, log } = fakeDaytona(["switchboard"])
    await rebuildSnapshot(daytona, {
      verify: async (name) => {
        log.push(`verify ${name}`)
      },
    })
    expect(log).toEqual([
      "build switchboard-temp",
      "verify switchboard-temp",
      "delete switchboard",
      "build switchboard",
      "delete switchboard-temp",
    ])
  })

  it("keeps the live image when the new one fails verification", async () => {
    // A version bump that broke skill discovery would otherwise have replaced
    // a working image, and every run after it would start without skills.
    const { daytona, log, snapshots } = fakeDaytona(["switchboard"])
    await expect(
      rebuildSnapshot(daytona, {
        verify: async () => {
          throw new Error("OpenCode lists 3 of 12 skills")
        },
      })
    ).rejects.toThrow("OpenCode lists 3 of 12 skills")
    expect([...snapshots.keys()]).toEqual(["switchboard"])
    expect(log).toEqual(["build switchboard-temp", "delete switchboard-temp"])
  })

  it("verifies a first build too, and says there was nothing to fall back to", async () => {
    const { daytona, log } = fakeDaytona([])
    await expect(
      rebuildSnapshot(daytona, {
        verify: async (name) => {
          log.push(`verify ${name}`)
          throw new Error("skills missing")
        },
      })
    ).rejects.toThrow(/first build.*skills missing/)
    expect(log).toEqual(["build switchboard", "verify switchboard"])
  })
})
