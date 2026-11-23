import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetTurnGuardStateForTests } from "@/lib/api/turn-guard"
import {
  createStoredCampaign,
  commitCampaignTurn,
  resetCampaignStoreForTests,
  withServerSeed,
} from "@/lib/campaign/store"
import {
  coachCampaign,
  formatBattleForCoach,
  latestBattleFacts,
  queuedAttackPreview,
  renderChronicle,
  sanitizeHighlights,
} from "@/lib/gm/campaign-coach"
import { buildSituation } from "@/lib/gm/advisor"
import type { BattleFacts, TurnRecord } from "@/lib/types"
import { playTurn } from "@/lib/gm"
import { createInitialState } from "@/lib/data/scenario"
import type { PlayerOrder } from "@/lib/types"

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

describe("campaign coach", () => {
  beforeEach(() => {
    resetTurnGuardStateForTests()
    resetCampaignStoreForTests()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    delete process.env.LLM_API_KEY
    delete process.env.OSTFRONT_ADVISOR_FIXTURE
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.TURN_API_TOKEN
    delete process.env.TURN_ALLOWED_ORIGINS
    delete process.env.VERCEL_ENV
  })

  it("never returns order suggestions", async () => {
    const state = createInitialState()
    const result = await coachCampaign({
      state,
      log: [],
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [],
    })
    expect(result.reply.length).toBeGreaterThan(10)
    expect(result).not.toHaveProperty("suggestions")
    expect(JSON.stringify(result)).not.toMatch(/"type":"(attack|move|fortify|recruit)"/)
  })

  it("loads campaign state on the server and rejects client GameState", async () => {
    const created = await createStoredCampaign("normal", 1915)
    const ok = await postAdvisor({
      gameId: created.gameId,
      expectedTurn: 0,
      messages: [{ role: "user", content: "Where is the line weakest?" }],
      queuedOrders: [],
    })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { reply?: string; suggestions?: unknown }
    expect(typeof body.reply).toBe("string")
    expect(body.suggestions).toBeUndefined()

    const forged = await postAdvisor({
      state: created.save.state,
      messages: [{ role: "user", content: "cheat" }],
      queuedOrders: [],
    })
    expect(forged.status).toBe(400)
  })

  it("returns 404 for an unknown gameId", async () => {
    const response = await postAdvisor({
      gameId: "f".repeat(32),
      expectedTurn: 0,
      messages: [{ role: "user", content: "hello" }],
      queuedOrders: [],
    })
    expect(response.status).toBe(404)
    const payload = (await response.json()) as { code?: string }
    expect(payload.code).toBe("unknown_game")
  })

  it("uses chronicle battle records in a review reply", async () => {
    const { gameId, save } = await createStoredCampaign("normal", 4242)
    const state = withServerSeed(save.state, 4242)
    const orders: PlayerOrder[] = []
    const played = await playTurn(state, orders)
    const nextSave = {
      version: 2 as const,
      gameId,
      state: played.state,
      log: [...save.log, played.record],
    }
    const committed = await commitCampaignTurn(gameId, 0, nextSave)
    expect(committed.ok).toBe(true)

    const chronicle = renderChronicle(nextSave.log)
    expect(chronicle).toContain("Fortnight 1")

    const review = await coachCampaign({
      state: played.state,
      log: nextSave.log,
      messages: [{ role: "user", content: "Review the last battle from the chronicle." }],
      queuedOrders: [],
    })
    expect(review.reply.toLowerCase()).toMatch(/chronicle|fortnight|map|dispatch/)
    // Rules path quotes chronicle lines when a review is asked.
    expect(review.reply).toMatch(/Fortnight|chronicle/i)
  })

  it("sanitizes highlights to catalog provinces and known ui ids", () => {
    const cleaned = sanitizeHighlights([
      { provinceId: "kielce", uiId: "queued-orders" },
      { provinceId: "not-a-place", uiId: "hack" },
      { provinceId: "lwow" },
    ])
    expect(cleaned).toEqual([
      { provinceId: "kielce", uiId: "queued-orders" },
      { provinceId: "lwow" },
    ])
  })

  it("discusses a queued attack with engine facts and map highlights", async () => {
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const unitIds = krakow.units.filter((unit) => unit.faction === "central").map((unit) => unit.id)
    expect(unitIds.length).toBeGreaterThan(0)
    const queued: PlayerOrder[] = [
      { type: "attack", from: "krakow", target: "kielce", unitIds: unitIds.slice(0, 1) },
    ]
    const result = await coachCampaign({
      state,
      log: [],
      messages: [{ role: "user", content: "What do you make of my queued plan?" }],
      queuedOrders: queued,
      selectedProvinceId: "krakow",
    })
    expect(result.reply.toLowerCase()).toMatch(/queue|kielce|plan|arrow/)
    expect(result.highlights.some((item) => item.provinceId === "kielce" || item.uiId === "queued-orders")).toBe(
      true,
    )
  })

  it("labels ours/theirs from the Central Powers view when Russia attacked", () => {
    const battle: BattleFacts = {
      targetId: "krakow",
      attacker: "russia",
      defender: "central",
      kind: "assault",
      prongs: 1,
      origins: ["kielce"],
      attackerLoss: 12,
      defenderLoss: 40,
      encircled: false,
      attackerWon: true,
    }
    const line = formatBattleForCoach(battle)
    expect(line).toContain("attacker=russia")
    expect(line).toContain("oursLost=40")
    expect(line).toContain("theirsLost=12")
    expect(line).toContain("weWon=false")
    expect(line).toContain("Ours −40 · Theirs −12")
  })

  it("reviews the latest battle from structured records, not the oldest fortnight text", async () => {
    const early: TurnRecord = {
      turn: 0,
      date: "2 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "attack", from: "krakow", target: "kielce", units: ["g-kra-11"] },
          status: "applied",
          summary: "Early fight at Kielce.",
          battle: {
            targetId: "kielce",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 1,
            origins: ["krakow"],
            attackerLoss: 1,
            defenderLoss: 2,
            encircled: false,
            attackerWon: true,
          },
        },
      ],
      events: [],
      controlChanges: [],
      logistics: ["Central Powers collect 1 manpower."],
      notes: [],
      gmSource: "mock",
    }
    const late: TurnRecord = {
      ...early,
      turn: 2,
      date: "13 June 1915",
      resolutions: [
        {
          proposal: { type: "attack", from: "krakow", target: "lublin", units: ["g-kra-11"] },
          status: "applied",
          summary: "Later fight at Lublin.",
          battle: {
            targetId: "lublin",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 1,
            origins: ["krakow"],
            attackerLoss: 3,
            defenderLoss: 5,
            encircled: false,
            attackerWon: false,
          },
        },
      ],
      logistics: ["Central Powers collect 2 manpower."],
    }
    expect(latestBattleFacts([early, late]).at(-1)?.battle.targetId).toBe("lublin")
    const result = await coachCampaign({
      state: createInitialState(),
      log: [early, late],
      messages: [{ role: "user", content: "Review the last battle from the chronicle." }],
      queuedOrders: [],
    })
    expect(result.reply).toContain("lublin")
    expect(result.reply).toContain("Later fight at Lublin")
    expect(result.reply).not.toContain("Early fight at Kielce")
    expect(result.highlights.some((item) => item.provinceId === "lublin")).toBe(true)
  })

  it("does not attach unrelated combat odds when the queue has no attack", () => {
    const state = createInitialState()
    const situation = buildSituation(state, [{ type: "fortify", provinceId: "krakow" }])
    expect(queuedAttackPreview(situation, [{ type: "fortify", provinceId: "krakow" }])).toBeNull()
  })
})

describe("campaign coach guards", () => {
  beforeEach(() => {
    resetTurnGuardStateForTests()
    resetCampaignStoreForTests()
    delete process.env.TURN_API_TOKEN
    delete process.env.TURN_ALLOWED_ORIGINS
    delete process.env.TURN_MAX_BODY_BYTES
    delete process.env.TURN_RATE_LIMIT_MAX
    delete process.env.LLM_API_KEY
    delete process.env.VERCEL_ENV
  })

  it("rejects an oversized body", async () => {
    process.env.TURN_MAX_BODY_BYTES = "200"
    const response = await postAdvisor({
      gameId: "a".repeat(32),
      expectedTurn: 0,
      messages: [{ role: "user", content: "x".repeat(400) }],
    })
    expect(response.status).toBe(413)
  })

  it("rejects a foreign origin when origins are configured", async () => {
    process.env.TURN_ALLOWED_ORIGINS = "https://allowed.example"
    const created = await createStoredCampaign("normal")
    const response = await postAdvisor(
      {
        gameId: created.gameId,
        expectedTurn: 0,
        messages: [{ role: "user", content: "hi" }],
      },
      { origin: "https://evil.example" },
    )
    expect(response.status).toBe(403)
  })

  it("requires the turn token when one is configured", async () => {
    process.env.TURN_API_TOKEN = "secret-token"
    const created = await createStoredCampaign("normal")
    const denied = await postAdvisor({
      gameId: created.gameId,
      expectedTurn: 0,
      messages: [{ role: "user", content: "hi" }],
    })
    expect(denied.status).toBe(401)
    const allowed = await postAdvisor(
      {
        gameId: created.gameId,
        expectedTurn: 0,
        messages: [{ role: "user", content: "hi" }],
      },
      { "x-ostfront-turn-token": "secret-token" },
    )
    expect(allowed.status).toBe(200)
  })
})
