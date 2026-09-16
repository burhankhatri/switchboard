import { describe, it, expect, vi, beforeEach } from "vitest"
import { encryptSecret } from "@/lib/db/encryption"

const findUnique = vi.fn()
vi.mock("@/lib/db/prisma", () => ({
  prisma: { workspaceMember: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}))

const { workspaceRunEnv, WorkspaceMembershipRevoked } = await import("./workspace-run-env")

const workspace = (environmentVariables: unknown = null, connections: unknown[] = []) =>
  ({ slug: "gtm", environmentVariables, connections }) as never

beforeEach(() => findUnique.mockReset())

describe("workspaceRunEnv", () => {
  it("is empty for a run with no workspace, without touching the database", async () => {
    await expect(workspaceRunEnv({ workspaceId: null, workspace: null, userId: "u1" })).resolves.toEqual({})
    expect(findUnique).not.toHaveBeenCalled()
  })

  it("decrypts the workspace's variables for a member", async () => {
    findUnique.mockResolvedValue({ role: "member" })
    await expect(
      workspaceRunEnv({
        workspaceId: "w1",
        workspace: workspace({ INSTANTLY_API_KEY: encryptSecret("sk-inst-123") }),
        userId: "u1",
      })
    ).resolves.toEqual({ INSTANTLY_API_KEY: "sk-inst-123" })
  })

  it("refuses someone who has left, even though the binding still names them", async () => {
    // The whole point of re-checking: a job or chat keeps its workspaceId for
    // life, so membership at bind time says nothing about membership now.
    findUnique.mockResolvedValue(null)
    await expect(
      workspaceRunEnv({
        workspaceId: "w1",
        workspace: workspace({ INSTANTLY_API_KEY: encryptSecret("sk-inst-123") }),
        userId: "u1",
      })
    ).rejects.toBeInstanceOf(WorkspaceMembershipRevoked)
  })

  it("throws rather than handing over a credential it could not decrypt", async () => {
    // Returning it would send ciphertext to the API as if it were a key.
    findUnique.mockResolvedValue({ role: "owner" })
    await expect(
      workspaceRunEnv({
        workspaceId: "w1",
        workspace: workspace({ INSTANTLY_API_KEY: "not-really-encrypted" }),
        userId: "u1",
      })
    ).rejects.toThrow(/gtm\.INSTANTLY_API_KEY/)
  })
})
