/**
 * Game-master clocks.
 *
 * Fluid Compute allows 300s on Hobby and 800s on Pro. The function limit is
 * 120s so a slow model still returns, staff fallback included, with margin.
 * Two calls of 45s fit in the 90s budget, and the budget fits in the function.
 */

export const TURN_MAX_DURATION_SEC = 120
export const DEFAULT_LLM_TIMEOUT_MS = 45_000
export const DEFAULT_GM_BUDGET_MS = 90_000

/** Browser wait. Longer than the function so the server answers first. */
export const CLIENT_TURN_TIMEOUT_MS = 130_000

const MIN_MS = 3_000
const MAX_LLM_TIMEOUT_MS = 50_000
const MAX_GM_BUDGET_MS = 100_000

type TimeoutEnv = {
  LLM_TIMEOUT_MS?: string
  GM_BUDGET_MS?: string
}

function timeoutEnv(): TimeoutEnv {
  return {
    LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
    GM_BUDGET_MS: process.env.GM_BUDGET_MS,
  }
}

export function resolveLlmTimeoutMs(env: TimeoutEnv = timeoutEnv()): number {
  return readMs(env.LLM_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS, MIN_MS, MAX_LLM_TIMEOUT_MS)
}

export function resolveGmBudgetMs(env: TimeoutEnv = timeoutEnv()): number {
  const call = resolveLlmTimeoutMs(env)
  const budget = readMs(env.GM_BUDGET_MS, DEFAULT_GM_BUDGET_MS, MIN_MS, MAX_GM_BUDGET_MS)
  return Math.max(budget, call)
}

/** Cap one model attempt by the per-call limit and the time still left in the budget. */
export function callTimeoutMs(remainingMs: number, anotherMayFollow: boolean, callCap: number): number {
  if (anotherMayFollow) {
    const half = Math.floor(remainingMs / 2)
    return Math.min(callCap, Math.max(MIN_MS, half))
  }
  return Math.min(callCap, Math.max(MIN_MS, remainingMs))
}

function readMs(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}
