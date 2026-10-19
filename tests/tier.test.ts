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
    const kielce = state.provinces.find((province) => province.id === "kielce")!
    const unitIds = kielce.units.map((unit) => unit.id)
    expect(unitIds.length).toBeGreaterThan(0)

    const scored = scoreTurn(state, [
      {
        type: "attack",
        from: "kielce",
        target: "warszawa",
        unitIds,
      },
    ])
    expect(scored.tier).not.toBe("routine")
    expect(scored.score).toBeGreaterThanOrEqual(TIER_THRESHOLDS.important)
  })

  it("marks critical when many attacks stack", () => {
    const state = createInitialState()
    const lemberg = state.provinces.find((province) => province.id === "lwow")!
    const kielce = state.provinces.find((province) => province.id === "kielce")!
    const poznan = state.provinces.find((province) => province.id === "poznan")!
    const orders: PlayerOrder[] = [
      {
        type: "attack",
        from: "lwow",
        target: "lublin",
        unitIds: lemberg.units.slice(0, 4).map((unit) => unit.id),
      },
      {
        type: "attack",
        from: "kielce",
        target: "warszawa",
        unitIds: [kielce.units[0]!.id],
      },
      {
        type: "attack",
        from: "poznan",
        target: "lodz",
        unitIds: [poznan.units[0]!.id],
      },
    ]
    expect(tier(state, orders)).toBe("critical")
  })
})
