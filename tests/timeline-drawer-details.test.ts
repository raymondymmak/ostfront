import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { logisticsForPhase } from "@/lib/finale"

describe("Log drawer Details", () => {
  it("renders TurnDetails with full logistics (not omitted)", () => {
    const chronicle = readFileSync("components/timeline-panel.tsx", "utf8")
    expect(chronicle).not.toContain("includeLogistics={false}")
  })

  it("shows logistics rows that the compact summary drops", () => {
    const logistics = [
      "Kraków drops below supply 30. Its formations cannot advance next fortnight.",
      "Warsaw: entrenchment complete.",
      "Recruits arrive in Lemberg.",
    ]
    const phase = "playing" as const
    const filtered = logisticsForPhase(logistics, phase)
    expect(filtered).toEqual(logistics)
  })
})