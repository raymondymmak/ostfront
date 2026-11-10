import { beforeEach, describe, expect, it } from "vitest"
import { coachHints } from "@/lib/teach/coach"
import { authoritativeLessonState, lessonMeta } from "@/lib/teach/lessons"
import { analyzeOrders } from "@/lib/teach/plan"
import { teachResolveTurn } from "@/lib/teach/resolve"
import { teachingTrustAssessment, campaignTrustAssessment } from "@/lib/teach/trust"
import { combinedEngagementOdds } from "@/lib/engine/turn"
import type { PlayerOrder } from "@/lib/types"

describe("teaching — converging lublin", () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY
  })

  it("builds guided and silent boards on the server", () => {
    const guided = authoritativeLessonState("converging-lublin", "guided")
    const silent = authoritativeLessonState("converging-lublin", "silent")
    const lublin = guided.provinces.find((p) => p.id === "lublin")!
    expect(lublin.units.some((u) => u.faction === "russia")).toBe(true)
    expect(guided.provinces.find((p) => p.id === "kielce")!.controller).toBe("central")
    expect(silent.provinces.find((p) => p.id === "katowice")!.units.length).toBeGreaterThan(0)
  })

  it("previews pooled odds for two prongs", () => {
    const state = authoritativeLessonState("converging-lublin", "guided")
    const preview = combinedEngagementOdds(state, "lublin", [
      { fromId: "krakow", unitIds: ["teach-11"] },
      { fromId: "kielce", unitIds: ["teach-kie"] },
    ])
    expect(preview).not.toBeNull()
    expect(preview!.origins).toBe(2)
    expect(preview!.multiplier).toBe(1.12)
  })

  it("classifies a converging guided plan with harsh die as sound but unlucky", async () => {
    const orders: PlayerOrder[] = [
      { type: "attack", from: "krakow", target: "lublin", unitIds: ["teach-11"] },
      { type: "attack", from: "kielce", target: "lublin", unitIds: ["teach-kie"] },
    ]
    const result = await teachResolveTurn(
      "converging-lublin",
      "guided",
      orders,
      "Combine directions.",
      "Both prongs merge; converging odds favour us before the die.",
      ["lublin"],
    )
    expect(result.plan.convergingOnTarget).toBe("lublin")
    expect(result.combatRoll).toBe(1)
    expect(result.record.resolutions.some((r) => /Two-pronged|Concentric/.test(r.summary))).toBe(
      true,
    )
    expect(result.feedback.kind).toBe("sound_converging_unlucky")
    expect(result.feedback.evidence.some((line) => /roll 1/i.test(line))).toBe(true)
    expect(result.feedback.coachReply.length).toBeGreaterThan(0)
  })

  it("flags a single-prong plan as a different trade-off", async () => {
    const orders: PlayerOrder[] = [
      { type: "attack", from: "krakow", target: "lublin", unitIds: ["teach-11"] },
    ]
    const plan = analyzeOrders(authoritativeLessonState("converging-lublin", "guided"), orders)
    expect(plan.singleProngOnTarget).toBe(true)
    const result = await teachResolveTurn(
      "converging-lublin",
      "guided",
      orders,
      "One blow.",
      "A single prong takes Lublin this fortnight.",
      [],
    )
    expect(result.feedback.kind).toBe("reasonable_single_prong")
  })

  it("offers hints only in guided mode", () => {
    const state = authoritativeLessonState("converging-lublin", "guided")
    const meta = lessonMeta("converging-lublin", "guided")
    expect(coachHints(meta, state, "guided").length).toBeGreaterThan(0)
    expect(coachHints(meta, state, "silent")).toEqual([])
  })

  it("records trust posture for teaching vs campaign", () => {
    expect(teachingTrustAssessment().clientStateTrustedOnResolve).toBe(false)
    expect(campaignTrustAssessment().clientStateTrustedOnResolve).toBe(false)
    expect(teachingTrustAssessment().pilotBlocked).toBe(false)
  })
})
