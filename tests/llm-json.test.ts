import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { llmAiTurn, readUsage } from "@/lib/gm/llm"
import type { GameState } from "@/lib/types"

const { logCalls } = vi.hoisted(() => ({
  logCalls: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/gm/llm-log", () => ({
  scheduleLlmResponseLog: (input: Record<string, unknown>) => {
    logCalls.push(input)
  },
}))

const TURN = {
  narration: 'He said "hold" the {line}.',
  proposals: [],
  events: [],
  diplomacy: ["Quiet."],
}

const EMPTY_USAGE = {
  prompt_tokens: 900,
  completion_tokens: 1800,
  total_tokens: 2700,
  completion_tokens_details: { reasoning_tokens: 1800 },
}

function completion(content: unknown, extra: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        finish_reason: extra.finish_reason ?? "stop",
        message: {
          content,
          ...(extra.reasoning ? { reasoning: extra.reasoning } : {}),
        },
      },
    ],
    usage: extra.usage,
  }
}

function stubFetch(payloads: Array<{ status?: number; body: unknown }>) {
  const bodies: Array<Record<string, unknown>> = []
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    const next = payloads.shift()
    if (!next) throw new Error("unexpected fetch")
    return Response.json(next.body, { status: next.status ?? 200 })
  })
  vi.stubGlobal("fetch", fetchMock)
  return { fetchMock, bodies }
}

describe("game master JSON", () => {
  let state: GameState

  beforeEach(() => {
    logCalls.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.BLOB_READ_WRITE_TOKEN
    delete process.env.LLM_MODEL_STRONG
    process.env.LLM_API_KEY = "test-key"
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1"
    process.env.LLM_MODEL = "z-ai/glm-5.3-flash"
    process.env.LLM_TIMEOUT_MS = "20000"
    process.env.GM_BUDGET_MS = "40000"
    state = createInitialState()
  })

  it("accepts fenced JSON and asks OpenRouter for a short hidden reasoning pass", async () => {
    const fenced = "```json\n" + JSON.stringify(TURN) + "\n```"
    const { fetchMock, bodies } = stubFetch([
      { body: completion(fenced, { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) },
    ])
    const result = await llmAiTurn(state, [], {
      model: "z-ai/glm-5.3-flash",
      timeoutMs: 20_000,
      budgetDeadline: Date.now() + 40_000,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.turn.narration).toContain("{line}")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodies[0]).toMatchObject({
      max_tokens: 4000,
      reasoning: { effort: "low", exclude: true },
    })
    expect(logCalls[0]).toMatchObject({
      kind: "turn",
      attempt: 1,
      outcome: "ok",
      fellBack: false,
      gameTurn: state.turn,
      gameDate: state.date,
    })
    expect(String(logCalls[0]?.content)).toContain("```")
  })

  it("reads a JSON object wrapped in leading and trailing prose", async () => {
    const prose = `Staff note before.\n${JSON.stringify(TURN)}\nTrailing } brace.`
    const { fetchMock } = stubFetch([{ body: completion(prose) }])
    const result = await llmAiTurn(state, [], {
      model: "z-ai/glm-5.3-flash",
      timeoutMs: 20_000,
      budgetDeadline: Date.now() + 40_000,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.turn.narration).toContain("{line}")
      expect(result.turn.diplomacy).toEqual(["Quiet."])
    }
  })

  it("retries truncated JSON once, then accepts the second object", async () => {
    const { fetchMock } = stubFetch([
      {
        body: completion('{"narration":"The front', {
          finish_reason: "length",
          usage: { prompt_tokens: 12, completion_tokens: 4000, total_tokens: 4012, reasoning_tokens: 0 },
        }),
      },
      { body: completion(JSON.stringify(TURN)) },
    ])
    const result = await llmAiTurn(state, [], {
      model: "z-ai/glm-5.3-flash",
      timeoutMs: 20_000,
      budgetDeadline: Date.now() + 40_000,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
    expect(logCalls[0]).toMatchObject({
      attempt: 1,
      outcome: "invalid_json",
      finishReason: "length",
      fellBack: true,
      usage: { reasoningTokens: 0 },
    })
    expect(logCalls[1]).toMatchObject({ attempt: 2, outcome: "ok", fellBack: false })
  })

  it("does not retry truncated JSON when the game-master budget is almost gone", async () => {
    const { fetchMock } = stubFetch([
      {
        body: completion('{"narration":"The front', {
          finish_reason: "length",
          usage: EMPTY_USAGE,
        }),
      },
      { body: completion(JSON.stringify(TURN)) },
    ])
    const result = await llmAiTurn(state, [], {
      model: "z-ai/glm-5.3-flash",
      timeoutMs: 20_000,
      budgetDeadline: Date.now() + 1_000,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe("zod")
      expect(result.finishReason).toBe("length")
      expect(result.content).toBe("present")
      expect(result.usage?.reasoningTokens).toBe(1800)
    }
    expect(logCalls).toHaveLength(1)
  })

  it("retries an empty reasoning budget once and keeps finish length plus reasoning tokens", async () => {
    const start = 1_700_000_000_000
    let now = start
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const payloads = [
      completion(null, {
        finish_reason: "length",
        reasoning: "secret-should-not-log",
        usage: EMPTY_USAGE,
      }),
      completion(JSON.stringify(TURN), { usage: { prompt_tokens: 10, completion_tokens: 30, total_tokens: 40 } }),
    ]
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      if (calls === 1) now += 15_000
      const body = payloads.shift()
      if (!body) throw new Error("unexpected fetch")
      return Response.json(body)
    })
    vi.stubGlobal("fetch", fetchMock)

    const { playTurn } = await import("@/lib/gm")
    const { record } = await playTurn(state, [])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(record.gmSource).toBe("llm")
    expect(record.gmDebug).toBeUndefined()
    expect(logCalls[0]).toMatchObject({
      kind: "turn",
      attempt: 1,
      outcome: "empty",
      fellBack: true,
      httpStatus: 200,
      finishReason: "length",
      gameTurn: state.turn,
      gameDate: state.date,
      usage: {
        promptTokens: 900,
        completionTokens: 1800,
        totalTokens: 2700,
        reasoningTokens: 1800,
      },
    })
    expect(JSON.stringify(logCalls)).not.toContain("secret-should-not-log")
    expect(logCalls[1]).toMatchObject({ attempt: 2, outcome: "ok", fellBack: false })
  })

  it("records finish length and reasoning tokens when an empty reply cannot be retried", async () => {
    process.env.LLM_TIMEOUT_MS = "3000"
    process.env.GM_BUDGET_MS = "3000"
    const { fetchMock } = stubFetch([
      {
        body: completion(null, {
          finish_reason: "length",
          reasoning: "secret-should-not-log",
          usage: EMPTY_USAGE,
        }),
      },
      { body: completion(JSON.stringify(TURN)) },
    ])
    const { playTurn } = await import("@/lib/gm")
    const { record } = await playTurn(state, [])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(record.gmSource).toBe("mock")
    expect(record.gmDebug).toContain("path llm")
    expect(record.gmDebug).toContain("abort: empty message")
    expect(record.gmDebug).toContain("content empty")
    expect(record.gmDebug).toContain("http none")
    expect(record.gmDebug).toContain("finish length")
    expect(record.gmDebug).toContain("reasoning 1800")
    expect(record.gmDebug).toContain("tokens prompt 900 completion 1800 total 2700")
    expect(record.gmDebug).toContain("fallback staff simulation")
    expect(record.gmDebug).not.toContain("secret-should-not-log")
    expect(logCalls[0]).toMatchObject({
      outcome: "empty",
      finishReason: "length",
      usage: { reasoningTokens: 1800 },
      fellBack: true,
    })
  })

  it("retries a schema miss once", async () => {
    const { fetchMock } = stubFetch([
      { body: completion(JSON.stringify({ narration: 1, proposals: [], events: [], diplomacy: [] })) },
      { body: completion(JSON.stringify(TURN)) },
    ])
    const result = await llmAiTurn(state, [], {
      model: "z-ai/glm-5.3-flash",
      timeoutMs: 20_000,
      budgetDeadline: Date.now() + 40_000,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
    expect(logCalls[0]).toMatchObject({ outcome: "schema", fellBack: true })
  })

  it("drops OpenRouter reasoning when the provider rejects the parameter", async () => {
    const { fetchMock, bodies } = stubFetch([
      { status: 400, body: { error: { message: "unsupported parameter: reasoning" } } },
      { body: completion(JSON.stringify(TURN)) },
    ])
    const result = await llmAiTurn(state, [], {
      model: "z-ai/glm-5.3-flash",
      timeoutMs: 20_000,
      budgetDeadline: Date.now() + 40_000,
    })
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodies[0]?.reasoning).toEqual({ effort: "low", exclude: true })
    expect(bodies[1]).not.toHaveProperty("reasoning")
    expect(logCalls[0]).toMatchObject({ outcome: "http", fellBack: true, httpStatus: 400 })
  })

  it("reads reasoning tokens from OpenRouter usage details or a top-level field", () => {
    expect(
      readUsage({
        usage: {
          prompt_tokens: 9,
          completion_tokens: 1800,
          total_tokens: 1809,
          completion_tokens_details: { reasoning_tokens: 1790 },
        },
      }),
    ).toEqual({
      promptTokens: 9,
      completionTokens: 1800,
      totalTokens: 1809,
      reasoningTokens: 1790,
    })
    expect(readUsage({ usage: { reasoning_tokens: 42, total_tokens: 50 } })?.reasoningTokens).toBe(42)
    expect(readUsage({ choices: [] })).toBeNull()
  })
})
