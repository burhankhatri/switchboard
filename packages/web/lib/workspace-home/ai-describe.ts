import type { HomePlan } from "./ai-contract"

type Titled = { id: string; title: string }

/** DOM id of a widget or finding card, so a notice can scroll to what changed. */
export const homeItemId = (id: string) => `home-item-${id}`

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Past tense of describeOperation, named from what was actually saved. */
export function describeResult(op: { kind: string; plan: HomePlan | null; receipts: Titled[] }): string {
  const first = op.receipts[0]?.title
  if (op.kind === "suggestions") {
    const ready = op.plan?.changes.length ?? 0
    return ready ? `${count(ready, "suggestion", "suggestions")} ready to review` : "No new suggestions from the available evidence"
  }
  if (!first) return "No changes were needed"
  switch (op.kind) {
    case "edit": return `Updated “${first}”`
    case "edit-insight": return `Updated the finding “${first}”`
    case "accept": return `${op.plan?.changes[0]?.targetId ? "Updated" : "Added"} “${first}” from the suggestion`
    case "insights": return `Refreshed ${count(op.receipts.length, "finding", "findings")}`
    default: return `Updated the home page: ${count(op.receipts.length, "change", "changes")} saved`
  }
}

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
