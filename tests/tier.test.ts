import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { scoreTurn, tier, TIER_THRESHOLDS } from "@/lib/gm/tier"
import type { PlayerOrder } from "@/lib/types"

describe("tier()", () => {
  it("classifies quiet turns as routine", () => {
    const state = createInitialState()
    expect(tier(state, [])).toBe("routine")
    expect(tier(state, [{ type: "text", text: "Hold the line." }])).toBe("routine")
  })

  it("raises tier when depots or large attacks are involved", () => {
    const state = createInitialState()
    const radom = state.provinces.find((province) => province.id === "radom")!
    const unitIds = radom.units.map((unit) => unit.id)
    expect(unitIds.length).toBeGreaterThan(0)

    const scored = scoreTurn(state, [
      {
        type: "attack",
        from: "radom",
        target: "warsaw",
        unitIds,
      },
    ])
    expect(scored.tier).not.toBe("routine")
    expect(scored.score).toBeGreaterThanOrEqual(TIER_THRESHOLDS.important)
  })

  it("marks critical when many attacks stack", () => {
    const state = createInitialState()
    const przemysl = state.provinces.find((province) => province.id === "przemysl")!
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const tarnow = state.provinces.find((province) => province.id === "tarnow")!
    const orders: PlayerOrder[] = [
      {
        type: "attack",
        from: "przemysl",
        target: "lemberg",
        unitIds: [przemysl.units[0]!.id],
      },
      {
        type: "attack",
        from: "krakow",
        target: "kielce",
        unitIds: [krakow.units[0]!.id],
      },
      {
        type: "attack",
        from: "tarnow",
        target: "przemysl",
        unitIds: [tarnow.units[0]!.id],
      },
    ]
    expect(tier(state, orders)).toBe("critical")
  })
})
