import { describe, it, expect } from "vitest"
import { BUDGET_WARN_FRACTION, budgetWarning, getProviderBudget } from "./usage-budgets"

/**
 * The OpenCode cap was a $0.50/day placeholder that tripped mid-enrichment on
 * 2026-10-01. The first replacement ($5) was set from a stale copy of the
 * ledger. Production's heaviest real day was $8.45 (2026-10-12), and three
 * user-days exceeded $5, so the budget sits just above that: $10.
 */
describe("shared-pool budgets", () => {
  it("gives OpenCode a $10 daily budget on the free plan", () => {
    expect(getProviderBudget("opencode", "free")).toEqual({ unit: "cost", limit: 10 })
  })

  it("doubles it on pro and lifts it on unlimited", () => {
    expect(getProviderBudget("opencode", "pro")).toEqual({ unit: "cost", limit: 20 })
    expect(getProviderBudget("opencode", "unlimited")).toBeNull()
  })
})

describe("budgetWarning", () => {
  it("is quiet under 80% of the budget", () => {
    expect(BUDGET_WARN_FRACTION).toBe(0.8)
    expect(budgetWarning({ used: 3.9, limit: 5, unit: "cost" })).toBeNull()
  })

  it("would not have warned on the heaviest real day until it was nearly over", () => {
    expect(budgetWarning({ used: 7.9, limit: 10, unit: "cost" })).toBeNull()
    expect(budgetWarning({ used: 8.45, limit: 10, unit: "cost" })).toMatch(/\$1\.55 left/)
  })

  it("warns at 80% with what is used and what is left", () => {
    const text = budgetWarning({ used: 4.1, limit: 5, unit: "cost" })
    expect(text).toContain("$4.10")
    expect(text).toContain("$5.00")
    expect(text).toMatch(/\$0\.90 left/)
  })

  it("says when the budget is spent", () => {
    expect(budgetWarning({ used: 5.2, limit: 5, unit: "cost" })).toMatch(/spent|used up/i)
  })

  it("is quiet with no budget", () => {
    expect(budgetWarning({ used: 100, limit: null, unit: "cost" })).toBeNull()
  })

  it("formats tokens and messages in their own units", () => {
    expect(budgetWarning({ used: 90_000, limit: 100_000, unit: "tokens" })).toContain("90,000 tokens")
    expect(budgetWarning({ used: 85, limit: 100, unit: "messages" })).toContain("85 messages")
  })
})
