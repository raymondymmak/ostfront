import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { putMock, headMock } = vi.hoisted(() => ({
  putMock: vi.fn(),
  headMock: vi.fn(),
}))

vi.mock("@vercel/blob", () => ({
  put: putMock,
  head: headMock,
}))

import { persistTeachRecord, persistenceStatusMessage } from "@/lib/teach/record"
import { authoritativeLessonState } from "@/lib/teach/lessons"
import { analyzeOrders } from "@/lib/teach/plan"
import { buildTeachFeedback } from "@/lib/teach/feedback"
import { lessonMeta } from "@/lib/teach/lessons"
import type { PlayerOrder } from "@/lib/types"

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
    date: "2 May 1915",
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

describe("persistTeachRecord", () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN

  beforeEach(() => {
    putMock.mockReset()
    headMock.mockReset()
  })

  afterEach(() => {
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN
    else process.env.BLOB_READ_WRITE_TOKEN = originalToken
  })

  it("returns unavailable when no blob token is configured", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    const result = await persistTeachRecord(baseInput())
    expect(result.persistence).toBe("unavailable")
    expect(putMock).not.toHaveBeenCalled()
    expect(persistenceStatusMessage(result)).toMatch(/only in this response/)
  })

  it("returns failed when put rejects", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token"
    putMock.mockRejectedValueOnce(new Error("upload rejected"))
    const result = await persistTeachRecord(baseInput())
    expect(result.persistence).toBe("failed")
    expect(persistenceStatusMessage(result)).toMatch(/not stored/)
  })

  it("returns failed when head verify mismatches", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token"
    putMock.mockResolvedValueOnce({
      url: "https://blob.example/teach-attempts/x.json",
      pathname: "teach-attempts/x.json",
    })
    headMock.mockResolvedValueOnce({
      url: "https://blob.example/teach-attempts/x.json",
      pathname: "teach-attempts/other.json",
    })
    const result = await persistTeachRecord(baseInput())
    expect(result.persistence).toBe("failed")
  })

  it("returns confirmed only after put and head roundtrip succeed", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token"
    putMock.mockResolvedValueOnce({
      url: "https://blob.example/teach-attempts/ok.json",
      pathname: "teach-attempts/2026-11-10/abc.json",
    })
    headMock.mockResolvedValueOnce({
      url: "https://blob.example/teach-attempts/ok.json",
      pathname: "teach-attempts/2026-11-10/abc.json",
    })
    const result = await persistTeachRecord(baseInput())
    expect(result.persistence).toBe("confirmed")
    expect(putMock).toHaveBeenCalledOnce()
    expect(headMock).toHaveBeenCalledOnce()
    expect(persistenceStatusMessage(result)).toMatch(/stored privately/)
    const putBody = putMock.mock.calls[0][1] as string
    expect(putBody).toContain('"persistence":"confirmed"')
  })

  it("returns failed when write exceeds timeout", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token"
    process.env.TEACH_RECORD_WRITE_TIMEOUT_MS = "50"
    putMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ url: "https://blob.example/l.json", pathname: "l.json" }), 200)),
    )
    const result = await persistTeachRecord(baseInput())
    expect(result.persistence).toBe("failed")
    delete process.env.TEACH_RECORD_WRITE_TIMEOUT_MS
  })
})
