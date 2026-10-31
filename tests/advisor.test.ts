import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { ENCIRCLEMENT_DEFENDER_LOSS, flankMultiplier } from "@/lib/engine/combat"
import { combinedEngagementOdds, engagementOdds, resolveTurn } from "@/lib/engine/turn"
import { advise, buildSituation, finishAdvisorReply, renderSituation, scrubAdvisorReply, staffMap } from "@/lib/gm/advisor"
import { refreshAdvisorCards } from "@/lib/gm/advisor-cards"
import { readMessageContent } from "@/lib/gm/llm"
import { resetTurnGuardStateForTests } from "@/lib/api/turn-guard"
import { applyAdvisorToQueue, combinedQueueLines } from "@/lib/orders"
import { advisorCardAction, type AdvisorCard, type AdvisorOrder, type AdvisorResponse } from "@/lib/gm/advisor-types"

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
    expect(payload.reply).toMatch(/one battle/i)
    expect(payload.reply).toContain(String(flankMultiplier(4)))
    expect(payload.reply).toContain(preview!.ratio.toFixed(2))
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

    const logged: string[] = []
    const spy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logged.push(String(message))
    })
    const response = await postAdvisor({
      state,
      messages: [{ role: "user", content: "Where is the Russian line weakest?" }],
      queuedOrders: [],
    })
    spy.mockRestore()
    const dropReasons = logged.flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as { tag?: string; reasons?: string[] }
        return parsed.tag === "ostfront.advisor.dropped" ? (parsed.reasons ?? []) : []
      } catch {
        return []
      }
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
    expect(payload.suggestions.some((card) => card.order.type === "fortify")).toBe(false)
    expect(payload.suggestions.some((card) => card.queue === "new" && card.order.type === "fortify")).toBe(false)
    expect(payload.dropped).toBeGreaterThanOrEqual(4)
    expect(dropReasons.some((reason) => /already fortified to level 3/i.test(reason))).toBe(true)
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

  it("keeps main's rules-path wording on a quiet opening", async () => {
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [],
    })
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.source).toBe("rules")
    expect(payload.reply).toMatch(/the engine rates/)
    expect(payload.reply).toMatch(/About \d+\.\d{2} : 1 before the dice/)
    expect(payload.reply).toContain(
      "These odds are against the garrison as it stands. A simultaneous march can change the fight.",
    )
    expect(payload.reply).not.toMatch(/I would march/)
    expect(payload.reply).not.toContain("This is against the garrison")
  })

  it("digs at Königsberg when the Kielce march would empty the Kraków depot", async () => {
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [
        { type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11", "g-kra-x", "g-kra-grd"] },
      ],
    })
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.source).toBe("rules")
    expect(payload.reply).toContain("Königsberg can still dig.")
    expect(payload.reply).toMatch(/the engine rates/)
    expect(payload.reply).toContain("These odds are against the garrison as it stands.")
    expect(
      payload.suggestions.some(
        (card) => card.order.type === "attack" && card.order.unitIds.length === 1 && card.order.unitIds[0] === "g-kra-art",
      ),
    ).toBe(false)
    expect(payload.suggestions.some((card) => card.order.type === "fortify" && card.order.provinceId === "konigsberg")).toBe(
      true,
    )
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
    expect(card?.valid).toBe(true)
    expect(card?.queue).toBe("conflict")
    expect(card?.conflict).toMatch(/Attack Kielce from Kraków/)
    expect(card?.order).toMatchObject({ type: "move", unitId: "g-kra-11", to: "katowice" })
    expect(payload.dropped).toBe(0)
  })

  it("flags a formation named in words that is already in the queue", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "The 11th Army is already committed.",
              suggestions: [{ type: "move", unitId: "German 11th Army", to: "Katowice" }],
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
    expect(card?.valid).toBe(true)
    expect(card?.queue).toBe("conflict")
    expect(card?.conflict).toMatch(/Attack Kielce from Kraków/)
    expect(card?.order).toMatchObject({ type: "move", unitId: "g-kra-11", to: "katowice" })
    expect(payload.dropped).toBe(0)
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

  it("shows an exact queued order and disables accept", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "That attack is already on the slate.",
              suggestions: [
                { type: "attack", from: "Kraków", target: "Kielce", unitIds: "G-KRA-11" },
              ],
            }),
          ),
        ),
      ),
    )
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "Repeat the Kielce attack." }],
      queuedOrders: [{ type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11"] }],
    })
    const payload = (await response.json()) as AdvisorResponse
    const card = payload.suggestions.find(
      (item) => item.order.type === "attack" && item.order.unitIds.includes("g-kra-11"),
    )
    expect(card?.queue).toBe("duplicate")
    expect(card?.valid).toBe(true)
    expect(advisorCardAction(card!)).toBe("disabled")
    expect(payload.dropped).toBe(0)
    expect(payload.reply).not.toMatch(/\d+(?:\.\d+)?\s*:\s*1/)
  })

  it("repairs an attack that names the provinces and not the formations", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "March from Gorlice on Kielce.",
              suggestions: [{ type: "attack", from: "Gorlice", target: "Kielce" }],
            }),
          ),
        ),
      ),
    )
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [],
    })
    const payload = (await response.json()) as AdvisorResponse
    const card = payload.suggestions.find((item) => item.order.type === "attack" && item.order.target === "kielce")
    expect(card?.valid).toBe(true)
    expect(card?.queue).toBe("new")
    expect(card?.order.type === "attack" && card.order.unitIds.length).toBeGreaterThan(0)
    expect(payload.dropped).toBe(0)
  })

  it("falls back to a rules card when every model suggestion is illegal", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "Hold.",
              suggestions: [{ type: "move", unitId: "no-such-corps", to: "nowhere" }],
            }),
          ),
        ),
      ),
    )
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [],
    })
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.dropped).toBeGreaterThanOrEqual(1)
    expect(payload.suggestions.some((card) => card.valid && card.queue === "new")).toBe(true)
    expect(payload.reply).not.toMatch(/\d+(?:\.\d+)?\s*:\s*1/)
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
    { text: "Kielce stands at odds:card1}.", keep: "Kielce stands at odds:card1." },
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
    { text: "odds:card99}", keep: "odds:card99" },
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
    { text: "Unclosed {odds:card1 and the corps stays.", keep: "Unclosed odds:card1 and the corps stays." },
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
    { text: "Start {odds:card1\nNext line stays.", keep: "Start odds:card1\nNext line stays." },
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
  ]

  it("strips only the token and keeps the text around it", () => {
    expect(forms).toHaveLength(89)
    for (const item of forms) {
      expect(finishAdvisorReply(item.text), item.text).toBe(item.keep)
    }
  })

  it("never leaves a brace", () => {
    for (const item of forms) {
      expect(finishAdvisorReply(item.text), item.text).not.toMatch(/[{}\uFF5B\uFF5D]/)
    }
  })
})

describe("advisor queue override", () => {
  it("replaces one division and keeps the rest of the column", () => {
    const state = createInitialState()
    const queue = [
      { id: "a", kind: "attack" as const, from: "krakow", to: "kielce", unitIds: ["g-kra-11", "g-kra-x"] },
      { id: "b", kind: "move" as const, from: "poznan", to: "lodz", unitIds: ["g-pos-inf"] },
    ]
    const filed = applyAdvisorToQueue(
      state,
      queue,
      [{ type: "move", unitId: "g-kra-11", to: "katowice" }],
      "override",
    )
    expect(filed.accepted).toBe(true)
    const attack = filed.queue.find((order) => order.kind === "attack")
    expect(attack?.unitIds).toEqual(["g-kra-x"])
    expect(attack?.to).toBe("kielce")
    expect(filed.queue.filter((order) => order.kind === "attack")).toHaveLength(1)
    const moved = filed.queue.find((order) => order.kind === "move" && order.to === "katowice")
    expect(moved?.unitIds).toEqual(["g-kra-11"])
    expect(filed.queue.some((order) => order.unitIds.includes("g-pos-inf"))).toBe(true)
  })

  it("replaces a column instead of adding a second one", () => {
    const state = createInitialState()
    const queue = [{ id: "a", kind: "attack" as const, from: "krakow", to: "kielce", unitIds: ["g-kra-11"] }]
    const filed = applyAdvisorToQueue(
      state,
      queue,
      [{ type: "attack", from: "krakow", target: "lwow", unitIds: ["g-kra-11"] }],
      "override",
    )
    expect(filed.accepted).toBe(true)
    expect(filed.queue).toHaveLength(1)
    expect(filed.queue[0]?.to).toBe("lwow")
    expect(filed.queue[0]?.unitIds).toEqual(["g-kra-11"])
  })

  it("does not file an exact duplicate a second time", () => {
    const state = createInitialState()
    const queue = [{ id: "a", kind: "attack" as const, from: "krakow", to: "kielce", unitIds: ["g-kra-11"] }]
    const filed = applyAdvisorToQueue(
      state,
      queue,
      [{ type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11"] }],
      "accept",
    )
    expect(filed.accepted).toBe(false)
    expect(filed.reason).toMatch(/Already queued/)
    expect(filed.queue).toHaveLength(1)
    expect(filed.queue[0]?.id).toBe("a")
  })

  it("refuses a stale multi-prong accept that would drop a column", () => {
    const state = createInitialState()
    const queue = [{ id: "a", kind: "attack" as const, from: "krakow", to: "lwow", unitIds: ["g-kra-11"] }]
    const filed = applyAdvisorToQueue(
      state,
      queue,
      [
        { type: "attack", from: "krakow", target: "lwow", unitIds: ["g-kra-11"] },
        { type: "attack", from: "stanislawow", target: "lwow", unitIds: ["g-sta-cav"] },
        { type: "attack", from: "bucovina", target: "lwow", unitIds: ["g-buc-inf"] },
      ],
      "accept",
    )
    expect(filed.accepted).toBe(false)
    expect(filed.reason).toMatch(/Nothing was filed/)
    expect(filed.reason).toMatch(/Override/)
    expect(filed.queue).toHaveLength(1)
    expect(filed.queue[0]?.unitIds).toEqual(["g-kra-11"])
    expect(filed.queue.some((order) => order.from === "stanislawow" || order.from === "bucovina")).toBe(false)
  })

  it("shows a message when a stale single card is accepted", () => {
    const state = createInitialState()
    const queue = [{ id: "a", kind: "attack" as const, from: "krakow", to: "kielce", unitIds: ["g-kra-11"] }]
    const filed = applyAdvisorToQueue(
      state,
      queue,
      [{ type: "move", unitId: "g-kra-11", to: "katowice" }],
      "accept",
    )
    expect(filed.accepted).toBe(false)
    expect(filed.reason).toMatch(/Nothing was filed/)
    expect(filed.reason).toMatch(/Override|already/i)
    expect(filed.queue).toEqual(queue)
  })

  it("files every prong of a new concentric card", () => {
    const state = createInitialState()
    const filed = applyAdvisorToQueue(
      state,
      [],
      [
        { type: "attack", from: "krakow", target: "lwow", unitIds: ["g-kra-11"] },
        { type: "attack", from: "stanislawow", target: "lwow", unitIds: ["g-sta-cav"] },
        { type: "attack", from: "bucovina", target: "lwow", unitIds: ["g-buc-inf"] },
      ],
      "accept",
    )
    expect(filed.accepted).toBe(true)
    expect(filed.queue.map((order) => order.from).sort()).toEqual(["bucovina", "krakow", "stanislawow"])
  })

  it("refuses an order the engine can no longer apply", () => {
    const state = createInitialState()
    const queue = [{ id: "a", kind: "move" as const, from: "poznan", to: "lodz", unitIds: ["g-pos-inf"] }]
    const filed = applyAdvisorToQueue(
      state,
      queue,
      [{ type: "move", unitId: "g-buc-inf", to: "kielce" }],
      "accept",
    )
    expect(filed.accepted).toBe(false)
    expect(filed.reason).toMatch(/Nothing was filed/)
    expect(filed.queue).toEqual(queue)
  })
})

describe("advisor card refresh and ranking", () => {
  beforeEach(() => {
    resetTurnGuardStateForTests()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    delete process.env.LLM_API_KEY
    delete process.env.TURN_API_TOKEN
    delete process.env.TURN_ALLOWED_ORIGINS
    delete process.env.TURN_MAX_BODY_BYTES
    delete process.env.TURN_RATE_LIMIT_MAX
    delete process.env.TURN_RATE_LIMIT_WINDOW_MS
    process.env.LLM_MODEL = "z-ai/glm-5.3"
    process.env.LLM_BASE_URL = "https://llm.example/v1"
  })

  it("marks a new card as a conflict after the queue claims its formation", () => {
    const state = createInitialState()
    const card: AdvisorCard = {
      id: "card",
      order: { type: "move", unitId: "g-kra-11", to: "katowice" },
      companions: [],
      label: "Move the 11th Army to Katowice",
      valid: true,
      note: null,
      odds: null,
      detail: null,
      queue: "new",
      conflict: null,
    }
    const refreshed = refreshAdvisorCards(state, [card], [
      { type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11"] },
    ])
    expect(refreshed[0]?.queue).toBe("conflict")
    expect(refreshed[0]?.conflict).toMatch(/Attack Kielce from Kraków/)
    expect(advisorCardAction(refreshed[0]!)).toBe("override")
  })

  it("ranks a new card and a conflict ahead of duplicates that do not use the cap", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "Hold the line.",
              suggestions: [
                { type: "attack", from: "poznan", target: "lodz", unitIds: ["g-pos-inf"] },
                { type: "attack", from: "katowice", target: "kielce", unitIds: ["g-kat-inf"] },
                { type: "attack", from: "gdynia", target: "plock", unitIds: ["g-gdy-inf"] },
                { type: "move", unitId: "g-kra-11", to: "katowice" },
                { type: "attack", from: "bucovina", target: "lwow", unitIds: ["g-buc-inf"] },
              ],
            }),
          ),
        ),
      ),
    )
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [
        { type: "attack", from: "poznan", target: "lodz", unitIds: ["g-pos-inf"] },
        { type: "attack", from: "katowice", target: "kielce", unitIds: ["g-kat-inf"] },
        { type: "attack", from: "gdynia", target: "plock", unitIds: ["g-gdy-inf"] },
        { type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11"] },
      ],
    })
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.suggestions).toHaveLength(5)
    const states = payload.suggestions.map((card) => card.queue)
    expect(states.filter((item) => item === "duplicate")).toHaveLength(3)
    expect(states.filter((item) => item === "conflict")).toHaveLength(1)
    expect(states.filter((item) => item === "new")).toHaveLength(1)
    expect(states.indexOf("new")).toBeLessThan(states.indexOf("conflict"))
    expect(states.indexOf("conflict")).toBeLessThan(states.indexOf("duplicate"))
  })

  it("does not count a duplicate card's own formations twice", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "That attack is already on the slate.",
              suggestions: [{ type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11"] }],
            }),
          ),
        ),
      ),
    )
    const state = createInitialState()
    const response = await postAdvisor({
      state,
      messages: [{ role: "user", content: "Repeat the Kielce attack." }],
      queuedOrders: [{ type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11"] }],
    })
    const payload = (await response.json()) as AdvisorResponse
    const card = payload.suggestions.find(
      (item) => item.order.type === "attack" && item.order.unitIds.includes("g-kra-11"),
    )
    const preview = engagementOdds(staffMap(state), "krakow", "kielce", ["g-kra-11"])
    expect(card?.queue).toBe("duplicate")
    expect(preview).not.toBeNull()
    expect(card?.odds).toContain(preview!.ratio.toFixed(2))
    expect(card?.odds).not.toContain((preview!.ratio * 2).toFixed(2))
  })

  it("drops rule-breaking orders and still returns a card the player can accept", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "Hold.",
              suggestions: [
                { type: "move", unitId: "g-buc-inf", to: "kielce" },
                { type: "recruit", provinceId: "stanislawow", unitKind: "infantry" },
                { type: "move", unitId: "g-kra-11", to: "kielce" },
                { type: "attack", from: "krakow", target: "katowice", unitIds: ["g-kra-11"] },
              ],
            }),
          ),
        ),
      ),
    )
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [],
    })
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.dropped).toBeGreaterThanOrEqual(4)
    expect(payload.suggestions.some((card) => card.order.type === "move")).toBe(false)
    expect(payload.suggestions.some((card) => card.order.type === "recruit")).toBe(false)
    expect(
      payload.suggestions.some((card) => card.order.type === "attack" && card.order.target === "katowice"),
    ).toBe(false)
    expect(payload.suggestions.some((card) => card.valid && (card.queue === "new" || card.queue === "conflict"))).toBe(
      true,
    )
    expect(payload.suggestions.every((card) => card.valid)).toBe(true)
  })

  it("fills an actionable card when the reply is duplicates plus one illegal order", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "Hold the line.",
              suggestions: [
                { type: "attack", from: "poznan", target: "lodz", unitIds: ["g-pos-inf"] },
                { type: "attack", from: "katowice", target: "kielce", unitIds: ["g-kat-inf"] },
                { type: "attack", from: "gdynia", target: "plock", unitIds: ["g-gdy-inf"] },
                { type: "move", unitId: "g-buc-inf", to: "kielce" },
              ],
            }),
          ),
        ),
      ),
    )
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [
        { type: "attack", from: "poznan", target: "lodz", unitIds: ["g-pos-inf"] },
        { type: "attack", from: "katowice", target: "kielce", unitIds: ["g-kat-inf"] },
        { type: "attack", from: "gdynia", target: "plock", unitIds: ["g-gdy-inf"] },
      ],
    })
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.suggestions.filter((card) => card.queue === "duplicate")).toHaveLength(3)
    expect(JSON.stringify(payload.suggestions)).not.toContain("g-buc-inf")
    expect(payload.suggestions.some((card) => card.valid && card.queue === "new")).toBe(true)
  })

  it("warns when the card would send the depot's last formation", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "The guns can march.",
              suggestions: [{ type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-art"] }],
            }),
          ),
        ),
      ),
    )
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "And the artillery?" }],
      queuedOrders: [
        { type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11", "g-kra-x", "g-kra-grd"] },
      ],
    })
    const payload = (await response.json()) as AdvisorResponse
    const card = payload.suggestions.find(
      (item) => item.order.type === "attack" && item.order.unitIds.includes("g-kra-art"),
    )
    expect(card?.depotWarning).toMatch(/empties the Kraków depot/)
  })

  it("does not use a depot-emptying march as the fallback card", async () => {
    process.env.LLM_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          llmPayload(
            JSON.stringify({
              reply: "Hold.",
              suggestions: [{ type: "move", unitId: "g-buc-inf", to: "kielce" }],
            }),
          ),
        ),
      ),
    )
    const response = await postAdvisor({
      state: createInitialState(),
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [
        { type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11", "g-kra-x", "g-kra-grd"] },
      ],
    })
    const payload = (await response.json()) as AdvisorResponse
    expect(payload.suggestions.some((card) => card.valid && card.queue === "new")).toBe(true)
    expect(
      payload.suggestions.some(
        (card) => card.order.type === "attack" && card.order.unitIds.length === 1 && card.order.unitIds[0] === "g-kra-art",
      ),
    ).toBe(false)
  })
})

describe("advisor card markup", () => {
  const panel = readFileSync("components/advisor-panel.tsx", "utf8")

  it("marks duplicate, conflict, and new cards for the demo", () => {
    expect(panel).toContain('data-advisor-state={card.queue}')
    expect(panel).toContain("Already queued")
    expect(panel).toContain("Conflicts with:")
    expect(panel).toContain('data-testid="advisor-override"')
    expect(panel).toContain('data-testid="advisor-notice"')
    expect(panel).toContain('data-testid="advisor-depot-warning"')
    expect(panel).toContain("advisorCardAction")
    expect(panel).toContain("refreshAdvisorCards")
  })
})

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
