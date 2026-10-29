import { beforeEach, describe, expect, it, vi } from "vitest"
import { LLM_LOG_CONTENT_LIMIT, buildLlmLogRecord, llmLogPath, scheduleLlmResponseLog } from "@/lib/gm/llm-log"

const { pending, putMock, waitUntilMock } = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  putMock: vi.fn(async () => ({ url: "https://blob.example/x", pathname: "x" })),
  waitUntilMock: vi.fn((promise: Promise<unknown>) => {
    pending.push(promise)
  }),
}))

vi.mock("@vercel/blob", () => ({
  put: putMock,
}))

vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}))

const baseInput = {
  kind: "turn" as const,
  attempt: 1,
  gameTurn: 4,
  gameDate: "2 May 1915",
  model: "z-ai/glm-5.3-flash",
  latencyMs: 17342.2,
  httpStatus: 200,
  finishReason: "length",
  usage: {
    promptTokens: 900,
    completionTokens: 1800,
    totalTokens: 2700,
    reasoningTokens: 1800,
  },
  content: "The front holds.",
  outcome: "empty" as const,
  error: "empty message",
  fellBack: true,
}

describe("LLM response log", () => {
  beforeEach(() => {
    pending.length = 0
    putMock.mockReset()
    putMock.mockResolvedValue({ url: "https://blob.example/x", pathname: "x" })
    waitUntilMock.mockClear()
    delete process.env.BLOB_READ_WRITE_TOKEN
    delete process.env.LLM_API_KEY
    process.env.VERCEL_ENV = "preview"
  })

  it("builds a private-log record without keys, headers, or an oversized body", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token-value"
    process.env.LLM_API_KEY = "sk-supersecretvalue"
    const now = new Date("2026-05-02T06:07:08.009Z")
    const content = `Bearer sk-supersecretvalue blob-test-token-value ${"x".repeat(LLM_LOG_CONTENT_LIMIT)}`
    const { pathname, record } = buildLlmLogRecord({
      ...baseInput,
      content,
      now,
      id: "abc123def456",
    })
    expect(pathname).toBe("llm-log/2026-05-02/2026-05-02T06-07-08.009Z-turn-abc123def456.json")
    expect(llmLogPath(now, "advisor", "abc")).toBe("llm-log/2026-05-02/2026-05-02T06-07-08.009Z-advisor-abc.json")
    expect(record.timestamp).toBe("2026-05-02T06:07:08.009Z")
    expect(record.env).toBe("preview")
    expect(record.attempt).toBe(1)
    expect(record.gameTurn).toBe(4)
    expect(record.gameDate).toBe("2 May 1915")
    expect(record.latencyMs).toBe(17342)
    expect(record.httpStatus).toBe(200)
    expect(record.finishReason).toBe("length")
    expect(record.usage.reasoningTokens).toBe(1800)
    expect(record.outcome).toBe("empty")
    expect(record.fellBack).toBe(true)
    expect(record.content?.endsWith("\n…[truncated]")).toBe(true)
    expect(record.content?.length).toBeLessThanOrEqual(LLM_LOG_CONTENT_LIMIT + "\n…[truncated]".length)
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain("sk-supersecretvalue")
    expect(serialized).not.toContain("blob-test-token-value")
    expect(serialized).not.toContain("Bearer")
    expect(record).not.toHaveProperty("headers")
    expect(record).not.toHaveProperty("authorization")
    expect(record).not.toHaveProperty("apiKey")
  })

  it("does nothing when BLOB_READ_WRITE_TOKEN is missing", () => {
    expect(() => scheduleLlmResponseLog(baseInput)).not.toThrow()
    expect(putMock).not.toHaveBeenCalled()
    expect(waitUntilMock).not.toHaveBeenCalled()
  })

  it("uploads a private object and does not block on the put", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token-value"
    expect(() =>
      scheduleLlmResponseLog({
        ...baseInput,
        kind: "advisor",
        attempt: 2,
        now: new Date("2026-05-02T06:07:08.009Z"),
        id: "deadbeef00",
      }),
    ).not.toThrow()
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
    expect(pending).toHaveLength(1)
    await pending[0]
    expect(putMock).toHaveBeenCalledTimes(1)
    const [pathname, body, options] = putMock.mock.calls[0] as unknown as [
      string,
      string,
      { access: string; token: string; addRandomSuffix: boolean },
    ]
    expect(pathname).toBe("llm-log/2026-05-02/2026-05-02T06-07-08.009Z-advisor-deadbeef00.json")
    expect(options).toMatchObject({
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      token: "blob-test-token-value",
    })
    const stored = JSON.parse(body) as { kind: string; finishReason: string; usage: { reasoningTokens: number } }
    expect(stored.kind).toBe("advisor")
    expect(stored.finishReason).toBe("length")
    expect(stored.usage.reasoningTokens).toBe(1800)
    expect(body).not.toContain("blob-test-token-value")
  })

  it("swallows an upload failure", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token-value"
    putMock.mockRejectedValueOnce(new Error("blob down"))
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => scheduleLlmResponseLog(baseInput)).not.toThrow()
    await pending[0]
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
