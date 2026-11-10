import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetTurnGuardStateForTests } from "@/lib/api/turn-guard"
import {
  createStoredCampaign,
  loadStoredCampaign,
  resetCampaignStoreForTests,
} from "@/lib/campaign/store"
import { createScenario } from "@/lib/data/scenario"
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

describe("server-owned campaign", () => {
  beforeEach(() => {
    resetTurnGuardStateForTests()
    resetCampaignStoreForTests()
    delete process.env.BLOB_READ_WRITE_TOKEN
    delete process.env.LLM_API_KEY
    vi.unstubAllEnvs()
  })

  it("rejects client-sent authoritative state on /api/turn", async () => {
    const created = await createStoredCampaign("normal")
    const tampered = createScenario("gorlice", "normal")
    tampered.provinces.find((province) => province.id === "lwow")!.controller = "central"
    const response = await postTurn({
      gameId: created.gameId,
      expectedTurn: 0,
      orders: [],
      state: tampered,
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

  it("matches outcomes when the same seed and orders are replayed from stored state", async () => {
    const seed = 42424242
    const { gameId } = await createStoredCampaign("normal", seed)
    const stored = await loadStoredCampaign(gameId)
    expect(stored?.save.state.seed).toBe(seed)
    const orders: PlayerOrder[] = [
      { type: "fortify", provinceId: "krakow" },
    ]
    const once = await playTurn(stored!.save.state, orders)
    const twice = await playTurn(stored!.save.state, orders)
    expect(twice.record.resolutions).toEqual(once.record.resolutions)
    expect(twice.state).toEqual(once.state)
  })

  it("assigns a fresh seed per new game", async () => {
    const a = await createStoredCampaign("normal", 111)
    const b = await createStoredCampaign("normal", 222)
    expect(a.save.state.seed).toBe(111)
    expect(b.save.state.seed).toBe(222)
    const viaApi = await postNewGame({ difficulty: "normal" })
    const payload = (await viaApi.json()) as { state: { seed: number } }
    expect(payload.state.seed).not.toBe(19150502)
  })
})
