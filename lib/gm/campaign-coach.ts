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
const COACH_MAX_TOKENS = 2_048

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
    reply: z.string().min(1).max(2000),
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

You know only the DISPATCH in the user message: engine map facts, the player's selected province (if any), their queued arrows, and CHRONICLE records of fortnights already resolved (including BattleFacts). You do not know Stavka's hidden plan. If a fact is not in the DISPATCH, say the map or chronicle does not show it.

Accuracy rules:
- Odds, supply figures, strengths, and battle results must come from the DISPATCH only. Never invent ratios or outcomes.
- Post-battle questions must use CHRONICLE / BattleFacts lines, not a generic debrief.
- Prefer pointing with highlights: provinceId from the catalog, or uiId from the allowed interface list in the DISPATCH. Never invent screen coordinates.

Speak in short staff prose, present tense, two to five sentences. Optional followUp is one short question or null.

Return one JSON object and no markdown:
{"reply":"...","followUp":null,"highlights":[{"provinceId":"kielce"},{"uiId":"tab-orders"}]}

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
    return {
      reply: finishAdvisorReply(rules.reply),
      source: "fallback",
      unavailable: true,
      followUp: rules.followUp,
      highlights: sanitizeHighlights(rules.highlights),
      ordersClosed,
    }
  }

  const prompt = [
    renderSituation(situation),
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
    "Answer the latest question. Use the dispatch and chronicle only. Do not issue orders.",
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
    const wire =
      failure === "empty"
        ? "The wire returned nothing I can file. Reasoning spent the dispatch before a reply was written."
        : "The wire returned nothing I can file."
    return {
      reply: finishAdvisorReply(`${wire}\n\n${rules.reply}`),
      source: "rules",
      unavailable: false,
      followUp: rules.followUp,
      highlights: sanitizeHighlights(rules.highlights),
      ordersClosed,
    }
  }

  const reply = scrubAdvisorReply(parsed.reply, map)
  return {
    reply: finishAdvisorReply(reply || rules.reply),
    source: "llm",
    unavailable: false,
    followUp: parsed.followUp?.trim() ? parsed.followUp.trim() : null,
    highlights: sanitizeHighlights(parsed.highlights ?? rules.highlights),
    ordersClosed,
  }
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

/** Compact odds phrase for player-facing coach copy (no trailing period). */
export function formatCoachOddsPhrase(preview: EngagementPreview | null): string | null {
  if (!preview) return null
  if (preview.empty && preview.origins < 2) return "undefended before the dice"
  const ratio =
    preview.empty || !Number.isFinite(preview.ratio) ? null : trimRatio(String(preview.ratio))
  const odds = ratio ? `odds about ${ratio}:1 before the dice` : "undefended before the dice"
  if (preview.origins >= 2) {
    const shape = preview.origins === 2 ? "two-pronged" : "concentric"
    const ring = preview.encircled ? ", and the defender is surrounded" : ""
    return `${shape}, ${odds}${ring}`
  }
  return odds
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
 * Player-facing chronicle review — plain sentences only (no key=value debug fields).
 * Pulls odds/roll/retreat from the engine resolution summary when present.
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
    ? ` at ${trimRatio(oddsMatch[1]!)}:1 odds (roll ${oddsMatch[2]})`
    : /undefended/i.test(summary)
      ? " against an undefended garrison"
      : ""
  const retreatMatch = summary.match(/remnants retreat to ([^,.\n]+)/i)
  const retreat = retreatMatch?.[1]?.trim()

  let lead: string
  if (battle.attacker === "central" && weWon) {
    lead = `In fortnight ${turn + 1} (${date}) our ${kind} from ${from} took ${target}${oddsPhrase}.`
  } else if (battle.attacker === "central" && !weWon) {
    lead = `In fortnight ${turn + 1} (${date}) our ${kind} from ${from} into ${target} failed${oddsPhrase}.`
  } else if (battle.attacker === "russia" && !weWon) {
    lead = `In fortnight ${turn + 1} (${date}) a Russian ${kind} from ${from} took ${target}${oddsPhrase}.`
  } else {
    lead = `In fortnight ${turn + 1} (${date}) we held ${target} against a Russian ${kind} from ${from}${oddsPhrase}.`
  }

  let losses = ` We lost ${ours}, they lost ${theirs}`
  if (retreat) {
    if (battle.attacker === "central" && weWon) {
      losses += `, and their remnants fell back to ${retreat}`
    } else if (battle.attacker === "russia" && !weWon) {
      losses += `, and our remnants fell back to ${retreat}`
    } else {
      losses += `, and remnants fell back to ${retreat}`
    }
  }
  losses += "."
  return `${lead}${losses}`
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
  const wantsPlan = /plan|queue|arrow|attack|compare|should i|what about|this fortnight/.test(lower)
  const highlights: CoachHighlight[] = []

  if (wantsReview) {
    const battles = latestBattleFacts(log)
    if (battles.length) {
      const last = battles[battles.length - 1]!
      highlights.push({ provinceId: last.battle.targetId, uiId: "chronicle-log-toggle" })
      return {
        reply: `${formatBattleReviewForPlayer(last.turn, last.date, last.battle, last.summary)} Ask if you want another province named.`,
        followUp: "Which battle do you want to walk through?",
        highlights,
      }
    }
  }

  if (situation.queue.length) {
    const oddsByTarget = queuedAttackOddsByTarget(map, queued)
    if (oddsByTarget.size) {
      for (const targetId of oddsByTarget.keys()) {
        highlights.push({ provinceId: targetId, uiId: "queued-orders" })
      }
      return {
        reply: formatQueuedPlanForPlayer(map, queued, oddsByTarget),
        followUp: wantsPlan ? "Do you want the same blow from one column only?" : null,
        highlights,
      }
    }
    return {
      reply: formatQueuedPlanForPlayer(map, queued, null),
      followUp: wantsPlan ? "Queue an attack if you want engine odds on an axis." : null,
      highlights: [{ uiId: "queued-orders" }],
    }
  }

  if (!selected.startsWith("None")) {
    const id = selected.split(" ")[0]
    if (id) highlights.push({ provinceId: id, uiId: "tab-province" })
    const province = map.provinces.find((item) => item.id === id)
    const name = province?.name ?? id
    return {
      reply: `${name} is selected (${province?.controller ?? "unknown"} control, supply ${province?.supply ?? "—"}). Queue is ${situation.queue.length ? "not empty" : "empty"}. I advise only; you still draw the arrows.`,
      followUp: "Ask about a neighbor attack or the last chronicle battle.",
      highlights,
    }
  }

  const weak = [...situation.contacts].sort((a, b) => b.ratio - a.ratio)[0]
  if (weak) {
    highlights.push({ provinceId: weak.targetId, uiId: "tab-orders" })
    const odds = weak.odds.replace(/\.\s*$/, "")
    return {
      reply: `On the map the strongest engine contact is ${weak.fromName} into ${weak.targetName} (${odds}). That is a reading, not an order.`,
      followUp: "Queue an arrow if you want me to discuss your plan.",
      highlights,
    }
  }

  return {
    reply: "The dispatch shows no open march into an enemy neighbor. Hold, dig, or raise troops from the yards listed.",
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
