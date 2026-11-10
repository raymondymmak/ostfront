import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { persistTeachRecord, persistenceStatusMessage } from "@/lib/teach/record"
import { authoritativeLessonState } from "@/lib/teach/lessons"
import { analyzeOrders } from "@/lib/teach/plan"
import { buildTeachFeedback } from "@/lib/teach/feedback"
import { lessonMeta } from "@/lib/teach/lessons"
import type { PlayerOrder } from "@/lib/types"
import { createFakeRedisClient } from "@/lib/redis/fake-client"
import { resetRedisClientForTests, setRedisClientForTests } from "@/lib/redis/client"

const baseInput = () => {
  const orders: PlayerOrder[] = [
    { type: "attack", from: "krakow", target: "lublin", unitIds: ["teach-11"] },
    { type: "attack", from: "kielce", target: "lublin", unitIds: ["teach-kie"] },
  ]
  const state = authoritativeLessonState("converging-lublin", "guided")
  const plan = analyzeOrders(state, orders)
  const meta = lessonMeta("converging-lublin", "guided")
  const feedback = buildTeachFeedback(meta, "guided", plan, {
    turn: 0,
    date: "2 May 2015",
    narration: "",
    diplomacy: [],
    resolutions: [],
    events: [],
    controlChanges: [],
    logistics: [],
    notes: [],
    gmSource: "mock",
  })
  return {
    meta,
    variant: "guided" as const,
    reasoning: "Combine prongs.",
    prediction: "Merged converging battle on Lublin before the die.",
    selectedProvinceIds: ["lublin"],
    orders,
    plan,
    feedback,
    coach: {
      reply: "Check the pooled line.",
      stance: "aligned" as const,
      followUp: null,
      highlights: [],
      source: "rules" as const,
    },
    combatRoll: 1,
    beliefKey: "unclassified",
    beliefSummary: "Combine prongs.",
    beliefId: null,
    beliefPersistence: "unavailable" as const,
    record: {
      turn: 0,
      date: "2 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [],
      events: [],
      controlChanges: [],
      logistics: [],
      notes: [],
      gmSource: "mock" as const,
    },
  }
}

function enableTeachRedis(): void {
  process.env.KV_REST_API_URL = "https://fake.upstash.io"
  process.env.KV_REST_API_TOKEN = "fake-token"
  setRedisClientForTests(createFakeRedisClient())
}

describe("persistTeachRecord", () => {
  const originalUrl = process.env.KV_REST_API_URL
  const originalToken = process.env.KV_REST_API_TOKEN

  beforeEach(() => {
    resetRedisClientForTests()
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
  })

  afterEach(() => {
    resetRedisClientForTests()
    if (originalUrl === undefined) delete process.env.KV_REST_API_URL
    else process.env.KV_REST_API_URL = originalUrl
    if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN
    else process.env.KV_REST_API_TOKEN = originalToken
  })

  it("returns unavailable when no redis credentials are configured", async () => {
    const result = await persistTeachRecord(baseInput())
    expect(result.persistence).toBe("unavailable")
    expect(persistenceStatusMessage(result)).toMatch(/only in this response/)
  })

  it("returns failed when set rejects", async () => {
    enableTeachRedis()
    const broken = createFakeRedisClient()
    broken.set = async () => {
      throw new Error("upload rejected")
    }
    setRedisClientForTests(broken)
    const result = await persistTeachRecord(baseInput())
    expect(result.persistence).toBe("failed")
    expect(persistenceStatusMessage(result)).toMatch(/not stored/)
  })

  it("returns failed when verify mismatches", async () => {
    enableTeachRedis()
    const broken = createFakeRedisClient()
    const realSet = broken.set.bind(broken)
    broken.set = async (key, value, opts) => {
      await realSet(key, "wrong", opts)
      return "OK"
    }
    setRedisClientForTests(broken)
    const result = await persistTeachRecord(baseInput())
    expect(result.persistence).toBe("failed")
  })

  it("returns confirmed only after set and get roundtrip succeed", async () => {
    enableTeachRedis()
    const result = await persistTeachRecord(baseInput())
    expect(result.persistence).toBe("confirmed")
    expect(persistenceStatusMessage(result)).toMatch(/stored privately/)
  })

  it("returns failed when write exceeds timeout", async () => {
    enableTeachRedis()
    const slow = createFakeRedisClient()
    slow.set = () =>
      new Promise((resolve) => setTimeout(() => resolve("OK"), 200))
    setRedisClientForTests(slow)
    process.env.TEACH_RECORD_WRITE_TIMEOUT_MS = "50"
    const result = await persistTeachRecord(baseInput())
    expect(result.persistence).toBe("failed")
    delete process.env.TEACH_RECORD_WRITE_TIMEOUT_MS
  })
})
