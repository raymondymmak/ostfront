import { callTimeoutMs } from "@/lib/gm/timeouts"

/**
 * Verified against OpenAI's model docs (24 Nov 2026):
 * https://developers.openai.com/api/docs/models/gpt-6.1-terra
 * Model id is `gpt-6.1-terra` (not `gpt-6-terra`).
 * `reasoning.effort` on that page: none, low, medium (default), high, xhigh, max.
 * Chat Completions sends that as `reasoning_effort` (Responses uses `reasoning.effort`).
 * `minimal` is a general Chat Completions value but not listed for Terra.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-6.1-terra"
export const OPENAI_CHAT_BASE = "https://api.openai.com/v1"

/** Chat Completions `reasoning_effort` values Terra documents. */
export const OPENAI_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const
export type OpenAiReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number]
export const DEFAULT_OPENAI_REASONING_EFFORT: OpenAiReasoningEffort = "medium"

/** Unknown or unsupported values (including `minimal`) stay on medium. */
export function resolveOpenAiReasoningEffort(env: NodeJS.ProcessEnv = process.env): OpenAiReasoningEffort {
  const raw = env.OPENAI_REASONING_EFFORT?.trim().toLowerCase()
  if (raw && (OPENAI_REASONING_EFFORTS as readonly string[]).includes(raw)) return raw as OpenAiReasoningEffort
  return DEFAULT_OPENAI_REASONING_EFFORT
}

export type LlmProviderId = "openai" | "openrouter"
export type LlmWire = "openai" | "compatible"

export type LlmProvider = {
  id: LlmProviderId
  /** Env var that selected `model`, for debug lines. */
  modelEnv: "OPENAI_MODEL" | "LLM_MODEL"
  baseUrl: string
  apiKey: string
  model: string
  strongModel: string | null
  wire: LlmWire
}

export type LlmTarget = {
  provider: LlmProviderId
  baseUrl: string
  apiKey: string
  wire: LlmWire
}

/** OpenAI first, then the existing OpenRouter-compatible `LLM_*` config. Missing keys are skipped. */
export function resolveProviderChain(env: NodeJS.ProcessEnv = process.env): LlmProvider[] {
  const chain: LlmProvider[] = []
  const openaiKey = env.OPENAI_API_KEY?.trim()
  if (openaiKey) {
    chain.push({
      id: "openai",
      modelEnv: "OPENAI_MODEL",
      baseUrl: OPENAI_CHAT_BASE,
      apiKey: openaiKey,
      model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
      strongModel: null,
      wire: "openai",
    })
  }
  const backupKey = env.LLM_API_KEY?.trim()
  if (backupKey) {
    const cheap = env.LLM_MODEL?.trim() || "gpt-4o-mini"
    const strongRaw = env.LLM_MODEL_STRONG?.trim()
    const strong = strongRaw && strongRaw !== cheap ? strongRaw : null
    chain.push({
      id: "openrouter",
      modelEnv: "LLM_MODEL",
      baseUrl: (env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: backupKey,
      model: cheap,
      strongModel: strong,
      wire: "compatible",
    })
  }
  return chain
}

export function targetFromProvider(provider: LlmProvider): LlmTarget {
  return {
    provider: provider.id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    wire: provider.wire,
  }
}

/**
 * Time for one provider. When another provider can still run, this is about half
 * of the time still left (same split as a strong-model retry), capped by `callCap`.
 */
export function providerAttemptTimeout(remainingMs: number, anotherProviderFollows: boolean, callCap: number): number {
  return callTimeoutMs(remainingMs, anotherProviderFollows, callCap)
}

/** Any unsuccessful provider attempt yields to the next one. Named cases are the required set. */
export function failureShouldFailover(
  kind: "http" | "timeout" | "empty" | "zod" | "unconfigured" | "invalid_json",
  httpStatus: number | null,
): boolean {
  if (kind === "timeout" || kind === "empty" || kind === "zod" || kind === "invalid_json" || kind === "unconfigured") {
    return true
  }
  if (httpStatus == null || httpStatus === 429 || httpStatus >= 500) return true
  return true
}

/** Campaign coach JSON for OpenAI strict mode. Nullable fields are required. */
export const CAMPAIGN_COACH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "followUp", "highlights"],
  properties: {
    reply: { type: "string" },
    followUp: { type: ["string", "null"] },
    highlights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["provinceId", "uiId"],
        properties: {
          provinceId: { type: ["string", "null"] },
          uiId: { type: ["string", "null"] },
        },
      },
    },
  },
} as const

/** Teach reasoning coach JSON for OpenAI strict mode. */
export const TEACH_COACH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "stance", "followUp", "highlights"],
  properties: {
    reply: { type: "string" },
    stance: {
      type: "string",
      enum: ["aligned", "partial", "misconception", "unclear", "absent"],
    },
    followUp: { type: ["string", "null"] },
    highlights: CAMPAIGN_COACH_JSON_SCHEMA.properties.highlights,
  },
} as const
