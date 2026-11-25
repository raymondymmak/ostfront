import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { formatDate } from "@/lib/format"
import { renderAdvisorGameFacts } from "@/lib/gm/advisor-game-facts"
import { staffMap } from "@/lib/gm/advisor"
import { legalTargets } from "@/lib/ui/legal-targets"

describe("advisor game facts", () => {
  it("emits 5–8 compact engine lines with fortnight calendar", () => {
    const state = createInitialState()
    state.turn = 4
    state.date = formatDate(4)
    const map = staffMap(state)
    const lines = renderAdvisorGameFacts(map, [], "krakow")
    expect(lines.length).toBeGreaterThanOrEqual(5)
    expect(lines.length).toBeLessThanOrEqual(8)
    const blob = lines.join("\n").toLowerCase()
    expect(blob).toContain("fortnight 5 of 6")
    expect(blob).toContain("11 july")
    expect(blob).toContain("krak")
  })

  it("lists orderable attack neighbors from Kraków", () => {
    const map = staffMap(createInitialState())
    const targets = legalTargets(map, "krakow", [])
    const lines = renderAdvisorGameFacts(map, [], "krakow")
    const legalLine = lines.find((line) => line.toLowerCase().includes("from krak"))
    expect(legalLine).toBeTruthy()
    if (targets.attack.length) {
      expect(legalLine!.toLowerCase()).toContain("orderable attack")
    }
  })
})