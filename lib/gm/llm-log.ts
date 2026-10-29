import { put } from "@vercel/blob"
import { waitUntil } from "@vercel/functions"

/** About 50KB of response text. Longer bodies are cut before upload. */
export const LLM_LOG_CONTENT_LIMIT = 50 * 1024

export type LlmLogKind = "turn" | "advisor"

export type LlmLogOutcome = "ok" | "invalid_json" | "schema" | "empty" | "http" | "timeout"

export type LlmUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
}

export type LlmLogInput = {
  kind: LlmLogKind
  attempt: number
  gameTurn?: number | null
  gameDate?: string | null
  model: string
  latencyMs: number
  httpStatus?: number | null
  finishReason?: string | null
  usage?: LlmUsage | null
  content?: string | null
  outcome: LlmLogOutcome
  error?: string | null
  fellBack: boolean
  now?: Date
  id?: string
}

export type LlmLogRecord = {
  timestamp: string
  kind: LlmLogKind
  attempt: number
  gameTurn: number | null
  gameDate: string | null
  model: string
  env: string | null
  latencyMs: number
  httpStatus: number | null
  finishReason: string | null
  usage: LlmUsage
  content: string | null
  outcome: LlmLogOutcome
  error: string | null
  fellBack: boolean
}

const SECRET =
  /Bearer\s+\S+|sk-[A-Za-z0-9_-]{6,}|vercel_blob_rw_[A-Za-z0-9_]+|\bLLM_API_KEY\s*[=:]\s*\S+/gi

/**
 * One JSON object per model call.
 * `@vercel/blob` 2.x supports `access: "private"`, so the object is not public.
 */
export function llmLogPath(now: Date, kind: LlmLogKind, id: string): string {
  const iso = now.toISOString()
  const day = iso.slice(0, 10)
  const stamp = iso.replace(/:/g, "-")
  return `llm-log/${day}/${stamp}-${kind}-${id}.json`
}

export function buildLlmLogRecord(input: LlmLogInput): { pathname: string; record: LlmLogRecord } {
  const now = input.now ?? new Date()
  const id = input.id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  const usage = input.usage ?? {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    reasoningTokens: null,
  }
  const record: LlmLogRecord = {
    timestamp: now.toISOString(),
    kind: input.kind,
    attempt: input.attempt,
    gameTurn: input.gameTurn ?? null,
    gameDate: input.gameDate ?? null,
    model: input.model,
    env: process.env.VERCEL_ENV?.trim() || null,
    latencyMs: Number.isFinite(input.latencyMs) ? Math.max(0, Math.round(input.latencyMs)) : 0,
    httpStatus: input.httpStatus ?? null,
    finishReason: input.finishReason ?? null,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      reasoningTokens: usage.reasoningTokens,
    },
    content: truncateContent(redactSecrets(input.content ?? null)),
    outcome: input.outcome,
    error: redactSecrets(input.error ?? null)?.slice(0, 500) ?? null,
    fellBack: input.fellBack,
  }
  return { pathname: llmLogPath(now, input.kind, id), record }
}

/**
 * Store one model response. Returns immediately.
 * No token: do nothing. Upload failures are swallowed so a turn never waits or throws.
 */
export function scheduleLlmResponseLog(input: LlmLogInput): void {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
    if (!token) return
    const built = buildLlmLogRecord(input)
    const task = uploadLlmLog(built.pathname, built.record, token).catch((error) => {
      console.error(
        JSON.stringify({
          tag: "ostfront.llm.log",
          error: redactSecrets(error instanceof Error ? error.message : String(error))?.slice(0, 200) ?? "upload failed",
        }),
      )
    })
    try {
      waitUntil(task)
    } catch {
      void task
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        tag: "ostfront.llm.log",
        error: redactSecrets(error instanceof Error ? error.message : String(error))?.slice(0, 200) ?? "log failed",
      }),
    )
  }
}

async function uploadLlmLog(pathname: string, record: LlmLogRecord, token: string): Promise<void> {
  await put(pathname, JSON.stringify(record), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    token,
  })
}

function truncateContent(text: string | null): string | null {
  if (text == null) return null
  if (text.length <= LLM_LOG_CONTENT_LIMIT) return text
  return `${text.slice(0, LLM_LOG_CONTENT_LIMIT)}\n…[truncated]`
}

function redactSecrets(text: string | null): string | null {
  if (text == null) return null
  let out = text.replace(SECRET, "[redacted]")
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  const apiKey = process.env.LLM_API_KEY?.trim()
  if (token && token.length >= 8) out = out.split(token).join("[redacted]")
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join("[redacted]")
  return out
}
