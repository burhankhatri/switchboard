export type CenterPane = "file" | "scheduled-jobs" | "chat" | "home"

/**
 * What fills the centre pane. One decision in one place: a file opened from
 * the sidebar takes over whatever would otherwise be there, and closing it
 * falls back to the view underneath.
 */
export function centerPaneFor({
  openFile,
  viewMode,
  chatId,
}: {
  openFile: string | null
  viewMode: "chat" | "scheduled-jobs"
  chatId: string | null
}): CenterPane {
  if (openFile) return "file"
  if (viewMode === "scheduled-jobs") return "scheduled-jobs"
  return chatId ? "chat" : "home"
}
