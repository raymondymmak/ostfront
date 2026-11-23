import { CATALOG_BY_ID } from "@/lib/data/catalog"
import {
  buildSituation,
  finishAdvisorReply,
  renderSituation,
  scrubAdvisorReply,
  staffMap,
  type Situation,
} from "@/lib/gm/advisor"
import {
  combinedEngagementOdds,
  engagementOdds,
  findUnit,
  type EngagementPreview,
} from "@/lib/engine/turn"
import type { AdvisorChatMessage } from "@/lib/gm/advisor-types"
import { extractTopLevelJson, llmChat, llmConfigured, resolveLlmModels } from "@/lib/gm/llm"
import { scheduleLlmResponseLog } from "@/lib/gm/llm-log"
import { provinceLabel } from "@/lib/news/battle"
import { routineLog } from "@/lib/news/routine-copy"
import type { BattleFacts, GameState, PlayerOrder, TurnRecord } from "@/lib/types"
import { z } from "zod"

const COACH_TIMEOUT_MS = 20_000
/** Browser abort for `/api/advisor` — longer than the coach LLM call, shorter than a hung UI. */
export const CLIENT_ADVISOR_TIMEOUT_MS = 25_000
/** Keep headroom for reasoning models that spend tokens before writing content. */
const COACH_MAX_TOKENS = 2_048
const COACH_MAX_SENTENCES = 3
const COACH_REPLY_MAX_CHARS = 420

/** Campaign UI ids the coach may point at (never screen pixels). */
export const CAMPAIGN_COACH_UI_IDS = [
  "tab-orders",
  "tab-province",
  "chronicle-log-toggle",
  "legend-toggle",
  "advisor-toggle",
  "ohl-toggle",
  "map-mode-supply",
  "map-mode-control",
  "map-mode-unrest",
  "attack-odds",
  "combined-odds",
  "queued-orders",
  "end-turn",
  "war-map",
] as const

export type CoachHighlight = { provinceId?: string; uiId?: string }

export type CampaignCoachResponse = {
  reply: string
  source: "llm" | "rules" | "fallback"
  unavailable: boolean
  followUp: string | null
  highlights: CoachHighlight[]
  ordersClosed: boolean
  /** Present only so clients can assert the schema forbids order cards. */
  suggestions?: never
}

const CoachJsonSchema = z
  .object({
    // Schema stays permissive; capCoachReply / capCoachHighlights enforce Socratic limits.
    reply: z.string().min(1).max(800),
    followUp: z.string().max(400).nullable().optional(),
    highlights: z
      .array(
        z.object({
          provinceId: z.string().optional(),
          uiId: z.string().optional(),
        }),
      )
      .max(6)
      .optional(),
  })
  .strict()

const COACH_SYSTEM = `You are General Erich von Falkenhayn, Chief of the General Staff, coaching the player who commands the Central Powers in the Gorlice–Tarnów offensive (2 May–11 July 1915).

You do NOT issue orders. You never return suggestions, Accept cards, or order JSON. You speak only in reply to the player's latest question.

You know only the DISPATCH in the user message: engine map facts, QUEUE_CONFLICTS (if any), the player's selected province (if any), their queued arrows, and CHRONICLE records of fortnights already resolved (including BattleFacts). You do not know Stavka's hidden plan. If a fact is not in the DISPATCH, say calmly that the map or chronicle does not show it — never scold, and never say "staff figures".

Socratic style (strict):
- At most 2–3 short sentences in "reply". The intent/prediction question MUST come first when you ask one; then exactly one engine fact as evidence.
- Tailor the opening question to the player's latest ask and the real blind spot in front of them (queue conflict, empty flank, low supply, chronicle result, illegal axis). Do NOT reuse a stock "Kielce / Lemberg push" opener when that is not the issue.
- If QUEUE_CONFLICTS is non-empty, diagnose that conflict first (e.g. fortify and attack from the same province).
- Return exactly one highlight that matches that evidence (one provinceId or one uiId). Never invent screen coordinates.
- Post-battle: ask what outcome they expected. If they already stated a prediction in CONVERSATION, compare it to the chronicle result (odds, roll, losses, who holds the province). Plain map language only — never say "the dice" or "what did you expect the dice to give you".
- Odds: quote ONLY from QUEUED_RESOLUTION_ODDS when attacks are queued; otherwise one contact figure from the DISPATCH. Say "about X:1 if the Russians don't reinforce". Quote exactly ONE ratio. Never compare two ratios. Never write dangling comparisons such as "adding X would raise it to" / "lift it to" / "pools to" without a finished figure — if you would need a second figure, omit the comparison entirely.
- Never say "before the dice", "combined-odds board", or other internal UI/debug names. Say "the Orders paper" or "the map" if you must point at the interface.
- Pushback: if the player refuses to answer or insists on a weak plan, stay concise and Socratic, but anchor on ONE concrete overlooked map fact (supply, fort, empty neighbor, reinforcement risk). Rhetorical pressure alone is not enough.
- You do not file, note, or queue orders. Never claim an order was filed, noted, or queued (e.g. never "Filed as noted").
- Battle review: cite the most recent battle in the CHRONICLE and name its fortnight (e.g. "In fortnight 2…"). Do not say no battle resolved this fortnight when an earlier fortnight has a battle. Only if the chronicle has no battles at all, say so plainly.

Accuracy: odds, strengths, and battle results only from the DISPATCH / CHRONICLE / QUEUED_RESOLUTION_ODDS. Never invent ratios.

Optional followUp is one short question or null (prefer putting the intent question first in "reply" itself).

Return one JSON object and no markdown:
{"reply":"Which job should that Kraków garrison keep — digging in or marching on Kielce? Your queue both fortifies Kraków and attacks from it.","followUp":null,"highlights":[{"provinceId":"krakow"}]}

Do not include a suggestions key. Do not include order objects.`

export async function coachCampaign(input: {
  state: GameState
  log: TurnRecord[]
  messages: AdvisorChatMessage[]
  queuedOrders: PlayerOrder[]
  selectedProvinceId?: string | null
}): Promise<CampaignCoachResponse> {
  const queued = input.queuedOrders.filter((order) => order.type !== "text")
  const map = staffMap(input.state)
  const situation = buildSituation(map, queued)
  const chronicle = renderChronicle(input.log)
  const selected = renderSelected(map, input.selectedProvinceId)
  const rules = rulesCoach(map, situation, selected, input.log, input.messages, queued)
  const ordersClosed = situation.over

  if (!llmConfigured() && !fixtureEnabled()) {
    const shaped = shapeCoachReply(rules.reply, rules.followUp)
    return {
      reply: finishAdvisorReply(shaped.reply),
      source: "fallback",
      unavailable: true,
      followUp: shaped.followUp,
      highlights: capCoachHighlights(rules.highlights),
      ordersClosed,
    }
  }

  const queuedOdds = renderQueuedResolutionOdds(map, queued)
  const queueConflicts = detectQueuedOrderConflicts(map, queued)
  // DISPATCH contacts still use advisor formatOdds ("before the dice"); scrub so the model cannot copy it.
  const dispatch = scrubCoachOddsLanguage(renderSituation(situation))
  const prompt = [
    dispatch,
    "",
    "QUEUE_CONFLICTS",
    queueConflicts.length ? queueConflicts.join("\n") : "None.",
    "",
    "QUEUED_RESOLUTION_ODDS",
    queuedOdds,
    "",
    "SELECTED",
    selected,
    "",
    "CHRONICLE",
    chronicle,
    "",
    "ALLOWED_UI_IDS",
    CAMPAIGN_COACH_UI_IDS.join(", "),
    "",
    "CONVERSATION",
    renderConversation(input.messages),
    "",
    "Answer the latest question. Use the dispatch, QUEUE_CONFLICTS, QUEUED_RESOLUTION_ODDS, and chronicle only. Diagnose the real blind spot (conflict, flank, supply, chronicle). Do not issue or claim to file orders. Put any intent question first; quote at most one odds figure; never leave a dangling comparison clause.",
  ].join("\n")

  let failure: "empty" | "http" | "timeout" | null = null
  let parsed: z.infer<typeof CoachJsonSchema> | null = null

  if (fixtureEnabled()) {
    parsed = {
      reply: rules.reply,
      followUp: rules.followUp,
      highlights: rules.highlights,
    }
  } else {
    const models = resolveLlmModels()
    const chat = await llmChat({
      model: models.cheap,
      system: COACH_SYSTEM,
      user: prompt,
      timeoutMs: COACH_TIMEOUT_MS,
      maxTokens: COACH_MAX_TOKENS,
      temperature: 0.3,
      gameTurn: map.turn,
      gameDate: map.date,
    })
    console.log(
      JSON.stringify({
        tag: "ostfront.coach.call",
        model: models.cheap,
        latencyMs: chat.latencyMs,
        outcome: chat.ok ? "ok" : chat.kind,
      }),
    )
    if (chat.ok) {
      const judged = classifyCoachJson(chat.content)
      parsed = judged.parsed
      scheduleLlmResponseLog({
        kind: "advisor",
        attempt: chat.exchange.attempt,
        gameTurn: map.turn,
        gameDate: map.date,
        model: models.cheap,
        latencyMs: chat.exchange.latencyMs,
        httpStatus: chat.exchange.httpStatus,
        finishReason: chat.exchange.finishReason,
        usage: chat.exchange.usage,
        content: chat.exchange.content,
        outcome: judged.outcome === "ok" ? "ok" : judged.outcome === "parse" ? "invalid_json" : "schema",
        error: judged.error,
        fellBack: judged.outcome !== "ok",
      })
      if (!parsed) failure = "empty"
    } else {
      failure = chat.kind === "unconfigured" ? "http" : chat.kind
    }
  }

  if (!parsed) {
    void failure
    const shaped = shapeCoachReply(rules.reply, rules.followUp)
    return {
      reply: finishAdvisorReply(shaped.reply),
      source: "rules",
      unavailable: false,
      followUp: shaped.followUp,
      highlights: capCoachHighlights(rules.highlights),
      ordersClosed,
    }
  }

  const reply = scrubAdvisorReply(parsed.reply, map)
  const shaped = shapeCoachReply(
    reply || rules.reply,
    parsed.followUp?.trim() ? parsed.followUp.trim().slice(0, 160) : null,
  )
  return {
    reply: finishAdvisorReply(shaped.reply),
    source: "llm",
    unavailable: false,
    followUp: shaped.followUp,
    highlights: capCoachHighlights(parsed.highlights ?? rules.highlights),
    ordersClosed,
  }
}

/** Split prose into sentences without treating decimal points (e.g. 5.8:1) as endings. */
export function splitCoachSentences(text: string): string[] {
  const parts: string[] = []
  let buf = ""
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    buf += ch
    if (ch !== "." && ch !== "!" && ch !== "?") continue
    const prev = text[i - 1]
    const next = text[i + 1]
    if (ch === "." && prev && /\d/.test(prev) && next && /\d/.test(next)) continue
    const trimmed = buf.trim()
    if (trimmed) parts.push(trimmed)
    buf = ""
  }
  const tail = buf.trim()
  if (tail) parts.push(tail)
  return parts
}

/** Drop raw supply ledger pairs (e.g. "159 against 56") — whole sentences only, never mid-clause fragments. */
export function scrubCoachLedgerNoise(reply: string): string {
  const out: string[] = []
  for (const sentence of splitCoachSentences(reply)) {
    const before = sentence
    const cleaned = sentence
      .replace(
        /\s*(?:,|;|:)?\s*(?:and\s+)?(?:(?:the|our|their)\s+)?over[- ]supply(?:\s+of|\s+line(?:\s+reads)?)?\s+\d+\s+against\s+(?:their\s+)?\d+/gi,
        "",
      )
      .replace(/\b\d{2,3}\s+against\s+\d{2,3}\b/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,;:.!?])/g, "$1")
      .trim()
    // Only drop when scrubbing gutted the sentence; keep short intentional sentences.
    if (!cleaned) continue
    if (cleaned !== before.trim() && cleaned.length < 12) continue
    out.push(cleaned)
  }
  return out.join(" ").trim()
}

/**
 * Rewrite forbidden dice phrasing on every reply path (LLM may copy DISPATCH
 * "before the dice" from advisor formatOdds). Dedupe the reinforce clause.
 */
export function scrubCoachOddsLanguage(reply: string): string {
  let out = reply.replace(/\bbefore the dice\b/gi, "if the Russians don't reinforce")
  out = out.replace(
    /(?:\s*if the Russians don't reinforce)+\b/gi,
    " if the Russians don't reinforce",
  )
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([,;:.!?])/g, "$1").trim()
  return out
}

/**
 * Plain map/staff language — strip residual dice/UI jargon and robotic continuity scolding.
 */
export function scrubCoachJargon(reply: string): string {
  let out = reply
  out = out.replace(
    /\bwhat did you expect the dice to (?:give|show|do)(?:\s+you)?\b/gi,
    "what outcome did you expect",
  )
  out = out.replace(/\bexpect(?:ed)? the dice\b/gi, "expect the result")
  out = out.replace(/\bthe dice\b/gi, "the result")
  out = out.replace(/\bcombined-odds board\b/gi, "combined odds on the Orders paper")
  out = out.replace(
    /\bthe figure you cite does not appear in my staff figures\b/gi,
    "I do not see that figure on the map dispatch",
  )
  out = out.replace(/\bin my staff figures\b/gi, "on the map dispatch")
  out = out.replace(/\sstaff figures\b/gi, "map figures")
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([,;:.!?])/g, "$1").trim()
  return out
}

/** True when prose ends on a truncated preposition/clause after odds scrubbing. */
export function hasDanglingCoachClause(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  // Bare preposition/truncated tail at the end of the sentence.
  if (/\b(?:to|at|only|from|by|into|toward|towards|than|versus|vs)\s*[.!?…]*$/i.test(trimmed)) {
    return true
  }
  // Comparison verb with a missing figure ("raise it to.", "rising to if…").
  if (/\brising\s+to\s+if\b/i.test(trimmed)) return true
  if (/\b(?:raise|lift|make)\s+it\s+to\s*(?:if\b|[.!?…]|$)/i.test(trimmed)) return true
  if (/\b(?:raising|lifting|pooling)\s+to\s*(?:if\b|[.!?…]|$)/i.test(trimmed)) return true
  if (/\bmake\s+it\s+(?:two-pronged\s+|concentric\s+)?at\s*[.!?…]*$/i.test(trimmed)) return true
  if (/\bpools?\s+to\s+(?:only\s*)?[.!?…]*$/i.test(trimmed)) return true
  return false
}

/**
 * After stripping a second odds figure, drop or rewrite dangling comparison tails
 * ("…raise it to.", "…rising to if…") rather than leaving mid-clause fragments.
 */
export function scrubDanglingOddsClauses(reply: string): string {
  const sentences = splitCoachSentences(reply)
  const out: string[] = []
  for (const sentence of sentences) {
    let primary = sentence.trim()
    if (!hasDanglingCoachClause(primary) && !/\b(?:adding|including)\b[\s\S]{0,80}\b(?:to|at)\s*[.!?]*$/i.test(primary)) {
      out.push(primary)
      continue
    }
    ODDS_FIGURE.lastIndex = 0
    const first = ODDS_FIGURE.exec(primary)
    if (first) {
      const after = primary.slice(first.index + first[0].length)
      const reinforce = after.match(/^\s*(if the Russians don't reinforce)?/i)
      const end = first.index + first[0].length + (reinforce?.[0]?.length ?? 0)
      primary = `${primary.slice(0, end).replace(/[,;:\s]+$/, "")}.`
    } else {
      const cut = primary.search(/,\s*(?:but|while|and|though|although|adding|including)\b/i)
      if (cut > 20) {
        primary = `${primary.slice(0, cut).replace(/[,;:\s]+$/, "")}.`
      } else {
        continue
      }
    }
    primary = primary.replace(/\s{2,}/g, " ").trim()
    if (primary.length >= 12 && !hasDanglingCoachClause(primary)) out.push(primary)
  }
  return out.join(" ").trim()
}

/**
 * Only claims that the coach itself filed/noted/queued an order — not ordinary
 * talk about the player's queued arrows ("this queued attack", "your queue").
 */
const FILED_CLAIM_SENTENCE =
  /\bfiled as noted\b|\bnoted as filed\b|\bi(?:'ve| have|'ll)?\s+(?:filed|noted|queued)\b|\bwe(?:'ve| have|'ll)?\s+(?:filed|noted|queued)\b|\b(?:order|orders)\s+(?:(?:was|were|has been|have been|is|are)\s+)?(?:filed|noted)(?:\s+as\s+noted)?\b|\b(?:it|that|this)\s+(?:(?:was|has been|is)\s+)?(?:filed|noted)(?:\s+as\s+noted)?\b/i

/** Never claim an order was filed or noted — coach cannot issue orders. */
export function scrubCoachFiledClaims(reply: string): string {
  const sentences = splitCoachSentences(reply)
  const out: string[] = []
  for (const sentence of sentences) {
    if (FILED_CLAIM_SENTENCE.test(sentence) && !/\b(?:do not|don't|cannot|can't|never)\s+file\b/i.test(sentence)) {
      out.push("I do not file orders.")
      continue
    }
    out.push(sentence)
  }
  return out.join(" ").replace(/(?:I do not file orders\.\s*){2,}/gi, "I do not file orders. ").trim()
}

const ODDS_FIGURE =
  /\b(?:odds\s+(?:about\s+)?)?(?:\d+(?:\.\d+)?)\s*:\s*1\b|\babout\s+\d+(?:\.\d+)?\s*:\s*1\b/gi

/**
 * Keep the first odds ratio; drop later sentences that carry another ratio.
 * When two ratios share one sentence, cut the whole comparison clause before the
 * second figure — never blank the second ratio in place (that left "raise it to.").
 */
export function keepOneOddsFigure(reply: string): string {
  const sentences = splitCoachSentences(reply)
  let seen = false
  const out: string[] = []
  for (const sentence of sentences) {
    ODDS_FIGURE.lastIndex = 0
    const matches = sentence.match(ODDS_FIGURE)
    if (!matches?.length) {
      out.push(sentence)
      continue
    }
    if (!seen) {
      seen = true
      let primary = sentence
      ODDS_FIGURE.lastIndex = 0
      const first = ODDS_FIGURE.exec(sentence)
      const second = first ? ODDS_FIGURE.exec(sentence) : null
      if (first && second) {
        const head = sentence.slice(0, second.index)
        const cutPatterns = [
          /,\s*while\b/i,
          /,\s*but\b/i,
          /;\s+and\s+/i,
          /,\s*and\s+(?:also\s+)?/i,
          /\s+but\s+(?:adding|including)\b/i,
          /\s+(?:while|though|although)\s+/i,
          /,\s*(?:adding|including)\b/i,
          /\s+(?:rising|raising|lifting|pooling)\s+to\b/i,
          /\s+(?:raise|lift|pool|make)\s+it\b/i,
          /\s+would\s+(?:raise|lift|make|pool)\b/i,
          /\s+adding\b/i,
        ]
        let cut = -1
        for (const pattern of cutPatterns) {
          const at = head.search(pattern)
          if (at > 0 && (cut < 0 || at < cut)) cut = at
        }
        if (cut < 0) {
          const lastBreak = Math.max(head.lastIndexOf(","), head.lastIndexOf(";"))
          if (lastBreak > 20) cut = lastBreak
        }
        if (cut > 0) {
          primary = `${sentence.slice(0, cut).replace(/[,;:\s]+$/, "")}.`
        } else {
          const afterFirst = sentence.slice(first.index + first[0].length)
          const reinforce = afterFirst.match(/^\s*(?:if the Russians don't reinforce)?/i)
          const end = first.index + first[0].length + (reinforce?.[0]?.length ?? 0)
          primary = `${sentence.slice(0, end).replace(/[,;:\s]+$/, "")}.`
        }
      }
      // Never blank-replace a leftover second ratio in place.
      ODDS_FIGURE.lastIndex = 0
      const stillFirst = ODDS_FIGURE.exec(primary)
      const stillSecond = stillFirst ? ODDS_FIGURE.exec(primary) : null
      if (stillFirst && stillSecond) {
        const afterFirst = primary.slice(stillFirst.index + stillFirst[0].length)
        const reinforce = afterFirst.match(/^\s*(?:if the Russians don't reinforce)?/i)
        const end = stillFirst.index + stillFirst[0].length + (reinforce?.[0]?.length ?? 0)
        primary = `${primary.slice(0, end).replace(/[,;:\s]+$/, "")}.`
      }
      primary = scrubDanglingOddsClauses(primary)
      if (primary.length >= 12) out.push(primary)
      continue
    }
    // Later odds sentences: drop entirely (do not strip in place).
  }
  return scrubDanglingOddsClauses(out.join(" ").trim())
}

/** Move the first question sentence to the front when intent/prediction asks trail evidence. */
export function putQuestionFirst(reply: string): string {
  const sentences = splitCoachSentences(reply)
  if (sentences.length < 2) return reply
  const qi = sentences.findIndex((sentence) => sentence.includes("?"))
  if (qi <= 0) return reply
  const question = sentences[qi]!
  return [question, ...sentences.filter((_, index) => index !== qi)].join(" ").trim()
}

/**
 * Enforce the character budget by dropping whole trailing sentences — never cut mid-clause.
 * Only if a single remaining sentence still exceeds the cap, truncate at a word boundary.
 */
export function fitCoachReplyLength(reply: string, maxChars = COACH_REPLY_MAX_CHARS): string {
  let sentences = splitCoachSentences(reply)
  if (!sentences.length) return ""
  while (sentences.length > 1 && sentences.join(" ").length > maxChars) {
    sentences = sentences.slice(0, -1)
  }
  const out = sentences.join(" ").trim()
  if (out.length <= maxChars) return out
  // One long sentence: keep a complete leading clause if possible, else word-boundary ellipsis.
  const clauseCut = out.search(/,\s+(?:while|though|although|and|but)\b/i)
  if (clauseCut > 40 && clauseCut < maxChars - 1) {
    const clause = `${out.slice(0, clauseCut).replace(/[,;:\s]+$/, "")}.`
    if (clause.length <= maxChars) return clause
  }
  const sliced = out.slice(0, maxChars - 1).replace(/\s+\S*$/, "").replace(/[,;:\s]+$/, "").trim()
  return sliced ? `${sliced}…` : out.slice(0, maxChars - 1).trimEnd() + "…"
}

/**
 * Post-process coach prose on every path: scrub dice/filing noise, one odds figure,
 * question first, 2–3 sentence cap, then whole-sentence character fit.
 */
export function capCoachReply(reply: string): string {
  let cleaned = scrubCoachLedgerNoise(reply.replace(/\s+/g, " ").trim())
  cleaned = scrubCoachOddsLanguage(cleaned)
  cleaned = scrubCoachJargon(cleaned)
  cleaned = scrubCoachFiledClaims(cleaned)
  cleaned = keepOneOddsFigure(cleaned)
  cleaned = scrubDanglingOddsClauses(cleaned)
  cleaned = scrubCoachOddsLanguage(cleaned)
  cleaned = scrubCoachJargon(cleaned)
  cleaned = putQuestionFirst(cleaned)
  if (!cleaned) return cleaned
  const kept = splitCoachSentences(cleaned).slice(0, COACH_MAX_SENTENCES)
  const ordered = putQuestionFirst(kept.join(" ").trim())
  return fitCoachReplyLength(ordered)
}

/** Merge a trailing follow-up question into reply-first form; then cap. */
export function shapeCoachReply(
  reply: string,
  followUp: string | null,
): { reply: string; followUp: string | null } {
  let text = reply.replace(/\s+/g, " ").trim()
  let next = followUp?.trim() ? followUp.trim() : null
  const hasQuestion = splitCoachSentences(text).some((sentence) => sentence.includes("?"))
  if (next && /\?/.test(next)) {
    if (!hasQuestion) {
      text = `${next} ${text}`.trim()
      next = null
    } else {
      // Reply already asks; drop duplicate follow-up questions.
      next = null
    }
  }
  return { reply: capCoachReply(text), followUp: next }
}

/** Socratic coach: keep a single map/UI pointer. */
export function capCoachHighlights(raw: CoachHighlight[] | undefined): CoachHighlight[] {
  return sanitizeHighlights(raw).slice(0, 1)
}

const STARTER_LIKE =
  /what do you make of my queued plan|explain the selected province|review the last battle from the chronicle/i

/** True when the player has stated an aim/expectation beyond a bare starter. */
export function playerStatedIntent(messages: AdvisorChatMessage[]): boolean {
  for (const message of messages) {
    if (message.role !== "user") continue
    const text = message.content.trim()
    if (!text) continue
    if (STARTER_LIKE.test(text) && text.length < 90) continue
    if (
      /expect|aim|goal|want|trying to|hoping|so that|for the .+ push|plan to (take|hold|open)|open the road/i.test(
        text,
      )
    ) {
      return true
    }
    if (text.length > 70 && !STARTER_LIKE.test(text)) return true
  }
  return false
}

/** Latest user prediction about a battle outcome, if any. */
export function extractPlayerPrediction(messages: AdvisorChatMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue
    const text = message.content.trim()
    if (
      /expect(ed|ing)?\s+(to\s+)?(take|hold|win|lose|fail|fall)|predict|should (take|fall|hold)|odds (will|should)/i.test(
        text,
      )
    ) {
      return text.slice(0, 160)
    }
  }
  return null
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
}

function trimRatio(raw: string): string {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "")
}

/**
 * Compact odds phrase for player-facing coach copy (no trailing period).
 * Uses the same engagementOdds / combinedEngagementOdds preview resolveTurn feeds
 * when the garrison is unchanged; names the inherent enemy-move gap in plain words.
 */
export function formatCoachOddsPhrase(preview: EngagementPreview | null): string | null {
  if (!preview) return null
  if (preview.empty && preview.origins < 2) {
    return "undefended if the Russians don't reinforce"
  }
  const ratio =
    preview.empty || !Number.isFinite(preview.ratio) ? null : trimRatio(String(preview.ratio))
  const odds = ratio
    ? `about ${ratio}:1 if the Russians don't reinforce`
    : "undefended if the Russians don't reinforce"
  if (preview.origins >= 2) {
    const shape = preview.origins === 2 ? "two-pronged" : "concentric"
    const ring = preview.encircled ? ", and the defender is surrounded" : ""
    return `${shape}, ${odds}${ring}`
  }
  return odds
}

/** First odds ratio quoted in coach prose, or null. */
export function extractCoachOddsRatio(text: string): number | null {
  const match = text.match(/\b(?:odds\s+(?:about\s+)?)?(\d+(?:\.\d+)?)\s*:\s*1\b|\babout\s+(\d+(?:\.\d+)?)\s*:\s*1\b/i)
  if (!match) return null
  const raw = match[1] ?? match[2]
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Dispatch slice: one resolution-preview odds line per queued attack target. */
export function renderQueuedResolutionOdds(map: GameState, queued: PlayerOrder[]): string {
  const oddsByTarget = queuedAttackOddsByTarget(map, queued)
  if (!oddsByTarget.size) return "None."
  return [...oddsByTarget.entries()]
    .map(([targetId, phrase]) => `${targetId} ${provinceLabel(targetId)}: ${phrase ?? "unknown"}`)
    .join("\n")
}

function centralView(battle: BattleFacts): { ours: number; theirs: number; weWon: boolean } {
  const ours = battle.attacker === "central" ? battle.attackerLoss : battle.defenderLoss
  const theirs = battle.attacker === "central" ? battle.defenderLoss : battle.attackerLoss
  const weWon = battle.attacker === "central" ? battle.attackerWon : !battle.attackerWon
  return { ours, theirs, weWon }
}

/** Plain-sentence battle line for the coach dispatch (no key=value fields). */
export function formatBattleForCoach(battle: BattleFacts): string {
  const target = provinceLabel(battle.targetId)
  const from = joinNames(battle.origins.map(provinceLabel))
  const { ours, theirs, weWon } = centralView(battle)
  const kind = battle.kind === "meeting" ? "meeting engagement" : "assault"
  const ring = battle.encircled ? " The defenders were surrounded." : ""
  if (battle.attacker === "central") {
    const verb = weWon ? `took ${target}` : `failed against ${target}`
    return `Our ${kind} from ${from} ${verb}. We lost ${ours}, they lost ${theirs}.${ring}`
  }
  const verb = weWon ? `we held ${target}` : `Russia took ${target}`
  return `A Russian ${kind} from ${from}: ${verb}. We lost ${ours}, they lost ${theirs}.${ring}`
}

/**
 * Compact chronicle evidence for a Socratic review (odds/roll/losses/control).
 * No key=value fields and no raw supply ledger pairs.
 */
export function formatBattleReviewForPlayer(
  turn: number,
  date: string,
  battle: BattleFacts,
  summary: string,
): string {
  const target = provinceLabel(battle.targetId)
  const from = joinNames(battle.origins.map(provinceLabel))
  const { ours, theirs, weWon } = centralView(battle)
  const kind = battle.kind === "meeting" ? "meeting engagement" : "assault"
  const oddsMatch = summary.match(/odds\s+([\d.]+)\s+\(roll\s+(\d+)\)/i)
  const oddsPhrase = oddsMatch
    ? ` at ${trimRatio(oddsMatch[1]!)}:1 (roll ${oddsMatch[2]})`
    : /undefended/i.test(summary)
      ? " against an undefended garrison"
      : ""

  let outcome: string
  if (battle.attacker === "central" && weWon) {
    outcome = `our ${kind} from ${from} took ${target}${oddsPhrase}`
  } else if (battle.attacker === "central" && !weWon) {
    outcome = `our ${kind} from ${from} into ${target} failed${oddsPhrase}`
  } else if (battle.attacker === "russia" && !weWon) {
    outcome = `a Russian ${kind} from ${from} took ${target}${oddsPhrase}`
  } else {
    outcome = `we held ${target} against a Russian ${kind} from ${from}${oddsPhrase}`
  }
  return `In fortnight ${turn + 1} (${date}) ${outcome}; we lost ${ours}, they lost ${theirs}.`
}

function describeNonAttackOrders(map: GameState, queued: PlayerOrder[]): string[] {
  return queued
    .map((order) => {
      if (order.type === "fortify") return `fortify ${provinceLabel(order.provinceId)}`
      if (order.type === "move") {
        const name = findUnit(map, order.unitId)?.unit.name ?? order.unitId
        return `move ${name} to ${provinceLabel(order.to)}`
      }
      if (order.type === "recruit") return `recruit at ${provinceLabel(order.provinceId)}`
      return null
    })
    .filter((line): line is string => Boolean(line))
}

/** Natural queued-plan sentence for the rules/offline coach (all attacks + other orders). */
export function formatQueuedPlanForPlayer(
  map: GameState,
  queued: PlayerOrder[],
  oddsByTarget: Map<string, string | null> | null,
): string {
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  const other = describeNonAttackOrders(map, queued)

  if (!attacks.length) {
    const listed = other.length ? joinNames(other) : "orders"
    return `Your queue shows ${listed}. I do not file orders.`
  }

  const byTarget = new Map<string, Extract<PlayerOrder, { type: "attack" }>[]>()
  for (const order of attacks) {
    const group = byTarget.get(order.target) ?? []
    group.push(order)
    byTarget.set(order.target, group)
  }

  const attackClauses: string[] = []
  for (const [targetId, prongs] of byTarget) {
    const target = provinceLabel(targetId)
    const names = prongs.flatMap((order) =>
      order.unitIds.map((id) => findUnit(map, id)?.unit.name ?? id),
    )
    const fromPlaces = [...new Set(prongs.map((order) => provinceLabel(order.from)))]
    const units = joinNames(names)
    const from = joinNames(fromPlaces)
    const odds = oddsByTarget?.get(targetId)
    const oddsClause = odds ? `, ${odds}` : ""
    attackClauses.push(`${units} from ${from} into ${target}${oddsClause}`)
  }

  const parts = [`You have ${joinNames(attackClauses)} queued`]
  if (other.length) parts.push(`plus ${joinNames(other)}`)
  return `${parts.join(", ")}. I do not file orders — change the arrows yourself if you disagree.`
}

/** Odds phrases for every distinct queued attack target (committed unitIds). */
export function queuedAttackOddsByTarget(
  map: GameState,
  queued: PlayerOrder[],
): Map<string, string | null> {
  const out = new Map<string, string | null>()
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  const byTarget = new Map<string, Extract<PlayerOrder, { type: "attack" }>[]>()
  for (const order of attacks) {
    const group = byTarget.get(order.target) ?? []
    group.push(order)
    byTarget.set(order.target, group)
  }
  for (const [targetId, prongs] of byTarget) {
    const preview =
      prongs.length >= 2
        ? combinedEngagementOdds(
            map,
            targetId,
            prongs.map((order) => ({ fromId: order.from, unitIds: order.unitIds })),
          )
        : engagementOdds(map, prongs[0]!.from, targetId, prongs[0]!.unitIds)
    out.set(targetId, formatCoachOddsPhrase(preview))
  }
  return out
}

/** Latest fortnight that recorded at least one battle, newest resolution last. */
export function latestBattleFacts(log: TurnRecord[]): Array<{
  turn: number
  date: string
  battle: BattleFacts
  summary: string
}> {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const record = log[i]!
    const rows = record.resolutions
      .filter((item) => item.battle)
      .map((item) => ({
        turn: record.turn,
        date: record.date,
        battle: item.battle!,
        summary: item.summary,
      }))
    if (rows.length) return rows
  }
  return []
}

/** Build the chronicle slice the coach may quote (engine records only). */
export function renderChronicle(log: TurnRecord[]): string {
  if (!log.length) return "No fortnights closed yet."
  const recent = log.slice(-3)
  return recent
    .map((record) => {
      const battles = record.resolutions
        .filter((item) => item.battle)
        .map((item) => formatBattleForCoach(item.battle!))
      const routine = routineLog(record)
      return [
        `Fortnight ${record.turn + 1} · ${record.date}`,
        ...routine.slice(0, 8),
        ...battles,
      ].join("\n")
    })
    .join("\n\n")
}

export function sanitizeHighlights(raw: CoachHighlight[] | undefined): CoachHighlight[] {
  if (!raw?.length) return []
  const uiAllow = new Set<string>(CAMPAIGN_COACH_UI_IDS)
  const out: CoachHighlight[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const provinceId =
      item.provinceId && CATALOG_BY_ID[item.provinceId] ? item.provinceId : undefined
    const uiId = item.uiId && uiAllow.has(item.uiId) ? item.uiId : undefined
    if (!provinceId && !uiId) continue
    const key = `${provinceId ?? ""}|${uiId ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...(provinceId ? { provinceId } : {}), ...(uiId ? { uiId } : {}) })
    if (out.length >= 6) break
  }
  return out
}

function renderSelected(state: GameState, selectedProvinceId?: string | null): string {
  if (!selectedProvinceId) return "None."
  const province = state.provinces.find((item) => item.id === selectedProvinceId)
  if (!province) return "None (id not on the map)."
  const strength = province.units
    .filter((unit) => unit.faction === "central")
    .reduce((sum, unit) => sum + unit.strength, 0)
  return `${province.id} ${province.name} controller=${province.controller} supply=${province.supply} fort=${province.fort} centralStrength=${strength}`
}

/**
 * Engine preview for the player's committed queued attacks.
 * Uses order.unitIds (same path as the order panel), never default-formation contacts.
 */
export function queuedAttackPreview(
  map: GameState,
  queued: PlayerOrder[],
): { targetId: string; odds: string | null } | null {
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  if (!attacks.length) return null

  const byTarget = new Map<string, Extract<PlayerOrder, { type: "attack" }>[]>()
  for (const order of attacks) {
    const group = byTarget.get(order.target) ?? []
    group.push(order)
    byTarget.set(order.target, group)
  }

  for (const [targetId, prongs] of byTarget) {
    const preview =
      prongs.length >= 2
        ? combinedEngagementOdds(
            map,
            targetId,
            prongs.map((order) => ({ fromId: order.from, unitIds: order.unitIds })),
          )
        : engagementOdds(map, prongs[0]!.from, targetId, prongs[0]!.unitIds)
    return { targetId, odds: formatCoachOddsPhrase(preview) }
  }
  return null
}

/** Fortify + attack (or overlapping commitments) the player queued on the same garrison. */
export function detectQueuedOrderConflicts(map: GameState, queued: PlayerOrder[]): string[] {
  const conflicts: string[] = []
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  const fortifies = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "fortify" }> => order.type === "fortify",
  )
  for (const fort of fortifies) {
    for (const attack of attacks) {
      if (attack.from !== fort.provinceId) continue
      conflicts.push(
        `Fortify ${provinceLabel(fort.provinceId)} conflicts with attack from ${provinceLabel(attack.from)} into ${provinceLabel(attack.target)} — the same garrison cannot dig in and march this fortnight.`,
      )
    }
  }
  return [...new Set(conflicts)]
}

/** Varied intent openers — avoid a stock Kielce/Lemberg line on every turn. */
export function intentQuestionForTarget(targetName: string): string {
  const options = [
    `What do you need ${targetName} for this fortnight?`,
    `What do you expect taking ${targetName} to unlock?`,
    `What happens to your line if ${targetName} holds?`,
  ]
  let hash = 0
  for (let i = 0; i < targetName.length; i += 1) hash = (hash + targetName.charCodeAt(i) * (i + 1)) % options.length
  return options[hash]!
}

function rulesCoach(
  map: GameState,
  situation: Situation,
  selected: string,
  log: TurnRecord[],
  messages: AdvisorChatMessage[],
  queued: PlayerOrder[],
): { reply: string; followUp: string | null; highlights: CoachHighlight[] } {
  const latest = [...messages].reverse().find((message) => message.role === "user")?.content ?? ""
  const lower = latest.toLowerCase()
  const wantsReview = /battle|fought|last fortnight|chronicle|review|how did|losses|result/.test(lower)
  const hasIntent = playerStatedIntent(messages)
  const prediction = extractPlayerPrediction(messages)
  const conflicts = detectQueuedOrderConflicts(map, queued)

  if (wantsReview) {
    const battles = latestBattleFacts(log)
    if (battles.length) {
      const last = battles[battles.length - 1]!
      const target = provinceLabel(last.battle.targetId)
      const evidence = formatBattleReviewForPlayer(last.turn, last.date, last.battle, last.summary)
      const evidenceBody = evidence.replace(/^In /, "").replace(/\.$/, "")
      if (prediction) {
        return {
          reply: `You expected ${prediction.replace(/\.$/, "")}; the chronicle shows ${evidenceBody}.`,
          followUp: null,
          highlights: [{ provinceId: last.battle.targetId }],
        }
      }
      // Name the fortnight even when the open fortnight has no battle yet.
      return {
        reply: `What outcome did you expect at ${target}? The chronicle shows ${evidenceBody}.`,
        followUp: null,
        highlights: [{ provinceId: last.battle.targetId }],
      }
    }
    return {
      reply:
        "No battles are recorded in the chronicle yet. What outcome are you trying to force this fortnight?",
      followUp: null,
      highlights: [{ uiId: "chronicle-log-toggle" }],
    }
  }

  if (conflicts.length) {
    const fort = queued.find((order) => order.type === "fortify")
    const attack = queued.find((order) => order.type === "attack")
    const provinceId =
      fort && fort.type === "fortify"
        ? fort.provinceId
        : attack && attack.type === "attack"
          ? attack.from
          : null
    const name = provinceId ? provinceLabel(provinceId) : "that province"
    const target =
      attack && attack.type === "attack" ? provinceLabel(attack.target) : "the objective"
    return {
      reply: `Which job should that ${name} garrison keep — digging in or marching on ${target}? Your queue both fortifies ${name} and attacks from it.`,
      followUp: null,
      highlights: provinceId ? [{ provinceId }] : [{ uiId: "queued-orders" }],
    }
  }

  const wantsFiling =
    /(?:just |please )?(?:attack|fortify|move|recruit).{0,60}\bfor me\b|\bfile (?:an? )?orders?\b|\byou (?:should )?(?:attack|order)\b/i.test(
      lower,
    )
  if (wantsFiling) {
    const weak = [...situation.contacts].sort((a, b) => b.ratio - a.ratio)[0]
    if (weak) {
      const oddsBit = Number.isFinite(weak.ratio)
        ? ` at about ${trimRatio(String(weak.ratio))}:1 if the Russians don't reinforce`
        : weak.empty
          ? " — undefended if the Russians don't reinforce"
          : " if the Russians don't reinforce"
      return {
        reply: `I do not file orders. ${intentQuestionForTarget(weak.targetName)} The strongest contact is ${weak.fromName} into ${weak.targetName}${oddsBit}.`,
        followUp: null,
        highlights: [{ provinceId: weak.targetId }],
      }
    }
    return {
      reply: "I do not file orders. What are you trying to achieve this fortnight?",
      followUp: null,
      highlights: [{ uiId: "tab-orders" }],
    }
  }

  if (situation.queue.length) {
    const oddsByTarget = queuedAttackOddsByTarget(map, queued)
    if (oddsByTarget.size) {
      const [targetId, oddsPhrase] = [...oddsByTarget.entries()][0]!
      const target = provinceLabel(targetId)
      const evidence = oddsPhrase
        ? `The engine rates that column at ${oddsPhrase}.`
        : `The engine has that column queued into ${target}.`
      if (!hasIntent) {
        return {
          reply: `${intentQuestionForTarget(target)} ${evidence}`,
          followUp: null,
          highlights: [{ provinceId: targetId }],
        }
      }
      return {
        reply: `What map fact cuts against that aim? ${evidence}`,
        followUp: null,
        highlights: [{ provinceId: targetId }],
      }
    }
    const other = describeNonAttackOrders(map, queued)
    return {
      reply: other.length
        ? `What are you trying to achieve with ${other[0]}? I do not file orders.`
        : "What are you trying to achieve with this queue? I do not file orders.",
      followUp: null,
      highlights: [{ uiId: "queued-orders" }],
    }
  }

  if (!selected.startsWith("None")) {
    const id = selected.split(" ")[0]
    const province = map.provinces.find((item) => item.id === id)
    const name = province?.name ?? id
    if (!hasIntent) {
      return {
        reply: `What are you weighing at ${name}? It is ${province?.controller ?? "unknown"}-held.`,
        followUp: null,
        highlights: id ? [{ provinceId: id }] : [{ uiId: "tab-province" }],
      }
    }
    return {
      reply: `${name} is ${province?.controller ?? "unknown"}-held with fort ${province?.fort ?? 0}. I advise only; you draw the arrows.`,
      followUp: null,
      highlights: id ? [{ provinceId: id }] : [{ uiId: "tab-province" }],
    }
  }

  const weak = [...situation.contacts].sort((a, b) => b.ratio - a.ratio)[0]
  if (weak) {
    const oddsBit = Number.isFinite(weak.ratio)
      ? ` at about ${trimRatio(String(weak.ratio))}:1 if the Russians don't reinforce`
      : weak.empty
        ? " — undefended if the Russians don't reinforce"
        : " if the Russians don't reinforce"
    return {
      reply: `What axis are you weighing this fortnight? The strongest engine contact is ${weak.fromName} into ${weak.targetName}${oddsBit}.`,
      followUp: null,
      highlights: [{ provinceId: weak.targetId }],
    }
  }

  return {
    reply: "What are you trying to achieve this fortnight? The dispatch shows no open march into an enemy neighbor.",
    followUp: null,
    highlights: [{ uiId: "tab-orders" }],
  }
}

function renderConversation(messages: AdvisorChatMessage[]): string {
  if (!messages.length) return "None."
  return messages
    .slice(-10)
    .map((message) => `${message.role === "user" ? "Player" : "Falkenhayn"}: ${message.content}`)
    .join("\n")
}

function fixtureEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.OSTFRONT_ADVISOR_FIXTURE === "1"
}

function classifyCoachJson(text: string): {
  outcome: "ok" | "parse" | "schema"
  error?: string
  parsed: z.infer<typeof CoachJsonSchema> | null
} {
  const extracted = extractTopLevelJson(text)
  if (!extracted.ok) return { outcome: "parse", error: extracted.error, parsed: null }
  const raw = extracted.value
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "suggestions" in raw) {
    return { outcome: "schema", error: "suggestions_forbidden", parsed: null }
  }
  const parsed = CoachJsonSchema.safeParse(raw)
  if (!parsed.success) return { outcome: "schema", error: parsed.error.issues[0]?.message, parsed: null }
  return { outcome: "ok", parsed: parsed.data }
}
