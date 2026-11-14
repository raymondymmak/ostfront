import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetTurnGuardStateForTests } from "@/lib/api/turn-guard"
import { jsonHasNoSeed } from "@/lib/campaign/public-state"
import { resetCampaignSerializeForTests } from "@/lib/campaign/serialize"
import {
  createStoredCampaign,
  loadStoredCampaign,
  resetCampaignStoreForTests,
} from "@/lib/campaign/store"
import { playTurn } from "@/lib/gm"
import type { PlayerOrder } from "@/lib/types"

async function postNewGame(body: unknown) {
  const { POST } = await import("@/app/api/new-game/route")
  return POST(
    new Request("https://example.com/api/new-game", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

async function postTurn(body: unknown) {
  const { POST } = await import("@/app/api/turn/route")
  return POST(
    new Request("https://example.com/api/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

async function getGame(gameId: string) {
  const { GET } = await import("@/app/api/game/route")
  return GET(new Request(`https://example.com/api/game?gameId=${gameId}`))
}

describe("server-owned campaign", () => {
  beforeEach(() => {
    resetTurnGuardStateForTests()
    resetCampaignStoreForTests()
    resetCampaignSerializeForTests()
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.VERCEL_ENV
    delete process.env.LLM_API_KEY
    vi.unstubAllEnvs()
  })

  it("rejects client-sent authoritative state on /api/turn", async () => {
    const created = await createStoredCampaign("normal")
    const response = await postTurn({
      gameId: created.gameId,
      expectedTurn: 0,
      orders: [],
      state: { forged: true },
    })
    expect(response.status).toBe(400)
  })

  it("rejects a stale expected turn", async () => {
    const created = await createStoredCampaign("normal")
    const first = await postTurn({ gameId: created.gameId, expectedTurn: 0, orders: [] })
    expect(first.status).toBe(200)
    const stale = await postTurn({ gameId: created.gameId, expectedTurn: 0, orders: [] })
    expect(stale.status).toBe(409)
    const payload = (await stale.json()) as { code?: string }
    expect(payload.code).toBe("stale_turn")
  })

  it("allows exactly one of ten parallel turns at the same expectedTurn", async () => {
    const created = await createStoredCampaign("normal")
    const requests = Array.from({ length: 10 }, () =>
      postTurn({ gameId: created.gameId, expectedTurn: 0, orders: [] }),
    )
    const responses = await Promise.all(requests)
    const winners = responses.filter((response) => response.status === 200)
    const losers = responses.filter((response) => response.status === 409)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(9)
    for (const response of losers) {
      const payload = (await response.json()) as { code?: string }
      expect(payload.code === "stale_turn" || payload.code === "storage_conflict").toBe(true)
    }
    const reloaded = await loadStoredCampaign(created.gameId)
    expect(reloaded?.head.turn).toBe(1)
  })

  it("matches outcomes when the same seed and orders are replayed from stored state", async () => {
    const seed = 42424242
    const { gameId } = await createStoredCampaign("normal", seed)
    const stored = await loadStoredCampaign(gameId)
    expect(stored?.head.seed).toBe(seed)
    const state = { ...stored!.save.state, seed: stored!.head.seed }
    const orders: PlayerOrder[] = [{ type: "fortify", provinceId: "krakow" }]
    const once = await playTurn(state, orders)
    const twice = await playTurn(state, orders)
    expect(twice.record.resolutions).toEqual(once.record.resolutions)
    expect(twice.state).toEqual(once.state)
  })

  it("never returns combat seeds in campaign API JSON", async () => {
    const created = await createStoredCampaign("normal", 99887766)
    const createdViaApi = await postNewGame({ difficulty: "normal" })
    const newBody = await createdViaApi.json()

    const turn = await postTurn({ gameId: created.gameId, expectedTurn: 0, orders: [] })
    const turnBody = await turn.json()

    const loaded = await getGame(created.gameId)
    const loadBody = await loaded.json()

    expect(jsonHasNoSeed(newBody)).toBe(true)
    expect(jsonHasNoSeed(turnBody)).toBe(true)
    expect(jsonHasNoSeed(loadBody)).toBe(true)
    expect(storedHeadSeedNotInText(JSON.stringify(turnBody), 99887766)).toBe(true)
    expect(storedHeadSeedNotInText(JSON.stringify(loadBody), 99887766)).toBe(true)
  })

  it("returns 503 on preview without Redis configured", async () => {
    process.env.VERCEL_ENV = "preview"
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    const response = await postNewGame({ difficulty: "normal" })
    expect(response.status).toBe(503)
    const payload = (await response.json()) as { code?: string }
    expect(payload.code).toBe("storage_unavailable")
  })

  it("assigns a fresh seed per new game", async () => {
    const a = await createStoredCampaign("normal", 111)
    const b = await createStoredCampaign("normal", 222)
    expect(a.save.state.seed).toBe(111)
    expect(b.save.state.seed).toBe(222)
    const viaApi = await postNewGame({ difficulty: "normal" })
    const payload = (await viaApi.json()) as { state: Record<string, unknown> }
    expect("seed" in payload.state).toBe(false)
  })
})

function storedHeadSeedNotInText(text: string, seed: number): boolean {
  return !text.includes(String(seed))
}
