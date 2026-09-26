import { describe, expect, it, vi } from "vitest"

// sandbox.ts builds a Prisma client at import; this test never queries it.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import { createSandboxForChat } from "./sandbox"

describe("createSandboxForChat", () => {
  it("launches from the snapshot it is given, so a new image can be checked before it goes live", async () => {
    let requested: string | undefined
    const daytona = {
      snapshot: {
        get: async () => {
          throw new Error("the active snapshot should not be looked up")
        },
      },
      create: async (args: { snapshot?: string }) => {
        requested = args.snapshot
        throw new Error("stop after create")
      },
    }

    await expect(
      createSandboxForChat({
        daytona: daytona as never,
        repo: "owner/agent-workspaces",
        baseBranch: "main",
        newBranch: "skill-harness",
        githubToken: "token",
        snapshot: "switchboard-temp",
      })
    ).rejects.toThrow("stop after create")
    expect(requested).toBe("switchboard-temp")
  })
})
