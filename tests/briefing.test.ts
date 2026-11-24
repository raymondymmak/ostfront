import { describe, expect, it } from "vitest"
import { BRIEFING } from "@/lib/data/scenario"
import { scenarioSpec } from "@/lib/data/objectives"
import { scenarioDate } from "@/lib/format"
import { campaignGoalLine } from "@/lib/ui/goal-copy"

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

describe("opening briefing", () => {
  it("keeps the long copy behind More, with a short goal line on the bar", () => {
    const goal = campaignGoalLine("gorlice")
    expect(BRIEFING).toHaveLength(4)
    expect(words(BRIEFING.join(" ")).length).toBeLessThanOrEqual(230)
    expect(words(goal).length).toBeLessThanOrEqual(35)
    for (const phrase of ["Lemberg", "13 June", "Kraków"]) {
      expect(goal).toContain(phrase)
    }
    expect(goal).toMatch(/Take Lemberg by 13 June;/)
    expect(goal).not.toMatch(/13 June Then/)
    expect(goal).toBe(
      "Take Lemberg by 13 June; Volhynia by 27 June; Lublin by 11 July. Never lose Kraków.",
    )
    expect(goal).not.toContain("Dimitriev")
    expect(goal).not.toContain("XXI Corps")
    expect(goal).not.toContain("4 VP")
  })

  it("uses the same par dates as the scenario objectives", () => {
    const goal = campaignGoalLine("gorlice")
    for (const objective of scenarioSpec("gorlice").objectives) {
      if (objective.side !== "eastern" || objective.parTurn == null) continue
      const date = scenarioDate("gorlice", objective.parTurn).replace(/ 1915$/, "")
      expect(goal).toContain(date)
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
