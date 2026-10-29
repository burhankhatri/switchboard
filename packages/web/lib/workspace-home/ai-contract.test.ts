import { describe, expect, it } from "vitest"
import { changeSchema, groundPlan, planSchema, type HomeChange } from "./ai-contract"
import { parseHomeOutput } from "./ai-output"

const source = { chatId: "chat-a", messageId: "message-a", author: "Wayne", date: "2026-10-28T00:00:00.000Z" }
const change = (overrides = {}): HomeChange => ({ targetId: null, version: null, key: "summary", type: "summary", title: "Overview", content: { headline: "An issue needs attention" }, reason: "Recent discussion", evidence: [source], ...overrides })

describe("home AI evidence and targets", () => {
  it("never keeps a citation outside the retrieved workspace context", () => {
    const foreign = { ...source, chatId: "other-workspace" }
    const insight = { key: "outage", title: "Outage", detail: "Down", kind: "issue" as const, status: "open" as const, evidence: [foreign] }
    const plan = groundPlan({ changes: [change({ evidence: [foreign, source] })], insights: [insight] }, [source], [])
    expect(plan.changes[0].evidence).toEqual([source])
    expect(plan.insights).toEqual([])
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
  it("saves a duplicated component or finding once", () => {
    const insight = { key: "outage", title: "Outage", detail: "Down", kind: "issue" as const, status: "open" as const, evidence: [source] }
    const plan = groundPlan({ changes: [change(), change({ title: "Again" })], insights: [insight, { ...insight, title: "Again" }] }, [source], [])
    expect(plan.changes.map(c => c.title)).toEqual(["Overview"])
    expect(plan.insights.map(i => i.title)).toEqual(["Outage"])
  })
  it("updates the existing component when the agent creates a key that is taken", () => {
    const plan = groundPlan({ changes: [change()], insights: [] }, [source], [{ id: "w1", key: "summary", updatedAt: "v1" }])
    expect(plan.changes[0]).toMatchObject({ targetId: "w1", version: "v1" })
  })
  it("drops changes to components that do not exist and creates past the widget cap", () => {
    const widgets = Array.from({ length: 39 }, (_, i) => ({ id: `w${i}`, key: null, updatedAt: "v" }))
    const plan = groundPlan({ changes: [change({ targetId: "missing" }), change({ key: "a" }), change({ key: "b" })], insights: [] }, [source], widgets)
    expect(plan.changes.map(c => c.key)).toEqual(["a"])
  })
  it("keeps only the selected component in an edit, and fails when nothing targets it", () => {
    const widgets = [{ id: "a", key: "one", updatedAt: "v" }, { id: "b", key: "two", updatedAt: "v" }]
    expect(groundPlan({ changes: [change({ targetId: "b", key: "two" }), change({ targetId: "a", key: "one" })], insights: [] }, [source], widgets, "a").changes.map(c => c.targetId)).toEqual(["a"])
    expect(() => groundPlan({ changes: [change({ targetId: "b", key: "two" })], insights: [] }, [source], widgets, "a")).toThrow(/selected component/)
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
  it("keeps the first citations when a record cites more than the limit", () => {
    const evidence = Array.from({ length: 12 }, (_, i) => ({ ...source, messageId: `message-${i}` }))
    const insight = { key: "api-outage", title: "API down", detail: "Many reports", kind: "issue", status: "open", evidence }
    const plan = parseHomeOutput([JSON.stringify({ change: change({ evidence }) }), JSON.stringify({ insight }), '{"done":true}'].join("\n"), true)
    expect(plan.changes[0].evidence).toEqual(evidence.slice(0, 8))
    expect(plan.insights[0].evidence).toEqual(evidence.slice(0, 8))
  })
  it("shortens text that runs past a limit at a word boundary instead of failing the run", () => {
    const headline = "The team shipped the pricing page and is now working through onboarding feedback ".repeat(4)
    const detail = "Customers report the export times out on large accounts. ".repeat(10)
    const insight = { key: "export-timeouts", title: "Export times out", detail, kind: "issue", status: "open", evidence: [source] }
    const plan = parseHomeOutput([JSON.stringify({ change: change({ content: { headline } }) }), JSON.stringify({ insight }), '{"done":true}'].join("\n"), true)
    const shortened = (plan.changes[0].content as { headline: string }).headline
    expect(shortened.length).toBeLessThanOrEqual(240)
    expect(shortened).toMatch(/\w…$/)
    expect(headline.startsWith(shortened.slice(0, -1))).toBe(true)
    expect(plan.insights[0].detail.length).toBeLessThanOrEqual(400)
  })
  it("drops unknown fields and invalid optional values, and reads numbers sent as text", () => {
    const content = { items: [{ title: "Fix export", urgency: "high", color: "red" }], extra: true }
    const funnel = { steps: [{ label: "Leads", value: "1,200" }, { label: "Won", value: "30" }] }
    const summary = { headline: "Stable", points: [{ text: "Export fixed", tone: "neutral" }] }
    const lines = [
      { change: change({ key: "actions", type: "actions", content, icon: "x" }) },
      { change: change({ key: "funnel", type: "funnel", content: funnel }) },
      { change: change({ content: summary, evidence: [{ ...source, text: "quoted" }] }) },
      { done: true },
    ]
    const plan = parseHomeOutput(lines.map(l => JSON.stringify(l)).join("\n"), true)
    // The store applies urgency's default when it saves.
    expect(plan.changes[0].content).toEqual({ items: [{ title: "Fix export" }] })
    expect(plan.changes[1].content).toEqual({ steps: [{ label: "Leads", value: 1200 }, { label: "Won", value: 30 }] })
    expect(plan.changes[2].content).toEqual({ headline: "Stable", points: [{ text: "Export fixed" }] })
    expect(plan.changes[2].evidence).toEqual([source])
  })
  it("lines up table rows with columns and chart values with labels", () => {
    const table = { columns: ["Name", "Status"], rows: [["A"], ["B", "Done", "extra"]] }
    const chart = { kind: "line", labels: ["Mon", "Tue", "Wed"], series: [{ name: "Leads", values: [1, 2] }] }
    const lines = [{ change: change({ key: "t", type: "table", content: table }) }, { change: change({ key: "c", type: "chart", content: chart }) }, { done: true }]
    const plan = parseHomeOutput(lines.map(l => JSON.stringify(l)).join("\n"), true)
    expect((plan.changes[0].content as typeof table).rows).toEqual([["A", null], ["B", "Done"]])
    expect((plan.changes[1].content as typeof chart).series[0].values).toEqual([1, 2, null])
  })
  it("turns readable keys into stable keys and ignores records past the plan limits", () => {
    const changes = Array.from({ length: 8 }, (_, i) => ({ change: change({ key: `Weekly Leads ${i}` }) }))
    const plan = parseHomeOutput([...changes, { done: true }].map(l => JSON.stringify(l)).join("\n"), true)
    expect(plan.changes).toHaveLength(6)
    expect(plan.changes[0].key).toBe("weekly-leads-0")
  })
  it("skips commentary between records", () => {
    const content = ["Here are the changes:", JSON.stringify({ change: change() }), "```", '{"done":true}'].join("\n")
    expect(parseHomeOutput(content, true).changes).toHaveLength(1)
  })
  it("explains an unusable record in words instead of raw validation output", () => {
    expect(() => parseHomeOutput(JSON.stringify({ change: change({ content: { headline: "" } }) }) + '\n{"done":true}', true)).toThrow(/^The agent returned a component that could not be used/)
  })
  it("still rejects records that are wrong in other ways", () => {
    const insight = { key: "x", title: "T", detail: "D", kind: "issue", status: "bogus", evidence: [source] }
    expect(() => parseHomeOutput(JSON.stringify({ insight }) + '\n{"done":true}', true)).toThrow()
    expect(() => parseHomeOutput(JSON.stringify({ change: change({ content: { headline: "" } }) }) + '\n{"done":true}', true)).toThrow()
  })
})
