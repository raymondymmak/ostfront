import { finishAdvisorReply, scrubAdvisorReply } from "@/lib/gm/advisor"
import { extractTopLevelJson, stripNullFields } from "@/lib/gm/llm"
import type { GameState } from "@/lib/types"
import { z } from "zod"

export type CoachHarnessStance = "probe" | "warn" | "confirm" | "brief"

export const COACH_HARNESS_STANCES: CoachHarnessStance[] = ["probe", "warn", "confirm", "brief"]

export const CoachHarnessJsonSchema = z
  .object({
    stance: z.enum(["probe", "warn", "confirm", "brief"]),
    reply: z.string().min(1).max(1200),
    highlightProvinceId: z.string().nullable().optional(),
  })
  .strict()

export type CoachHarnessJson = z.infer<typeof CoachHarnessJsonSchema>

export const COACH_HARNESS_SYSTEM = `You are General Erich von Falkenhayn, Chief of the General Staff, coaching the Central Powers commander on the Gorlice–Tarnów front (2 May–11 July 1915, six fortnights).

You never issue, file, queue, or suggest orders. You never invent odds, ratios, or battle results. Use only GAME_FACTS and CONVERSATION.

Return one JSON object (no markdown):
{"stance":"probe"|"warn"|"confirm"|"brief","reply":"...","highlightProvinceId":null}

stance:
- probe — clarify intent or flag one concrete risk (supply, depot, Unlikely queued attack, encirclement)
- warn — name one concrete risk on the board
- confirm — short direct verdict when facts support it
- brief — compact map read

Style rules:
- Direct staff-college prose is fine — questions and short yes/no answers are both allowed.
- Never hedge with robotic phrases like "the available facts do not establish", "it is unclear whether", or "cannot confirm".
- Never use "reach-only" — GAME_FACTS list queued arrows and orderable neighbors only.
- The "Selected province (UI)" line is the player's map selection; answer "explain the selected province" and "this one" / "here" from it.
- When a queued or selected attack is in play, cite at most one odds figure exactly as in GAME_FACTS (e.g. Unlikely, 0.68 — the Orders panel label and ratio).

When stance is warn, set highlightProvinceId to the province the warning is about (engine id, or null).

Examples (style only; live GAME_FACTS are authoritative):
{"stance":"warn","reply":"Warsaw is already queued from Lublin — the Orders panel reads Unlikely, 0.39; that is a thin assault if the column fails.","highlightProvinceId":"lublin"}
{"stance":"brief","reply":"Yes — Kraków still has orderable attack neighbors on this fortnight; see the From Kraków line in GAME_FACTS.","highlightProvinceId":null}
{"stance":"confirm","reply":"No — Łódź is not a legal arrow from Upper Silesia this fortnight; your queued attack list is the engine truth.","highlightProvinceId":null}

Keep reply concise (soft cap ~120 words). Do not include suggestions, orders, or followUp keys.`

const ODDS_INVENTED =
  /\b(?:odds\s+(?:about\s+)?)?(\d+(?:\.\d+)?)\s*:\s*1\b|\babout\s+\d+(?:\.\d+)?\s*:\s*1\b/i

const FILED_CLAIM =
  /\b(?:i(?:'ve| have|'ll)?\s+(?:filed|noted|queued)|we(?:'ve| have|'ll)?\s+(?:filed|noted|queued))\b/i

const PRESCRIBE_ORDER =
  /\b(?:cancel|remove)\s+(?:the\s+)?(?:fortify|attack|move)\b|\b(?:you should|i would)\s+(?:attack|fortify|move|cancel)\b/i

const HEDGE_PHRASE =
  /\b(?:the )?available facts do not establish\b|\bit is unclear whether\b|\bcannot confirm whether\b|\bthe facts do not (?:show|establish)\b/i

const REACH_ONLY = /\breach-only\b/i

function extractCoachOddsRatio(text: string): number | null {
  const match = text.match(/\b(?:odds\s+(?:about\s+)?)?(\d+(?:\.\d+)?)\s*:\s*1\b|\babout\s+(\d+(?:\.\d+)?)\s*:\s*1\b/i)
  if (!match) return null
  const raw = match[1] ?? match[2]
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function scrubHarnessSafety(reply: string): string {
  let text = reply
  if (FILED_CLAIM.test(text)) text = `I do not file orders. ${text.replace(FILED_CLAIM, "").trim()}`
  if (PRESCRIBE_ORDER.test(text)) {
    text = text.replace(PRESCRIBE_ORDER, "").trim()
    if (!text.includes("?")) text = `${text} What tradeoff are you weighing?`.trim()
  }
  return text.replace(/\s+/g, " ").trim()
}

export type HarnessMisfire = {
  code: "invented_odds" | "filed_claim" | "prescribed_order" | "empty_reply"
  detail: string
}

export function parseCoachHarnessJson(text: string): {
  outcome: "ok" | "parse" | "schema"
  error?: string
  parsed: CoachHarnessJson | null
} {
  const extracted = extractTopLevelJson(text)
  if (!extracted.ok) return { outcome: "parse", error: extracted.error, parsed: null }
  const raw = stripNullFields(extracted.value)
  if (raw && typeof raw === "object" && !Array.isArray(raw) && ("suggestions" in raw || "orders" in raw)) {
    return { outcome: "schema", error: "suggestions_forbidden", parsed: null }
  }
  const parsed = CoachHarnessJsonSchema.safeParse(raw)
  if (!parsed.success) {
    return { outcome: "schema", error: parsed.error.issues[0]?.message, parsed: null }
  }
  return { outcome: "ok", parsed: parsed.data }
}

export type HarnessHighlight = { provinceId?: string; uiId?: string }

export function harnessHighlights(parsed: CoachHarnessJson): HarnessHighlight[] {
  if (parsed.stance === "warn" && parsed.highlightProvinceId?.trim()) {
    return [{ provinceId: parsed.highlightProvinceId.trim() }]
  }
  return []
}

/**
 * Safety pass only — no sentence-count or question-first gates.
 * Logs misfires instead of triggering LLM retries.
 */
export function reshapeHarnessReplyForPlayer(reply: string): string {
  let text = reply.replace(/\s+/g, " ").trim()
  if (HEDGE_PHRASE.test(text)) {
    text = text
      .replace(HEDGE_PHRASE, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[,;:\s]+/, "")
      .trim()
    if (text.length < 12) {
      text = "The dispatch lists your queued arrows and legal neighbors — use that engine read."
    }
  }
  if (REACH_ONLY.test(text)) {
    text = text.replace(REACH_ONLY, "neighbor").replace(/\s+/g, " ").trim()
  }
  return text.trim()
}

export function finalizeHarnessReply(
  map: GameState,
  stance: CoachHarnessStance,
  reply: string,
  allowedOdds: string[] = [],
): { stance: CoachHarnessStance; reply: string; misfires: HarnessMisfire[] } {
  const misfires: HarnessMisfire[] = []
  let text = reshapeHarnessReplyForPlayer(reply).replace(/\s+/g, " ").trim()
  if (HEDGE_PHRASE.test(reply)) {
    misfires.push({ code: "empty_reply", detail: "hedge phrase scrubbed" })
  }
  if (!text) {
    misfires.push({ code: "empty_reply", detail: "empty harness reply" })
    text = "I cannot read that dispatch clearly. What are you trying to do this fortnight?"
  }
  const scrubbed = scrubAdvisorReply(scrubHarnessSafety(text), map)
  if (scrubbed !== text) {
    misfires.push({ code: "filed_claim", detail: "scrubbed filed/prescribed language" })
    text = scrubbed
  }
  if (ODDS_INVENTED.test(text)) {
    const ratio = extractCoachOddsRatio(text)
    const grounded =
      ratio != null && allowedOdds.some((item) => Math.abs(Number(item) - ratio) < 0.15)
    if (!grounded) {
      misfires.push({ code: "invented_odds", detail: text.slice(0, 120) })
      text = text.replace(ODDS_INVENTED, "the contact")
    }
  }
  for (const misfire of misfires) {
    console.log(JSON.stringify({ tag: "ostfront.coach.harness_misfire", stance, ...misfire }))
  }
  return { stance, reply: finishAdvisorReply(text), misfires }
}

export function inferHarnessStance(reply: string, highlights: HarnessHighlight[]): CoachHarnessStance {
  if (highlights.length) return "warn"
  if (/\?/.test(reply)) return "probe"
  if (/\b(understood|sound plan|correct|yes,? that matches)\b/i.test(reply)) return "confirm"
  return "brief"
}