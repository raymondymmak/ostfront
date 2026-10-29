export type GmContentState = "empty" | "present" | "n/a"

export type GmModelEnv = "LLM_MODEL" | "LLM_MODEL_STRONG"

export type GmTokenUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
}

export type GmDebug = {
  path: "llm" | "cascade"
  reason: string
  elapsedMs: number
  model: string
  modelEnv: GmModelEnv
  httpStatus: number | null
  content: GmContentState
  fallback: "staff-simulation"
  /** Provider finish_reason. `length` means the token budget truncated the reply. */
  finishReason?: string | null
  usage?: GmTokenUsage | null
}

const SECRET =
  /Bearer\s+\S+|sk-[A-Za-z0-9_-]{6,}|\bLLM_API_KEY\s*[=:]\s*\S+|api[_-]?key["']?\s*[:=]\s*["']?[^\s"']+/gi

/** Drop keys, bearer tokens, and prompt-sized blobs before anything reaches the player. */
export function sanitizeGmText(message: string): string {
  return message.replace(SECRET, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 180)
}

export function formatGmDebug(debug: GmDebug): string {
  const http = debug.httpStatus == null ? "none" : String(debug.httpStatus)
  const reason = sanitizeGmText(debug.reason) || "unknown"
  const model = sanitizeGmText(debug.model) || "unknown"
  const elapsed = Number.isFinite(debug.elapsedMs) ? Math.max(0, Math.round(debug.elapsedMs)) : 0
  const detail = [
    `path ${debug.path}`,
    `abort: ${reason}`,
    `${elapsed}ms`,
    `model ${model} (${debug.modelEnv})`,
    `http ${http}`,
    `content ${debug.content}`,
  ]
  const finish = formatFinish(debug.finishReason)
  if (finish) detail.push(finish)
  const tokens = formatTokens(debug.usage)
  if (tokens) detail.push(tokens)
  detail.push("fallback staff simulation")
  return `debug: ${detail.join(" · ")}`
}

function formatFinish(reason: string | null | undefined): string | null {
  if (!reason) return null
  const clean = sanitizeGmText(reason)
  if (!clean) return null
  return clean === "length" ? "finish length" : `finish ${clean}`
}

/** Prompt, completion, and total, plus reasoning tokens when the provider reported them. */
function formatTokens(usage: GmTokenUsage | null | undefined): string | null {
  if (!usage) return null
  const present =
    usage.promptTokens != null ||
    usage.completionTokens != null ||
    usage.totalTokens != null ||
    usage.reasoningTokens != null
  if (!present) return null
  const parts = [
    `prompt ${count(usage.promptTokens)}`,
    `completion ${count(usage.completionTokens)}`,
    `total ${count(usage.totalTokens)}`,
  ]
  if (usage.reasoningTokens != null) parts.push(`reasoning ${count(usage.reasoningTokens)}`)
  return `tokens ${parts.join(" ")}`
}

function count(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.max(0, Math.round(value))) : "?"
}
