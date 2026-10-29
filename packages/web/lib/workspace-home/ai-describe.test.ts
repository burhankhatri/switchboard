import { describe, expect, it } from "vitest"
import { describeOperation } from "./ai-describe"

const titles = { widgets: [{ id: "w1", title: "Workspace summary" }], insights: [{ id: "i1", title: "CRM sync needs attention" }] }
const op = (kind: string, extra = {}) => ({ kind, targetId: null, plan: null, ...extra })
const suggestion = (targetId: string | null, title: string) => ({ changes: [{ targetId, version: null, key: "k", type: "summary" as const, title, content: {}, reason: "", evidence: [] }], insights: [] })

describe("what a running operation is doing", () => {
  it("names each kind of work in words a member recognises", () => {
    expect(describeOperation(op("suggestions"), titles)).toBe("Finding suggestions for this home page")
    expect(describeOperation(op("insights"), titles)).toBe("Checking conversations for issues, blockers and decisions")
    expect(describeOperation(op("create"), titles)).toBe("Updating the home page")
  })
  it("names the component or finding being edited", () => {
    expect(describeOperation(op("edit", { targetId: "w1" }), titles)).toBe("Editing “Workspace summary”")
    expect(describeOperation(op("edit-insight", { targetId: "i1" }), titles)).toBe("Updating the finding “CRM sync needs attention”")
  })
  it("names the suggestion being applied, and whether it adds or updates", () => {
    expect(describeOperation(op("accept", { plan: suggestion(null, "Weekly leads") }), titles)).toBe("Adding “Weekly leads” from a suggestion")
    expect(describeOperation(op("accept", { targetId: "w1", plan: suggestion("w1", "Workspace summary") }), titles)).toBe("Updating “Workspace summary” from a suggestion")
  })
  it("still says what it is doing when the target is not loaded", () => {
    expect(describeOperation(op("edit", { targetId: "gone" }), titles)).toBe("Editing a component")
    expect(describeOperation(op("edit-insight", { targetId: "gone" }), titles)).toBe("Updating a finding")
    expect(describeOperation(op("accept"), titles)).toBe("Applying a suggestion")
  })
})
