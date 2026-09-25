/** Line and column of an offset, counted from one like every editor's status bar. */
export function cursorPosition(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset)
  const lastBreak = before.lastIndexOf("\n")
  return { line: lineCount(before), column: offset - lastBreak }
}

export function lineCount(text: string): number {
  let lines = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++
  return lines
}
