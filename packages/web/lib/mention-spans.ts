/**
 * Spans of `@token` that match a known connection slug or workspace file path.
 * Only exact, committed tokens are returned — a trailing `@partial` stays plain
 * text so the menu and the highlight never disagree about what is "done".
 */
export function findCommittedMentionSpans(
  text: string,
  tokens: string[]
): Array<{ start: number; end: number }> {
  if (!text || tokens.length === 0) return []
  const sorted = [...new Set(tokens)].sort((a, b) => b.length - a.length)
  const spans: Array<{ start: number; end: number }> = []
  let i = 0
  while (i < text.length) {
    if (text[i] === "@" && (i === 0 || /\s/.test(text[i - 1]!))) {
      const rest = text.slice(i + 1)
      let matched = false
      for (const token of sorted) {
        if (!token || !rest.startsWith(token)) continue
        const end = i + 1 + token.length
        const next = text[end]
        if (next !== undefined && !/\s/.test(next)) continue
        spans.push({ start: i, end })
        i = end
        matched = true
        break
      }
      if (!matched) i++
    } else {
      i++
    }
  }
  return spans
}
