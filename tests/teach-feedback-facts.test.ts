import { describe, expect, it } from "vitest"
import { lessonMeta } from "@/lib/teach/lessons"
import { analyzeOrders } from "@/lib/teach/plan"
import { authoritativeLessonState } from "@/lib/teach/lessons"
import { buildTeachFeedback } from "@/lib/teach/feedback"
import { buildSupplyTeachFeedback } from "@/lib/teach/supply-feedback"
import { analyzeSupplyLesson } from "@/lib/teach/supply-plan"
import { teachResolveTurn } from "@/lib/teach/resolve"
import type { PlayerOrder, TurnRecord } from "@/lib/types"

describe("teach feedback uses BattleFacts, not summary regex", () => {
  it("grades converging misconception path that still loses from structured facts", async () => {
    const orders: PlayerOrder[] = [
      { type: "attack", from: "krakow", target: "lublin", unitIds: ["teach-11"] },
      { type: "attack", from: "kielce", target: "lublin", unitIds: ["teach-kie"] },
    ]
    const result = await teachResolveTurn(
      "converging-lublin",
      "guided",
      orders,
      "Combine both prongs.",
      "Both prongs merge; converging odds favour us before the die.",
      ["lublin"],
    )
    const battle = result.record.resolutions.find((item) => item.battle?.targetId === "lublin")?.battle
    expect(battle).toBeDefined()
    expect(battle!.prongs).toBe(2)
    expect(battle!.roll).toBe(result.combatRoll)
    expect(result.feedback.kind).toBe("sound_converging_unlucky")
    expect(result.feedback.evidence.join(" ")).toMatch(/odds [\d.]+ on die roll/)
    expect(result.feedback.evidence.join(" ")).not.toMatch(/succeeds|fails/)
    expect(battle!.attackerWon).toBe(false)
  })

  it("buildTeachFeedback matches grades when facts are present without parsing summaries", () => {
    const state = authoritativeLessonState("converging-lublin", "guided")
    const meta = lessonMeta("converging-lublin", "guided")
    const plan = analyzeOrders(state, [
      { type: "attack", from: "krakow", target: "lublin", unitIds: ["teach-11"] },
      { type: "attack", from: "kielce", target: "lublin", unitIds: ["teach-kie"] },
    ])
    const record: TurnRecord = {
      turn: 0,
      date: "2 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "attack", from: "krakow", target: "lublin", units: ["teach-11"] },
          status: "applied",
          summary: "Decorator text only — no odds here.",
          battle: {
            targetId: "lublin",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 2,
            origins: ["kielce", "krakow"],
            attackerLoss: 5,
            defenderLoss: 20,
            encircled: false,
            attackerWon: false,
            attack: 80,
            defense: 60,
            ratio: 1.33,
            roll: 1,
            launchSupply: { kielce: 100, krakow: 100 },
            pooledSupply: null,
          },
        },
      ],
      events: [],
      controlChanges: [],
      logistics: [],
      notes: [],
      gmSource: "mock",
    }
    const feedback = buildTeachFeedback(meta, "guided", plan, record)
    expect(feedback.kind).toBe("sound_converging_unlucky")
    expect(feedback.evidence.some((line) => line.includes("roll 1"))).toBe(true)
    expect(feedback.evidence.some((line) => line.includes("1.33"))).toBe(true)
  })

  it("supply feedback reads win/loss from battle.attackerWon", () => {
    const state = authoritativeLessonState("supply-tradeoff", "guided")
    const meta = lessonMeta("supply-tradeoff", "guided")
    const supplyPlan = analyzeSupplyLesson(state, meta, [
      { type: "attack", from: "krakow", target: "kielce", unitIds: ["teach-fed"] },
    ])
    const record: TurnRecord = {
      turn: 0,
      date: "2 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "attack", from: "krakow", target: "kielce", units: ["teach-fed"] },
          status: "applied",
          summary: "No parseable keywords.",
          battle: {
            targetId: "kielce",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 1,
            origins: ["krakow"],
            attackerLoss: 2,
            defenderLoss: 15,
            encircled: false,
            attackerWon: true,
            attack: 55,
            defense: 40,
            ratio: 1.37,
            roll: 5,
            launchSupply: { krakow: 88 },
            pooledSupply: null,
          },
        },
      ],
      events: [],
      controlChanges: [],
      logistics: [],
      notes: [],
      gmSource: "mock",
    }
    const feedback = buildSupplyTeachFeedback(meta, "guided", supplyPlan, record)
    expect(feedback.kind).toBe("supply_sound_fed_column")
    expect(feedback.evidence.some((line) => /attack 55/.test(line))).toBe(true)
  })
})