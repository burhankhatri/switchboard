import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { recordWorkspaceEventAsync } from "./events"
import {
  MAX_WIDGETS_PER_WORKSPACE,
  fileWidgetPathAllowed,
  validateKey,
  validateTitle,
  validateWidgetContent,
  type WidgetType,
} from "./widgets"

/**
 * Every widget write — from the home page, a pin, or an agent tool — goes
 * through here, so the schema, the reference checks, the per-workspace cap and
 * the provenance are applied identically whoever is writing.
 *
 * Callers have already established that `actor.userId` is a member of the
 * workspace; this module scopes every lookup to the workspace so an id from
 * elsewhere behaves exactly like one that does not exist.
 */

export interface WidgetActor {
  userId: string
  via: "manual" | "pin" | "agent"
  chatId?: string | null
  messageId?: string | null
  jobId?: string | null
  runId?: string | null
}

export interface WidgetWorkspace {
  id: string
  path: string
}

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 404 | 409; error: string }

const fail = (status: 400 | 404 | 409, error: string) => ({ ok: false as const, status, error })

/** Provenance of the content being written now, replacing whatever was there. */
function provenance(actor: WidgetActor) {
  return {
    updatedById: actor.userId,
    sourceChatId: actor.chatId ?? null,
    sourceMessageId: actor.messageId ?? null,
    sourceJobId: actor.jobId ?? null,
    sourceRunId: actor.runId ?? null,
  }
}

async function checkReferences(
  workspace: WidgetWorkspace,
  type: WidgetType,
  content: unknown
): Promise<string | null> {
  if (type === "file") {
    const { path } = content as { path: string }
    if (!fileWidgetPathAllowed(path, workspace.path)) {
      return `path must be a file inside this workspace (${workspace.path}/…)`
    }
  }
  if (type === "job") {
    const { jobId } = content as { jobId: string }
    const job = await prisma.scheduledJob.findFirst({
      where: { id: jobId, workspaceId: workspace.id, isDraft: false },
      select: { id: true },
    })
    if (!job) return "jobId must be a scheduled job in this workspace"
  }
  return null
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
}

export interface CreateWidgetInput {
  type: unknown
  title: unknown
  content: unknown
  key?: unknown
}

export async function createWidget(
  workspace: WidgetWorkspace,
  input: CreateWidgetInput,
  actor: WidgetActor
): Promise<StoreResult<{ id: string; key: string | null }>> {
  const title = validateTitle(input.title)
  if (!title.ok) return fail(400, title.error)
  const key = validateKey(input.key)
  if (!key.ok) return fail(400, key.error)
  const checked = validateWidgetContent(input.type, input.content)
  if (!checked.ok) return fail(400, checked.error)
  const refError = await checkReferences(workspace, checked.value.type, checked.value.content)
  if (refError) return fail(400, refError)

  const [count, last] = await Promise.all([
    prisma.workspaceWidget.count({ where: { workspaceId: workspace.id } }),
    prisma.workspaceWidget.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { position: "desc" },
      select: { position: true },
    }),
  ])
  if (count >= MAX_WIDGETS_PER_WORKSPACE) {
    return fail(
      409,
      `This workspace already has ${MAX_WIDGETS_PER_WORKSPACE} widgets. Update or remove one instead of adding another.`
    )
  }

  try {
    const widget = await prisma.workspaceWidget.create({
      data: {
        workspaceId: workspace.id,
        key: key.value,
        type: checked.value.type,
        title: title.value,
        content: checked.value.content as Prisma.InputJsonValue,
        position: (last?.position ?? -1) + 1,
        createdVia: actor.via,
        createdById: actor.userId,
        ...provenance(actor),
      },
      select: { id: true, key: true },
    })
    recordWorkspaceEventAsync({
      workspaceId: workspace.id,
      kind: "widget_created",
      summary: `Pinned ${title.value} to the home page`,
      actorUserId: actor.userId,
      widgetId: widget.id,
      jobId: actor.jobId,
      runId: actor.runId,
      chatId: actor.chatId,
    })
    return { ok: true, value: widget }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail(409, `A widget with key "${key.value}" already exists. Update it instead.`)
    }
    throw err
  }
}

/** By id, by key, or either — an agent may hold one or the other. */
export type WidgetRef = { id: string } | { key: string } | { idOrKey: string }

function refWhere(ref: WidgetRef): Prisma.WorkspaceWidgetWhereInput {
  if ("id" in ref) return { id: ref.id }
  if ("key" in ref) return { key: ref.key }
  return { OR: [{ id: ref.idOrKey }, { key: ref.idOrKey }] }
}

export interface UpdateWidgetInput {
  title?: unknown
  content?: unknown
  /**
   * A different type, with content for it. Lets a widget become the shape it
   * should have been (a note listing dates into a timeline) where it already
   * sits, instead of a near-duplicate pinned at the bottom.
   */
  type?: unknown
}

export async function updateWidget(
  workspace: WidgetWorkspace,
  ref: WidgetRef,
  input: UpdateWidgetInput,
  actor: WidgetActor
): Promise<StoreResult<{ id: string }>> {
  const existing = await prisma.workspaceWidget.findFirst({
    where: { workspaceId: workspace.id, ...refWhere(ref) },
    select: { id: true, type: true, title: true },
  })
  if (!existing) return fail(404, "No such widget in this workspace")

  const data: Prisma.WorkspaceWidgetUpdateInput = {}
  if (input.title !== undefined) {
    const title = validateTitle(input.title)
    if (!title.ok) return fail(400, title.error)
    data.title = title.value
  }
  const retype = input.type !== undefined && input.type !== existing.type
  if (retype && input.content === undefined) {
    return fail(400, "Changing a widget's type needs content in the new type's shape")
  }
  if (input.content !== undefined) {
    const checked = validateWidgetContent(retype ? input.type : existing.type, input.content)
    if (!checked.ok) return fail(400, checked.error)
    const refError = await checkReferences(workspace, checked.value.type, checked.value.content)
    if (refError) return fail(400, refError)
    data.content = checked.value.content as Prisma.InputJsonValue
    if (retype) data.type = checked.value.type
  }
  if (Object.keys(data).length === 0) return fail(400, "Nothing to update")

  const p = provenance(actor)
  await prisma.workspaceWidget.update({
    where: { id: existing.id },
    data: {
      ...data,
      updatedBy: { connect: { id: p.updatedById } },
      sourceChatId: p.sourceChatId,
      sourceMessageId: p.sourceMessageId,
      sourceJobId: p.sourceJobId,
      sourceRunId: p.sourceRunId,
    },
  })

  // A job refreshing its numbers every morning is not news; a person
  // changing what a widget says is.
  if (actor.via !== "agent") {
    recordWorkspaceEventAsync({
      workspaceId: workspace.id,
      kind: "widget_updated",
      summary: `Updated ${(data.title as string | undefined) ?? existing.title} on the home page`,
      actorUserId: actor.userId,
      widgetId: existing.id,
    })
  }
  return { ok: true, value: { id: existing.id } }
}

export async function deleteWidget(
  workspace: WidgetWorkspace,
  id: string,
  actor: WidgetActor
): Promise<StoreResult<{ id: string }>> {
  const existing = await prisma.workspaceWidget.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, title: true },
  })
  if (!existing) return fail(404, "No such widget in this workspace")
  await prisma.workspaceWidget.delete({ where: { id: existing.id } })
  recordWorkspaceEventAsync({
    workspaceId: workspace.id,
    kind: "widget_removed",
    summary: `Removed ${existing.title} from the home page`,
    actorUserId: actor.userId,
    widgetId: existing.id,
  })
  return { ok: true, value: { id: existing.id } }
}

/** Positions follow the order given; every id must be one of this workspace's. */
export async function reorderWidgets(
  workspace: WidgetWorkspace,
  ids: unknown
): Promise<StoreResult<{ count: number }>> {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return fail(400, "ids must be an array of widget ids")
  }
  if (new Set(ids).size !== ids.length) return fail(400, "ids must not repeat")
  const owned = await prisma.workspaceWidget.findMany({
    where: { workspaceId: workspace.id },
    select: { id: true },
  })
  const ownedIds = new Set(owned.map((w) => w.id))
  if (ids.length !== ownedIds.size || ids.some((id) => !ownedIds.has(id))) {
    return fail(400, "ids must list every widget in this workspace exactly once")
  }
  await prisma.$transaction(
    (ids as string[]).map((id, position) =>
      prisma.workspaceWidget.update({ where: { id }, data: { position } })
    )
  )
  return { ok: true, value: { count: ids.length } }
}
