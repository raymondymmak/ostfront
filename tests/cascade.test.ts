import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import {
  planCascade,
  shouldEscalateOnRejections,
} from "@/lib/gm/cascade"
import { formatGmDebug } from "@/lib/gm/debug"
import { classifyLlmError, resolveLlmModels, type LlmFailure } from "@/lib/gm/llm"
import type { PlayerOrder } from "@/lib/types"

function failed(partial: Partial<LlmFailure> & Pick<LlmFailure, "kind" | "latencyMs" | "abortReason">): LlmFailure {
  return {
    ok: false,
    message: partial.abortReason,
    httpStatus: null,
    content: partial.kind === "empty" ? "empty" : partial.kind === "zod" ? "present" : "n/a",
    ...partial,
  }
}

describe("cascade planning", () => {
  beforeEach(() => {
    delete process.env.LLM_MODEL_STRONG
    process.env.LLM_MODEL = "cheap-model"
  })

  it("uses the cheap model for routine turns when no strong model is set", () => {
    const state = createInitialState()
    const plan = planCascade(state, [], resolveLlmModels())
    expect(plan.tier).toBe("routine")
    expect(plan.primaryModel).toBe("cheap-model")
    expect(plan.mayEscalate).toBe(false)
  })

  it("starts on the strong model for important turns when configured", () => {
    process.env.LLM_MODEL_STRONG = "strong-model"
    const state = createInitialState()
    const kielce = state.provinces.find((province) => province.id === "kielce")!
    const orders: PlayerOrder[] = [
      {
        type: "attack",
        from: "kielce",
        target: "warszawa",
        unitIds: kielce.units.map((unit) => unit.id),
      },
    ]
    const plan = planCascade(state, orders, resolveLlmModels())
    expect(plan.tier).not.toBe("routine")
    expect(plan.primaryModel).toBe("strong-model")
    expect(plan.mayEscalate).toBe(false)
  })

  it("allows one escalation from cheap to strong on routine turns", () => {
    process.env.LLM_MODEL_STRONG = "strong-model"
    const state = createInitialState()
    const plan = planCascade(state, [], resolveLlmModels())
    expect(plan.primaryModel).toBe("cheap-model")
    expect(plan.mayEscalate).toBe(true)
    expect(plan.escalationModel).toBe("strong-model")
  })

  it("escalates when rejection rate exceeds the threshold", () => {
    expect(shouldEscalateOnRejections(0.31)).toBe(true)
    expect(shouldEscalateOnRejections(0.3)).toBe(false)
    expect(shouldEscalateOnRejections(0)).toBe(false)
  })
})

describe("fetchGmWithCascade", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.LLM_API_KEY = "test-key"
    process.env.LLM_MODEL = "cheap-model"
    delete process.env.LLM_MODEL_STRONG
  })

  it("does not call the model twice when the first reply is valid", async () => {
    const llm = await import("@/lib/gm/llm")
    const spy = vi.spyOn(llm, "llmAiTurn").mockResolvedValue({
      ok: true,
      turn: {
        narration: "Staff notes.",
        proposals: [],
        events: [],
        diplomacy: [],
      },
      latencyMs: 12,
      zodIssueCount: 0,
    })

    const { fetchGmWithCascade } = await import("@/lib/gm/cascade")
    const state = createInitialState()
    const result = await fetchGmWithCascade(state, [], { proposals: [], notes: [] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warning).toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it("names a timeout on the LLM path and keeps the staff-simulation fallback", async () => {
    const llm = await import("@/lib/gm/llm")
    vi.spyOn(llm, "llmAiTurn").mockResolvedValue(
      failed({
        kind: "timeout",
        latencyMs: 14002,
        abortReason: "The operation was aborted due to timeout",
      }),
    )
    const { playTurn } = await import("@/lib/gm")
    const { record } = await playTurn(createInitialState(), [])
    expect(record.gmSource).toBe("mock")
    expect(record.warning).toBe(
      "The game master could not be reached (timeout). The staff simulation took the turn.",
    )
    expect(record.gmDebug).toBe(
      "debug: path llm · abort: The operation was aborted due to timeout · 14002ms · model cheap-model (LLM_MODEL) · http none · content n/a · fallback staff simulation",
    )
  })

  it("records the HTTP status and an empty body without the response payload", async () => {
    const llm = await import("@/lib/gm/llm")
    vi.spyOn(llm, "llmAiTurn").mockResolvedValue(
      failed({
        kind: "http",
        latencyMs: 420,
        httpStatus: 502,
        content: "n/a",
        abortReason: "LLM HTTP 502",
        message: "LLM HTTP 502",
      }),
    )
    const { playTurn } = await import("@/lib/gm")
    const { record } = await playTurn(createInitialState(), [])
    expect(record.warning).toBe(
      "The game master could not be reached (HTTP 502). The staff simulation took the turn.",
    )
    expect(record.gmDebug).toContain("path llm")
    expect(record.gmDebug).toContain("http 502")
    expect(record.gmDebug).toContain("420ms")
    expect(record.gmDebug).toContain("model cheap-model (LLM_MODEL)")
    expect(record.gmDebug).toContain("content n/a")
    expect(record.gmDebug).toContain("fallback staff simulation")
    expect(record.gmDebug).not.toMatch(/sk-|Bearer|LLM_API_KEY/)
  })

  it("marks null content as empty", async () => {
    const llm = await import("@/lib/gm/llm")
    vi.spyOn(llm, "llmAiTurn").mockResolvedValue(
      failed({
        kind: "empty",
        latencyMs: 800,
        content: "empty",
        abortReason: "empty message",
      }),
    )
    const { playTurn } = await import("@/lib/gm")
    const { record } = await playTurn(createInitialState(), [])
    expect(record.warning).toBe(
      "The game master could not be reached (empty response). The staff simulation took the turn.",
    )
    expect(record.gmDebug).toContain("content empty")
    expect(record.gmDebug).toContain("800ms")
    expect(record.gmDebug).toContain("fallback staff simulation")
  })

  it("labels a failed strong-model retry as the cascade path", async () => {
    process.env.LLM_MODEL_STRONG = "strong-model"
    const llm = await import("@/lib/gm/llm")
    vi.spyOn(llm, "llmAiTurn")
      .mockResolvedValueOnce(
        failed({
          kind: "zod",
          latencyMs: 1100,
          content: "present",
          abortReason: "LLM JSON failed validation",
          zodIssueCount: 2,
        }),
      )
      .mockResolvedValueOnce(
        failed({
          kind: "timeout",
          latencyMs: 9000,
          abortReason: "The operation was aborted due to timeout",
        }),
      )
    const { playTurn } = await import("@/lib/gm")
    const { record } = await playTurn(createInitialState(), [])
    expect(record.warning).toBe(
      "Game master could not produce valid JSON. The staff simulation took the turn.",
    )
    expect(record.gmDebug).toBe(
      "debug: path cascade · abort: The operation was aborted due to timeout (after zod) · 10100ms · model strong-model (LLM_MODEL_STRONG) · http none · content n/a · fallback staff simulation",
    )
  })

  it("leaves the chronicle quiet when the model answers", async () => {
    const llm = await import("@/lib/gm/llm")
    vi.spyOn(llm, "llmAiTurn").mockResolvedValue({
      ok: true,
      turn: { narration: "Staff notes.", proposals: [], events: [], diplomacy: [] },
      latencyMs: 30,
      zodIssueCount: 0,
    })
    const { playTurn } = await import("@/lib/gm")
    const { record } = await playTurn(createInitialState(), [])
    expect(record.gmSource).toBe("llm")
    expect(record.warning).toBeUndefined()
    expect(record.gmDebug).toBeUndefined()
  })
})

describe("gm failure debug", () => {
  it("classifies an abort timeout and strips secrets from an HTTP body", () => {
    const aborted = new Error("The operation was aborted due to timeout")
    aborted.name = "AbortError"
    const timeout = classifyLlmError(aborted, 14002)
    expect(timeout.kind).toBe("timeout")
    expect(timeout.abortReason).toBe("The operation was aborted due to timeout")
    expect(timeout.httpStatus).toBeNull()
    expect(timeout.content).toBe("n/a")
    expect(timeout.latencyMs).toBe(14002)

    const leaked = new Error('LLM HTTP 401: {"api_key":"sk-supersecretvalue","prompt":"system"}')
    const http = classifyLlmError(leaked, 90)
    expect(http.kind).toBe("http")
    expect(http.httpStatus).toBe(401)
    expect(http.abortReason).toBe("LLM HTTP 401")
    expect(JSON.stringify(http)).not.toContain("sk-")
    expect(JSON.stringify(http)).not.toContain("prompt")

    const empty = classifyLlmError(new Error("LLM returned an empty message"), 15)
    expect(empty.kind).toBe("empty")
    expect(empty.content).toBe("empty")
  })

  it("redacts keys inside the player-facing debug line", () => {
    const line = formatGmDebug({
      path: "llm",
      reason: "LLM HTTP 401: Bearer sk-supersecretvalue",
      elapsedMs: 12.6,
      model: "gpt-4o-mini",
      modelEnv: "LLM_MODEL",
      httpStatus: 401,
      content: "n/a",
      fallback: "staff-simulation",
    })
    expect(line).toContain("path llm")
    expect(line).toContain("13ms")
    expect(line).toContain("model gpt-4o-mini (LLM_MODEL)")
    expect(line).toContain("http 401")
    expect(line).toContain("content n/a")
    expect(line).toContain("fallback staff simulation")
    expect(line).not.toContain("sk-")
    expect(line).not.toContain("Bearer sk-")
    expect(line).toContain("[redacted]")
  })
})
