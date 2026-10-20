import { describe, expect, it } from "vitest"
import { createInitialState, createScenario } from "@/lib/data/scenario"
import { resolveTurn } from "@/lib/engine/turn"
import { decideFortnight, standing } from "@/lib/engine/victory"

describe("victory", () => {
  it("opens Gorlice–Tarnów on 2 May and closes it on 11 July", () => {
    const state = createInitialState()
    expect(state.date).toBe("2 May 1915")
    expect(standing(state).available).toBe(9)
    expect(standing(state).next?.name).toBe("Lemberg")
    expect(standing(state).next?.date).toBe("13 June 1915")
    state.turn = 5
    state.date = "11 July 1915"
    const result = decideFortnight(state)
    expect(result?.grade).toBe("draw")
  })

  it("grades Lublin alone as marginal and a clean sweep on time as brilliant", () => {
    const state = createInitialState()
    state.turn = 5
    const lublin = state.provinces.find((province) => province.id === "lublin")!
    lublin.controller = "central"
    state.capturedOn.lublin = 2
    expect(decideFortnight(state)?.grade).toBe("marginal")

    const taken = { lwow: 2, lublin: 4, wolyn: 3 }
    for (const id of ["lwow", "lublin", "wolyn"] as const) {
      const province = state.provinces.find((item) => item.id === id)!
      province.controller = "central"
      state.capturedOn[id] = taken[id]
    }
    expect(decideFortnight(state)?.grade).toBe("brilliant")
    state.provinces.find((province) => province.id === "krakow")!.controller = "russia"
    state.homeLost = true
    expect(decideFortnight(structuredClone(state))?.grade).toBe("defeat")
  })

  it("does not sudden-death because Lemberg starts Russian, and loses Kraków at the end", () => {
    const state = createInitialState()
    expect(state.provinces.find((province) => province.id === "lwow")!.controller).toBe("russia")
    const played = resolveTurn(state, { narration: "x", proposals: [], events: [], diplomacy: [] })
    expect(played.state.result).toBeNull()
    expect(played.state.homeLost).toBe(false)

    const closed = createInitialState()
    closed.turn = 5
    closed.date = "11 July 1915"
    closed.provinces.find((province) => province.id === "krakow")!.controller = "russia"
    const result = decideFortnight(closed)
    expect(result?.grade).toBe("defeat")
    expect(result?.sudden).toBe(false)
  })

  it("gives Gorlice six fortnights from 2 May and its own objectives", () => {
    const state = createScenario("gorlice")
    expect(state.date).toBe("2 May 1915")
    expect(standing(state).available).toBe(9)
    expect(standing(state).next?.name).toBe("Lemberg")
    state.turn = 5
    const lublin = state.provinces.find((province) => province.id === "lublin")!
    lublin.controller = "central"
    state.capturedOn.lublin = 2
    expect(decideFortnight(state)?.grade).toBe("marginal")
    state.date = "11 July 1915"
    const closed = resolveTurn(state, { narration: "x", proposals: [], events: [], diplomacy: [] })
    expect(closed.state.result?.grade).toBe("marginal")
    expect(closed.state.turn).toBe(5)
    expect(closed.state.date).toBe("11 July 1915")
  })
})
