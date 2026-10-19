import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import {
  planCascade,
  shouldEscalateOnRejections,
} from "@/lib/gm/cascade"
import { resolveLlmModels } from "@/lib/gm/llm"
import type { PlayerOrder } from "@/lib/types"

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
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
