import { describe, expect, it } from "vitest"
import { combinedEngagementOdds } from "@/lib/engine/turn"
import { teachResolveTurn } from "@/lib/teach/resolve"
import { authoritativeLessonState } from "@/lib/teach/lessons"
import type { PlayerOrder } from "@/lib/types"

describe("converging assault supply", () => {
  it("makes all-in weaker than lean Fed on the supply lesson board", () => {
    const state = authoritativeLessonState("supply-tradeoff", "guided")
    const fed = combinedEngagementOdds(state, "kielce", [
      { fromId: "krakow", unitIds: ["teach-fed"] },
    ])!
    const allIn = combinedEngagementOdds(state, "kielce", [
      { fromId: "katowice", unitIds: ["teach-heavy"] },
      { fromId: "krakow", unitIds: ["teach-fed"] },
    ])!
    expect(allIn.ratio).toBeLessThan(fed.ratio)
    expect(allIn.attack).toBeLessThan(fed.attack)
    expect(allIn.multiplier).toBe(1)
  })

  it("fails all-in on teaching roll 1 while lean Fed succeeds", async () => {
    const allInOrders: PlayerOrder[] = [
      { type: "attack", from: "katowice", target: "kielce", unitIds: ["teach-heavy"] },
      { type: "attack", from: "krakow", target: "kielce", unitIds: ["teach-fed"] },
    ]
    const leanOrders: PlayerOrder[] = [
      { type: "attack", from: "krakow", target: "kielce", unitIds: ["teach-fed"] },
    ]
    const allIn = await teachResolveTurn(
      "supply-tradeoff",
      "guided",
      allInOrders,
      "Pool both for mass.",
      "Both prongs take Kielce.",
      [],
    )
    const lean = await teachResolveTurn(
      "supply-tradeoff",
      "guided",
      leanOrders,
      "Fed column only.",
      "Fed corps breaks the line.",
      [],
    )
    expect(allIn.record.resolutions.some((r) => /fails/i.test(r.summary))).toBe(true)
    expect(lean.record.resolutions.some((r) => /succeeds/i.test(r.summary))).toBe(true)
    expect(allIn.feedback.kind).toBe("supply_all_in_convergence")
    expect(lean.feedback.kind).toBe("supply_sound_fed_column")
  })

  it("keeps well-fed converging Lublin stronger than a single prong", () => {
    const state = authoritativeLessonState("converging-lublin", "guided")
    const single = combinedEngagementOdds(state, "lublin", [
      { fromId: "krakow", unitIds: ["teach-11"] },
    ])!
    const both = combinedEngagementOdds(state, "lublin", [
      { fromId: "krakow", unitIds: ["teach-11"] },
      { fromId: "kielce", unitIds: ["teach-kie"] },
    ])!
    expect(both.ratio).toBeGreaterThan(single.ratio)
    expect(both.multiplier).toBeGreaterThan(1)
  })
})
