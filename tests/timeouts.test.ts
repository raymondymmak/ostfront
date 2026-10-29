import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  CLIENT_TURN_TIMEOUT_MS,
  DEFAULT_GM_BUDGET_MS,
  DEFAULT_LLM_TIMEOUT_MS,
  TURN_MAX_DURATION_SEC,
  callTimeoutMs,
  resolveGmBudgetMs,
  resolveLlmTimeoutMs,
} from "@/lib/gm/timeouts"

describe("game master clocks", () => {
  it("defaults to 45s per call and 90s overall, inside a 120s function", () => {
    expect(DEFAULT_LLM_TIMEOUT_MS).toBe(45_000)
    expect(DEFAULT_GM_BUDGET_MS).toBe(90_000)
    expect(TURN_MAX_DURATION_SEC).toBe(120)
    expect(DEFAULT_LLM_TIMEOUT_MS * 2).toBeLessThanOrEqual(DEFAULT_GM_BUDGET_MS)
    expect(DEFAULT_GM_BUDGET_MS).toBeLessThan(TURN_MAX_DURATION_SEC * 1000)
    expect(CLIENT_TURN_TIMEOUT_MS).toBeGreaterThan(TURN_MAX_DURATION_SEC * 1000)
  })

  it("sets the turn and advisor functions to that same limit", () => {
    const turn = readFileSync("app/api/turn/route.ts", "utf8")
    const advisor = readFileSync("app/api/advisor/route.ts", "utf8")
    expect(turn).toContain(`export const maxDuration = ${TURN_MAX_DURATION_SEC}`)
    expect(advisor).toContain(`export const maxDuration = ${TURN_MAX_DURATION_SEC}`)
  })

  it("reads the env overrides and clamps them so two calls still fit", () => {
    expect(resolveLlmTimeoutMs({})).toBe(45_000)
    expect(resolveGmBudgetMs({})).toBe(90_000)
    expect(resolveLlmTimeoutMs({ LLM_TIMEOUT_MS: "12000" })).toBe(12_000)
    expect(resolveGmBudgetMs({ LLM_TIMEOUT_MS: "12000", GM_BUDGET_MS: "60000" })).toBe(60_000)
    expect(resolveLlmTimeoutMs({ LLM_TIMEOUT_MS: "nope" })).toBe(45_000)
    expect(resolveLlmTimeoutMs({ LLM_TIMEOUT_MS: "999999" })).toBe(50_000)
    expect(resolveGmBudgetMs({ GM_BUDGET_MS: "1", LLM_TIMEOUT_MS: "8000" })).toBe(8_000)
    expect(resolveGmBudgetMs({ GM_BUDGET_MS: "999999" })).toBe(100_000)
  })

  it("gives a retry half the remaining budget, capped by the per-call limit", () => {
    expect(callTimeoutMs(90_000, true, 45_000)).toBe(45_000)
    expect(callTimeoutMs(90_000, false, 45_000)).toBe(45_000)
    expect(callTimeoutMs(20_000, false, 45_000)).toBe(20_000)
    expect(callTimeoutMs(20_000, true, 45_000)).toBe(10_000)
    expect(callTimeoutMs(1_000, false, 45_000)).toBe(3_000)
  })
})
