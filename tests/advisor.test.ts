import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { ENCIRCLEMENT_DEFENDER_LOSS, flankMultiplier } from "@/lib/engine/combat"
import { independentFormations } from "@/lib/engine/echelon"
import { combinedEngagementOdds, engagementOdds, resolveTurn } from "@/lib/engine/turn"
import { advise, buildSituation, reconcileReplyWithCards, renderSituation, scrubAdvisorReply, staffMap } from "@/lib/gm/advisor"
import { readMessageContent } from "@/lib/gm/llm"
import { resetTurnGuardStateForTests } from "@/lib/api/turn-guard"
import { combinedQueueLines, leaveDepotGarrison } from "@/lib/orders"
import type { GameState } from "@/lib/types"
import type { AdvisorCard, AdvisorOrder, AdvisorResponse } from "@/lib/gm/advisor-types"

async function postAdvisor(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/advisor/route")
  return POST(
    new Request("https://example.com/api/advisor", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

function llmPayload(content: unknown, extra: Record<string, unknown> = {}) {
  return {
    choices: [{ message: { content, ...extra } }],
  }
}

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

  it("answers a together question with one validated Łódź battle", async () => {
    const state = createInitialState()
    const snapshot = structuredClone(state)
    const response = await postAdvisor({
      state,
      messages: [
        {
          role: "user",
          content: "If we attack Łódź together from Posen, Upper Silesia, Pomorze and Katowice, the odds are different.",
        },
      ],
      queuedOrders: [],
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as AdvisorResponse
    const preview = combinedEngagementOdds(staffMap(state), "lodz", [
      { fromId: "poznan", unitIds: ["g-pos-inf"] },
      { fromId: "oberschlesien", unitIds: ["g-obs-inf"] },
      { fromId: "gdynia", unitIds: ["g-gdy-inf"] },
      { fromId: "katowice", unitIds: ["g-kat-inf"] },
    ])
    expect(payload.reply).toContain(preview!.ratio.toFixed(2))
    expect(payload.reply).toMatch(/one battle/i)
    expect(payload.reply).toContain(String(flankMultiplier(4)))
    expect(payload.reply).not.toMatch(/does not show combined|each column separately|cannot promise|dispersion/i)
    expect(payload.reply).not.toMatch(/Stavka|will attack/i)
    const card = payload.suggestions.find(
      (item) => item.order.type === "attack" && item.order.target === "lodz",
    )
    expect(card?.valid).toBe(true)
    const orders = [card!.order, ...card!.companions] as Extract<AdvisorOrder, { type: "attack" }>[]
    expect(orders).toHaveLength(4)
    expect(orders.every((order) => order.target === "lodz")).toBe(true)
    expect(orders.map((order) => order.from).sort()).toEqual(["gdynia", "katowice", "oberschlesien", "poznan"])
    expect(card?.odds).toContain(preview!.ratio.toFixed(2))
    expect(state).toEqual(snapshot)
  })

  it("groups a model's four Łódź attacks and drops a Russian column", async () => {
    process.env.LLM_API_KEY = "test-key"
    const state = createInitialState()
    const snapshot = structuredClone(state)
    let system = ""
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] }
        system = body.messages.find((message) => message.role === "system")?.content ?? ""
        return Response.json(
          llmPayload(
            JSON.stringify({
              reply:
                "The map does not show combined odds. I cannot promise the dice or the engine will pool these attacks. The real figure is on the dispatch.",
              suggestions: [
                { type: "attack", from: "poznan", target: "lodz", unitIds: ["g-pos-inf"] },
                { type: "attack", from: "oberschlesien", target: "lodz", unitIds: ["g-obs-inf"] },
                { type: "attack", from: "gdynia", target: "lodz", unitIds: ["g-gdy-inf"] },
                { type: "attack", from: "katowice", target: "lodz", unitIds: ["g-kat-inf"] },
                { type: "attack", from: "warszawa", target: "lodz", unitIds: ["g-war-inf"] },
              ],
            }),
          ),
        )
      }),
    )
    const response = await postAdvisor({
      state,
      messages: [{ role: "user", content: "If we do it together, the odds are different." }],
      queuedOrders: [],
    })
    const payload = (await response.json()) as AdvisorResponse
    expect(system).toMatch(/one battle/i)
    expect(system).toContain("Never write an odds numeral")
    expect(system).toContain("{odds:card1}")
    expect(system).toContain("{odds:combined:")
    expect(system).toContain(String(flankMultiplier(2)))
    expect(system).toContain(String(flankMultiplier(4)))
    expect(system).not.toMatch(/each column separately|cannot promise/i)
    expect(payload.reply).not.toMatch(/does not show combined|cannot promise/)
    expect(payload.reply).toMatch(/real figure|dispatch/i)
    const card = payload.suggestions.find((item) => item.order.type === "attack" && item.order.target === "lodz")
    const orders = [card!.order, ...card!.companions]
    expect(orders).toHaveLength(4)
    expect(card?.valid).toBe(true)
    expect(JSON.stringify(payload.suggestions)).not.toContain("g-war-inf")
    expect(payload.dropped).toBeGreaterThanOrEqual(1)
    expect(state).toEqual(snapshot)
  })

  it("shows one combined readout for four queued attacks on Łódź", () => {
    const state = staffMap(createInitialState())
    const queue = [
      { id: "1", kind: "attack" as const, from: "poznan", to: "lodz", unitIds: ["g-pos-inf"] },
      { id: "2", kind: "attack" as const, from: "oberschlesien", to: "lodz", unitIds: ["g-obs-inf"] },
      { id: "3", kind: "attack" as const, from: "gdynia", to: "lodz", unitIds: ["g-gdy-inf"] },
      { id: "4", kind: "attack" as const, from: "katowice", to: "lodz", unitIds: ["g-kat-inf"] },
    ]
    const lines = combinedQueueLines(state, queue)
    const preview = combinedEngagementOdds(
      state,
      "lodz",
      queue.map((order) => ({ fromId: order.from, unitIds: order.unitIds })),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].targetName).toBe("Łódź")
    expect(lines[0].fromNames).toEqual(["Katowice", "Pomorze", "Posen", "Upper Silesia"])
    expect(lines[0].preview.ratio).toBe(preview!.ratio)
    expect(lines[0].preview.multiplier).toBe(flankMultiplier(4))
    expect(lines[0].preview.origins).toBe(4)
  })

  it("drops invented and Russian orders, flags an illegal Central Powers order, and does not roll the battle", async () => {
    process.env.LLM_API_KEY = "test-key"
    process.env.LLM_MODEL_STRONG = "xiaomi/mimo-v2.6-pro"
    process.env.LLM_HTTP_REFERER = "https://ostfront.example"
    process.env.LLM_HTTP_TITLE = "Ostfront"
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")
    krakow!.fort = 3
    const snapshot = structuredClone(state)
    const seen: { model?: string; user?: string; referer?: string } = {}
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          model: string
          messages: { role: string; content: string }[]
        }
        const headers = init.headers as Record<string, string>
        seen.model = body.model
        seen.user = body.messages.find((message) => message.role === "user")?.content
        seen.referer = headers["HTTP-Referer"]
        return Response.json(
          llmPayload(
            JSON.stringify({
              reply:
                "Kielce is the thin shoulder. Stavka will attack Kraków at dawn. Send g-fake-9 through the gap.",
              suggestions: [
                { type: "attack", from: "Kraków", target: "Kielce", unitIds: ["g-kra-11"] },
                { type: "attack", from: "krakow", target: "kielce", unitIds: ["no-such-corps"] },
                { type: "move", unitId: "g-kie-inf", to: "lublin" },
                { type: "fortify", provinceId: "not-a-province" },
                { type: "fortify", provinceId: "krakow" },
              ],
            }),
          ),
        )
      }),
    )

    const response = await postAdvisor({
      state,
      messages: [{ role: "user", content: "Where is the Russian line weakest?" }],
      queuedOrders: [],
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.source).toBe("llm")
    expect(payload.unavailable).toBe(false)
    expect(payload).not.toHaveProperty("state")
    expect(payload.reply).toContain("Kielce")
    expect(payload.reply).not.toMatch(/will attack/i)
    expect(payload.reply).not.toContain("g-fake-9")
    expect(seen.model).toBe("z-ai/glm-5.3")
    expect(seen.referer).toBe("https://ostfront.example")
    expect(seen.user).toContain("X Corps")
    expect(seen.user).not.toMatch(/Stavka|Russian purse|Russian manpower/)
    expect(seen.user).not.toContain(`manpower ${state.treasury.russia.mp}`)

    const attack = payload.suggestions.find(
      (card) => card.order.type === "attack" && card.order.unitIds.includes("g-kra-11"),
    )
    expect(attack?.valid).toBe(true)
    expect(attack?.odds).toMatch(/: 1|Undefended/)
    expect(attack?.detail ?? "").not.toMatch(/\broll\b/i)
    expect(attack?.odds ?? "").not.toMatch(/\broll\b/i)
    expect(payload.suggestions.some((card) => JSON.stringify(card.order).includes("no-such-corps"))).toBe(false)
    expect(payload.suggestions.some((card) => JSON.stringify(card.order).includes("g-kie-inf"))).toBe(false)
    expect(payload.suggestions.some((card) => JSON.stringify(card.order).includes("not-a-province"))).toBe(false)
    const dig = payload.suggestions.find((card) => card.order.type === "fortify")
    expect(dig?.valid).toBe(false)
    expect(dig?.note).toMatch(/level 3/)
    expect(payload.dropped).toBeGreaterThanOrEqual(3)
    expect(state).toEqual(snapshot)
    await advise({
      state,
      messages: [{ role: "user", content: "Where is the Russian line weakest?" }],
      queuedOrders: [],
    })
    expect(state).toEqual(snapshot)
  })

  it("treats null content as an empty dispatch and ignores the reasoning trace", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(null, { reasoning: "secret-plan-to-attack-krakow" }),
        ),
      ),
    )
    const state = createInitialState()
    const response = await postAdvisor({
      state,
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [],
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.source).toBe("rules")
    expect(payload.reply).toMatch(/nothing I can file/i)
    expect(payload.reply).not.toContain("secret-plan-to-attack-krakow")
    expect(payload.suggestions.some((card) => card.valid)).toBe(true)
    expect(payload.suggestions.every((card) => card.valid)).toBe(true)
  })

  it("reads array content and still refuses an empty string", () => {
    expect(
      readMessageContent({
        choices: [{ message: { content: [{ type: "text", text: "{\"reply\":\"Kielce.\"}" }] } }],
      }),
    ).toContain("Kielce")
    expect(
      readMessageContent({
        choices: [{ message: { content: "", reasoning: "secret-plan-to-attack-krakow" } }],
      }),
    ).toBeNull()
    expect(readMessageContent({ choices: [{ message: { content: null } }] })).toBeNull()
  })

  it("stays on the map when no key is set and does not call the model", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [],
      queuedOrders: [],
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.unavailable).toBe(true)
    expect(payload.source).toBe("rules")
    expect(payload.reply).toMatch(/unavailable offline/i)
    expect(payload.suggestions.length).toBeGreaterThan(0)
    expect(payload.suggestions.every((card: AdvisorCard) => card.valid)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not suggest orders after the campaign, and does not leak the grade", async () => {
    process.env.LLM_API_KEY = "test-key"
    const state = createInitialState()
    state.result = {
      grade: "victory",
      score: 40,
      reason: "A secret grade sentence",
      captured: 4,
      available: 9,
      sudden: false,
    }
    let user = ""
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: { content: string }[] }
        user = body.messages[1].content
        return Response.json(
          llmPayload(
            JSON.stringify({
              reply: "The map is quiet.",
              suggestions: [{ type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11"] }],
            }),
          ),
        )
      }),
    )
    const response = await postAdvisor({
      state,
      messages: [{ role: "user", content: "What now?" }],
      queuedOrders: [],
    })
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.ordersClosed).toBe(true)
    expect(payload.suggestions).toEqual([])
    expect(payload.dropped).toBe(1)
    expect(user).not.toContain("A secret grade sentence")
    expect(user).toContain("Campaign: over")
  })

  it("flags a formation that is already in the queue", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "The 11th Army is already committed.",
              suggestions: [{ type: "move", unitId: "g-kra-11", to: "katowice" }],
            }),
          ),
        ),
      ),
    )
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "And the 11th Army?" }],
      queuedOrders: [{ type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11"] }],
    })
    const payload = (await response.json()) as AdvisorResponse
    const card = payload.suggestions.find((item) => item.order.type === "move")
    expect(card?.valid).toBe(false)
    expect(card?.note).toMatch(/already has orders/)
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
    expect(text).toContain("Łódź is one battle")
    expect(text).not.toMatch(/does not show combined|each column separately|cannot promise/)
  })

  it("reconciles quoted odds with invalid cards", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "Kielce two-pronged about 8.34 : 1. Lemberg is the prize.",
              suggestions: [
                { type: "attack", from: "Kraków", target: "Lemberg", unitIds: ["g-kra-11"] },
                { type: "attack", from: "Kraków", target: "Kielce", unitIds: ["g-kra-11"] },
                { type: "attack", from: "Katowice", target: "Kielce", unitIds: ["g-kat-inf"] },
              ],
            }),
          ),
        ),
      ),
    )
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "Where should I attack Kielce and Lemberg together?" }],
      queuedOrders: [],
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.reply).not.toContain("8.34")
    expect(payload.reply).toContain("Lemberg is the prize.")
    expect(payload.reply).toContain("is already committed to")
    expect(payload.reply).not.toMatch(/two-pronged/i)
    const kielceOdds = payload.reply
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => /kielce/i.test(sentence) && /\d+(?:\.\d+)?\s*:\s*1/.test(sentence))
    expect(kielceOdds).toEqual([])
    for (const card of payload.suggestions) {
      expect(card).not.toHaveProperty("conflict")
      if (card.order.type !== "attack") {
        expect(card.ratio).toBeNull()
        continue
      }
      const figure = card.odds?.match(/(\d+(?:\.\d+)?)\s*:\s*1/)
      if (figure) expect(Number(card.ratio).toFixed(2)).toBe(Number(figure[1]).toFixed(2))
      else if (/undefended/i.test(card.odds ?? "")) expect(card.ratio).toBe(Infinity)
    }
  })

  it("fills card and province placeholders and leaves an unknown one neutral", () => {
    const map = createInitialState()
    const cards = [
      attackCard("card1", "kielce", 2.09),
      attackCard("card2", "lublin", 0.55),
    ]
    const filled = reconcileReplyWithCards(
      "Kielce is {odds:card1}. Lublin is {odds:card2}. One column is {odds:kielce}.",
      cards,
      map,
    )
    const source = "Kielce is {odds:card1}. Lublin is {odds:card2}. One column is {odds:kielce}."
    expect(filled).toBe(
      `Kielce is 2.09 : 1. Lublin is 0.55 : 1. One column is ${singleFigure(map, "kielce")} : 1.`,
    )
    expect(reconcileReplyWithCards(source, cards, map)).toBe(filled)
    const unknown = reconcileReplyWithCards("The figure is {odds:card9}. Also {odds:not-a-province}.", cards, map)
    expect(unknown).toBe("The figure is uncertain odds. Also uncertain odds.")
    expect(unknown).not.toMatch(/\d/)
    const invalid = attackCard("card1", "kielce", 2.09)
    invalid.valid = false
    expect(reconcileReplyWithCards("Try {odds:card1}.", [invalid], map)).toBe("Try uncertain odds.")
    expect(reconcileReplyWithCards("Memel is {odds:klaipeda}.", [], map)).toBe("Memel is undefended.")
  })

  it("keeps a single-column placeholder distinct from the pooled attack", () => {
    const map = createInitialState()
    const katowice = map.provinces.find((province) => province.id === "katowice")!
    const column = engagementOdds(
      map,
      "katowice",
      "kielce",
      katowice.units.filter((unit) => unit.faction === "central").map((unit) => unit.id),
    )
    expect(column && Number.isFinite(column.ratio)).toBeTruthy()
    const card = attackCard("card1", "kielce", column!.ratio)
    card.order = { type: "attack", from: "katowice", target: "kielce", unitIds: ["g-kat-inf"] }
    const alone = reconcileReplyWithCards(
      "The Katowice column alone against Kielce is {odds:card1}.",
      [card],
      map,
    )
    const pooled = reconcileReplyWithCards("The pooled attack on Kielce is {odds:combined:kielce}.", [card], map)
    const best = reconcileReplyWithCards("The strongest single column is {odds:kielce}.", [card], map)
    expect(alone).toBe(`The Katowice column alone against Kielce is ${column!.ratio.toFixed(2)} : 1.`)
    expect(pooled).toMatch(/The pooled attack on Kielce is \d+\.\d{2} : 1\./)
    const pooledFigure = pooled.match(/(\d+\.\d{2}) : 1/)?.[1]
    const bestFigure = best.match(/(\d+\.\d{2}) : 1/)?.[1]
    expect(pooledFigure).not.toBe(column!.ratio.toFixed(2))
    expect(bestFigure).not.toBe(pooledFigure)
    expect(alone).not.toContain("8.34")
  })

  it("drops a raw odds sentence instead of rewriting it onto the combined figure", () => {
    const map = createInitialState()
    const out = reconcileReplyWithCards(
      "The Katowice column alone against Kielce is about 0.94 : 1.",
      [attackCard("card1", "kielce", 8.34)],
      map,
    )
    expect(out).not.toMatch(/alone against Kielce/)
    expect(out).not.toContain("0.94")
    expect(out).not.toMatch(/alone against Kielce[^.]{0,80}8\.34/)
    expect(out).toBe("Attack kielce: 8.34 : 1.")
    const kept = reconcileReplyWithCards(
      "The Katowice column alone against Kielce is about 0.94 : 1. Lemberg is the prize.",
      [attackCard("card1", "kielce", 8.34)],
      map,
    )
    expect(kept).toBe("Lemberg is the prize.")
    expect(kept).not.toContain("8.34")
    expect(kept).not.toContain("0.94")
  })

  it("drops each raw odds spelling and leaves the rest of the paragraph", () => {
    const map = createInitialState()
    const cards = [attackCard("card1", "kielce", 2.09), attackCard("card2", "lublin", 0.55)]
    expect(reconcileReplyWithCards("Hold the shoulder. Kielce is 3:1.", cards, map)).toBe("Hold the shoulder.")
    expect(reconcileReplyWithCards("Hold the shoulder. The odds of 8 at Kielce.", cards, map)).toBe("Hold the shoulder.")
    expect(reconcileReplyWithCards("Hold the shoulder. The ratio is 3 to 1 at Kielce.", cards, map)).toBe(
      "Hold the shoulder.",
    )
    expect(reconcileReplyWithCards("Kielce is {odds:card1} or 9.99 : 1.", cards, map)).toBe(
      "Attack kielce: 2.09 : 1. Attack lublin: 0.55 : 1.",
    )
    expect(reconcileReplyWithCards("Memel is open country at 9.99 : 1.", [], map)).toBe(
      "The engine has no confirmed odds for that.",
    )
    expect(
      reconcileReplyWithCards("Kielce looks like 0.94 : 1 and Lublin 3.06 : 1. Lemberg is the prize.", cards, map),
    ).toBe("Lemberg is the prize.")
  })

  it("does not rewrite a sentence that names three targets", () => {
    const map = createInitialState()
    const reply = "Suwałki is about 4.20 : 1, Białystok is about 6.51 : 1, and Płock is about 6.51 : 1. Hold the line."
    const cards = [
      attackCard("card1", "suduva", 1.11),
      attackCard("card2", "bialystok", 2.22),
      attackCard("card3", "plock", 3.33),
    ]
    const out = reconcileReplyWithCards(reply, cards, map)
    expect(out).toBe("Hold the line.")
    expect(out).not.toMatch(/4\.20|6\.51|1\.11|2\.22|3\.33/)
    expect(out).not.toMatch(/Suwałki|Białystok|Płock/)
    const placed = reconcileReplyWithCards(
      "Suwałki is {odds:card1}, Białystok is {odds:card2}, and Płock is {odds:card3}.",
      cards,
      map,
    )
    expect(placed).toBe("Suwałki is 1.11 : 1, Białystok is 2.22 : 1, and Płock is 3.33 : 1.")
  })

  it("drops broken sentences without leaving a dangling fragment", () => {
    const map = createInitialState()
    const broken = "Kielce from Kraków is; The odds are. is, so pool it. or Nowogródek,;"
    expect(reconcileReplyWithCards(broken, [], map)).toBe("The engine has no confirmed odds for that.")
    const mixed = "Send 2 to 3 corps. Kielce from Kraków is; The odds are. is, so pool it. or Nowogródek,;"
    expect(reconcileReplyWithCards(mixed, [], map)).toBe("Send 2 to 3 corps.")
    expect(reconcileReplyWithCards("Send 2 to 3 corps; Kielce is 0.94 : 1.", [], map)).toBe("Send 2 to 3 corps.")
  })

  it("leaves non-odds numbers untouched", () => {
    const map = createInitialState()
    const prose = [
      "Send 2 to 3 corps.",
      "Wait a fortnight 3 to 4.",
      "Expect 1 to 2 marches.",
      "Supply is 60%.",
      "Hold a 2-3 : 1 range on the shoulder.",
      "Send 3 to 1 corps down the road.",
      "Kielce is 3-to-1 on the map sketch.",
      "Lublin is 5 to 2 in the old note.",
    ].join(" ")
    expect(reconcileReplyWithCards(prose, [attackCard("card1", "kielce", 8.34)], map)).toBe(prose)
    expect(reconcileReplyWithCards(prose, [], map, "engine")).toBe(prose)
  })

  it("keeps engine prose, including a real ratio, when the reply is not model text", () => {
    const map = createInitialState()
    const reply = "Kielce is about 2.09 : 1. The odds are 3 to 1."
    expect(reconcileReplyWithCards(reply, [], map, "engine")).toBe(reply)
    expect(reconcileReplyWithCards("One column is {odds:kielce}.", [], map, "engine")).toBe(
      `One column is ${singleFigure(map, "kielce")} : 1.`,
    )
  })

  it("uses a pooled placeholder only when two columns can march", () => {
    const map = createInitialState()
    const single = reconcileReplyWithCards("Alone {odds:kielce}.", [], map)
    const pooled = reconcileReplyWithCards("Pooled {odds:combined:kielce}.", [], map)
    expect(single).not.toBe(pooled)
    expect(pooled).not.toContain("uncertain")
    const oneColumn = map.provinces.find((province) => {
      if (province.controller !== "russia") return false
      const neighbors = map.provinces.filter(
        (from) => from.controller === "central" && from.supply >= 30 && from.neighbors.includes(province.id),
      )
      return neighbors.length === 1 && province.units.some((unit) => unit.faction === province.controller)
    })
    expect(oneColumn).toBeTruthy()
    const text = reconcileReplyWithCards(`Check {odds:${oneColumn!.id}} and {odds:combined:${oneColumn!.id}}.`, [], map)
    expect(text).toMatch(new RegExp(`Check \\d+\\.\\d{2} : 1 and uncertain odds\\.`))
  })
})

function attackCard(id: string, target: string, ratio: number, companions: AdvisorOrder[] = []): AdvisorCard {
  return {
    id,
    order: { type: "attack", from: "krakow", target, unitIds: ["g-kra-11"] },
    companions,
    label: `Attack ${target}`,
    valid: true,
    note: null,
    odds: `About ${ratio.toFixed(2)} : 1 before the dice.`,
    ratio,
    detail: null,
  }
}

function singleFigure(map: GameState, targetId: string): string {
  const ratios: number[] = []
  for (const province of map.provinces) {
    if (province.controller !== "central" || province.supply < 30) continue
    if (!province.neighbors.includes(targetId)) continue
    const available = independentFormations(province.units.filter((unit) => unit.faction === "central"))
    const chosen = leaveDepotGarrison(available, province.depot === "central", false)
    if (!chosen.length) continue
    const preview = engagementOdds(
      map,
      province.id,
      targetId,
      chosen.map((unit) => unit.id),
    )
    if (preview && !preview.empty && Number.isFinite(preview.ratio)) ratios.push(preview.ratio)
  }
  return Math.max(...ratios).toFixed(2)
}

describe("advisor guard", () => {
  beforeEach(() => {
    resetTurnGuardStateForTests()
    delete process.env.TURN_API_TOKEN
    delete process.env.TURN_ALLOWED_ORIGINS
    delete process.env.TURN_MAX_BODY_BYTES
    delete process.env.TURN_RATE_LIMIT_MAX
    delete process.env.TURN_RATE_LIMIT_WINDOW_MS
    delete process.env.LLM_API_KEY
  })

  it("rejects an oversized body", async () => {
    process.env.TURN_MAX_BODY_BYTES = "128"
    const response = await postAdvisor("{}", { "content-length": "1000" })
    expect(response.status).toBe(413)
  })

  it("rate limits by client ip", async () => {
    process.env.TURN_RATE_LIMIT_MAX = "1"
    const headers = { "x-forwarded-for": "203.0.113.9" }
    const first = await postAdvisor({ state: createInitialState(), messages: [], queuedOrders: [] }, headers)
    expect(first.status).toBe(200)
    const second = await postAdvisor({ state: createInitialState(), messages: [], queuedOrders: [] }, headers)
    expect(second.status).toBe(429)
  })

  it("rejects a foreign origin when origins are configured", async () => {
    process.env.TURN_ALLOWED_ORIGINS = "https://ostfront.example"
    const response = await postAdvisor(
      { state: createInitialState(), messages: [], queuedOrders: [] },
      { origin: "https://evil.example" },
    )
    expect(response.status).toBe(403)
  })

  it("requires the turn token when one is configured", async () => {
    process.env.TURN_API_TOKEN = "secret"
    const denied = await postAdvisor({ state: createInitialState(), messages: [], queuedOrders: [] })
    expect(denied.status).toBe(401)
    const allowed = await postAdvisor(
      { state: createInitialState(), messages: [], queuedOrders: [] },
      { "x-ostfront-turn-token": "secret" },
    )
    expect(allowed.status).toBe(200)
  })

  it("rejects a body that is not the advisor schema", async () => {
    const response = await postAdvisor({ messages: [] })
    expect(response.status).toBe(400)
  })
})
