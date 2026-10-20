import { describe, expect, it } from "vitest"
import { createInitialState, createScenario } from "@/lib/data/scenario"
import { resolveTurn } from "@/lib/engine/turn"
import { decideFortnight, standing } from "@/lib/engine/victory"

describe("victory", () => {
  it("opens the long campaign on 4 June and closes it on 31 December", () => {
    const state = createInitialState()
    expect(state.date).toBe("4 June 1915")
    expect(standing(state).available).toBe(13)
    expect(standing(state).next?.name).toBe("Warsaw")
    state.turn = 15
    state.date = "31 December 1915"
    const result = decideFortnight(state)
    expect(result?.grade).toBe("draw")
  })

  it("grades a captured Warsaw as marginal and a clean sweep on time as brilliant", () => {
    const state = createInitialState()
    state.turn = 15
    const warsaw = state.provinces.find((province) => province.id === "warszawa")!
    warsaw.controller = "central"
    state.capturedOn.warszawa = 5
    expect(decideFortnight(state)?.grade).toBe("marginal")

    for (const id of ["warszawa", "lublin", "kaunas", "bialystok", "wilno", "lodz"]) {
      const province = state.provinces.find((item) => item.id === id)!
      province.controller = "central"
      state.capturedOn[id] = id === "lodz" ? 4 : { warszawa: 5, lublin: 6, kaunas: 6, bialystok: 7, wilno: 8 }[id]!
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
    expect(played.state.date).toBe("4 June 1915")
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
