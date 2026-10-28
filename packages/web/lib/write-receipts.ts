import type { ToolCall } from "@switchboard/common"
import { summarizeWrites } from "@/lib/write-classifier"
import { recordWorkspaceEventAsync } from "@/lib/workspace-home/events"

/**
 * One feed line per turn that wrote somewhere outside the sandbox, so a
 * teammate opening the workspace sees "Agent made 2 external writes: apply
 * push_to_instantly.py --campaign 7c08 → leads_uploaded 16; …" without opening
 * the chat. Instantly's own audit log shows the same writes with no actor;
 * this is the side that knows who asked.
 */
export function recordExternalWritesAsync(params: {
  workspaceId: string | null | undefined
  chatId: string
  userId: string
  toolCalls: ToolCall[]
}): string[] {
  const lines = summarizeWrites(params.toolCalls)
  if (lines.length === 0 || !params.workspaceId) return lines
  recordWorkspaceEventAsync({
    workspaceId: params.workspaceId,
    kind: "external_write",
    summary: `Agent made ${lines.length} external write${lines.length === 1 ? "" : "s"}: ${lines.join("; ")}`,
    actorUserId: params.userId,
    chatId: params.chatId,
    meta: { writes: lines },
  })
  return lines
}
