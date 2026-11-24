import { describe, expect, it } from "vitest"
import type { TeachFeedback } from "@/lib/teach/feedback"
import { comparePredictionSupply } from "@/lib/teach/prediction"
import type { SupplyPlanAnalysis } from "@/lib/teach/supply-plan"

function engagementPreview(ratio: number) {
  return {
    attack: 10 * ratio,
    defense: 10,
    ratio,
    empty: false,
    origins: 1,
    encircled: false,
    multiplier: 1,
  }
}

function supplyPlan(overrides: Partial<SupplyPlanAnalysis> = {}): SupplyPlanAnalysis {
  return {
    heavyFromId: "katowice",
    fedFromId: "krakow",
    targetProvinceId: "kielce",
    chosenFrom: "krakow",
    allInConvergence: false,
    heavyPreview: engagementPreview(0.6),
    fedPreview: engagementPreview(1.4),
    combinedPreview: null,
    engineLines: [],
    ...overrides,
  }
}

function soundFedFeedback(): TeachFeedback {
  return {
    kind: "supply_sound_fed_column",
    headline: "",
    paragraphs: [],
    evidence: [],
    pointers: [],
    coachReply: "",
    coachStance: "",
    coachSource: "rules",
    followUp: null,
    attemptId: null,
    recordPersistence: "unavailable",
    recordPersistenceMessage: null,
    predictionParagraphs: [],
    beliefSummary: null,
    beliefPersistence: null,
  }
}

describe("comparePredictionSupply — sound fed column", () => {
  it("does not accuse a heavy-column choice when the player queued the lean launch", () => {
    const result = comparePredictionSupply(
      "The heavy column breaks through because headcount always wins.",
      supplyPlan(),
      soundFedFeedback(),
    )
    expect(result.paragraphs.join(" ")).not.toMatch(/leaned toward the heavy column/i)
    expect(result.stance).toBe("partial")
  })

  it("marks aligned when prediction and plan both favour the fed column", () => {
    const result = comparePredictionSupply(
      "Kraków's lean corps hits harder thanks to depot supply before the die.",
      supplyPlan(),
      soundFedFeedback(),
    )
    expect(result.stance).toBe("aligned")
  })
})