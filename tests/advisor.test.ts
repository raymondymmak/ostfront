import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { engagementOdds } from "@/lib/engine/turn"
import { advise, buildSituation, renderSituation, scrubAdvisorReply, staffMap } from "@/lib/gm/advisor"
import { readMessageContent } from "@/lib/gm/llm"
import { resetTurnGuardStateForTests } from "@/lib/api/turn-guard"
import type { AdvisorCard, AdvisorResponse } from "@/lib/gm/advisor-types"

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
