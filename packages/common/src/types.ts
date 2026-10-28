/**
 * Shared types for upstream-agents packages
 */

// =============================================================================
// Content Blocks (for displaying agent output)
// =============================================================================

export interface ToolCall {
  tool: string
  summary: string
  fullSummary?: string
  filePath?: string
  output?: string
  /**
   * Set when the call changed something outside the sandbox (a POST to a
   * workspace API, a script run with --apply). See web/lib/write-classifier.
   */
  write?: { verb: string; target: string }
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_calls"; toolCalls: ToolCall[] }

// =============================================================================
// Agent Status
// =============================================================================

export type AgentStatus = "running" | "completed" | "error"

export interface AgentStatusResponse {
  status: AgentStatus
  content: string
  toolCalls: ToolCall[]
  contentBlocks: ContentBlock[]
  error?: string
  sessionId?: string
}
