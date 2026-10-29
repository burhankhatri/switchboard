import { ZodError, type z } from "zod"
import { changeSchema, insightSchema, MAX_CHANGES, MAX_INSIGHTS, planSchema, type HomePlan } from "./ai-contract"
import { isWidgetType, MAX_CHART_POINTS, widgetContentSchema } from "./widgets"

type Node = Record<string | number, unknown>
const isObject = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value)

function shorten(text: string, max: number) {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  const cut = trimmed.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  // A boundary near the start would throw most of the text away; cut mid-word instead.
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "") + "…"
}

const slug = (value: unknown) => typeof value === "string"
  ? value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 63).replace(/-+$/, "")
  : ""

// Tables and charts are positional: one cell per column, one value per label.
// The model miscounts in long rows, which would otherwise discard the widget.
function align(type: string, content: unknown) {
  if (!isObject(content)) return content
  const fill = (row: unknown, length: number) => Array.isArray(row) ? [...row.slice(0, length), ...Array(Math.max(0, length - row.length)).fill(null)] : row
  if (type === "table" && Array.isArray(content.columns) && Array.isArray(content.rows)) {
    return { ...content, rows: content.rows.map(row => fill(row, (content.columns as unknown[]).length)) }
  }
  if (type === "chart" && Array.isArray(content.labels) && Array.isArray(content.series) && content.series.length) {
    const labels = content.labels.slice(0, Math.floor(MAX_CHART_POINTS / content.series.length))
    return { ...content, labels, series: content.series.map(s => isObject(s) ? { ...s, values: fill(s.values, labels.length) } : s) }
  }
  return content
}

// A home run is one shot: unlike a chat agent calling pin_to_home, the model
// never sees a validation error and cannot retry, and in busy workspaces it
// reliably overshoots limits or adds a field. What can be repaired without
// changing meaning is: text and lists are shortened to the schema's maximum,
// unknown fields are dropped, numeric strings become numbers, and an invalid
// optional field (tone, link, urgency) is removed. If the record still does
// not validate, the original is returned so the error names the real problem.
function fit(schema: z.ZodTypeAny, value: unknown): unknown {
  if (!isObject(value)) return value
  let copy = structuredClone(value)
  for (let pass = 0; pass < 4; pass++) {
    const result = schema.safeParse(copy)
    if (result.success) return copy
    let changed = false
    for (const issue of result.error.issues) {
      const parent = (issue.code === "unrecognized_keys" ? issue.path : issue.path.slice(0, -1))
        .reduce<unknown>((node, key) => (node as Node | undefined)?.[key], copy) as Node | undefined
      if (!parent || typeof parent !== "object") continue
      if (issue.code === "unrecognized_keys") {
        for (const key of issue.keys) delete parent[key]
        changed = true
        continue
      }
      const key = issue.path[issue.path.length - 1]
      if (key === undefined) continue
      const current = parent[key]
      if (issue.code === "too_big" && issue.type === "string" && typeof current === "string") parent[key] = shorten(current, Number(issue.maximum))
      else if (issue.code === "too_big" && issue.type === "array" && Array.isArray(current)) parent[key] = current.slice(0, Number(issue.maximum))
      else if (issue.code === "invalid_type" && issue.expected === "number" && typeof current === "string" && current.trim() && Number.isFinite(Number(current.replace(/,/g, "")))) parent[key] = Number(current.replace(/,/g, ""))
      else if (typeof key === "string" && current !== undefined && ["invalid_enum_value", "invalid_string", "invalid_type", "custom"].includes(issue.code)) delete parent[key]
      else continue
      changed = true
    }
    if (!changed) break
  }
  return schema.safeParse(copy).success ? copy : value
}

function fitChange(change: unknown) {
  if (!isObject(change)) return change
  const key = slug(change.key) || slug(change.title)
  if (!isWidgetType(change.type)) return { ...change, key }
  return fit(changeSchema, { ...change, key, content: fit(widgetContentSchema(change.type), align(change.type, change.content)) })
}

function fitInsight(insight: unknown) {
  if (!isObject(insight)) return insight
  return fit(insightSchema, { ...insight, key: slug(insight.key) || slug(insight.title) })
}

function readable(error: unknown, what: string) {
  if (!(error instanceof ZodError)) return error
  const issue = error.issues[0]
  return new Error(`The agent returned a ${what} that could not be used (${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}). Retry to regenerate it.`)
}

/** Only newline-terminated records can become live writes. A partial JSON
 * string or a valid prefix of an object must never replace saved content. */
export function parseHomeOutput(content: string, complete: boolean): HomePlan {
  const plan: HomePlan = { changes: [], insights: [] }
  let done = false
  const lines = content.split("\n")
  if (!complete) lines.pop()
  for (const line of lines) {
    const text = line.trim()
    // Records are objects; a stray sentence or code fence between them is not one.
    if (!text.startsWith("{")) continue
    let value
    try { value = JSON.parse(text) } catch { throw new Error("The agent returned an invalid component. Retry to regenerate it.") }
    if (done) throw new Error("Unexpected output after completion")
    try {
      if (value.change && plan.changes.length < MAX_CHANGES) plan.changes.push(changeSchema.parse(fitChange(value.change)))
      else if (value.insight && plan.insights.length < MAX_INSIGHTS) plan.insights.push(insightSchema.parse(fitInsight(value.insight)))
      else if (value.done === true) done = true
    } catch (error) { throw readable(error, value.change ? "component" : "finding") }
  }
  if (complete && !done) throw new Error("The agent stopped before finishing its home changes.")
  return planSchema.parse(plan)
}
