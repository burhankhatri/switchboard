/**
 * Application configuration constants
 */
import { BRAND } from "@/lib/brand"

/**
 * Re-exported from BRAND rather than declared here. Two hardcoded copies of the
 * product name is how a rename ends up half-applied — the page title kept
 * saying MaLoewe long after every visible surface had moved on.
 */
export const APP_NAME = BRAND.name

/**
 * Generate a page title with consistent formatting
 * @param parts - Title parts to join (e.g., ["Chat Name", "Scheduled Jobs"])
 * @returns Formatted title like "Chat Name · Shared Agents"
 */
export function formatPageTitle(...parts: (string | null | undefined)[]): string {
  const filtered = parts.filter(Boolean) as string[]
  if (filtered.length === 0) {
    return APP_NAME
  }
  return `${filtered.join(" · ")} · ${APP_NAME}`
}
