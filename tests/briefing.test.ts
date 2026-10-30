import { describe, expect, it } from "vitest"
import { BRIEFING } from "@/lib/data/scenario"
import { scenarioSpec } from "@/lib/data/objectives"
import { scenarioDate } from "@/lib/format"

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

describe("opening briefing", () => {
  it("leads with the task, then the two armies and the map", () => {
    expect(BRIEFING).toHaveLength(4)
    expect(words(BRIEFING.join(" ")).length).toBeLessThanOrEqual(230)
    expect(words(BRIEFING[0]).length).toBeLessThanOrEqual(70)
    for (const phrase of ["Lemberg", "13 June", "Rovno", "27 June", "Lublin", "11 July", "Kraków", "4 VP", "3 VP", "2 VP"]) {
      expect(BRIEFING[0]).toContain(phrase)
    }
    expect(BRIEFING[0]).not.toContain("Dimitriev")
    expect(BRIEFING[0]).not.toContain("XXI Corps")
  })

  it("uses the same par dates as the scenario objectives", () => {
    for (const objective of scenarioSpec("gorlice").objectives) {
      if (objective.side !== "eastern" || objective.parTurn == null) continue
      const date = scenarioDate("gorlice", objective.parTurn).replace(/ 1915$/, "")
      expect(BRIEFING[0]).toContain(date)
    }
  })

  it("keeps the map facts in the last paragraph", () => {
    const notes = BRIEFING[3]
    expect(notes).toMatch(/Przemyśl/)
    expect(notes).toMatch(/Kraków/)
    expect(notes).toMatch(/Lemberg is Austrian soil/)
    expect(notes).toMatch(/Katowice is German/)
    expect(notes).toMatch(/Stanislav and Bukovina are Austro-Hungarian/)
  })
})
