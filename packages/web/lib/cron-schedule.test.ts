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
 * A cron schedule is a line item on the database bill, so changing one is a
 * decision rather than a tweak. These tests assert the exact schedules, which
 * means a change to vercel.json cannot land without someone editing this file
 * and reading what follows.
 *
 * The history, because it will come up again: agent-lifecycle ran at
 * "* * * * *", and Neon suspends a compute only after five minutes without a
 * query. Every tick queries Postgres, so the production database never
 * suspended — it billed .25-2 CU around the clock with nobody using the app.
 * It was moved to a 30-minute tick for that reason.
 *
 * It is back at every minute deliberately. A job set to run at 9am should run
 * at 9am, and at a 30-minute tick the honest description of "every day at 9" was "some
 * time in the next half hour". The cost is real and accepted: assume the
 * compute never suspends. If that becomes the problem again, the fix is to
 * change what keeps it awake — a cheaper readiness check, or a scheduler that
 * is not the database — rather than making every job late again.
 */
describe("cron schedules", () => {
  const config = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "vercel.json"), "utf8")
  ) as { crons?: { path: string; schedule: string }[] }

  const scheduleFor = (path: string) =>
    config.crons?.find((c) => c.path === path)?.schedule

  it("has crons configured", () => {
    expect(config.crons?.length).toBeGreaterThan(0)
  })

  it("runs agent-lifecycle every minute, deliberately", () => {
    const schedule = scheduleFor("/api/cron/agent-lifecycle")
    expect(schedule, "agent-lifecycle cron is missing from vercel.json").toBeDefined()
    expect(
      everyNMinutes(schedule!),
      "changing this means the database never suspends — read the note above first"
    ).toBe(1)
  })

  it("refreshes Claude credentials hourly", () => {
    // Nothing about this one needs to be fast; it exists so a token does not
    // go stale, and an hourly tick is free next to the one above.
    expect(everyNMinutes(scheduleFor("/api/cron/refresh-claude-creds")!)).toBe(60)
  })

  it("parses the expressions it is asked to judge", () => {
    expect(everyNMinutes("* * * * *")).toBe(1)
    expect(everyNMinutes("*/10 * * * *")).toBe(10)
    expect(everyNMinutes("0 * * * *")).toBe(60)
  })
})
