import { describe, expect, it } from "vitest"
import { createInitialState, createScenario } from "@/lib/data/scenario"
import { resolveTurn } from "@/lib/engine/turn"
import { decideFortnight, standing } from "@/lib/engine/victory"

describe("victory", () => {
  it("opens Gorlice–Tarnów on 2 May and closes it on 11 July", () => {
    const state = createInitialState()
    expect(state.date).toBe("2 May 1915")
    expect(standing(state).available).toBe(7)
    expect(standing(state).next?.name).toBe("Kielce")
    state.turn = 5
    state.date = "11 July 1915"
    const result = decideFortnight(state)
    expect(result?.grade).toBe("draw")
  })

  it("grades Kielce alone as marginal and a clean sweep on time as brilliant", () => {
    const state = createInitialState()
    state.turn = 5
    const kielce = state.provinces.find((province) => province.id === "kielce")!
    kielce.controller = "central"
    state.capturedOn.kielce = 1
    expect(decideFortnight(state)?.grade).toBe("marginal")

    for (const id of ["kielce", "lublin", "wolyn"] as const) {
      const province = state.provinces.find((item) => item.id === id)!
      province.controller = "central"
      state.capturedOn[id] = { kielce: 1, lublin: 3, wolyn: 5 }[id]
    }
    expect(decideFortnight(state)?.grade).toBe("brilliant")
    state.provinces.find((province) => province.id === "krakow")!.controller = "russia"
    state.homeLost = true
    expect(decideFortnight(structuredClone(state))?.grade).toBe("defeat")
  })

  it("ends at once when Russia holds two home cities", () => {
    const state = createInitialState()
    state.provinces.find((province) => province.id === "krakow")!.controller = "russia"
    state.provinces.find((province) => province.id === "lwow")!.controller = "russia"
    const played = resolveTurn(state, { narration: "x", proposals: [], events: [], diplomacy: [] })
    expect(played.state.result?.grade).toBe("defeat")
    expect(played.state.result?.sudden).toBe(true)
    expect(played.state.turn).toBe(0)
    expect(played.state.date).toBe("2 May 1915")
    expect(played.record.logistics.some((line) => line.includes("Sudden") || line.includes("sues"))).toBe(true)
  })

  it("gives Gorlice six fortnights from 2 May and its own objectives", () => {
    const state = createScenario("gorlice")
    expect(state.date).toBe("2 May 1915")
    expect(standing(state).available).toBe(7)
    expect(standing(state).next?.name).toBe("Kielce")
    state.turn = 5
    const kielce = state.provinces.find((province) => province.id === "kielce")!
    kielce.controller = "central"
    state.capturedOn.kielce = 1
    expect(decideFortnight(state)?.grade).toBe("marginal")
    state.date = "11 July 1915"
    const closed = resolveTurn(state, { narration: "x", proposals: [], events: [], diplomacy: [] })
    expect(closed.state.result?.grade).toBe("marginal")
    expect(closed.state.turn).toBe(5)
    expect(closed.state.date).toBe("11 July 1915")
  })
})
