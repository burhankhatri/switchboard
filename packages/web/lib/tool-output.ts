/**
 * Reading the agent's own tool output to decide what the UI may do with it.
 *
 * Deliberately dependency-free so both the server-side session builder and
 * client components can import it without dragging the SDK into the browser
 * bundle (see the note at the top of lib/session.ts).
 */

/**
 * Did this Read return a directory listing rather than file content?
 *
 * The Read tool accepts a directory, and a directory is not something the file
 * viewer can open. The path alone cannot tell us — `.claude/skills` has a dot
 * and no extension, `README` has neither, and both are legal either way — but
 * the agent's result declares the type outright:
 *
 *     <path>/…/.claude/skills</path>
 *     <type>directory</type>
 *     <entries>…</entries>
 *
 * Conservative by design: only a recognised marker counts. An agent CLI that
 * formats its output differently keeps the previous behaviour rather than
 * silently losing the ability to open files.
 */
export function isDirectoryReadOutput(output: string | undefined): boolean {
  if (!output) return false
  return /^<type>directory<\/type>\s*$/m.test(output)
}
