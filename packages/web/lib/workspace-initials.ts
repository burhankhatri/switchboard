/** Up to two letters that identify a workspace on the rail, like a Slack tile. */
export function workspaceInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const initials = words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("")
  return initials || "?"
}
