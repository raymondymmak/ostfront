import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { fetchGmWithCascade } from "@/lib/gm/cascade"
import { llmChat, llmChatChain } from "@/lib/gm/llm"
import {
  DEFAULT_OPENAI_MODEL,
  providerAttemptTimeout,
  resolveOpenAiReasoningEffort,
  resolveProviderChain,
} from "@/lib/gm/providers"
import { OPENAI_GM_JSON_SCHEMA } from "@/lib/schema"

const TURN = {
  narration: "The front holds.",
  proposals: [],
  events: [{ type: "strike", province: "lwow", note: null }],
  diplomacy: ["Quiet."],
}

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> }

function completion(content: unknown, status = 200) {
  return Response.json(
    { choices: [{ finish_reason: "stop", message: { content } }] },
    { status },
  )
}

function httpError(status: number, message: string) {
  return Response.json({ error: { message } }, { status })
}

function hang(init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    const abort = () => reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
    if (signal?.aborted) abort()
    else signal?.addEventListener("abort", abort, { once: true })
  })
}

function installFetch(
  decide: (url: string, init: RequestInit | undefined, index: number) => Promise<Response> | Response,
) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    calls.push({ url: String(url), body, headers })
    return decide(String(url), init, calls.length - 1)
  })
  vi.stubGlobal("fetch", fetchMock)
  return calls
}

function acceptCoach(content: string) {
  try {
    const value = JSON.parse(content) as { reply?: unknown }
    if (typeof value.reply === "string" && value.reply.trim()) return { ok: true as const }
    return { ok: false as const, outcome: "schema" as const, error: "schema" }
  } catch {
    return { ok: false as const, outcome: "invalid_json" as const, error: "invalid json" }
  }
}

describe("provider chain", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.OPENAI_API_KEY = "sk-openai-test-key"
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_REASONING_EFFORT
    process.env.LLM_API_KEY = "sk-openrouter-test-key"
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1"
    process.env.LLM_MODEL = "z-ai/glm-5.3-flash"
    delete process.env.LLM_MODEL_STRONG
    process.env.LLM_TIMEOUT_MS = "3000"
    process.env.GM_BUDGET_MS = "10000"
    process.env.LLM_HTTP_REFERER = "https://ostfront.example"
    delete process.env.LLM_HTTP_TITLE
    delete process.env.LLM_LOG_BLOB
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it("defaults OpenAI to gpt-6.1-terra at medium effort and keeps OpenRouter second", () => {
    const chain = resolveProviderChain()
    expect(chain.map((provider) => provider.id)).toEqual(["openai", "openrouter"])
    expect(chain[0]?.model).toBe(DEFAULT_OPENAI_MODEL)
    expect(chain[0]?.model).toBe("gpt-6.1-terra")
    expect(resolveOpenAiReasoningEffort()).toBe("medium")
    const effort = (value: string) => resolveOpenAiReasoningEffort({ OPENAI_REASONING_EFFORT: value } as unknown as NodeJS.ProcessEnv)
    expect(effort("low")).toBe("low")
    expect(effort("minimal")).toBe("medium")
    expect(effort("none")).toBe("none")
    expect(chain[1]?.model).toBe("z-ai/glm-5.3-flash")
    expect(chain[1]?.baseUrl).toBe("https://openrouter.ai/api/v1")
    expect(providerAttemptTimeout(90_000, true, 45_000)).toBe(45_000)
    expect(providerAttemptTimeout(90_000, false, 45_000)).toBe(45_000)
  })

  it("uses a strict OpenAI schema without const or optional note", () => {
    const text = JSON.stringify(OPENAI_GM_JSON_SCHEMA)
    expect(text).not.toContain('"const"')
    const events = OPENAI_GM_JSON_SCHEMA.properties.events.items
    expect(events.required).toEqual(["type", "province", "note"])
    expect(events.properties.note.type).toEqual(["string", "null"])
    expect(OPENAI_GM_JSON_SCHEMA.additionalProperties).toBe(false)
  })

  it("asks OpenAI with reasoning_effort and strict json_schema, and does not call OpenRouter on success", async () => {
    const calls = installFetch(() => completion(JSON.stringify(TURN)))
    const result = await fetchGmWithCascade(createInitialState(), [], { proposals: [], notes: [] })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions")
    expect(calls[0]?.body.model).toBe("gpt-6.1-terra")
    expect(calls[0]?.body.reasoning_effort).toBe("medium")
    expect(calls[0]?.body).not.toHaveProperty("reasoning")
    expect(calls[0]?.body).not.toHaveProperty("temperature")
    expect(calls[0]?.body.max_completion_tokens).toBe(4000)
    expect(calls[0]?.body).not.toHaveProperty("max_tokens")
    const format = calls[0]?.body.response_format as { json_schema: { strict: boolean; name: string } }
    expect(format.json_schema.strict).toBe(true)
    expect(format.json_schema.name).toBe("gm_turn")
    expect(calls[0]?.headers["http-referer"]).toBeUndefined()
    expect(calls[0]?.headers.authorization).toBe("Bearer sk-openai-test-key")
    const logged = vi.mocked(console.info).mock.calls.map((args) => String(args[0])).join("\n")
    expect(logged).toContain('"provider":"openai"')
    expect(logged).toContain('"model":"gpt-6.1-terra"')
  })

  it("drops an unsupported OpenAI reasoning param without leaving the provider", async () => {
    const calls = installFetch((_url, _init, index) => {
      if (index === 0) return httpError(400, "unsupported parameter: reasoning_effort")
      return completion(JSON.stringify(TURN))
    })
    const result = await fetchGmWithCascade(createInitialState(), [], { proposals: [], notes: [] })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.url.includes("api.openai.com"))).toBe(true)
    expect(calls[1]?.body).not.toHaveProperty("reasoning_effort")
    expect(calls[1]?.body.temperature).toBe(0.4)
  })

  it("fails over to the unchanged OpenRouter request after HTTP 429", async () => {
    const calls = installFetch((url) => {
      if (url.includes("api.openai.com")) return httpError(429, "rate limit")
      return completion(JSON.stringify(TURN))
    })
    const result = await fetchGmWithCascade(createInitialState(), [], { proposals: [], notes: [] })
    expect(result.ok).toBe(true)
    expect(calls[0]?.url).toContain("api.openai.com")
    expect(calls[1]?.url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(calls[1]?.body.model).toBe("z-ai/glm-5.3-flash")
    expect(calls[1]?.body.reasoning).toEqual({ effort: "low", exclude: true })
    expect(calls[1]?.body.max_tokens).toBe(4000)
    expect(calls[1]?.body.temperature).toBe(0.4)
    expect(calls[1]?.body).not.toHaveProperty("reasoning_effort")
    expect(calls[1]?.body).not.toHaveProperty("max_completion_tokens")
    const format = calls[1]?.body.response_format as { json_schema: { strict: boolean } }
    expect(format.json_schema.strict).toBe(false)
    expect(calls[1]?.headers["http-referer"]).toBe("https://ostfront.example")
    const logged = [...vi.mocked(console.info).mock.calls, ...vi.mocked(console.error).mock.calls]
      .map((args) => String(args[0]))
      .join("\n")
    expect(logged).toContain('"provider":"openrouter"')
    expect(logged).toContain('"model":"z-ai/glm-5.3-flash"')
  })

  it("fails over to OpenRouter on HTTP 500", async () => {
    const calls = installFetch((url) => {
      if (url.includes("api.openai.com")) return httpError(502, "upstream")
      return completion(JSON.stringify(TURN))
    })
    const result = await fetchGmWithCascade(createInitialState(), [], { proposals: [], notes: [] })
    expect(result.ok).toBe(true)
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.openai.com/v1/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions",
    ])
  })

  it("fails over to OpenRouter on an empty reply", async () => {
    const calls = installFetch((url) => {
      if (url.includes("api.openai.com")) return completion(null)
      return completion(JSON.stringify(TURN))
    })
    const result = await fetchGmWithCascade(createInitialState(), [], { proposals: [], notes: [] })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.url).toContain("openrouter.ai")
  })

  it("fails over to OpenRouter on unparseable JSON", async () => {
    const calls = installFetch((url) => {
      if (url.includes("api.openai.com")) return completion("not json at all")
      return completion(JSON.stringify(TURN))
    })
    const result = await fetchGmWithCascade(createInitialState(), [], { proposals: [], notes: [] })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it("fails over to OpenRouter on JSON that misses the schema", async () => {
    const calls = installFetch((url) => {
      if (url.includes("api.openai.com")) return completion(JSON.stringify({ narration: 1 }))
      return completion(JSON.stringify(TURN))
    })
    const result = await fetchGmWithCascade(createInitialState(), [], { proposals: [], notes: [] })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it("aborts OpenAI around half the budget, then calls OpenRouter", async () => {
    const calls = installFetch((url, init) => {
      if (url.includes("api.openai.com")) return hang(init)
      return completion(JSON.stringify(TURN))
    })
    const started = Date.now()
    const result = await fetchGmWithCascade(createInitialState(), [], { proposals: [], notes: [] })
    const elapsed = Date.now() - started
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(elapsed).toBeGreaterThan(2_000)
    expect(elapsed).toBeLessThan(8_000)
  }, 15_000)

  it("skips OpenAI when the key is missing and keeps the OpenRouter call", async () => {
    delete process.env.OPENAI_API_KEY
    const calls = installFetch(() => completion(JSON.stringify(TURN)))
    const result = await fetchGmWithCascade(createInitialState(), [], { proposals: [], notes: [] })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain("openrouter.ai")
    expect(calls[0]?.body.reasoning).toEqual({ effort: "low", exclude: true })
  })

  it("falls through to the staff simulation when both providers fail", async () => {
    installFetch(() => httpError(500, "down"))
    const { playTurn } = await import("@/lib/gm")
    const { record } = await playTurn(createInitialState(), [])
    expect(record.gmSource).toBe("mock")
    expect(record.warning).toContain("staff simulation")
    expect(record.gmDebug).toContain("provider openrouter")
    expect(record.gmDebug).toContain("HTTP 500")
  })

  it("names OpenAI on the staff-simulation debug line when it is the only provider", async () => {
    delete process.env.LLM_API_KEY
    installFetch(() => httpError(503, "unavailable"))
    const { playTurn } = await import("@/lib/gm")
    const { record } = await playTurn(createInitialState(), [])
    expect(record.gmSource).toBe("mock")
    expect(record.gmDebug).toContain("provider openai")
    expect(record.gmDebug).toContain("gpt-6.1-terra")
    expect(record.gmDebug).toContain("OPENAI_MODEL")
  })
})

describe("chat provider chain", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    process.env.OPENAI_API_KEY = "sk-openai-test-key"
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_REASONING_EFFORT
    process.env.LLM_API_KEY = "sk-openrouter-test-key"
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1"
    process.env.LLM_MODEL = "z-ai/glm-5.3-flash"
    delete process.env.LLM_MODEL_STRONG
    delete process.env.LLM_HTTP_REFERER
  })

  async function chat(decide: (url: string, init: RequestInit | undefined, index: number) => Promise<Response> | Response) {
    const calls = installFetch(decide)
    const result = await llmChatChain({
      system: "Return JSON.",
      user: "Hello",
      timeoutMs: 8_000,
      maxTokens: 200,
      temperature: 0.3,
      kind: "advisor",
      jsonSchema: {
        name: "campaign_coach",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["reply"],
          properties: { reply: { type: "string" } },
        },
      },
      accept: acceptCoach,
    })
    return { calls, result }
  }

  it("keeps a valid OpenAI coach reply", async () => {
    const { calls, result } = await chat(() => completion(JSON.stringify({ reply: "Which flank?" })))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provider).toBe("openai")
      expect(result.model).toBe("gpt-6.1-terra")
      expect(result.content).toContain("Which flank")
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body.reasoning_effort).toBe("medium")
    const format = calls[0]?.body.response_format as { json_schema: { strict: boolean } }
    expect(format.json_schema.strict).toBe(true)
  })

  it("fails over when OpenAI returns unparseable coach JSON", async () => {
    const { calls, result } = await chat((url) => {
      if (url.includes("api.openai.com")) return completion("no braces")
      return completion(JSON.stringify({ reply: "What is the supply for?" }))
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.provider).toBe("openrouter")
    expect(calls).toHaveLength(2)
    expect(calls[1]?.body.reasoning).toEqual({ effort: "low", exclude: true })
  })

  it("fails over when OpenAI JSON does not match the coach schema", async () => {
    const { calls, result } = await chat((url) => {
      if (url.includes("api.openai.com")) return completion(JSON.stringify({ nope: true }))
      return completion(JSON.stringify({ reply: "Who holds the depot?" }))
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.model).toBe("z-ai/glm-5.3-flash")
    expect(calls).toHaveLength(2)
  })

  it("fails over when OpenAI returns an empty coach reply", async () => {
    const { calls, result } = await chat((url) => {
      if (url.includes("api.openai.com")) return completion(null)
      return completion(JSON.stringify({ reply: "Still with you." }))
    })
    expect(result.ok).toBe(true)
    expect(calls[1]?.url).toContain("openrouter.ai")
  })

  it("fails over when OpenAI returns 429", async () => {
    const { calls, result } = await chat((url) => {
      if (url.includes("api.openai.com")) return httpError(429, "slow down")
      return completion(JSON.stringify({ reply: "Try the other wire." }))
    })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it("fails over when OpenAI returns 500", async () => {
    const { result } = await chat((url) => {
      if (url.includes("api.openai.com")) return httpError(500, "boom")
      return completion(JSON.stringify({ reply: "Backup staff." }))
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.provider).toBe("openrouter")
  })

  it("fails over when OpenAI times out", async () => {
    const started = Date.now()
    const { calls, result } = await chat((url, init) => {
      if (url.includes("api.openai.com")) return hang(init)
      return completion(JSON.stringify({ reply: "After the wait." }))
    })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(Date.now() - started).toBeLessThan(7_000)
  }, 15_000)

  it("keeps compatibility retries inside the original OpenAI timeout", async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const calls = installFetch(async (_url, init, index) => {
      if (index === 0) {
        await delay(250)
        return httpError(400, "unsupported parameter: reasoning_effort")
      }
      if (index === 1) {
        await delay(250)
        return httpError(400, "unsupported response_format json_schema")
      }
      return hang(init)
    })
    const started = Date.now()
    const result = await llmChat({
      model: "gpt-6.1-terra",
      system: "Return JSON.",
      user: "Hello",
      timeoutMs: 800,
      maxTokens: 40,
      target: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-openai-test-key",
        wire: "openai",
      },
    })
    expect(result.ok).toBe(false)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(Date.now() - started).toBeLessThan(1_150)
  })

  it("sends none effort with temperature when OPENAI_REASONING_EFFORT=none", async () => {
    process.env.OPENAI_REASONING_EFFORT = "none"
    const calls = installFetch(() => completion(JSON.stringify({ reply: "Which flank?" })))
    const result = await llmChat({
      model: "gpt-6.1-terra",
      system: "Return JSON.",
      user: "Hello",
      timeoutMs: 2_000,
      maxTokens: 40,
      temperature: 0.3,
      target: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-openai-test-key",
        wire: "openai",
      },
    })
    expect(result.ok).toBe(true)
    expect(calls[0]?.body.reasoning_effort).toBe("none")
    expect(calls[0]?.body.temperature).toBe(0.3)
  })
})
