import { prisma } from "./prisma"
import { shouldBlockForAuthFailure } from "@/lib/credential-health"

/**
 * Has the provider already rejected this user's credential for this agent,
 * with nothing changed since?
 *
 * Reads the auth-category rows logLlmProviderError already writes, so this
 * costs one indexed query and no provider round-trip.
 *
 * Fails open on any error. A hiccup here should cost a wasted sandbox, never a
 * user who cannot run anything.
 */
export async function isCredentialKnownBad(
  userId: string,
  agent: string
): Promise<boolean> {
  try {
    const [failure, user] = await Promise.all([
      prisma.activityLog.findFirst({
        where: {
          userId,
          action: "llm_provider_error",
          metadata: { path: ["category"], equals: "auth" },
          AND: [{ metadata: { path: ["agent"], equals: agent } }],
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { updatedAt: true },
      }),
    ])

    return shouldBlockForAuthFailure({
      lastAuthFailureAt: failure?.createdAt ?? null,
      credentialsUpdatedAt: user?.updatedAt ?? null,
    })
  } catch (err) {
    console.error("[credential-health] check failed, allowing the run", err)
    return false
  }
}
