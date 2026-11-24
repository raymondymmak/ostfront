import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { ENCIRCLEMENT_DEFENDER_LOSS, flankMultiplier } from "@/lib/engine/combat"
import { combinedEngagementOdds, engagementOdds, resolveTurn } from "@/lib/engine/turn"
import { buildSituation, finishAdvisorReply, renderSituation, scrubAdvisorReply, staffMap } from "@/lib/gm/advisor"
import { resetTurnGuardStateForTests } from "@/lib/api/turn-guard"

describe("advisor grounding", () => {
  beforeEach(() => {
    resetTurnGuardStateForTests()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    delete process.env.LLM_API_KEY
    delete process.env.LLM_MODEL_STRONG
    delete process.env.LLM_HTTP_REFERER
    delete process.env.LLM_HTTP_TITLE
    delete process.env.OSTFRONT_ADVISOR_FIXTURE
    delete process.env.TURN_API_TOKEN
    delete process.env.TURN_ALLOWED_ORIGINS
    delete process.env.TURN_MAX_BODY_BYTES
    delete process.env.TURN_RATE_LIMIT_MAX
    delete process.env.TURN_RATE_LIMIT_WINDOW_MS
    process.env.LLM_MODEL = "z-ai/glm-5.3"
    process.env.LLM_BASE_URL = "https://llm.example/v1"
  })

  it("prints engine odds, rails, and no Russian purse or Stavka plan", () => {
    const state = createInitialState()
    const situation = buildSituation(state, [])
    const map = staffMap(state)
    const kielce = situation.contacts.find(
      (contact) => contact.fromId === "krakow" && contact.targetId === "kielce",
    )
    expect(kielce).toBeTruthy()
    const preview = engagementOdds(map, "krakow", "kielce", kielce!.unitIds)
    expect(preview).not.toBeNull()
    expect(kielce!.ratio).toBeCloseTo(preview!.ratio)
    const text = renderSituation(situation)
    expect(text).toContain(kielce!.ratio.toFixed(2))
    expect(text).toContain("X Corps")
    expect(text).toContain("German 11th Army (Mackensen)")
    expect(text).toMatch(/Kraków–Lemberg cut|Lemberg–Kraków cut/)
    expect(text).toContain(`Central Powers purse: manpower ${state.treasury.central.mp}`)
    expect(text).not.toContain(`manpower ${state.treasury.russia.mp}`)
    expect(text).not.toMatch(/Russian purse|Russian manpower|Russian industry|Stavka/)
    expect(JSON.stringify(situation)).not.toContain('"plans"')
    expect(text).toContain(String(flankMultiplier(2)))
    expect(text).toContain(String(flankMultiplier(3)))
    expect(text).toContain(String(flankMultiplier(4)))
    expect(text).toContain(String(Math.round(ENCIRCLEMENT_DEFENDER_LOSS * 100)))
    expect(text).toMatch(/one battle/i)
    expect(text).not.toMatch(/does not show combined|each column separately|cannot promise/i)
  })

  it("pools four directions into Łódź at the resolver's combined odds", () => {
    const state = createInitialState()
    const situation = buildSituation(state, [])
    const map = staffMap(state)
    const lodz = situation.combined.find((battle) => battle.targetId === "lodz")
    expect(lodz).toBeTruthy()
    expect(lodz!.prongs.map((prong) => prong.fromId).sort()).toEqual([
      "gdynia",
      "katowice",
      "oberschlesien",
      "poznan",
    ])
    expect(lodz!.prongs.map((prong) => prong.fromName).sort()).toEqual([
      "Katowice",
      "Pomorze",
      "Posen",
      "Upper Silesia",
    ])
    const columns = lodz!.prongs.map((prong) => engagementOdds(map, prong.fromId, "lodz", prong.unitIds))
    expect(columns.every((column) => column && column.origins === 1)).toBe(true)
    const preview = combinedEngagementOdds(
      map,
      "lodz",
      lodz!.prongs.map((prong) => ({ fromId: prong.fromId, unitIds: prong.unitIds })),
    )
    expect(preview).not.toBeNull()
    expect(lodz!.ratio).toBe(preview!.ratio)
    expect(lodz!.multiplier).toBe(preview!.multiplier)
    expect(lodz!.multiplier).toBe(flankMultiplier(4))
    expect(lodz!.origins).toBe(4)
    expect(lodz!.encircled).toBe(preview!.encircled)
    const pooledAttack =
      columns.reduce((sum, column) => sum + column!.attack, 0) * flankMultiplier(lodz!.origins)
    expect(preview!.ratio).toBeCloseTo(pooledAttack / Math.max(8, preview!.defense), 5)
    expect(preview!.ratio).toBeGreaterThan(Math.max(...columns.map((column) => column!.ratio)))

    const text = renderSituation(situation)
    expect(text).toContain(`flank ×${preview!.multiplier}`)
    expect(text).toContain(preview!.ratio.toFixed(2))
    expect(text).not.toMatch(/with your queued attack/i)

    const fought = resolveTurn(
      state,
      {
        narration: "",
        proposals: lodz!.prongs.map((prong) => ({
          type: "attack" as const,
          from: prong.fromId,
          target: "lodz",
          units: prong.unitIds,
        })),
        events: [],
        diplomacy: [],
      },
      { rng: () => 0 },
    )
    const attacks = fought.record.resolutions.filter((item) => item.proposal.type === "attack")
    expect(attacks).toHaveLength(1)
    expect(attacks[0].summary).toMatch(/Concentric attack/)
    expect(attacks[0].summary).toContain("Łódź")
    const variance = 0.82
    expect(attacks[0].summary).toContain((preview!.ratio * variance).toFixed(2))
    expect(attacks[0].summary).toContain("roll 1")
    expect(state.provinces.find((province) => province.id === "lodz")?.controller).toBe("russia")
  })

  it("tells Falkenhayn what adding columns does to a queued attack", () => {
    const state = createInitialState()
    const queued = [{ type: "attack" as const, from: "poznan", target: "lodz", unitIds: ["g-pos-inf"] }]
    const situation = buildSituation(state, queued)
    const map = staffMap(state)
    const lodz = situation.combined.find((battle) => battle.targetId === "lodz")
    expect(lodz).toBeTruthy()
    expect(lodz!.prongs.filter((prong) => prong.queued).map((prong) => prong.fromId)).toEqual(["poznan"])
    expect(lodz!.prongs.filter((prong) => !prong.queued)).toHaveLength(3)
    const full = combinedEngagementOdds(
      map,
      "lodz",
      lodz!.prongs.map((prong) => ({ fromId: prong.fromId, unitIds: prong.unitIds })),
    )
    const alone = combinedEngagementOdds(map, "lodz", [{ fromId: "poznan", unitIds: ["g-pos-inf"] }])
    expect(lodz!.ratio).toBe(full!.ratio)
    expect(lodz!.queuedRatio).toBe(alone!.ratio)
    const text = renderSituation(situation)
    expect(text).toContain(full!.ratio.toFixed(2))
    expect(text).toContain(alone!.ratio.toFixed(2))
    expect(text).toMatch(/with your queued attack from Posen, adding .+ makes it/)
  })
  it("scrubs a forecast of Russian movement", () => {
    const state = createInitialState()
    const text = scrubAdvisorReply(
      "Kielce is thin. Stavka will attack Kraków at dawn. Hold the depot.",
      state,
    )
    expect(text).toContain("Kielce is thin")
    expect(text).toContain("Hold the depot")
    expect(text).not.toMatch(/will attack/i)
  })

  it("scrubs a denial that converging attacks are one battle", () => {
    const text = scrubAdvisorReply(
      "The map does not show combined odds. The engine previews each column separately. I cannot promise the dice or the engine will pool these attacks. Łódź is one battle at 3.53 : 1.",
      createInitialState(),
    )
    expect(text).toContain("Łódź is one battle at 3.53 : 1")
    expect(text).not.toMatch(/does not show combined|each column separately|cannot promise/)
  })

})

describe("advisor placeholder tokens", () => {
  const forms: { text: string; keep: string }[] = [
    { text: "Kielce stands at {odds:card1}.", keep: "Kielce stands at." },
    { text: "Kielce stands at {card1}.", keep: "Kielce stands at." },
    { text: "Kielce stands at {kielce_odds}.", keep: "Kielce stands at." },
    { text: "Kielce stands at {odds:kielce}.", keep: "Kielce stands at." },
    { text: "Kielce stands at {{odds:card1}}.", keep: "Kielce stands at." },
    { text: "Kielce stands at {odds:{odds:card1}}.", keep: "Kielce stands at." },
    { text: "Kielce stands at ｛odds:card1｝.", keep: "Kielce stands at." },
    { text: "Kielce stands at ｛｛odds:card1｝｝.", keep: "Kielce stands at." },
    { text: "Kielce stands at {odds:card1.", keep: "Kielce stands at odds:card1." },
    { text: "Kielce stands at odds:card1}.", keep: "Kielce stands at." },
    { text: "Kielce stands at { odds:card1 }.", keep: "Kielce stands at." },
    { text: "Kielce stands at {ODDS:card1}.", keep: "Kielce stands at." },
    { text: "Kielce stands at {odds:CARD1}.", keep: "Kielce stands at." },
    { text: "Use {card1} and {kielce_odds}.", keep: "Use and." },
    { text: "{{odds:x}}", keep: "" },
    { text: "{odds}", keep: "" },
    { text: "{", keep: "" },
    { text: "}", keep: "" },
    { text: "｛", keep: "" },
    { text: "｝", keep: "" },
    { text: "{placeholder}", keep: "" },
    { text: "｛placeholder｝", keep: "" },
    { text: "{card99}", keep: "" },
    { text: "{not_a_place_odds}", keep: "" },
    { text: "odds:card99}", keep: "" },
    { text: "{odds:card1}} extra", keep: "extra" },
    { text: "Hold { the shoulder", keep: "Hold the shoulder" },
    { text: "See {odds:card1} now.", keep: "See now." },
    { text: "Mix ｛odds:x｝ and } stray {", keep: "Mix and stray" },
    { text: "{odds: card1}", keep: "" },
    { text: "{ odds : card1 }", keep: "" },
    { text: "{ odds:card1}", keep: "" },
    { text: "{odds :card1}", keep: "" },
    { text: "Kielce stands at {odds: card1}.", keep: "Kielce stands at." },
    { text: "Before {odds: card1} after.", keep: "Before after." },
    { text: "Before { odds : card1 } after.", keep: "Before after." },
    { text: "Hold { the shoulder and march.", keep: "Hold the shoulder and march." },
    { text: "card1 stays.", keep: "card1 stays." },
    { text: "The word card1 is not a token.", keep: "The word card1 is not a token." },
    { text: "kielce_odds stays without braces.", keep: "kielce_odds stays without braces." },
    { text: "March on. {odds:card1} The depot holds.", keep: "March on. The depot holds." },
    { text: "{odds:card1} Kielce is the shoulder.", keep: "Kielce is the shoulder." },
    { text: "Unclosed {odds:card1 and the corps stays.", keep: "Unclosed and the corps stays." },
    { text: "Unclosed {card1 and the corps stays.", keep: "Unclosed card1 and the corps stays." },
    { text: "Line with { only the brace.", keep: "Line with only the brace." },
    { text: "End } only.", keep: "End only." },
    { text: "Left ｛odds: card1｝ right.", keep: "Left right." },
    { text: "Doubled {{odds: card1}} tail.", keep: "Doubled tail." },
    { text: "Nested {odds:{card1}} tail.", keep: "Nested tail." },
    { text: "Nested {odds:{ odds : card1 }} tail.", keep: "Nested tail." },
    { text: "Stray } in the middle of the line stays words.", keep: "Stray in the middle of the line stays words." },
    { text: "{placeholder} and the map.", keep: "and the map." },
    { text: "See {PLACEHOLDER} here.", keep: "See here." },
    { text: "{ODDS} alone next word.", keep: "alone next word." },
    { text: "odds:card1 without a brace goes.", keep: "odds:card1 without a brace goes." },
    { text: "The odds: kielce hold.", keep: "The odds: kielce hold." },
    { text: "First line.\nSecond {odds:card1} line stays.", keep: "First line.\nSecond line stays." },
    { text: "Start {odds:card1\nNext line stays.", keep: "Start\nNext line stays." },
    { text: "Hold {\nThe shoulder stays.", keep: "Hold\nThe shoulder stays." },
    { text: "Mixed {odds:card1｝ stays.", keep: "Mixed stays." },
    { text: "Mixed ｛odds:card1} stays.", keep: "Mixed stays." },
    { text: "A {odds:card1}{card1} B", keep: "A B" },
    { text: "Also {odds:card2} card2 remains.", keep: "Also card2 remains." },
    { text: "Read {kielce_odds} on the card.", keep: "Read on the card." },
    { text: "{}", keep: "" },
    { text: "{ }", keep: "" },
    { text: "{odds:}", keep: "" },
    { text: "{odds: }", keep: "" },
    { text: "odds:", keep: "odds:" },
    { text: "Ratio 6.51 : 1 stays.", keep: "Ratio 6.51 : 1 stays." },
    { text: "About 6.51 : 1 before the dice.", keep: "About 6.51 : 1 before the dice." },
    { text: "Gen. Mackensen holds {odds:card1} Kraków.", keep: "Gen. Mackensen holds Kraków." },
    { text: "{odds:card1}.", keep: "." },
    { text: "Tail survives {odds:x}!", keep: "Tail survives!" },
    { text: "A {odds:x}, B.", keep: "A, B." },
    { text: "Word} stays.", keep: "Word stays." },
    { text: "{not_a_place_odds} and more.", keep: "and more." },
    { text: "Keep 2 to 3 corps {odds:card1} here.", keep: "Keep 2 to 3 corps here." },
    { text: "05:00 is a clock {odds}.", keep: "05:00 is a clock." },
    { text: "Province count is 18 to 21 {card1} along.", keep: "Province count is 18 to 21 along." },
    { text: "{odds:combined:kielce:2}", keep: "" },
    { text: "Before {odds:combined:kielce:2} after.", keep: "Before after." },
    { text: "{odds:kielce:2}", keep: "" },
    { text: "Before {odds:kielce:2} after.", keep: "Before after." },
    { text: "{odds:card 1}", keep: "" },
    { text: "Before {odds:card 1} after.", keep: "Before after." },
    { text: "Odds: 8.34 : 1 (Kielce)", keep: "Odds: 8.34 : 1 (Kielce)" },
    { text: "The odds: 6.51 : 1 at Kielce.", keep: "The odds: 6.51 : 1 at Kielce." },
    { text: "Odds: good.", keep: "Odds: good." },
    { text: "Kielce is at {odds:card1 and Lublin is weaker.", keep: "Kielce is at and Lublin is weaker." },
    { text: "Kielce is at { odds:card1 and Lublin is weaker.", keep: "Kielce is at and Lublin is weaker." },
    { text: "Kielce is at ｛odds:card1 and Lublin is weaker.", keep: "Kielce is at and Lublin is weaker." },
    { text: "March ends {odds:card7", keep: "March ends" },
    { text: "March ends ｛odds:card7", keep: "March ends" },
    { text: "Kielce is odds:card1}.", keep: "Kielce is." },
    { text: "Kielce is odds:card1｝.", keep: "Kielce is." },
    { text: "Kielce {odds:6.51 : 1 holds.", keep: "Kielce odds:6.51 : 1 holds." },
    { text: "Kielce is odds:card1 } and Lublin holds.", keep: "Kielce is and Lublin holds." },
    { text: "{odds: card1", keep: "" },
    { text: "{ odds : card1", keep: "" },
    { text: "odds: card1}", keep: "" },
    { text: "Kielce is {odds:x1.5 now.", keep: "Kielce is odds:x1.5 now." },
    { text: "6{odds:card1}.51 : 1", keep: "6 .51 : 1" },
    { text: "6.5{1 : 1", keep: "6.5 1 : 1" },
    { text: "8.34{odds:card1 : 1", keep: "8.34odds:card1 : 1" },
  ]

  it("strips only the token and keeps the text around it", () => {
    expect(forms).toHaveLength(105)
    for (const item of forms) {
      expect(finishAdvisorReply(item.text), item.text).toBe(item.keep)
    }
  })

  it("never leaves a brace", () => {
    for (const item of forms) {
      expect(finishAdvisorReply(item.text), item.text).not.toMatch(/[{}\uFF5B\uFF5D]/)
    }
  })

  it("does not invent a numeric figure", () => {
    const figure = /\d+(?:\.\d+)?/g
    for (const item of forms) {
      const out = finishAdvisorReply(item.text)
      const known = item.text.match(figure) ?? []
      for (const found of out.match(figure) ?? []) {
        expect(known, `${item.text} -> ${out}`).toContain(found)
      }
    }
  })
})

