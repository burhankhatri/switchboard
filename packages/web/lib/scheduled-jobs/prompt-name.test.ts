import { describe, it, expect } from "vitest"
import { scheduleNameFromPrompt } from "./prompt-name"

describe("scheduleNameFromPrompt", () => {
  it("takes the first sentence", () => {
    expect(
      scheduleNameFromPrompt("Audit the live campaigns. Report anything that moved by more than 20%.")
    ).toBe("Audit the live campaigns")
  })

  it("takes the first line when it has no sentence end", () => {
    expect(scheduleNameFromPrompt("Run scripts/campaign_audit.mjs\nThen summarise it")).toBe(
      "Run scripts/campaign_audit.mjs"
    )
  })

  it("skips leading blank lines", () => {
    expect(scheduleNameFromPrompt("\n\n  Check deliverability\n")).toBe("Check deliverability")
  })

  it("strips the markdown a pasted prompt drags in", () => {
    expect(scheduleNameFromPrompt("## **Weekly** audit")).toBe("Weekly audit")
    expect(scheduleNameFromPrompt("- run the `audit` script")).toBe("run the audit script")
  })

  it("truncates on a word boundary and shows that it did", () => {
    const name = scheduleNameFromPrompt(
      "Audit every live Instantly campaign and report the bounce rate, the reply rate and the contact to lead ratio"
    )
    expect(name.length).toBeLessThanOrEqual(60)
    expect(name.endsWith("…")).toBe(true)
    expect(name).not.toMatch(/\s…$/)
  })

  it("returns nothing usable rather than punctuation", () => {
    expect(scheduleNameFromPrompt("   ")).toBe("")
    expect(scheduleNameFromPrompt("###")).toBe("")
  })
})
