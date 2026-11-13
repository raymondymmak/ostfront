import { beforeEach, describe, expect, it } from "vitest"
import { jsonHasNoSeed } from "@/lib/campaign/public-state"
import { resetCampaignSerializeForTests } from "@/lib/campaign/serialize"
import {
  commitCampaignTurn,
  createStoredCampaign,
  loadStoredCampaign,
  resetCampaignStoreForTests,
  withServerSeed,
} from "@/lib/campaign/store"
import { playTurn } from "@/lib/gm"
import { setRedisClientForTests, resetRedisClientForTests } from "@/lib/redis/client"
import { createFakeRedisClient } from "@/lib/redis/fake-client"
import { publicSavePayload } from "@/lib/campaign/public-state"

function enableFakeRedisEnv(): void {
  process.env.KV_REST_API_URL = "https://fake.upstash.io"
  process.env.KV_REST_API_TOKEN = "fake-token"
  setRedisClientForTests(createFakeRedisClient())
}

describe("campaign redis store (in-memory fake)", () => {
  beforeEach(() => {
    resetCampaignStoreForTests()
    resetCampaignSerializeForTests()
    resetRedisClientForTests()
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.VERCEL_ENV
  })

  it("allows exactly one of ten parallel commits at the same expectedTurn", async () => {
    enableFakeRedisEnv()
    const { gameId, save } = await createStoredCampaign("normal")
    const state = withServerSeed(save.state, (await loadStoredCampaign(gameId))!.head.seed)
    const resolved = await playTurn(state, [])
    const nextSave = { ...save, state: resolved.state, log: [...save.log, resolved.record] }

    const results = await Promise.all(
      Array.from({ length: 10 }, () => commitCampaignTurn(gameId, 0, nextSave)),
    )
    const winners = results.filter((r) => r.ok)
    const losers = results.filter((r) => !r.ok)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(9)
    for (const loss of losers) {
      expect(loss.status).toBe(409)
    }
    const reloaded = await loadStoredCampaign(gameId)
    expect(reloaded?.head.turn).toBe(1)
  })

  it("does not persist seed inside turn snapshots", async () => {
    enableFakeRedisEnv()
    const seed = 11223344
    const { gameId } = await createStoredCampaign("normal", seed)
    const loaded = await loadStoredCampaign(gameId)
    expect(loaded?.head.seed).toBe(seed)
    expect("seed" in loaded!.save.state).toBe(false)
    expect(JSON.stringify(loaded!.save)).not.toContain(String(seed))
  })

  it("never exposes seed in public save payload", async () => {
    enableFakeRedisEnv()
    const seed = 77665544
    const { gameId, save } = await createStoredCampaign("normal", seed)
    const publicPayload = publicSavePayload(gameId, save)
    expect(jsonHasNoSeed(publicPayload)).toBe(true)
    expect(JSON.stringify(publicPayload)).not.toContain(String(seed))
    const loaded = await loadStoredCampaign(gameId)
    expect(loaded?.head.seed).toBe(seed)
  })
})
