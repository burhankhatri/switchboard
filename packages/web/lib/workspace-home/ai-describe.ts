import type { HomePlan } from "./ai-contract"

type Titled = { id: string; title: string }

/** The stage says how far along work is; this says what the work is for. */
export function describeOperation(op: { kind: string; targetId: string | null; plan: HomePlan | null },
  titles: { widgets: Titled[]; insights: Titled[] }): string {
  const quoted = (items: Titled[]) => {
    const title = items.find(item => item.id === op.targetId)?.title
    return title ? `“${title}”` : null
  }
  switch (op.kind) {
    case "suggestions": return "Finding suggestions for this home page"
    case "insights": return "Checking conversations for issues, blockers and decisions"
    case "edit": { const t = quoted(titles.widgets); return t ? `Editing ${t}` : "Editing a component" }
    case "edit-insight": { const t = quoted(titles.insights); return t ? `Updating the finding ${t}` : "Updating a finding" }
    case "accept": {
      const change = op.plan?.changes[0]
      if (!change) return "Applying a suggestion"
      return `${change.targetId ? "Updating" : "Adding"} “${change.title}” from a suggestion`
    }
    default: return "Updating the home page"
  }
}
