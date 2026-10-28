import { describe, it, expect } from "vitest"
import { BUDGET_WARN_FRACTION, budgetWarning, getProviderBudget } from "./usage-budgets"

/**
 * The OpenCode cap was a $0.50/day placeholder. The whole first two months of
 * use cost $5.69 in total, and the one day someone did real work (2026-10-01,
 * about $2.50 across two chats) the cap tripped mid-enrichment, two seconds
 * before the hard timeout killed the turn. The number is now set from the
 * ledger: twice the heaviest real day.
 */
describe("shared-pool budgets", () => {
  it("gives OpenCode a $5 daily budget on the free plan", () => {
    expect(getProviderBudget("opencode", "free")).toEqual({ unit: "cost", limit: 5 })
  })

  it("doubles it on pro and lifts it on unlimited", () => {
    expect(getProviderBudget("opencode", "pro")).toEqual({ unit: "cost", limit: 10 })
    expect(getProviderBudget("opencode", "unlimited")).toBeNull()
  })
})

describe("budgetWarning", () => {
  it("is quiet under 80% of the budget", () => {
    expect(BUDGET_WARN_FRACTION).toBe(0.8)
    expect(budgetWarning({ used: 3.9, limit: 5, unit: "cost" })).toBeNull()
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
