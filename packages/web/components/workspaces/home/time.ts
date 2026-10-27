/** "3 days ago" is more useful here than a timestamp nobody reads. */
export function ago(ts: number | string): string {
  const ms = typeof ts === "string" ? Date.parse(ts) : ts
  const mins = Math.round((Date.now() - ms) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days}d ago`
}
