import { describe, expect, it } from "vitest"
import { applySupply, createInitialState } from "@/lib/data/scenario"
import {
  applyProvinceSupplyCapacity,
  effectiveSupplyFromBase,
  provinceSupplyCapacity,
  TERRAIN_SUPPLY_CAPACITY,
} from "@/lib/engine/supply"
import { combinedEngagementOdds } from "@/lib/engine/turn"
import { authoritativeLessonState } from "@/lib/teach/lessons"

describe("province supply capacity", () => {
  it("scales effective supply when garrison exceeds capacity", () => {
    const base = 80
  const cap = 50
    const effective = effectiveSupplyFromBase(base, cap, 100)
    expect(effective).toBe(40)
  })

  it("logs over-capacity on Katowice in the supply lesson", () => {
    const state = authoritativeLessonState("supply-tradeoff", "guided")
    const kat = state.provinces.find((p) => p.id === "katowice")!
    const cap = provinceSupplyCapacity(kat)
    expect(cap).toBe(TERRAIN_SUPPLY_CAPACITY.plains + kat.rail.length * 6)
    expect(kat.units[0].strength).toBeGreaterThan(cap)
    expect(kat.supply).toBeLessThan(44)
  })

  it("makes the lean fed preview stronger than the starved heavy prong alone", () => {
    const state = authoritativeLessonState("supply-tradeoff", "guided")
    const fed = combinedEngagementOdds(state, "kielce", [
      { fromId: "krakow", unitIds: ["teach-fed"] },
    ])!
    const heavy = combinedEngagementOdds(state, "kielce", [
      { fromId: "katowice", unitIds: ["teach-heavy"] },
    ])!
    expect(fed.ratio).toBeGreaterThan(1)
    expect(fed.ratio).toBeGreaterThan(heavy.ratio)
  })
})

describe("applySupply capacity notes", () => {
  it("returns notes for stacked provinces in the campaign", () => {
    const state = createInitialState("normal")
    const krakow = state.provinces.find((p) => p.id === "krakow")!
    const notes = applySupply(state)
    if (krakow.units.reduce((s, u) => s + u.strength, 0) > provinceSupplyCapacity(krakow)) {
      expect(notes.some((n) => n.provinceId === "krakow")).toBe(true)
    }
    const hypothetical = { ...krakow, supply: 0 }
    const note = applyProvinceSupplyCapacity(hypothetical, 70)
    expect(note).not.toBeNull()
  })
})
