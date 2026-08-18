/**
 * Single source of truth for product identity.
 *
 * Everything user-visible that names the product reads from here, so renaming
 * is one edit rather than a grep across the app.
 */
export const BRAND = {
  name: "MaLoewe",
  /** Shown under the name on the launcher. */
  tagline: "Your team's agents, in one place",
  /** Used for <title> and PWA metadata. */
  description:
    "Shared agent workspaces. Pick a workspace and an agent runs it with the right skills, scripts and connections already loaded.",
  /** Empty-state prompt on the launcher. */
  launcherHeading: "Pick a workspace",
  launcherSubheading:
    "Each workspace carries its own skills, scripts and connections. Nothing to set up.",
} as const
