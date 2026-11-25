import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { formatDate } from "@/lib/format"
import { renderAdvisorGameFacts } from "@/lib/gm/advisor-game-facts"
import { staffMap } from "@/lib/gm/advisor"
import { centralEncirclementRiskIds } from "@/lib/ui/encirclement-risk"
import { legalTargets } from "@/lib/ui/legal-targets"
import type { PlayerOrder } from "@/lib/types"

function attackOrder(from: string, target: string, unitIds: string[]): PlayerOrder {
  return { type: "attack", from, target, unitIds }
}

function centralUnitIds(map: ReturnType<typeof staffMap>, provinceId: string): string[] {
  const province = map.provinces.find((item) => item.id === provinceId)
  return province?.units.filter((unit) => unit.faction === "central").map((unit) => unit.id) ?? []
}

describe("advisor game facts", () => {
  it("emits compact engine lines with fortnight calendar", () => {
    const state = createInitialState()
    state.turn = 4
    state.date = formatDate(4)
    const map = staffMap(state)
    const lines = renderAdvisorGameFacts(map, [], "krakow")
    expect(lines.length).toBeGreaterThanOrEqual(5)
    expect(lines.length).toBeLessThanOrEqual(10)
    const blob = lines.join("\n").toLowerCase()
    expect(blob).toContain("fortnight 5 of 6")
    expect(blob).toContain("11 july")
    expect(blob).toContain("krak")
  })

  it("lists orderable attack neighbors from Kraków and never reach-only", () => {
    const map = staffMap(createInitialState())
    const targets = legalTargets(map, "krakow", [])
    const lines = renderAdvisorGameFacts(map, [], "krakow")
    const legalLine = lines.find((line) => line.toLowerCase().includes("from krak"))
    expect(legalLine).toBeTruthy()
    expect(lines.join("\n").toLowerCase()).not.toContain("reach-only")
    if (targets.attack.length) {
      expect(legalLine!.toLowerCase()).toContain("orderable attack")
    }
  })

  it("states queued arrows and UI odds for a Lublin→Warsaw attack", () => {
    const state = structuredClone(createInitialState("normal"))
    const lublin = state.provinces.find((province) => province.id === "lublin")!
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    lublin.controller = "central"
    lublin.supply = 80
    lublin.units = krakow.units.filter((unit) => unit.faction === "central").map((unit) => ({
      ...unit,
      province: "lublin",
    }))
    krakow.units = krakow.units.filter((unit) => unit.faction !== "central")
    const map = staffMap(state)
    const unitIds = centralUnitIds(map, "lublin")
    expect(unitIds.length).toBeGreaterThan(0)
    const queued = [attackOrder("lublin", "warszawa", unitIds)]
    const lines = renderAdvisorGameFacts(map, queued, "lublin")
    const blob = lines.join("\n").toLowerCase()
    expect(blob).toContain("queued arrows")
    expect(blob).toContain("warsaw")
    expect(blob).toContain("orders ui")
    expect(blob).toMatch(/unlikely|even|favourable|undefended/)
    expect(blob).not.toContain("reach-only")
  })

  it("reports supply below 30 and encirclement risk when the board matches", () => {
    const state = structuredClone(createInitialState("normal"))
    const map = staffMap(state)
    const risk = centralEncirclementRiskIds(map)
  const province = map.provinces.find((item) => risk.includes(item.id))
    if (province) {
      province.supply = 25
      const lines = renderAdvisorGameFacts(map, [], province.id)
      const blob = lines.join("\n").toLowerCase()
      expect(blob).toContain("encirclement risk")
      expect(blob).toContain("below supply 30")
    } else {
      const starving = map.provinces.find((item) => item.controller === "central")
      if (!starving) return
      starving.supply = 22
      const lines = renderAdvisorGameFacts(map, [], starving.id)
      expect(lines.join("\n").toLowerCase()).toContain("below supply 30")
    }
  })
})