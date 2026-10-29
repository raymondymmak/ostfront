import { childUnits, echelonOf, independentFormations } from "@/lib/engine/echelon"
import { sanitizeGmText, type GmContentState } from "@/lib/gm/debug"
import { GMTurnSchema, GM_JSON_SCHEMA } from "@/lib/schema"
import type { GameState, GMTurn, PlayerOrder } from "@/lib/types"

const SYSTEM = `You are the Russian staff for the Gorlice–Tarnów offensive, from 2 May 1915 through the fortnight of 11 July. The map state is authoritative. You narrate and propose. A deterministic engine accepts or rejects every proposal. You do not roll dice and you do not describe results.

The human player commands the Central Powers: Mackensen's German 11th Army and the Austro-Hungarian 4th Army on the Dunajec, with holding forces in East Prussia, Silesia and the Carpathians. You are Stavka. You command Russia and the friction of the war: events, small supply or unrest shocks, and diplomacy. On 2 May Radko Dimitriev's 3rd Army holds Lemberg, Russian since September 1914. Przemyśl lies inside the Kraków province and is not a separate state. Do not propose move, attack, or fortify actions for Central Powers formations. The engine inserts the player's orders itself. You may propose Russian moves, attacks, and fortify actions, plus modify proposals.

Respect these limits so the engine does not reject you:
- move: {"type":"move","unit":"<unit id>","to":"<province id>"} only along neighbors, only into a province Russia controls, only if that unit's current province has supply >= 30.
- attack: {"type":"attack","from":"<province id>","target":"<province id>","units":["<unit id>"]} from and target are neighbors, target is not Russian-controlled, every unit is in from, supply at from >= 30.
- fortify: {"type":"fortify","province":"<province id>"} only where Russia has a unit, supply >= 40, and fort < 3.
- modify: {"type":"modify","province":"<province id>","field":"unrest"|"supply","delta":<number>,"reason":"<short>"} Delta must be between -20 and 20.
- events: partisans, strike, epidemic, or breakthrough, each with a real province id.
Use only ids from the state digest. narration is two short paragraphs, present tense, staff-college prose, about intentions. diplomacy is zero to two short sentences. Return one JSON object and no markdown.

JSON schema for your reply (follow exactly):
${JSON.stringify(GM_JSON_SCHEMA)}`

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
}

export type LlmCallResult =
  | {
      ok: true
      turn: GMTurn
      latencyMs: number
      zodIssueCount: 0
    }
  | LlmFailure

export function resolveLlmModels(): LlmModels {
  const cheap = process.env.LLM_MODEL || "gpt-4o-mini"
  const strongRaw = process.env.LLM_MODEL_STRONG?.trim()
  const strong = strongRaw && strongRaw !== cheap ? strongRaw : null
  return { cheap, strong }
}

export function llmConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY?.trim())
}

export async function llmAiTurn(
  state: GameState,
  orders: PlayerOrder[],
  options: { model: string; timeoutMs: number },
): Promise<LlmCallResult> {
  const key = process.env.LLM_API_KEY
  if (!key) {
    return llmFailure({
      latencyMs: 0,
      kind: "http",
      message: "LLM_API_KEY is not set",
      httpStatus: null,
      content: "n/a",
      abortReason: "LLM_API_KEY is not set",
    })
  }
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  )

  const user = [
    digest(state),
    "",
    "Player orders (the engine will add the legal ones; do not repeat Central Powers moves):",
    JSON.stringify(orders),
  ].join("\n")

  const started = Date.now()
  try {
    const turn = await completeWithFormatFallback(
      base,
      key,
      options.model,
      user,
      options.timeoutMs,
    )
    return {
      ok: true,
      turn,
      latencyMs: Date.now() - started,
      zodIssueCount: 0,
    }
  } catch (error) {
    return classifyLlmError(error, Date.now() - started)
  }
}

async function completeWithFormatFallback(
  base: string,
  key: string,
  model: string,
  user: string,
  timeoutMs: number,
): Promise<GMTurn> {
  try {
    return await complete(base, key, model, user, schemaFormat(), timeoutMs)
  } catch (error) {
    if (!isResponseFormatUnsupported(error)) throw error
    return await complete(base, key, model, user, { type: "json_object" }, timeoutMs)
  }
}

async function complete(
  base: string,
  key: string,
  model: string,
  user: string,
  responseFormat: unknown,
  timeoutMs: number,
): Promise<GMTurn> {
  const headers = llmRequestHeaders(key)

  let response: Response
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 1800,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        response_format: responseFormat,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (isAbortTimeout(error)) throw new LlmTimeoutError(abortReasonOf(error))
    throw error
  }

  if (!response.ok) {
    const body = await response.text()
    throw new LlmHttpError(response.status, publicHttpReason(response.status, body))
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[]
  }
  const content = payload.choices?.[0]?.message?.content
  if (content == null || (typeof content === "string" && content.trim() === "")) {
    throw new LlmEmptyError("LLM returned an empty message")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(content))
  } catch {
    throw new LlmZodError("LLM JSON was not valid JSON", 1)
  }
  const result = GMTurnSchema.safeParse(parsed)
  if (!result.success) {
    throw new LlmZodError(
      `LLM JSON failed validation: ${result.error.issues
        .map((issue) => issue.message)
        .slice(0, 4)
        .join("; ")}`,
      result.error.issues.length,
    )
  }
  return result.data
}

class LlmZodError extends Error {
  issueCount: number
  constructor(message: string, issueCount: number) {
    super(message)
    this.name = "LlmZodError"
    this.issueCount = issueCount
  }
}

class LlmTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LlmTimeoutError"
  }
}

class LlmHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "LlmHttpError"
    this.status = status
  }
}

class LlmEmptyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LlmEmptyError"
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

function isResponseFormatUnsupported(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = error.message.toLowerCase()
  return (
    text.includes("response_format") ||
    text.includes("json_schema") ||
    text.includes("structured outputs") ||
    text.includes("unsupported") ||
    text.includes("invalid parameter")
  )
}

function schemaFormat() {
  return {
    type: "json_schema",
    json_schema: {
      name: "gm_turn",
      strict: false,
      schema: GM_JSON_SCHEMA,
    },
  }
}

function stripFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

export function llmBaseUrl(): string {
  return (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")
}

/** Same headers the Russian staff uses, including optional OpenRouter titles. */
export function llmRequestHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  }
  const referer = process.env.LLM_HTTP_REFERER?.trim()
  if (referer) headers["HTTP-Referer"] = referer
  const title = process.env.LLM_HTTP_TITLE?.trim()
  if (title) headers["X-Title"] = title
  return headers
}

export type LlmChatFailureKind = "unconfigured" | "http" | "timeout" | "empty"

export type LlmChatResult =
  | { ok: true; content: string; latencyMs: number }
  | { ok: false; kind: LlmChatFailureKind; message: string; latencyMs: number }

/**
 * One chat completion on the fast model. Reasoning models sometimes spend the
 * whole max_tokens budget before they write `content`. Null or empty content
 * is an `empty` result, not a throw. Reasoning text is never returned.
 */
export async function llmChat(options: {
  model: string
  system: string
  user: string
  timeoutMs: number
  maxTokens: number
  temperature?: number
}): Promise<LlmChatResult> {
  const key = process.env.LLM_API_KEY?.trim()
  if (!key) {
    return { ok: false, kind: "unconfigured", message: "LLM_API_KEY is not set", latencyMs: 0 }
  }
  const started = Date.now()
  const base = llmBaseUrl()
  const openRouter = base.includes("openrouter.ai")
  try {
    const content = await chatWithFallbacks(base, key, options, openRouter)
    return { ok: true, content, latencyMs: Date.now() - started }
  } catch (error) {
    const latencyMs = Date.now() - started
    if (error instanceof LlmTimeoutError) {
      return { ok: false, kind: "timeout", message: error.message, latencyMs }
    }
    if (error instanceof LlmEmptyError) {
      return { ok: false, kind: "empty", message: error.message, latencyMs }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, kind: "http", message, latencyMs }
  }
}

async function chatWithFallbacks(
  base: string,
  key: string,
  options: {
    model: string
    system: string
    user: string
    timeoutMs: number
    maxTokens: number
    temperature?: number
  },
  openRouter: boolean,
): Promise<string> {
  const attempts: Record<string, unknown>[] = []
  if (openRouter) {
    attempts.push({
      response_format: { type: "json_object" },
      reasoning: { effort: "low", exclude: true },
    })
  }
  attempts.push({ response_format: { type: "json_object" } })
  attempts.push({})

  let last: unknown
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      return await postChat(base, key, options, attempts[index])
    } catch (error) {
      last = error
      if (error instanceof LlmEmptyError || error instanceof LlmTimeoutError) throw error
      const retry = isResponseFormatUnsupported(error) || isReasoningUnsupported(error)
      if (!retry || index === attempts.length - 1) throw error
    }
  }
  throw last instanceof Error ? last : new Error("LLM chat failed")
}

async function postChat(
  base: string,
  key: string,
  options: {
    model: string
    system: string
    user: string
    timeoutMs: number
    maxTokens: number
    temperature?: number
  },
  extra: Record<string, unknown>,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: llmRequestHeaders(key),
      body: JSON.stringify({
        model: options.model,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
        ...extra,
      }),
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new LlmTimeoutError(`LLM timed out after ${options.timeoutMs}ms`)
    }
    throw error
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`LLM HTTP ${response.status}: ${body.slice(0, 240)}`)
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new LlmEmptyError("LLM returned an empty message")
  }
  const content = readMessageContent(payload)
  if (!content) throw new LlmEmptyError("LLM returned an empty message")
  return content
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
  if (!(error instanceof Error)) return false
  const text = error.message.toLowerCase()
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
