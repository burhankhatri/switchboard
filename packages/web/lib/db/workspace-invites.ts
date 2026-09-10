import { prisma } from "./prisma"
import { logActivityAsync } from "./activity-log"
import { notifyAsync } from "./notifications"

/**
 * Workspace invites for people who have not signed in yet.
 *
 * Membership needs a `User` row to point at, so adding a colleague used to be
 * refused outright until they had signed in once. That put the slow half of
 * onboarding on the person doing the inviting: tell them to sign up, wait, come
 * back, add them again. An invite records the intent now and this module turns
 * it into real membership the moment the account appears.
 */

/**
 * The form a handle is stored and matched in.
 *
 * GitHub logins are case-insensitive, and people paste them with an `@` or a
 * profile URL attached. Everything funnels through here so an invite written as
 * "@BurhanKhatri" is found by a sign-in reporting "burhankhatri" — the whole
 * feature is that equality match, and a stray capital would silently strand the
 * invite forever.
 */
export function normalizeGithubLogin(identifier: string): string {
  return identifier
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase()
}

/** A GitHub handle: alphanumerics and single hyphens, 39 characters at most. */
export function isValidGithubLogin(handle: string): boolean {
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/.test(handle)
}

export interface ClaimedInvite {
  workspaceId: string
  workspaceName: string
  role: string
}

/**
 * Turn every pending invite for this handle into membership.
 *
 * Called from the sign-in event, which means it runs on *every* sign-in rather
 * than only the first. That is deliberate: an invite sent to someone who
 * already has an account but has not been added yet lands on their next visit,
 * so there is one code path instead of a signup path and a separate
 * already-registered path.
 *
 * Never throws. Being unable to claim an invite must not cost someone their
 * sign-in — they end up merely un-added, which the next sign-in retries.
 */
export async function claimInvitesForLogin(
  userId: string,
  login: string
): Promise<ClaimedInvite[]> {
  const handle = normalizeGithubLogin(login)
  if (!handle) return []

  try {
    const invites = await prisma.workspaceInvite.findMany({
      where: { githubLogin: handle, workspace: { archived: false } },
      select: {
        id: true,
        role: true,
        invitedById: true,
        workspace: { select: { id: true, name: true, slug: true } },
      },
    })
    if (invites.length === 0) return []

    const claimed: ClaimedInvite[] = []

    for (const invite of invites) {
      try {
        // The invite is consumed whether or not it produced a new membership.
        // `skipDuplicates` covers the case where they were added by hand in the
        // meantime; leaving the row behind would re-add them after a later
        // removal, silently undoing a revocation.
        await prisma.$transaction([
          prisma.workspaceMember.createMany({
            data: [{ workspaceId: invite.workspace.id, userId, role: invite.role }],
            skipDuplicates: true,
          }),
          prisma.workspaceInvite.delete({ where: { id: invite.id } }),
        ])

        claimed.push({
          workspaceId: invite.workspace.id,
          workspaceName: invite.workspace.name,
          role: invite.role,
        })

        logActivityAsync(invite.invitedById, "workspace_invite_accepted", {
          workspaceSlug: invite.workspace.slug,
          targetUserId: userId,
          githubLogin: handle,
          role: invite.role,
        })

        // Landing in a workspace you have never heard of, on an account you
        // made thirty seconds ago, reads as a bug without this.
        notifyAsync({
          userId,
          actorId: invite.invitedById,
          kind: "workspace_member_added",
          title: `You have been added to ${invite.workspace.name}`,
          body: "It was waiting for you — open it from the workspace picker.",
          workspaceId: invite.workspace.id,
        })
      } catch (err) {
        // One bad invite must not strand the rest.
        console.error("[workspace-invites] could not claim invite", invite.id, err)
      }
    }

    return claimed
  } catch (err) {
    console.error("[workspace-invites] claim failed for", handle, err)
    return []
  }
}
