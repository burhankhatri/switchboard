/**
 * Application configuration constants
 */

export const APP_NAME = "Switchboard"

/**
 * Generate a page title with consistent formatting
 * @param parts - Title parts to join (e.g., ["Chat Name", "Scheduled Jobs"])
 * @returns Formatted title like "Chat Name · Switchboard"
 */
export function formatPageTitle(...parts: (string | null | undefined)[]): string {
  const filtered = parts.filter(Boolean) as string[]
  if (filtered.length === 0) {
    return APP_NAME
  }
  return `${filtered.join(" · ")} · ${APP_NAME}`
}
