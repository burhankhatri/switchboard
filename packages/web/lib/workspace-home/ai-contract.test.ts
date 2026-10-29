import { describe, expect, it } from "vitest"
import { changeSchema, groundPlan, planSchema, type HomeChange } from "./ai-contract"
import { parseHomeOutput } from "./ai-output"

const source = { chatId: "chat-a", messageId: "message-a", author: "Wayne", date: "2026-10-28T00:00:00.000Z" }
const change = (overrides = {}): HomeChange => ({ targetId: null, version: null, key: "summary", type: "summary", title: "Overview", content: { headline: "An issue needs attention" }, reason: "Recent discussion", evidence: [source], ...overrides })

describe("home AI evidence and targets", () => {
  it("rejects references to conversations outside the retrieved workspace context", () => {
    expect(() => groundPlan({ changes: [change({ evidence: [{ ...source, chatId: "other-workspace" }] })], insights: [] }, [source], [])).toThrow(/unavailable conversation/)
  })
  it("uses server attribution instead of model-supplied names and dates", () => {
    const plan = groundPlan({ changes: [change({ evidence: [{ ...source, author: "Invented", date: "yesterday" }] })], insights: [] }, [source], [])
    expect(plan.changes[0].evidence).toEqual([source])
  })
  it("refuses edits that affect an unrelated component", () => {
    expect(() => groundPlan({ changes: [change({ targetId: "b" })], insights: [] }, [source], [{ id: "b", updatedAt: "now" }], "a")).toThrow(/selected component/)
  })
  it("pins updates to the server's current component version", () => {
    const result = groundPlan({ changes: [change({ targetId: "a", version: "invented" })], insights: [] }, [source], [{ id: "a", updatedAt: "original" }])
    expect(result.changes[0].version).toBe("original")
  })
  it("rejects duplicate updates and duplicate creates", () => {
    expect(() => groundPlan({ changes: [change(), change()], insights: [] }, [source], [])).toThrow(/duplicate/)
  })
  it("rejects invalid generated content before it can be saved", () => {
    expect(changeSchema.safeParse(change({ type: "chart", content: { kind: "line", labels: ["A"], series: [{ name: "Metric", values: [1, 2] }] } })).success).toBe(false)
  })
  it("allows no suggestions when there is no evidence", () => {
    expect(planSchema.parse({ changes: [], insights: [] })).toEqual({ changes: [], insights: [] })
  })
})

describe("incremental home output", () => {
  it("makes a completed record available while the next component is generating", () => {
    const content = JSON.stringify({ change: change() }) + '\n{"change":{"title":"unfinished'
    expect(parseHomeOutput(content, false).changes).toHaveLength(1)
  })
  it("does not save an object before its record is terminated", () => {
    expect(parseHomeOutput(JSON.stringify({ change: change() }), false).changes).toHaveLength(0)
  })
  it("accepts the final completion marker without a newline", () => {
    expect(parseHomeOutput(JSON.stringify({ change: change() }) + '\n{"done":true}', true).changes).toHaveLength(1)
  })
  it("does not report a truncated response as success", () => {
    expect(() => parseHomeOutput(JSON.stringify({ change: change() }), true)).toThrow(/stopped before/)
  })
  it("rejects extra instructions after completion", () => {
    expect(() => parseHomeOutput('{"done":true}\n{"change":{}}', true)).toThrow(/after completion/)
  })
  it("keeps resolved status and evidence on findings", () => {
    const insight = { key: "api-outage", title: "API fixed", detail: "Service recovered", kind: "issue", status: "resolved", evidence: [source] }
    expect(parseHomeOutput(JSON.stringify({ insight }) + '\n{"done":true}', true).insights[0]).toEqual(insight)
  })
})
