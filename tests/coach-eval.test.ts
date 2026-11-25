import { describe, expect, it } from "vitest"
import { buildSituation, staffMap } from "@/lib/gm/advisor"
import {
  buildAllCoachEvalFixtures,
  checkHardRules,
  COACH_EVAL_SCENARIOS,
  hardRulesPassed,
  runCoachEval,
} from "@/lib/gm/coach-eval"
import { engagementOdds } from "@/lib/engine/turn"
import { independentFormations } from "@/lib/engine/echelon"
import { leaveDepotGarrison } from "@/lib/orders"
import { legalTargets } from "@/lib/ui/legal-targets"
import { createInitialState } from "@/lib/data/scenario"

describe("coach eval harness", () => {
  it("ships 14 engine-grounded scenarios", () => {
    expect(COACH_EVAL_SCENARIOS).toHaveLength(16)
    const ids = COACH_EVAL_SCENARIOS.map((scenario) => scenario.id)
    expect(ids).toEqual([
      "under-supply-trap",
      "exposed-flank",
      "clerk-request",
      "pushback-follow-up",
      "sound-plan",
      "fortify-attack-conflict",
      "post-battle-surprise",
      "illegal-move",
      "reachable-warsaw",
      "captured-province-odds",
      "supply-rejected-queue",
      "rejected-chronicle",
      "odds-open-question",
      "clerk-cancel-order",
      "fortnight-five-of-six",
      "krakow-neighbor-legality",
    ])
  })

  it("builds fixtures that match live engine facts", () => {
    const built = buildAllCoachEvalFixtures()
    expect(built).toHaveLength(16)

    const under = built.find((item) => item.id === "under-supply-trap")!.fixture
    const underMap = staffMap(under.state)
    const katowice = underMap.provinces.find((province) => province.id === "katowice")!
    expect(katowice.supply).toBeLessThan(60)
    const underIds = under.queuedOrders[0] && under.queuedOrders[0].type === "attack"
      ? under.queuedOrders[0].unitIds
      : []
    const underOdds = engagementOdds(underMap, "katowice", "kielce", underIds)!
    expect(underOdds.ratio).toBeLessThan(1)
    expect(under.facts.allowedOddsTrimmed).toContain(
      (Math.round(underOdds.ratio * 10) / 10).toFixed(1).replace(/\.0$/, ""),
    )

    const flank = built.find((item) => item.id === "exposed-flank")!.fixture
    const flankMap = staffMap(flank.state)
    const ermland = flankMap.provinces.find((province) => province.id === "ermland_masuren")!
    expect(ermland.units).toHaveLength(0)
    expect(ermland.neighbors).toEqual(expect.arrayContaining(["bialystok", "plock"]))

    const sound = built.find((item) => item.id === "sound-plan")!.fixture
    expect(sound.queuedOrders.filter((order) => order.type === "attack")).toHaveLength(2)

    const conflict = built.find((item) => item.id === "fortify-attack-conflict")!.fixture
    expect(conflict.queuedOrders.some((order) => order.type === "fortify")).toBe(true)
    expect(
      conflict.queuedOrders.some(
        (order) => order.type === "attack" && order.from === "krakow" && order.target === "kielce",
      ),
    ).toBe(true)

    const surprise = built.find((item) => item.id === "post-battle-surprise")!.fixture
    expect(surprise.log).toHaveLength(1)
    expect(surprise.facts.battleFortnight).toBe(1)
    expect(surprise.facts.battleDate).toBe("2 May 1915")
    const battle = surprise.log[0]!.resolutions.find((item) => item.battle)?.battle
    expect(battle?.attackerWon).toBe(false)
    expect(battle?.targetId).toBe("kielce")

    const illegal = built.find((item) => item.id === "illegal-move")!.fixture
    const illegalMap = staffMap(illegal.state)
    const krakow = illegalMap.provinces.find((province) => province.id === "krakow")!
    expect(krakow.neighbors.includes("warszawa")).toBe(false)
    // engagementOdds ignores adjacency; legality is the grounded refusal signal.
    expect(legalTargets(illegalMap, "krakow", []).attack.includes("warszawa")).toBe(false)
    expect(legalTargets(illegalMap, "krakow", []).reach.attack.includes("warszawa")).toBe(false)
  })

  it("allows contact odds that match leaveDepotGarrison, not the full depot stack", () => {
    const map = staffMap(createInitialState("normal"))
    const krakow = map.provinces.find((province) => province.id === "krakow")!
    expect(krakow.depot).toBe("central")
    const available = independentFormations(
      krakow.units.filter((unit) => unit.faction === "central"),
    )
    expect(available.length).toBeGreaterThan(1)
    const garrisoned = leaveDepotGarrison(available, true, false)
    expect(garrisoned.length).toBe(available.length - 1)

    const contacts = buildSituation(map, []).contacts.filter((contact) => contact.fromId === "krakow")
    expect(contacts.length).toBeGreaterThan(0)
    const clerk = COACH_EVAL_SCENARIOS.find((item) => item.id === "clerk-request")!.build()
    for (const contact of contacts) {
      const trimmed = (Math.round(contact.ratio * 10) / 10).toFixed(1).replace(/\.0$/, "")
      expect(clerk.facts.allowedOddsTrimmed).toContain(trimmed)
      const fullStack = engagementOdds(
        map,
        "krakow",
        contact.targetId,
        available.map((unit) => unit.id),
      )!
      const garrisonOdds = engagementOdds(
        map,
        "krakow",
        contact.targetId,
        garrisoned.map((unit) => unit.id),
      )!
      expect(garrisonOdds.ratio).toBeCloseTo(contact.ratio, 5)
      if (Math.abs(fullStack.ratio - contact.ratio) > 0.05) {
        const fullTrimmed = (Math.round(fullStack.ratio * 10) / 10).toFixed(1).replace(/\.0$/, "")
        // Full-stack odds that diverge from the contact must not be required — contacts win.
        expect(trimmed).not.toBe(fullTrimmed)
      }
    }
  })

  it("hard-rule checker accepts a clean Socratic reply", () => {
    const surprise = COACH_EVAL_SCENARIOS.find((item) => item.id === "post-battle-surprise")!.build()
    const reply =
      "What did you expect at Kielce? The chronicle shows fortnight 1 (2 May 1915) our assault from Kraków into Kielce failed at 0.7:1 if the Russians don't reinforce (roll 1); we lost 61, they lost 23."
    const results = checkHardRules(reply, surprise.facts)
    expect(hardRulesPassed(results)).toBe(true)
  })

  it("hard-rule checker flags filed claims, prescriptions, and ungrounded odds", () => {
    const sound = COACH_EVAL_SCENARIOS.find((item) => item.id === "sound-plan")!.build()
    const filed = checkHardRules("Filed as noted. Kielce is yours.", sound.facts)
    expect(filed.find((item) => item.id === "no_filed_claims")?.pass).toBe(false)

    const prescribed = checkHardRules("You should attack Kielce from Kraków this fortnight.", sound.facts)
    expect(prescribed.find((item) => item.id === "no_order_prescription")?.pass).toBe(false)

    const badOdds = checkHardRules(
      "What do you expect at Kielce? About 99:1 if the Russians don't reinforce.",
      sound.facts,
    )
    expect(badOdds.find((item) => item.id === "grounded_odds")?.pass).toBe(false)
  })

  it("runs the offline eval without calling external APIs", async () => {
    delete process.env.LLM_API_KEY
    delete process.env.OSTFRONT_ADVISOR_FIXTURE
    const report = await runCoachEval({ offline: true, gradePedagogy: false })
    expect(report.mode).toBe("offline")
    expect(report.scenarios).toHaveLength(16)
    expect(report.pedagogyPassCount).toBeNull()
    for (const scenario of report.scenarios) {
      expect(scenario.reply.length).toBeGreaterThan(10)
      expect(scenario.pedagogy).toBeNull()
      expect(["fallback", "rules", "llm"]).toContain(scenario.source)
      // Offline path must not use a live model.
      expect(scenario.source).not.toBe("llm")
    }
    // Hard rules should pass on the shaped rules/fallback path for these fixtures.
    expect(report.hardFailCount).toBe(0)
  })
})
