import { beforeEach, describe, expect, it } from "vitest"
import { analyzeSupplyLesson } from "@/lib/teach/supply-plan"
import { authoritativeLessonState, lessonMeta } from "@/lib/teach/lessons"
import { teachResolveTurn } from "@/lib/teach/resolve"
import type { PlayerOrder } from "@/lib/types"

const PREDICTION_LEAN = "The fed corps from Kraków wins because supply scales attack power before the die."
const PREDICTION_ALLIN = "Both prongs converge and the heavier stack breaks Kielce because headcount pools together."

describe("supply lesson — all-in vs lean", () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY
  })

  it("grades all-in convergence as the misconception", async () => {
    const state = authoritativeLessonState("supply-tradeoff", "guided")
    const meta = lessonMeta("supply-tradeoff", "guided")
    const orders: PlayerOrder[] = [
      { type: "attack", from: "katowice", target: "kielce", unitIds: ["teach-heavy"] },
      { type: "attack", from: "krakow", target: "kielce", unitIds: ["teach-fed"] },
    ]
    const plan = analyzeSupplyLesson(state, meta, orders)
    expect(plan.allInConvergence).toBe(true)
    expect(plan.fedPreview.ratio).toBeGreaterThan(plan.heavyPreview.ratio)
    expect(plan.combinedPreview!.ratio).toBeLessThan(plan.fedPreview.ratio)

    const result = await teachResolveTurn(
      "supply-tradeoff",
      "guided",
      orders,
      "Pool both columns — more troops means a stronger converging attack.",
      PREDICTION_ALLIN,
      ["kielce"],
    )
    expect(result.feedback.kind).toBe("supply_all_in_convergence")
    expect(result.record.resolutions.some((r) => /fails/i.test(r.summary))).toBe(true)
    expect(result.feedback.evidence.some((line) => /capacity|supply \d+/i.test(line))).toBe(true)
  })

  it("wins and grades the lean fed column as sound", async () => {
    const orders: PlayerOrder[] = [
      { type: "attack", from: "krakow", target: "kielce", unitIds: ["teach-fed"] },
    ]
    const result = await teachResolveTurn(
      "supply-tradeoff",
      "guided",
      orders,
      "March the well-supplied fed corps only.",
      PREDICTION_LEAN,
      ["kielce"],
    )
    expect(result.feedback.kind).toBe("supply_sound_fed_column")
    expect(result.record.resolutions.some((r) => /succeeds/i.test(r.summary))).toBe(true)
  })
})
