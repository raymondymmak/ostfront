import { GMTurnSchema, GM_JSON_SCHEMA } from "@/lib/schema"
import type { GameState, GMTurn, PlayerOrder } from "@/lib/types"

const SYSTEM = `You are the game master of a World War I operational game on the Eastern Front in 1915. The map state is authoritative. You narrate and propose. A deterministic engine accepts or rejects every proposal. You do not roll dice and you do not describe results.

The human player commands the Central Powers. You command Russia and the friction of the war: events, small supply or unrest shocks, and diplomacy. Do not propose move, attack, or fortify actions for Central Powers formations. The engine inserts the player's orders itself. You may propose Russian moves, attacks, and fortify actions, plus modify proposals.

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

export type LlmCallResult =
  | {
      ok: true
      turn: GMTurn
      latencyMs: number
      zodIssueCount: 0
    }
  | {
      ok: false
      latencyMs: number
      kind: "http" | "timeout" | "empty" | "zod"
      zodIssueCount?: number
      message: string
    }

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
    return {
      ok: false,
      latencyMs: 0,
      kind: "http",
      message: "LLM_API_KEY is not set",
    }
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
    const latencyMs = Date.now() - started
    if (error instanceof LlmZodError) {
      return {
        ok: false,
        latencyMs,
        kind: "zod",
        zodIssueCount: error.issueCount,
        message: error.message,
      }
    }
    if (error instanceof LlmTimeoutError) {
      return { ok: false, latencyMs, kind: "timeout", message: error.message }
    }
    const message = error instanceof Error ? error.message : String(error)
    const kind = message.includes("empty message") ? "empty" : "http"
    return { ok: false, latencyMs, kind, message }
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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  }
  const referer = process.env.LLM_HTTP_REFERER?.trim()
  if (referer) headers["HTTP-Referer"] = referer
  const title = process.env.LLM_HTTP_TITLE?.trim()
  if (title) headers["X-Title"] = title

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
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new LlmTimeoutError(`LLM timed out after ${timeoutMs}ms`)
    }
    throw error
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`LLM HTTP ${response.status}: ${body.slice(0, 240)}`)
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error("LLM returned an empty message")
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

function digest(state: GameState): string {
  const lines = state.provinces.map((province) => {
    const units = province.units
      .map(
        (unit) =>
          `${unit.id} (${unit.name}, ${unit.kind}, ${unit.faction}, str ${unit.strength}, mor ${unit.morale})`,
      )
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
