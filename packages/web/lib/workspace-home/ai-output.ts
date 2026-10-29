import { changeSchema, insightSchema, planSchema, type HomePlan } from "./ai-contract"

/** Only newline-terminated records can become live writes. A partial JSON
 * string or a valid prefix of an object must never replace saved content. */
export function parseHomeOutput(content: string, complete: boolean): HomePlan {
  const plan: HomePlan = { changes: [], insights: [] }
  let done = false
  const lines = content.split("\n")
  if (!complete) lines.pop()
  for (const line of lines) {
    const text = line.trim()
    if (!text || text.startsWith("```")) continue
    let value
    try { value = JSON.parse(text) } catch { throw new Error("The agent returned an invalid component. Retry to regenerate it.") }
    if (done) throw new Error("Unexpected output after completion")
    if (value.change) plan.changes.push(changeSchema.parse(value.change))
    else if (value.insight) plan.insights.push(insightSchema.parse(value.insight))
    else if (value.done === true) done = true
    else throw new Error("Unexpected home AI output")
  }
  if (complete && !done) throw new Error("The agent stopped before finishing its home changes.")
  return planSchema.parse(plan)
}
