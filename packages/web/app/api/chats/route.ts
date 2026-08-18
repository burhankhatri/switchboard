import { NextRequest } from "next/server"
import {
  WORKSPACE_RUNTIME_SELECT,
  type WorkspaceRuntime,
} from "@/lib/workspace"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  forbidden,
  internalError,
} from "@/lib/db/api-helpers"
import { logActivityAsync } from "@/lib/db/activity-log"
import {
  agentModels,
  getDefaultAgent,
  resolveAgent,
  resolveModelForAgent,
  hasCredentialsForModel,
  type Agent,
} from "@switchboard/common"
import { getEffectiveCredentialFlags } from "@/lib/server/credential-flags"

// =============================================================================
// Types
// =============================================================================

interface ChatResponse {
  id: string
  workspaceId: string | null
  repo: string
  baseBranch: string
  branch: string | null
  sandboxId: string | null
  sessionId: string | null
  previewUrlPattern: string | null
  backgroundSessionId: string | null
  agent: string
  model: string | null
  planModeEnabled: boolean
  displayName: string | null
  shareId: string | null
  status: string
  archived: boolean
  pinned: boolean
  parentChatId: string | null
  needsSync: boolean
  createdAt: number
  updatedAt: number
  lastActiveAt: number
  messageCount: number
  lastMessageId: string | null
}

// =============================================================================
// GET - List all chats for user
// =============================================================================

export async function GET(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { searchParams } = new URL(req.url)
    const updatedAfter = searchParams.get("updatedAfter")

    const chats = await prisma.chat.findMany({
      where: {
        userId,
        // Exclude chats linked to scheduled job runs (they show in Scheduled Jobs UI)
        scheduledJobRun: null,
        ...(updatedAfter && {
          updatedAt: { gt: new Date(parseInt(updatedAfter)) },
        }),
      },
      include: {
        messages: {
          select: { id: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { lastActiveAt: "desc" },
    })

    const response: ChatResponse[] = chats.map((chat) => ({
      id: chat.id,
      workspaceId: chat.workspaceId,
      repo: chat.repo,
      baseBranch: chat.baseBranch,
      branch: chat.branch,
      sandboxId: chat.sandboxId,
      sessionId: chat.sessionId,
      previewUrlPattern: chat.previewUrlPattern,
      backgroundSessionId: chat.backgroundSessionId,
      agent: chat.agent,
      model: chat.model,
      planModeEnabled: chat.planModeEnabled,
      displayName: chat.displayName,
      shareId: chat.shareId,
      status: chat.status,
      archived: chat.archived,
      pinned: chat.pinned,
      parentChatId: chat.parentChatId,
      needsSync: chat.needsSync,
      createdAt: chat.createdAt.getTime(),
      updatedAt: chat.updatedAt.getTime(),
      lastActiveAt: chat.lastActiveAt.getTime(),
      messageCount: chat._count.messages,
      lastMessageId: chat.messages[0]?.id ?? null,
    }))

    return Response.json({ chats: response })
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// POST - Create a new chat
// =============================================================================

interface CreateChatBody {
  /** Optional when workspaceId is given — the workspace supplies the repo. */
  repo?: string
  /**
   * Workspace to run in. Workspaces are shared, so there is deliberately no
   * ownership check here: any signed-in user may start a chat in any workspace.
   * Attribution stays on Chat.userId.
   */
  workspaceId?: string
  baseBranch?: string
  parentChatId?: string
  agent?: string
  model?: string
  status?: string
  planModeEnabled?: boolean
}

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const body: CreateChatBody = await req.json()

    // A workspace supplies repo/baseBranch/agent/model, so the chat row can be
    // denormalized from it. That keeps every existing consumer of Chat.repo
    // (clone, auto-push, PR creation, sandbox labels, the sidebar) working with
    // no changes — the workspace only narrows where the agent runs.
    let workspace: WorkspaceRuntime | null = null
    if (body.workspaceId) {
      // Membership is REQUIRED here. Binding a chat to a workspace is what
      // causes that workspace's decrypted connections to be injected into a
      // sandbox, so this is an authorization boundary, not a convenience:
      // without it any signed-in user could name any workspace and receive its
      // CRM credential — while the env endpoint refuses them even the key names.
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: body.workspaceId, userId } },
        select: { role: true },
      })
      if (!member) return forbidden("Join this workspace first")

      workspace = await prisma.workspace.findFirst({
        where: { id: body.workspaceId, archived: false },
        select: WORKSPACE_RUNTIME_SELECT,
      })
      if (!workspace) {
        return badRequest("Invalid workspaceId")
      }
    }

    if (!body.repo && !workspace) {
      return badRequest("repo is required")
    }

    // Validate parentChatId if provided
    if (body.parentChatId) {
      const parentChat = await prisma.chat.findUnique({
        where: { id: body.parentChatId },
        select: { userId: true },
      })
      if (!parentChat || parentChat.userId !== userId) {
        return badRequest("Invalid parentChatId")
      }
    }

    // Pick an (agent, model) pair that's actually usable with the user's
    // credentials. Without this the row could have e.g. agent="opencode"
    // (the hardcoded default) but model="claude-sonnet-..." (settings'
    // default), which is internally inconsistent and confuses the UI.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    })
    const userSettings = (user?.settings as { defaultAgent?: string; defaultModel?: string } | null) ?? {}
    const { flags } = await getEffectiveCredentialFlags(userId)

    // Workspace agent wins over the user default but still goes through the
    // usability check below, so an unusable harness falls back rather than
    // producing a chat that cannot run.
    const requestedAgent = resolveAgent(
      body.agent ?? workspace?.agent,
      userSettings.defaultAgent
    )
    const requestedAgentUsable = (agentModels[requestedAgent] ?? []).some((m) =>
      hasCredentialsForModel(m, flags, requestedAgent)
    )
    const finalAgent: Agent = requestedAgentUsable
      ? requestedAgent
      : getDefaultAgent()

    const finalModel: string =
      body.model ??
      (requestedAgentUsable ? (workspace?.model ?? undefined) : undefined) ??
      resolveModelForAgent(finalAgent, flags, userSettings.defaultModel)

    const chat = await prisma.chat.create({
      data: {
        userId,
        workspaceId: workspace?.id,
        repo: workspace?.repo ?? body.repo!,
        baseBranch: body.baseBranch ?? workspace?.baseBranch ?? "main",
        parentChatId: body.parentChatId,
        agent: finalAgent,
        model: finalModel,
        status: body.status ?? "pending",
        planModeEnabled: body.planModeEnabled ?? false,
      },
    })

    const response: ChatResponse = {
      id: chat.id,
      workspaceId: chat.workspaceId,
      repo: chat.repo,
      baseBranch: chat.baseBranch,
      branch: chat.branch,
      sandboxId: chat.sandboxId,
      sessionId: chat.sessionId,
      previewUrlPattern: chat.previewUrlPattern,
      backgroundSessionId: chat.backgroundSessionId,
      agent: chat.agent,
      model: chat.model,
      planModeEnabled: chat.planModeEnabled,
      displayName: chat.displayName,
      shareId: chat.shareId,
      status: chat.status,
      archived: chat.archived,
      pinned: chat.pinned,
      parentChatId: chat.parentChatId,
      needsSync: chat.needsSync,
      createdAt: chat.createdAt.getTime(),
      updatedAt: chat.updatedAt.getTime(),
      lastActiveAt: chat.lastActiveAt.getTime(),
      messageCount: 0,
      lastMessageId: null,
    }

    // Log activity (fire and forget)
    logActivityAsync(userId, "chat_created", {
      chatId: chat.id,
      repo: chat.repo,
      agent: chat.agent,
      model: chat.model ?? undefined,
    })

    return Response.json(response, { status: 201 })
  } catch (error) {
    return internalError(error)
  }
}
