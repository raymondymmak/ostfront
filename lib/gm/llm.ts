import { childUnits, echelonOf, independentFormations } from "@/lib/engine/echelon"
import { sanitizeGmText, type GmContentState } from "@/lib/gm/debug"
import {
  scheduleLlmResponseLog,
  type LlmLogKind,
  type LlmLogOutcome,
  type LlmUsage,
} from "@/lib/gm/llm-log"
import {
  failureShouldFailover,
  providerAttemptTimeout,
  resolveOpenAiReasoningEffort,
  resolveProviderChain,
  targetFromProvider,
  type LlmProviderId,
  type LlmTarget,
  type LlmWire,
} from "@/lib/gm/providers"
import { GMTurnSchema, GM_JSON_SCHEMA, OPENAI_GM_JSON_SCHEMA } from "@/lib/schema"
import type { GameState, GMTurn, PlayerOrder } from "@/lib/types"

const SYSTEM = `You are the Russian staff for the Gorlice–Tarnów offensive, from 2 May 1915 through the fortnight of 11 July. The map state is authoritative. You narrate and propose. A deterministic engine accepts or rejects every proposal. You do not roll dice and you do not describe results.

The human player commands the Central Powers: Mackensen's German 11th Army and the Austro-Hungarian 4th Army on the Dunajec, with holding forces in East Prussia, Silesia and the Carpathians. You are Stavka. You command Russia and the friction of the war: events, small supply or unrest shocks, and diplomacy. On 2 May Radko Dimitriev's 3rd Army holds Lemberg, Russian since September 1914. Przemyśl lies inside the Kraków province and is not a separate state. You are not shown the Central Powers' orders. Do not guess them. Do not propose move, attack, or fortify actions for Central Powers formations. The engine inserts the player's orders itself, and both sides are resolved from the same opening map. You may propose Russian moves, attacks, and fortify actions, plus modify proposals.

Respect these limits so the engine does not reject you:
- move: {"type":"move","unit":"<unit id>","to":"<province id>"} only along neighbors, only into a province Russia controls, only if that unit's current province has supply >= 30.
- attack: {"type":"attack","from":"<province id>","target":"<province id>","units":["<unit id>"]} from and target are neighbors, target is not Russian-controlled, every unit is in from, supply at from >= 30.
- fortify: {"type":"fortify","province":"<province id>"} only where Russia has a unit, supply >= 40, fort+pending < 3, and treasury has >= 2 IP; takes effect next fortnight and ties up the garrison.
- modify: {"type":"modify","province":"<province id>","field":"unrest"|"supply","delta":<number>,"reason":"<short>"} Delta must be between -20 and 20.
- events: partisans, strike, epidemic, or breakthrough, each with a real province id.
Use only ids from the state digest. narration is two short paragraphs, present tense, staff-college prose, about intentions. diplomacy is zero to two short sentences. Return one JSON object and no markdown.

JSON schema for your reply (follow exactly):
${JSON.stringify(GM_JSON_SCHEMA)}`

/** Room for the JSON after a short reasoning pass. The call is still aborted by LLM_TIMEOUT_MS. */
const GM_MAX_TOKENS = 4_000

/** One extra attempt when invalid JSON, schema failure, or an empty body still has this much GM budget. */
const JSON_RETRY_MIN_REMAINING_MS = 8_000

const LOW_REASONING = { effort: "low", exclude: true } as const

export type LlmModels = {
  cheap: string
  strong: string | null
}

export type LlmFailure = {
  ok: false
  latencyMs: number
  kind: "http" | "timeout" | "empty" | "zod"
  zodIssueCount?: number
  message: string
  httpStatus: number | null
  content: GmContentState
  abortReason: string
  finishReason?: string | null
  usage?: LlmUsage | null
}

export type LlmCallResult =
  | {
      ok: true
      turn: GMTurn
      latencyMs: number
      zodIssueCount: 0
    }
  | LlmFailure

type ModelMeta = {
  finishReason: string | null
  usage: LlmUsage | null
}

const EMPTY_META: ModelMeta = { finishReason: null, usage: null }

type AttemptLog = {
  kind: LlmLogKind
  provider: LlmProviderId
  model: string
  gameTurn: number | null
  gameDate: string | null
  attempt: number
}

export type { LlmProviderId, LlmTarget }

type JsonSchemaSpec = { name: string; schema: object }

type SendOptions = {
  tokenParam: "max_tokens" | "max_completion_tokens"
  omitTemperature: boolean
}

export function resolveLlmModels(): LlmModels {
  const cheap = process.env.LLM_MODEL || "gpt-4o-mini"
  const strongRaw = process.env.LLM_MODEL_STRONG?.trim()
  const strong = strongRaw && strongRaw !== cheap ? strongRaw : null
  return { cheap, strong }
}

export function llmConfigured(): boolean {
  return resolveProviderChain().length > 0
}

export { resolveProviderChain } from "@/lib/gm/providers"

/** Direct `llmAiTurn` callers (and the OpenRouter slot) keep the existing `LLM_*` endpoint. */
function legacyOpenRouterTarget(): LlmTarget | null {
  const key = process.env.LLM_API_KEY?.trim()
  if (!key) return null
  return {
    provider: "openrouter",
    baseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey: key,
    wire: "compatible",
  }
}

function chatTarget(explicit?: LlmTarget): LlmTarget | null {
  if (explicit) return explicit
  const first = resolveProviderChain()[0]
  if (first) return targetFromProvider(first)
  return legacyOpenRouterTarget()
}

export async function llmAiTurn(
  state: GameState,
  orders: PlayerOrder[],
  options: { model: string; timeoutMs: number; budgetDeadline?: number; target?: LlmTarget },
): Promise<LlmCallResult> {
  const target = options.target ?? legacyOpenRouterTarget()
  if (!target) {
    return llmFailure({
      latencyMs: 0,
      kind: "http",
      message: "LLM_API_KEY is not set",
      httpStatus: null,
      content: "n/a",
      abortReason: "LLM_API_KEY is not set",
    })
  }

  void orders
  const user = [
    digest(state),
    "",
    "The Central Powers' orders are not included. Lock Russian orders from this map alone.",
  ].join("\n")

  const started = Date.now()
  const budgetDeadline = options.budgetDeadline ?? started + Math.max(1, options.timeoutMs)
  const log: AttemptLog = {
    kind: "turn",
    provider: target.provider,
    model: options.model,
    gameTurn: state.turn,
    gameDate: state.date,
    attempt: 0,
  }
  const run = () =>
    completeWithFormatFallback(
      target,
      options.model,
      user,
      callWindow(budgetDeadline, options.timeoutMs),
      log,
      { name: "gm_turn", schema: target.wire === "openai" ? OPENAI_GM_JSON_SCHEMA : GM_JSON_SCHEMA },
    )

  try {
    const turn = await run()
    return { ok: true, turn, latencyMs: Date.now() - started, zodIssueCount: 0 }
  } catch (error) {
    const remaining = budgetDeadline - Date.now()
    if (isRetryableModelError(error) && remaining >= JSON_RETRY_MIN_REMAINING_MS) {
      try {
        const turn = await run()
        return { ok: true, turn, latencyMs: Date.now() - started, zodIssueCount: 0 }
      } catch (retryError) {
        return classifyLlmError(retryError, Date.now() - started)
      }
    }
    return classifyLlmError(error, Date.now() - started)
  }
}

function callWindow(deadline: number, cap: number): number {
  return Math.max(1, Math.min(cap, deadline - Date.now()))
}

function isRetryableModelError(error: unknown): boolean {
  return error instanceof LlmZodError || error instanceof LlmEmptyError
}

async function completeWithFormatFallback(
  target: LlmTarget,
  model: string,
  user: string,
  timeoutMs: number,
  log: AttemptLog,
  jsonSchema: JsonSchemaSpec,
): Promise<GMTurn> {
  const deadline = Date.now() + timeoutMs
  const left = () => Math.max(1, deadline - Date.now())
  if (target.wire === "openai") {
    return runOpenAiAttempts((attempt) => {
      const extra = openAiExtra(attempt, jsonSchema)
      return complete(target, model, user, extra, left(), log, {
        tokenParam: attempt.tokenParam,
        omitTemperature: omitOpenAiTemperature(attempt),
      })
    })
  }

  const openRouter = target.baseUrl.includes("openrouter.ai")
  let useReasoning = openRouter
  let useSchema = true
  let droppedReasoning = false
  let droppedSchema = false

  for (;;) {
    const extra: Record<string, unknown> = {
      response_format: useSchema ? schemaFormat(jsonSchema, false) : { type: "json_object" },
    }
    if (useReasoning) extra.reasoning = LOW_REASONING
    try {
      return await complete(target, model, user, extra, left(), log, {
        tokenParam: "max_tokens",
        omitTemperature: false,
      })
    } catch (error) {
      if (useReasoning && !droppedReasoning && isReasoningUnsupported(error)) {
        droppedReasoning = true
        useReasoning = false
        continue
      }
      if (useSchema && !droppedSchema && isResponseFormatUnsupported(error)) {
        droppedSchema = true
        useSchema = false
        continue
      }
      throw error
    }
  }
}

type OpenAiAttempt = {
  useReasoning: boolean
  useSchema: boolean
  tokenParam: "max_completion_tokens" | "max_tokens"
}

/** OpenAI chat: `reasoning_effort`, strict json_schema, no temperature unless effort is `none`, `max_completion_tokens`. */
async function runOpenAiAttempts<T>(run: (attempt: OpenAiAttempt) => Promise<T>): Promise<T> {
  let useReasoning = true
  let useSchema = true
  let tokenParam: OpenAiAttempt["tokenParam"] = "max_completion_tokens"
  let droppedReasoning = false
  let droppedSchema = false
  let droppedToken = false
  for (;;) {
    try {
      return await run({ useReasoning, useSchema, tokenParam })
    } catch (error) {
      if (!droppedToken && tokenParam === "max_completion_tokens" && mentions(error, "max_completion_tokens")) {
        droppedToken = true
        tokenParam = "max_tokens"
        continue
      }
      if (useReasoning && !droppedReasoning && isReasoningUnsupported(error)) {
        droppedReasoning = true
        useReasoning = false
        continue
      }
      if (useSchema && !droppedSchema && isResponseFormatUnsupported(error)) {
        droppedSchema = true
        useSchema = false
        continue
      }
      throw error
    }
  }
}

function openAiExtra(attempt: OpenAiAttempt, jsonSchema: JsonSchemaSpec | null): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  if (attempt.useSchema && jsonSchema) extra.response_format = schemaFormat(jsonSchema, true)
  else extra.response_format = { type: "json_object" }
  if (attempt.useReasoning) extra.reasoning_effort = resolveOpenAiReasoningEffort()
  return extra
}

/** Temperature is unsupported while Chat Completions reasoning effort is not `none`. */
function omitOpenAiTemperature(attempt: OpenAiAttempt): boolean {
  return attempt.useReasoning && resolveOpenAiReasoningEffort() !== "none"
}

function mentions(error: unknown, needle: string): boolean {
  return providerText(error).toLowerCase().includes(needle.toLowerCase())
}

async function complete(
  target: LlmTarget,
  model: string,
  user: string,
  extra: Record<string, unknown>,
  timeoutMs: number,
  log: AttemptLog,
  send: SendOptions,
): Promise<GMTurn> {
  const attempt = ++log.attempt
  const ctx: AttemptLog = { ...log, attempt }
  let sent: SentChat
  try {
    sent = await sendChat({
      target,
      model,
      system: SYSTEM,
      user,
      timeoutMs,
      maxTokens: GM_MAX_TOKENS,
      temperature: 0.4,
      extra,
      send,
    })
  } catch (error) {
    logTransportFailure(ctx, error)
    throw error
  }

  const meta: ModelMeta = { finishReason: sent.finishReason, usage: sent.usage }
  if (!sent.content) {
    logAttempt(ctx, {
      latencyMs: sent.latencyMs,
      httpStatus: sent.httpStatus,
      finishReason: sent.finishReason,
      usage: sent.usage,
      content: null,
      outcome: "empty",
      error: "empty message",
      fellBack: true,
    })
    throw new LlmEmptyError("LLM returned an empty message", meta)
  }

  const extracted = extractTopLevelJson(sent.content)
  if (!extracted.ok) {
    logAttempt(ctx, {
      latencyMs: sent.latencyMs,
      httpStatus: sent.httpStatus,
      finishReason: sent.finishReason,
      usage: sent.usage,
      content: sent.content,
      outcome: "invalid_json",
      error: extracted.error,
      fellBack: true,
    })
    throw new LlmZodError(extracted.error, 1, meta)
  }

  const result = GMTurnSchema.safeParse(stripNullFields(extracted.value))
  if (!result.success) {
    const message = `LLM JSON failed validation: ${result.error.issues
      .map((issue) => issue.message)
      .slice(0, 4)
      .join("; ")}`
    logAttempt(ctx, {
      latencyMs: sent.latencyMs,
      httpStatus: sent.httpStatus,
      finishReason: sent.finishReason,
      usage: sent.usage,
      content: sent.content,
      outcome: "schema",
      error: message,
      fellBack: true,
    })
    throw new LlmZodError(message, result.error.issues.length, meta)
  }

  logAttempt(ctx, {
    latencyMs: sent.latencyMs,
    httpStatus: sent.httpStatus,
    finishReason: sent.finishReason,
    usage: sent.usage,
    content: sent.content,
    outcome: "ok",
    error: null,
    fellBack: false,
  })
  return result.data
}

class LlmZodError extends Error {
  issueCount: number
  meta: ModelMeta
  constructor(message: string, issueCount: number, meta: ModelMeta = EMPTY_META) {
    super(message)
    this.name = "LlmZodError"
    this.issueCount = issueCount
    this.meta = meta
  }
}

class LlmTimeoutError extends Error {
  latencyMs: number
  constructor(message: string, latencyMs = 0) {
    super(message)
    this.name = "LlmTimeoutError"
    this.latencyMs = latencyMs
  }
}

class LlmHttpError extends Error {
  status: number
  rawBody: string
  latencyMs: number
  constructor(status: number, message: string, rawBody: string, latencyMs: number) {
    super(message)
    this.name = "LlmHttpError"
    this.status = status
    this.rawBody = rawBody
    this.latencyMs = latencyMs
  }
}

class LlmEmptyError extends Error {
  meta: ModelMeta
  constructor(message: string, meta: ModelMeta = EMPTY_META) {
    super(message)
    this.name = "LlmEmptyError"
    this.meta = meta
  }
}

function llmFailure(failure: Omit<LlmFailure, "ok">): LlmFailure {
  return { ok: false, ...failure }
}

/** Map a thrown model error onto fields that are safe to show a player. */
export function classifyLlmError(error: unknown, latencyMs: number): LlmFailure {
  if (error instanceof LlmZodError) {
    const reason = sanitizeGmText(error.message) || "validation failed"
    return llmFailure({
      latencyMs,
      kind: "zod",
      zodIssueCount: error.issueCount,
      message: reason,
      httpStatus: null,
      content: "present",
      abortReason: reason,
      finishReason: error.meta.finishReason,
      usage: error.meta.usage,
    })
  }
  if (error instanceof LlmEmptyError || errorMessage(error).toLowerCase().includes("empty message")) {
    return llmFailure({
      latencyMs,
      kind: "empty",
      message: "LLM returned an empty message",
      httpStatus: null,
      content: "empty",
      abortReason: "empty message",
      finishReason: error instanceof LlmEmptyError ? error.meta.finishReason : null,
      usage: error instanceof LlmEmptyError ? error.meta.usage : null,
    })
  }
  if (error instanceof LlmHttpError) {
    return llmFailure({
      latencyMs,
      kind: "http",
      message: error.message,
      httpStatus: error.status,
      content: "n/a",
      abortReason: error.message,
    })
  }
  const status = httpStatusOf(errorMessage(error))
  if (status) {
    const reason = `LLM HTTP ${status}`
    return llmFailure({
      latencyMs,
      kind: "http",
      message: reason,
      httpStatus: status,
      content: "n/a",
      abortReason: reason,
    })
  }
  if (error instanceof LlmTimeoutError || isAbortTimeout(error)) {
    const reason = abortReasonOf(error)
    return llmFailure({
      latencyMs,
      kind: "timeout",
      message: reason,
      httpStatus: null,
      content: "n/a",
      abortReason: reason,
    })
  }
  const reason = sanitizeGmText(errorMessage(error)) || "LLM request failed"
  return llmFailure({
    latencyMs,
    kind: "http",
    message: reason,
    httpStatus: null,
    content: "n/a",
    abortReason: reason,
  })
}

export function isAbortTimeout(error: unknown): boolean {
  const name = errorName(error)
  if (name === "TimeoutError" || name === "AbortError" || name === "LlmTimeoutError") return true
  const message = errorMessage(error).toLowerCase()
  return message.includes("aborted due to timeout") || message.includes("timed out")
}

function abortReasonOf(error: unknown): string {
  return sanitizeGmText(errorMessage(error)) || "timeout"
}

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error && typeof (error as { name: unknown }).name === "string") {
    return (error as { name: string }).name
  }
  return ""
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message
  }
  return String(error ?? "")
}

function httpStatusOf(message: string): number | null {
  const match = message.match(/LLM HTTP (\d{3})/i)
  if (!match) return null
  const status = Number(match[1])
  return status >= 100 && status <= 599 ? status : null
}

function publicHttpReason(status: number, body: string): string {
  const snippet = sanitizeGmText(body)
  if (!snippet || snippet.includes("[redacted]") || snippet.startsWith("{") || snippet.startsWith("[")) {
    return `LLM HTTP ${status}`
  }
  const brief = snippet.slice(0, 80)
  return brief ? `LLM HTTP ${status}: ${brief}` : `LLM HTTP ${status}`
}

function providerText(error: unknown): string {
  if (error instanceof LlmHttpError) return `${error.message}\n${error.rawBody}`
  return errorMessage(error)
}

function isResponseFormatUnsupported(error: unknown): boolean {
  const text = providerText(error).toLowerCase()
  return (
    text.includes("response_format") ||
    text.includes("json_schema") ||
    text.includes("structured outputs") ||
    text.includes("unsupported") ||
    text.includes("invalid parameter")
  )
}

function schemaFormat(spec: JsonSchemaSpec, strict: boolean) {
  return {
    type: "json_schema",
    json_schema: {
      name: spec.name,
      strict,
      schema: spec.schema,
    },
  }
}

/** Drop nulls from strict-mode replies so optional Zod fields still parse. */
export function stripNullFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNullFields)
  if (!value || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === null) continue
    out[key] = stripNullFields(item)
  }
  return out
}

export type JsonExtract =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

/** Drop markdown fences anywhere, then take the first balanced top-level object. */
export function extractTopLevelJson(text: string): JsonExtract {
  const stripped = stripFences(text).trim()
  if (!stripped) return { ok: false, error: "LLM JSON was not valid JSON" }
  const direct = parseJson(stripped)
  if (direct.ok) return direct
  const slice = firstBalancedObject(stripped)
  if (!slice) return { ok: false, error: "LLM JSON was not valid JSON" }
  return parseJson(slice)
}

function parseJson(text: string): JsonExtract {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, error: "LLM JSON was not valid JSON" }
  }
}

function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "")
}

function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (char === "\\") {
        escape = true
        continue
      }
      if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

export function llmBaseUrl(): string {
  return (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")
}

/** Same headers the Russian staff uses. OpenRouter titles stay off the OpenAI request. */
export function llmRequestHeaders(key: string, wire: LlmWire = "compatible"): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  }
  if (wire === "openai") return headers
  const referer = process.env.LLM_HTTP_REFERER?.trim()
  if (referer) headers["HTTP-Referer"] = referer
  const title = process.env.LLM_HTTP_TITLE?.trim()
  if (title) headers["X-Title"] = title
  return headers
}

export type LlmChatFailureKind = "unconfigured" | "http" | "timeout" | "empty" | "invalid_json"

export type LlmExchange = {
  attempt: number
  httpStatus: number | null
  finishReason: string | null
  usage: LlmUsage | null
  content: string | null
  latencyMs: number
}

export type LlmChatResult =
  | {
      ok: true
      content: string
      latencyMs: number
      exchange: LlmExchange
      provider: LlmProviderId
      model: string
    }
  | {
      ok: false
      kind: LlmChatFailureKind
      message: string
      latencyMs: number
      exchange: null
      provider: LlmProviderId | null
      model: string | null
      httpStatus: number | null
    }

export type LlmJsonVerdict = { ok: true } | { ok: false; outcome: "invalid_json" | "schema"; error: string }

/**
 * One chat completion. Reasoning models sometimes spend the whole token budget
 * before they write `content`. Null or empty content is an `empty` result.
 * Pass `target` to pin a provider; otherwise the first configured provider is used.
 */
export async function llmChat(options: {
  model: string
  system: string
  user: string
  timeoutMs: number
  maxTokens: number
  temperature?: number
  gameTurn?: number | null
  gameDate?: string | null
  kind?: LlmLogKind
  target?: LlmTarget
  jsonSchema?: JsonSchemaSpec
}): Promise<LlmChatResult> {
  const target = chatTarget(options.target)
  if (!target) {
    return {
      ok: false,
      kind: "unconfigured",
      message: "OPENAI_API_KEY and LLM_API_KEY are not set",
      latencyMs: 0,
      exchange: null,
      provider: null,
      model: null,
      httpStatus: null,
    }
  }
  const started = Date.now()
  const log: AttemptLog = {
    kind: options.kind ?? "advisor",
    provider: target.provider,
    model: options.model,
    gameTurn: options.gameTurn ?? null,
    gameDate: options.gameDate ?? null,
    attempt: 0,
  }
  try {
    const result = await chatWithFallbacks(target, options, log)
    return {
      ok: true,
      content: result.content,
      latencyMs: Date.now() - started,
      exchange: result.exchange,
      provider: target.provider,
      model: options.model,
    }
  } catch (error) {
    const latencyMs = Date.now() - started
    const httpStatus = error instanceof LlmHttpError ? error.status : null
    if (error instanceof LlmTimeoutError) {
      return {
        ok: false,
        kind: "timeout",
        message: error.message,
        latencyMs,
        exchange: null,
        provider: target.provider,
        model: options.model,
        httpStatus: null,
      }
    }
    if (error instanceof LlmEmptyError) {
      return {
        ok: false,
        kind: "empty",
        message: error.message,
        latencyMs,
        exchange: null,
        provider: target.provider,
        model: options.model,
        httpStatus: null,
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      kind: "http",
      message,
      latencyMs,
      exchange: null,
      provider: target.provider,
      model: options.model,
      httpStatus,
    }
  }
}

/**
 * Try each configured provider until one returns JSON `accept` allows.
 * The first provider gets about half the timeout when a backup is configured.
 */
export async function llmChatChain(options: {
  system: string
  user: string
  timeoutMs: number
  maxTokens: number
  temperature?: number
  gameTurn?: number | null
  gameDate?: string | null
  kind?: LlmLogKind
  jsonSchema?: JsonSchemaSpec
  accept: (content: string) => LlmJsonVerdict
}): Promise<LlmChatResult> {
  const providers = resolveProviderChain()
  if (providers.length === 0) {
    return {
      ok: false,
      kind: "unconfigured",
      message: "OPENAI_API_KEY and LLM_API_KEY are not set",
      latencyMs: 0,
      exchange: null,
      provider: null,
      model: null,
      httpStatus: null,
    }
  }
  const started = Date.now()
  const deadline = started + Math.max(1, options.timeoutMs)
  let last: LlmChatResult | null = null
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index]!
    const another = index < providers.length - 1
    const remaining = Math.max(1, deadline - Date.now())
    const timeoutMs = providerAttemptTimeout(remaining, another, options.timeoutMs)
    const chat = await llmChat({
      ...options,
      model: provider.model,
      timeoutMs,
      target: targetFromProvider(provider),
    })
    if (!chat.ok) {
      last = chat
      if (another && failureShouldFailover(chat.kind === "invalid_json" ? "invalid_json" : chat.kind, chat.httpStatus)) {
        continue
      }
      return chat
    }
    const verdict = options.accept(chat.content)
    if (verdict.ok) return chat
    scheduleLlmResponseLog({
      kind: options.kind ?? "advisor",
      attempt: chat.exchange.attempt,
      gameTurn: options.gameTurn ?? null,
      gameDate: options.gameDate ?? null,
      provider: provider.id,
      model: provider.model,
      latencyMs: chat.exchange.latencyMs,
      httpStatus: chat.exchange.httpStatus,
      finishReason: chat.exchange.finishReason,
      usage: chat.exchange.usage,
      content: chat.content,
      outcome: verdict.outcome === "schema" ? "schema" : "invalid_json",
      error: verdict.error,
      fellBack: true,
    })
    last = {
      ok: false,
      kind: "invalid_json",
      message: verdict.error,
      latencyMs: Date.now() - started,
      exchange: null,
      provider: provider.id,
      model: provider.model,
      httpStatus: chat.exchange.httpStatus,
    }
    if (another) continue
    return last
  }
  return (
    last ?? {
      ok: false,
      kind: "http",
      message: "LLM chat failed",
      latencyMs: Date.now() - started,
      exchange: null,
      provider: null,
      model: null,
      httpStatus: null,
    }
  )
}

async function chatWithFallbacks(
  target: LlmTarget,
  options: {
    model: string
    system: string
    user: string
    timeoutMs: number
    maxTokens: number
    temperature?: number
    jsonSchema?: JsonSchemaSpec
  },
  log: AttemptLog,
): Promise<{ content: string; exchange: LlmExchange }> {
  const deadline = Date.now() + Math.max(1, options.timeoutMs)
  const remainingOptions = () => ({ ...options, timeoutMs: callWindow(deadline, options.timeoutMs) })

  if (target.wire === "openai") {
    return runOpenAiAttempts((attempt) =>
      sendChatOnce(target, remainingOptions(), openAiExtra(attempt, options.jsonSchema ?? null), log, {
        tokenParam: attempt.tokenParam,
        omitTemperature: omitOpenAiTemperature(attempt),
      }),
    )
  }

  const openRouter = target.baseUrl.includes("openrouter.ai")
  const attempts: Record<string, unknown>[] = []
  if (openRouter) {
    attempts.push({
      response_format: { type: "json_object" },
      reasoning: LOW_REASONING,
    })
  }
  attempts.push({ response_format: { type: "json_object" } })
  attempts.push({})

  let last: unknown
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      return await sendChatOnce(target, remainingOptions(), attempts[index] ?? {}, log, {
        tokenParam: "max_tokens",
        omitTemperature: false,
      })
    } catch (error) {
      last = error
      if (error instanceof LlmEmptyError) throw error
      const retry = (isResponseFormatUnsupported(error) || isReasoningUnsupported(error)) && index < attempts.length - 1
      if (!retry) throw error
    }
  }
  throw last instanceof Error ? last : new Error("LLM chat failed")
}

async function sendChatOnce(
  target: LlmTarget,
  options: {
    model: string
    system: string
    user: string
    timeoutMs: number
    maxTokens: number
    temperature?: number
  },
  extra: Record<string, unknown>,
  log: AttemptLog,
  send: SendOptions,
): Promise<{ content: string; exchange: LlmExchange }> {
  const attempt = ++log.attempt
  const ctx: AttemptLog = { ...log, attempt }
  try {
    const sent = await sendChat({
      target,
      model: options.model,
      system: options.system,
      user: options.user,
      timeoutMs: options.timeoutMs,
      maxTokens: options.maxTokens,
      temperature: options.temperature ?? 0.3,
      extra,
      send,
    })
    if (!sent.content) {
      logAttempt(ctx, {
        latencyMs: sent.latencyMs,
        httpStatus: sent.httpStatus,
        finishReason: sent.finishReason,
        usage: sent.usage,
        content: null,
        outcome: "empty",
        error: "empty message",
        fellBack: true,
      })
      throw new LlmEmptyError("LLM returned an empty message", {
        finishReason: sent.finishReason,
        usage: sent.usage,
      })
    }
    logAttempt(ctx, {
      latencyMs: sent.latencyMs,
      httpStatus: sent.httpStatus,
      finishReason: sent.finishReason,
      usage: sent.usage,
      content: sent.content,
      outcome: "ok",
      error: null,
      fellBack: false,
    })
    return {
      content: sent.content,
      exchange: {
        attempt,
        httpStatus: sent.httpStatus,
        finishReason: sent.finishReason,
        usage: sent.usage,
        content: sent.content,
        latencyMs: sent.latencyMs,
      },
    }
  } catch (error) {
    if (!(error instanceof LlmEmptyError)) logTransportFailure(ctx, error)
    throw error
  }
}

type SentChat = {
  httpStatus: number
  finishReason: string | null
  usage: LlmUsage | null
  content: string | null
  latencyMs: number
}

async function sendChat(options: {
  target: LlmTarget
  model: string
  system: string
  user: string
  timeoutMs: number
  maxTokens: number
  temperature: number
  extra: Record<string, unknown>
  send: SendOptions
}): Promise<SentChat> {
  const started = Date.now()
  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    ...options.extra,
  }
  if (options.send.tokenParam === "max_completion_tokens") body.max_completion_tokens = options.maxTokens
  else body.max_tokens = options.maxTokens
  if (!options.send.omitTemperature) body.temperature = options.temperature
  let response: Response
  try {
    response = await fetch(`${options.target.baseUrl}/chat/completions`, {
      method: "POST",
      headers: llmRequestHeaders(options.target.apiKey, options.target.wire),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error) {
    const latencyMs = Date.now() - started
    if (isAbortTimeout(error)) throw new LlmTimeoutError(abortReasonOf(error), latencyMs)
    throw error
  }

  const latencyMs = Date.now() - started
  if (!response.ok) {
    const rawBody = await response.text()
    throw new LlmHttpError(response.status, publicHttpReason(response.status, rawBody), rawBody, latencyMs)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new LlmHttpError(response.status, `LLM HTTP ${response.status}`, "", latencyMs)
  }

  return {
    httpStatus: response.status,
    finishReason: readFinishReason(payload),
    usage: readUsage(payload),
    content: readMessageContent(payload),
    latencyMs,
  }
}

export function readFinishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0 || !choices[0] || typeof choices[0] !== "object") return null
  const choice = choices[0] as { finish_reason?: unknown; native_finish_reason?: unknown }
  if (typeof choice.finish_reason === "string" && choice.finish_reason.trim()) return choice.finish_reason.trim()
  if (typeof choice.native_finish_reason === "string" && choice.native_finish_reason.trim()) {
    return choice.native_finish_reason.trim()
  }
  return null
}

export function readUsage(payload: unknown): LlmUsage | null {
  if (!payload || typeof payload !== "object") return null
  const usage = (payload as { usage?: unknown }).usage
  if (!usage || typeof usage !== "object") return null
  const record = usage as Record<string, unknown>
  const promptTokens = readTokenCount(record.prompt_tokens) ?? readTokenCount(record.input_tokens)
  const completionTokens = readTokenCount(record.completion_tokens) ?? readTokenCount(record.output_tokens)
  const totalTokens = readTokenCount(record.total_tokens)
  const reasoningTokens = readReasoningTokens(record)
  if (promptTokens == null && completionTokens == null && totalTokens == null && reasoningTokens == null) return null
  return { promptTokens, completionTokens, totalTokens, reasoningTokens }
}

function readReasoningTokens(usage: Record<string, unknown>): number | null {
  for (const key of ["completion_tokens_details", "output_tokens_details"]) {
    const detail = usage[key]
    if (!detail || typeof detail !== "object") continue
    const count = readTokenCount((detail as Record<string, unknown>).reasoning_tokens)
    if (count != null) return count
  }
  return readTokenCount(usage.reasoning_tokens)
}

function readTokenCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

function logAttempt(
  ctx: AttemptLog,
  fields: {
    latencyMs: number
    httpStatus: number | null
    finishReason: string | null
    usage: LlmUsage | null
    content: string | null
    outcome: LlmLogOutcome
    error: string | null
    fellBack: boolean
  },
): void {
  scheduleLlmResponseLog({
    kind: ctx.kind,
    attempt: ctx.attempt,
    gameTurn: ctx.gameTurn,
    gameDate: ctx.gameDate,
    provider: ctx.provider,
    model: ctx.model,
    ...fields,
  })
}

function logTransportFailure(ctx: AttemptLog, error: unknown): void {
  if (error instanceof LlmHttpError) {
    logAttempt(ctx, {
      latencyMs: error.latencyMs,
      httpStatus: error.status,
      finishReason: null,
      usage: null,
      content: error.rawBody || null,
      outcome: "http",
      error: error.message,
      fellBack: true,
    })
    return
  }
  if (error instanceof LlmTimeoutError || isAbortTimeout(error)) {
    logAttempt(ctx, {
      latencyMs: error instanceof LlmTimeoutError ? error.latencyMs : 0,
      httpStatus: null,
      finishReason: null,
      usage: null,
      content: null,
      outcome: "timeout",
      error: error instanceof Error ? error.message : "timeout",
      fellBack: true,
    })
    return
  }
  logAttempt(ctx, {
    latencyMs: 0,
    httpStatus: null,
    finishReason: null,
    usage: null,
    content: null,
    outcome: "http",
    error: error instanceof Error ? error.message : "LLM request failed",
    fellBack: true,
  })
}

/** Visible assistant text only. Ignores reasoning traces, which may be null-content leftovers. */
export function readMessageContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as { message?: unknown } | undefined)?.message
  if (!message || typeof message !== "object") return null
  const text = contentToString((message as { content?: unknown }).content).trim()
  return text || null
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => {
      if (typeof part === "string") return part
      if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
        return (part as { text: string }).text
      }
      return ""
    })
    .join("")
}

function isReasoningUnsupported(error: unknown): boolean {
  const text = providerText(error).toLowerCase()
  return text.includes("reasoning") || text.includes("thinking")
}

function digest(state: GameState): string {
  const lines = state.provinces.map((province) => {
    const units = independentFormations(province.units)
      .map((unit) => {
        const children = childUnits(province.units, unit.id)
        const nested = children.length ? `, under it: ${children.map((child) => child.id).join(",")}` : ""
        return `${unit.id} (${unit.name}, ${echelonOf(unit)}, ${unit.kind}, ${unit.faction}, str ${unit.strength}, mor ${unit.morale}${nested})`
      })
      .join("; ")
    return [
      province.id,
      province.name,
      province.terrain,
      `owner ${province.owner}`,
      `ctrl ${province.controller}`,
      `sup ${province.supply}`,
      `unr ${province.unrest}`,
      `fort ${province.fort}`,
      province.depot ? `depot ${province.depot}` : "",
      `neigh ${province.neighbors.join(",")}`,
      `rail ${province.rail.join(",") || "-"}`,
      `units ${units || "none"}`,
    ]
      .filter(Boolean)
      .join(" | ")
  })
  return [`Date: ${state.date}`, `Turn index: ${state.turn}`, ...lines].join("\n")
}
