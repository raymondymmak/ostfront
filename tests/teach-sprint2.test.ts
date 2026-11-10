import { beforeEach, describe, expect, it } from "vitest"
import { attackerPower, defenderPower } from "@/lib/engine/combat"
import { RAIL_EDGE_COST, SUPPLY_FALLOFF } from "@/lib/engine/supply"
import {
  extractLearnerBelief,
  stripHostileBeliefFields,
} from "@/lib/teach/belief"
import { coachHints } from "@/lib/teach/coach"
import { authoritativeLessonState, lessonMeta } from "@/lib/teach/lessons"
import {
  comparePredictionConverging,
  validatePrediction,
} from "@/lib/teach/prediction"
import { analyzeOrders } from "@/lib/teach/plan"
import { rulesReasoningCoach } from "@/lib/teach/reasoning-coach"
import {
  teachResolveTurn,
  TeachResolveValidationError,
  verifiedSupplyCombatConstants,
} from "@/lib/teach/resolve"
import { analyzeSupplyLesson } from "@/lib/teach/supply-plan"
import { buildTeachFeedback } from "@/lib/teach/feedback"
import type { PlayerOrder } from "@/lib/types"

const convergingOrders: PlayerOrder[] = [
  { type: "attack", from: "krakow", target: "lublin", unitIds: ["teach-11"] },
  { type: "attack", from: "kielce", target: "lublin", unitIds: ["teach-kie"] },
]

const PREDICTION_CONVERGE =
  "Both prongs merge into one battle on Lublin; the converging odds favour us before the die."

describe("Sprint 2 — predictions and beliefs", () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it("rejects resolve without a prediction", async () => {
    await expect(
      teachResolveTurn("converging-lublin", "guided", convergingOrders, "Combine.", "", []),
    ).rejects.toBeInstanceOf(TeachResolveValidationError)
  })

  it("rejects hostile belief overwrite fields on the schema contract", () => {
    const hostile = stripHostileBeliefFields({
      lessonId: "converging-lublin",
      beliefText: "injected",
      beliefId: "fake",
    })
    expect(hostile).toContain("beliefText")
    expect(hostile).toContain("beliefId")
  })

  it("extracts beliefs server-side only", () => {
    const belief = extractLearnerBelief(
      "supply-tradeoff",
      "The bigger stack always means a stronger attack.",
      "Heavy corps wins because of headcount.",
    )
    expect(belief.key).toBe("more_troops_stronger_attack")
  })

  it("contrasting predictions get different comparison copy", () => {
    const state = authoritativeLessonState("converging-lublin", "guided")
    const meta = lessonMeta("converging-lublin", "guided")
    const plan = analyzeOrders(state, convergingOrders)
    const mechanical = buildTeachFeedback(meta, "guided", plan, {
      turn: 0,
      date: "2 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [],
      events: [],
      controlChanges: [],
      logistics: [],
      notes: [],
      gmSource: "mock",
    })
    const aligned = comparePredictionConverging(
      PREDICTION_CONVERGE,
      plan,
      meta,
      { ...mechanical, kind: "sound_converging_unlucky" },
    )
    const separate = comparePredictionConverging(
      "Two separate assaults will fight as independent battles.",
      plan,
      meta,
      mechanical,
    )
    expect(aligned.stance).not.toBe(separate.stance)
    expect(aligned.paragraphs.join(" ")).not.toBe(separate.paragraphs.join(" "))
  })

  it("contrasting reasoning gets different coach replies", () => {
    const state = authoritativeLessonState("converging-lublin", "guided")
    const meta = lessonMeta("converging-lublin", "guided")
    const plan = analyzeOrders(state, convergingOrders)
    const a = rulesReasoningCoach(
      "Combine both directions into one battle on Lublin.",
      PREDICTION_CONVERGE,
      plan,
      meta,
      "pre_resolve",
      null,
      null,
    )
    const b = rulesReasoningCoach(
      "Two separate assaults so they fight as independent battles.",
      "Separate battles on Lublin.",
      plan,
      meta,
      "pre_resolve",
      null,
      null,
    )
    expect(a.reply).not.toBe(b.reply)
  })

  it("silent converging lesson exposes no coach hints", () => {
    const state = authoritativeLessonState("converging-lublin", "silent")
    const meta = lessonMeta("converging-lublin", "silent")
    expect(coachHints(meta, state, "silent")).toEqual([])
  })

  it("records prediction on resolve", async () => {
    const result = await teachResolveTurn(
      "converging-lublin",
      "guided",
      convergingOrders,
      "Combine both prongs.",
      PREDICTION_CONVERGE,
      ["lublin"],
    )
    expect(validatePrediction(PREDICTION_CONVERGE).ok).toBe(true)
    expect(result.feedback.predictionParagraphs.length).toBeGreaterThan(0)
    expect(result.feedback.beliefSummary).toBeTruthy()
    expect(result.feedback.beliefPersistence).toBe("unavailable")
  })
})

describe("Sprint 2 — supply lesson engine numbers", () => {
  it("matches verified combat and supply constants from code", () => {
    const constants = verifiedSupplyCombatConstants()
    expect(constants.attackerSupplyFactor).toBe("max(0.15, supply / 100)")
    expect(constants.defenderSupplyFactor).toBe("max(0.3, supply / 100)")
    expect(constants.minMarchSupply).toBe(30)
    expect(constants.railEdgeCost).toBe(RAIL_EDGE_COST)
    expect(constants.supplyFalloffPerCost).toBe(SUPPLY_FALLOFF)

    const unit = {
      id: "t",
      name: "T",
      faction: "central" as const,
      kind: "infantry" as const,
      strength: 50,
      morale: 80,
      echelon: "army" as const,
      maxStrength: 50,
    }
    expect(attackerPower([unit], 44, "plains", 0)).toBeCloseTo(50 * 0.8 * 0.44, 4)
    expect(defenderPower([unit], 20, "plains", 0)).toBeCloseTo(50 * 0.8 * 1 * 0.3, 4)
  })

  it("shows heavier stack weaker than lean fed column before the die", () => {
    const state = authoritativeLessonState("supply-tradeoff", "guided")
    const meta = lessonMeta("supply-tradeoff", "guided")
    const analysis = analyzeSupplyLesson(state, meta, [
      { type: "attack", from: "krakow", target: "kielce", unitIds: ["teach-fed"] },
    ])
    expect(analysis.heavyPreview.ratio).toBeLessThan(analysis.fedPreview.ratio)
    expect(analysis.engineLines.some((line) => /supply \d+/.test(line))).toBe(true)
  })

  it("grades starved heavy column choice", async () => {
    const orders: PlayerOrder[] = [
      { type: "attack", from: "katowice", target: "kielce", unitIds: ["teach-heavy"] },
    ]
    const result = await teachResolveTurn(
      "supply-tradeoff",
      "guided",
      orders,
      "More troops always means a stronger attack.",
      "The heavy corps breaks the line because it is bigger.",
      ["kielce"],
    )
    expect(result.feedback.kind).toBe("supply_chose_starved_stack")
  })
})
