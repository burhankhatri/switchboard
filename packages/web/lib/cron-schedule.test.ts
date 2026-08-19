import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Minutes between runs for the cron expressions this repo actually uses. */
function everyNMinutes(schedule: string): number {
  const minute = schedule.trim().split(/\s+/)[0]
  if (minute === "*") return 1
  const step = minute.match(/^\*\/(\d+)$/)
  if (step) return Number(step[1])
  return 60 // a fixed minute, e.g. "0" — once an hour
}

/**
 * A cron schedule is a line item on the database bill.
 *
 * Neon suspends a compute after five minutes without a query, and every tick of
 * agent-lifecycle queries Postgres. At "* * * * *" the production database
 * never suspended — it billed .25-2 CU around the clock with nobody using the
 * app, which is what a surprise bill for an idle project is made of.
 *
 * Ten minutes is the floor because that is also the shortest interval a
 * scheduled job can have (ScheduleFields: "Interval must be at least 10
 * minutes"), so a faster cron cannot make any job more punctual — it can only
 * cost more. If you need a tighter loop, the thing to change is what keeps the
 * compute awake, not this number.
 */
describe("cron schedules", () => {
  const config = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "vercel.json"), "utf8")
  ) as { crons?: { path: string; schedule: string }[] }

  it("has crons configured", () => {
    expect(config.crons?.length).toBeGreaterThan(0)
  })

  it("never polls the database faster than it can suspend", () => {
    for (const cron of config.crons ?? []) {
      expect(
        everyNMinutes(cron.schedule),
        `${cron.path} runs every ${everyNMinutes(cron.schedule)}min — under 10 keeps Neon awake 24/7`
      ).toBeGreaterThanOrEqual(10)
    }
  })

  it("parses the expressions it is asked to judge", () => {
    expect(everyNMinutes("* * * * *")).toBe(1)
    expect(everyNMinutes("*/10 * * * *")).toBe(10)
    expect(everyNMinutes("0 * * * *")).toBe(60)
  })
})
