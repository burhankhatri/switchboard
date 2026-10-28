/**
 * Per-provider daily budgets for the shared credential pools.
 *
 * Budgets scale by plan: `free` gets the base daily budget, `pro` gets 2× that
 * budget (still daily), and `unlimited` is uncapped. The budget *unit* differs
 * by provider — each pool is metered in whatever measure best reflects its cost:
 *   - claude   → "tokens": cache-excluded limited tokens (input + output +
 *                reasoning; see UsageTotals.limitedTokens).
 *   - opencode → "cost": USD spend (tokscale's per-turn cost), since OpenCode
 *                spans many models with wildly different per-token prices.
 *   - gemini   → "messages": number of assistant turns, a simple message cap.
 *
 * The OpenCode figure is set from the TokenUsage ledger (2026-10-28): the whole
 * first two months cost $5.69 in total, and the heaviest real day (2026-10-01,
 * one user, two chats, an approved 40-building enrichment) was about $2.50. The
 * old $0.50 placeholder tripped on that day, two seconds before the hard
 * timeout killed the same turn. Twice the heaviest day leaves room for a long
 * session and still bounds a runaway. The claude and gemini figures remain
 * placeholders: nothing in the ledger has exercised them yet. Omit a provider
 * to leave it unlimited.
 */

import type { ProviderName } from "@switchboard/common"

/** Subscription tier (mirrors Prisma's `Plan` enum). */
export type Plan = "free" | "pro" | "unlimited"

/** Unit a provider's shared-pool budget is measured in. */
export type BudgetUnit = "tokens" | "cost" | "messages"

export interface ProviderBudget {
  unit: BudgetUnit
  /** Daily allowance in the unit: tokens, USD, or message count. */
  limit: number
}

/** Multiplier applied to the free daily budget for `pro` users. */
export const PRO_BUDGET_MULTIPLIER = 2

/** Free-tier daily budget per shared-pool provider, with its unit. */
const FREE_DAILY_BUDGETS: Partial<Record<ProviderName, ProviderBudget>> = {
  // TODO(token-budgets): claude and gemini are still placeholders.
  claude: { unit: "tokens", limit: 100_000 },
  opencode: { unit: "cost", limit: 5 },
  gemini: { unit: "messages", limit: 100 },
}

/**
 * Daily budget descriptor for a provider on a given plan, or null when
 * unlimited (the `unlimited` plan, or a provider with no configured budget).
 * `pro` gets `PRO_BUDGET_MULTIPLIER`× the free budget; `free` gets the base.
 */
export function getProviderBudget(
  provider: ProviderName,
  plan: Plan = "free"
): ProviderBudget | null {
  if (plan === "unlimited") return null
  const base = FREE_DAILY_BUDGETS[provider]
  if (!base) return null
  if (plan === "pro") {
    return { unit: base.unit, limit: base.limit * PRO_BUDGET_MULTIPLIER }
  }
  return base
}

/** Fraction of the daily budget at which the composer starts warning. */
export const BUDGET_WARN_FRACTION = 0.8

function fmtAmount(value: number, unit: BudgetUnit): string {
  if (unit === "cost") return `$${value.toFixed(2)}`
  const n = Math.round(value).toLocaleString("en-US")
  return unit === "tokens" ? `${n} tokens` : `${n} messages`
}

/**
 * One line for the composer once a shared pool is nearly spent, or null while
 * there is nothing to say. The cap used to announce itself only by refusing the
 * send; this tells the person before they start a turn that will be cut short.
 */
export function budgetWarning(pool: {
  used: number
  limit: number | null
  unit: BudgetUnit
}): string | null {
  if (pool.limit == null || pool.limit <= 0) return null
  if (pool.used < pool.limit * BUDGET_WARN_FRACTION) return null
  const used = fmtAmount(pool.used, pool.unit)
  const limit = fmtAmount(pool.limit, pool.unit)
  if (pool.used >= pool.limit) {
    return `Today's shared budget is spent: ${used} of ${limit}. It resets at midnight UTC.`
  }
  const left = fmtAmount(pool.limit - pool.used, pool.unit)
  return `Shared budget: ${used} of ${limit} used today, ${left} left.`
}

/**
 * Daily token budget for a provider on a given plan, or null when the provider
 * isn't metered in tokens (cost/message-based) or is unlimited. Used by the
 * Claude-specific limit display in credential-flags.
 */
export function getDailyTokenBudget(
  provider: ProviderName,
  plan: Plan = "free"
): number | null {
  const b = getProviderBudget(provider, plan)
  return b && b.unit === "tokens" ? b.limit : null
}

/**
 * Free models (mostly OpenCode's free tier) that must NOT count against the
 * shared-pool budget. They're still recorded in the ledger (so they appear in
 * overall totals), just flagged `freeModel=true` and excluded from shared sums.
 *
 * Matching is by tokscale's `model` id: this explicit set OR a `-free`/`:free`
 * suffix (the common convention) — so new free models are auto-caught.
 */
const FREE_MODELS: ReadonlySet<string> = new Set([
  "big-pickle",
  "deepseek-v4-flash-free",
  "nemotron-3-ultra-free",
])

/** Whether a model is free (excluded from shared-pool budgets). */
export function isFreeModel(model: string | null | undefined): boolean {
  if (!model) return false
  const m = model.toLowerCase()
  return FREE_MODELS.has(m) || m.endsWith("-free") || m.endsWith(":free")
}

/** Start of the current UTC day (budget window start for free users). */
export function getStartOfUtcDay(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
}

/** Next UTC midnight (when the daily budget resets). */
export function getNextUtcDayReset(now: Date = new Date()): Date {
  return new Date(getStartOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000)
}

/** Start of the current ISO week (Monday 00:00 UTC) — Pro usage window. */
export function getStartOfUtcWeek(now: Date = new Date()): Date {
  const dayOfWeek = now.getUTCDay() // 0=Sun, 1=Mon, …
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceMonday
    )
  )
}

/** Next Monday 00:00 UTC. */
export function getNextUtcWeekReset(now: Date = new Date()): Date {
  return new Date(getStartOfUtcWeek(now).getTime() + 7 * 24 * 60 * 60 * 1000)
}
