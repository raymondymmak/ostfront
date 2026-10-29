import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { applySupply, rebindState } from "@/lib/data/scenario"
import { scenarioSpec } from "@/lib/data/objectives"
import { ENCIRCLEMENT_DEFENDER_LOSS, flankMultiplier } from "@/lib/engine/combat"
import { independentFormations, partyOf } from "@/lib/engine/echelon"
import { projectIncome, RECRUIT, recruitmentYard, spendable } from "@/lib/engine/economy"
import { decaySupplyModifier } from "@/lib/engine/supply"
import {
  applyAttack,
  applyCancelRecruit,
  applyFortify,
  applyMove,
  applyRecruit,
  combinedEngagementOdds,
  engagementOdds,
  findProvince,
  findUnit,
  type EngagementPreview,
} from "@/lib/engine/turn"
import { easternObjectives, standing } from "@/lib/engine/victory"
import { KIND_LABEL, normalizeName } from "@/lib/format"
import type { AdvisorCard, AdvisorChatMessage, AdvisorOrder, AdvisorResponse } from "@/lib/gm/advisor-types"
import { leaveDepotGarrison } from "@/lib/orders"
import { llmChat, llmConfigured, resolveLlmModels } from "@/lib/gm/llm"
import type { Faction, GameState, PlayerOrder, Province, Unit, UnitKind } from "@/lib/types"

const ADVISOR_TIMEOUT_MS = 20_000
const ADVISOR_MAX_TOKENS = 4_096
const MAX_SUGGESTIONS = 3

const OFFLINE_LINE =
  "The chief of staff is unavailable offline. What follows is read from the map, not from the wire."

const SYSTEM = `You are General Erich von Falkenhayn, Chief of the General Staff of the German field army, writing during the Gorlice–Tarnów offensive (2 May to 11 July 1915). You arranged this blow: Mackensen's German 11th Army, the heavy artillery, and the Austro-Hungarian 4th Army under Archduke Joseph Ferdinand. You want a limited stroke that breaks the Russian line in Galicia. You do not want a march on Petrograd. Lemberg is the prize. Lublin and Rovno are pursuit, and only while supply holds. Kraków must not be emptied. The northern armies hold.

You advise the player, who commands the Central Powers. You do not issue orders and you do not change the map. A deterministic engine accepts or rejects every suggestion. Only that engine resolves the fortnight.

You know only the DISPATCH in the user message. It is the map the Central Powers can see: ownership, supply, strengths, morale, rails, and odds the engine has already computed. You do not know what the Russian staff will order. Do not predict Russian moves, hidden plans, or the next Russian attack. If a fact is not in the dispatch, say that the map does not show it.

Odds are against the garrison and the forts as they stand when the fortnight opens. A simultaneous Russian march can leave a rear guard, empty the province, or meet the columns in the open. Digging ordered this fortnight is not in the figures. Say that the printed odds can change when both sides move together. Do not invent the Russian march.

${combinedRuleText()} Weigh a pooled attack against a single strong blow, and quote the COMBINED figure. CONTACTS are one column. They are not the battle when COMBINED lists that province.

Use only province names and formation names from the dispatch. Do not invent corps, armies, or provinces. Quote odds only as printed. Do not roll dice and do not describe a battle as already fought. Speak in short staff prose, present tense, two to five sentences.

Return one JSON object and no markdown:
{"reply":"...","suggestions":[]}

suggestions is zero to three orders, using ids from the dispatch:
{"type":"move","unitId":"<unit id>","to":"<province id>"}
{"type":"attack","from":"<province id>","target":"<province id>","unitIds":["<unit id>"]}
{"type":"attacks","target":"<province id>","prongs":[{"from":"<province id>","unitIds":["<unit id>"]}]}
{"type":"fortify","provinceId":"<province id>"}
{"type":"recruit","provinceId":"<province id>","unitKind":"infantry"|"cavalry"|"artillery"}
{"type":"cancelRecruit","buildId":"<id>"}

Several attack orders on one target, or one attacks object, are one battle. Prefer the stronger of a pooled attack and a single blow, using the figures in the dispatch. Leave a garrison on a depot. Do not repeat an order already in the queue. If the dispatch says the campaign is over, suggestions must be empty.`

export type UnitSnap = {
  id: string
  name: string
  faction: Faction
  strength: number
  morale: number
  kind: string
}

export type FrontContact = {
  fromId: string
  fromName: string
  fromSupply: number
  targetId: string
  targetName: string
  terrain: string
  fort: number
  targetSupply: number
  empty: boolean
  ratio: number
  encircled: boolean
  origins: number
  unitIds: string[]
  attackers: UnitSnap[]
  defenders: UnitSnap[]
  garrisonId: string | null
  garrisonName: string | null
  objective: boolean
  odds: string
}

export type CombinedProng = {
  fromId: string
  fromName: string
  unitIds: string[]
  names: string[]
  queued: boolean
}

export type CombinedBattle = {
  targetId: string
  targetName: string
  prongs: CombinedProng[]
  ratio: number
  multiplier: number
  origins: number
  encircled: boolean
  odds: string
  queuedRatio: number | null
  queuedOdds: string | null
}

export type RailFact = {
  a: string
  b: string
  aName: string
  bName: string
  intact: boolean
}

export type Situation = {
  date: string
  turn: number
  fortnight: number
  length: number
  over: boolean
  captured: number
  available: number
  next: { name: string; date: string; overdue: boolean } | null
  homeLost: boolean
  homeName: string
  homeHeld: boolean
  purse: { mp: number; ip: number }
  income: { mp: number; ip: number }
  yards: { id: string; name: string; supply: number }[]
  digSite: { id: string; name: string; supply: number; fort: number } | null
  contacts: FrontContact[]
  combined: CombinedBattle[]
  rails: RailFact[]
  provinces: string[]
  queue: string[]
}

type Prepared = {
  map: GameState
  used: Set<string>
  fortified: Set<string>
  purse: GameState
  queued: PlayerOrder[]
}

/** Supply as the engine will see it when the fortnight opens. Neighbors and rails are rebound from the catalog. */
export function staffMap(state: GameState): GameState {
  const rebound = rebindState(state)
  for (const province of rebound.provinces) {
    province.supplyModifier = decaySupplyModifier(province.supplyModifier)
  }
  applySupply(rebound)
  return rebound
}

export function buildSituation(state: GameState, queued: PlayerOrder[] = []): Situation {
  return situationFrom(prepareStaff(state, queued))
}

export function renderSituation(situation: Situation): string {
  const lines = [
    "DISPATCH",
    `Date: ${situation.date}`,
    `Fortnight: ${situation.fortnight} of ${situation.length}`,
    `Campaign: ${situation.over ? "over. Do not suggest orders." : "open"}`,
    `Eastern victory points: ${situation.captured} of ${situation.available}`,
    situation.next
      ? `Next object: ${situation.next.name} by ${situation.next.date}${situation.next.overdue ? " (overdue)" : ""}`
      : "Next object: none",
    `${situation.homeName} held by the Central Powers: ${situation.homeHeld ? "yes" : "no"}`,
    `Kraków already lost at the end of an earlier fortnight: ${situation.homeLost ? "yes" : "no"}`,
    `Central Powers purse: manpower ${situation.purse.mp}, industry ${situation.purse.ip}`,
    `Central Powers income this fortnight, before recruits: manpower ${situation.income.mp}, industry ${situation.income.ip}`,
    `Yards that can raise troops: ${
      situation.yards.length
        ? situation.yards.map((yard) => `${yard.id} ${yard.name} supply ${yard.supply}`).join("; ")
        : "none"
    }`,
    "Recruit costs: infantry 6 manpower 3 industry, arrives this fortnight; cavalry 4 and 2, arrives this fortnight; artillery 2 and 7, arrives in two fortnights.",
    combinedRuleText(),
    "ODDS are against the garrison and forts as they stand when the fortnight opens. A simultaneous Russian march can leave a rear guard at half strength, empty the province, or meet the columns. Digging this fortnight is not in these figures.",
    "CONTACTS are one column. COMBINED is the pooled battle when two or more columns can march on the same province this fortnight. Quote COMBINED.",
    "CONTACTS",
    situation.contacts.length
      ? situation.contacts.map(renderContact).join("\n")
      : "None. No Central Powers formation can march into an enemy neighbor.",
    "COMBINED",
    situation.combined.length
      ? situation.combined.map(renderBattle).join("\n")
      : "None. No enemy province can be attacked from two Central Powers neighbors this fortnight.",
    "RAILS",
    situation.rails.length
      ? situation.rails
          .map((rail) => `${rail.aName}–${rail.bName} ${rail.intact ? "open" : "cut"}`)
          .join("\n")
      : "None",
    "QUEUE",
    situation.queue.length ? situation.queue.join("\n") : "Empty. Unordered formations hold.",
    "PROVINCES",
    situation.provinces.join("\n"),
  ]
  return lines.join("\n")
}

export function scrubAdvisorReply(reply: string, state: GameState): string {
  const knownUnits = new Set(state.provinces.flatMap((province) => province.units.map((unit) => unit.id)))
  const sentences = reply
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !leaksRussianPlan(sentence))
    .filter((sentence) => !deniesCombined(sentence))
    .filter((sentence) => !inventsUnit(sentence, knownUnits))
  return sentences.join(" ").trim()
}

export async function advise(input: {
  state: GameState
  messages: AdvisorChatMessage[]
  queuedOrders: PlayerOrder[]
}): Promise<AdvisorResponse> {
  const queued = input.queuedOrders.filter((order) => order.type !== "text")
  const prepared = prepareStaff(input.state, queued)
  const situation = situationFrom(prepared)
  const brief = rulesDispatch(situation, input.messages)
  const ordersClosed = situation.over

  if (!llmConfigured() && !fixtureEnabled()) {
    const suggestions = ordersClosed ? [] : assessOrders(prepared, brief.orders, queued)
    return {
      reply: `${OFFLINE_LINE}\n\n${brief.reply}`,
      source: "rules",
      unavailable: true,
      suggestions: suggestions.filter((card) => card.valid),
      dropped: 0,
      ordersClosed,
    }
  }

  const prompt = [
    renderSituation(situation),
    "",
    "CONVERSATION",
    renderConversation(input.messages),
    "",
    "Answer the latest question from the player. Use the dispatch only.",
  ].join("\n")

  let modelText: string | null = null
  let failure: "empty" | "http" | "timeout" | null = null
  if (fixtureEnabled()) {
    modelText = JSON.stringify({ reply: brief.reply, suggestions: brief.orders })
  } else {
    const models = resolveLlmModels()
    const chat = await llmChat({
      model: models.cheap,
      system: SYSTEM,
      user: prompt,
      timeoutMs: ADVISOR_TIMEOUT_MS,
      maxTokens: ADVISOR_MAX_TOKENS,
      temperature: 0.3,
    })
    console.log(
      JSON.stringify({
        tag: "ostfront.advisor.call",
        model: models.cheap,
        latencyMs: chat.latencyMs,
        outcome: chat.ok ? "ok" : chat.kind,
      }),
    )
    if (chat.ok) modelText = chat.content
    else failure = chat.kind === "unconfigured" ? "http" : chat.kind
  }

  if (!modelText) {
    const suggestions = ordersClosed ? [] : assessOrders(prepared, brief.orders, queued)
    const wire =
      failure === "empty"
        ? "The wire returned nothing I can file. Reasoning spent the dispatch before a reply was written."
        : "The wire returned nothing I can file."
    return {
      reply: `${wire}\n\n${brief.reply}`,
      source: "rules",
      unavailable: false,
      suggestions: suggestions.filter((card) => card.valid),
      dropped: 0,
      ordersClosed,
    }
  }

  const parsed = parseModel(modelText)
  if (!parsed) {
    const suggestions = ordersClosed ? [] : assessOrders(prepared, brief.orders, queued)
    return {
      reply: `The wire returned nothing I can file.\n\n${brief.reply}`,
      source: "rules",
      unavailable: false,
      suggestions: suggestions.filter((card) => card.valid),
      dropped: 0,
      ordersClosed,
    }
  }

  const reply = scrubAdvisorReply(parsed.reply, prepared.map)
  const raw = parsed.suggestions.slice(0, 12)
  if (ordersClosed) {
    return {
      reply: reply || brief.reply,
      source: "llm",
      unavailable: false,
      suggestions: [],
      dropped: raw.length,
      ordersClosed: true,
    }
  }

  const { cards, dropped } = classifySuggestions(prepared, raw, queued)
  return {
    reply: reply || brief.reply,
    source: "llm",
    unavailable: false,
    suggestions: cards,
    dropped,
    ordersClosed: false,
  }
}

function fixtureEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.OSTFRONT_ADVISOR_FIXTURE === "1"
}

function situationFrom(prepared: Prepared): Situation {
  const { map } = prepared
  const spec = scenarioSpec(map.scenario)
  const board = standing(map)
  const home = map.provinces.find((province) =>
    spec.objectives.some((objective) => objective.side === "home" && objective.id === province.id),
  )
  const income = projectIncome(map, "central")
  const objectives = new Set(easternObjectives(spec).map((objective) => objective.id))
  return {
    date: map.date,
    turn: map.turn,
    fortnight: Math.min(map.turn + 1, spec.length),
    length: spec.length,
    over: Boolean(map.result),
    captured: board.captured,
    available: board.available,
    next: board.next,
    homeLost: map.homeLost,
    homeName: home?.name ?? "Kraków",
    homeHeld: home?.controller === "central",
    purse: { mp: map.treasury.central.mp, ip: map.treasury.central.ip },
    income,
    yards: map.provinces
      .filter((province) => recruitmentYard(province, "central"))
      .map((province) => ({ id: province.id, name: province.name, supply: province.supply })),
    digSite: digSite(map, prepared.fortified),
    contacts: frontContacts(prepared, objectives),
    combined: combinedBattles(prepared),
    rails: railFacts(map),
    provinces: map.provinces.map((province) => renderProvince(province)),
    queue: preparedQueueLines(map, prepared),
  }
}

function frontContacts(prepared: Prepared, objectives: Set<string>): FrontContact[] {
  const { map, used } = prepared
  const contacts: FrontContact[] = []
  for (const province of map.provinces) {
    if (province.controller !== "central" || province.supply < 30) continue
    const available = independentFormations(
      province.units.filter((unit) => unit.faction === "central" && !used.has(unit.id)),
    )
    if (!available.length) continue
    const chosen = leaveDepotGarrison(available, province.depot === "central", false)
    if (!chosen.length) continue
    const left = available.filter((unit) => !chosen.some((item) => item.id === unit.id))
    for (const neighborId of province.neighbors) {
      const target = findProvince(map, neighborId)
      if (!target || target.controller === "central") continue
      const unitIds = chosen.map((unit) => unit.id)
      const preview = engagementOdds(map, province.id, target.id, unitIds)
      if (!preview) continue
      contacts.push({
        fromId: province.id,
        fromName: province.name,
        fromSupply: province.supply,
        targetId: target.id,
        targetName: target.name,
        terrain: target.terrain,
        fort: target.fort,
        targetSupply: target.supply,
        empty: preview.empty,
        ratio: preview.ratio,
        encircled: preview.encircled,
        origins: preview.origins,
        unitIds,
        attackers: chosen.map(snap),
        defenders: target.units.filter((unit) => unit.faction === target.controller).map(snap),
        garrisonId: left[0]?.id ?? null,
        garrisonName: left[0]?.name ?? null,
        objective: objectives.has(target.id),
        odds: formatOdds(preview) ?? "odds unknown",
      })
    }
  }
  contacts.sort((a, b) => rank(b) - rank(a) || a.targetName.localeCompare(b.targetName))
  return contacts
}

function rank(contact: FrontContact): number {
  if (contact.empty || !Number.isFinite(contact.ratio)) return 1_000
  return contact.ratio
}

function railFacts(map: GameState): RailFact[] {
  const facts: RailFact[] = []
  const seen = new Set<string>()
  for (const province of map.provinces) {
    for (const otherId of province.rail) {
      const key = [province.id, otherId].sort().join("|")
      if (seen.has(key)) continue
      seen.add(key)
      const other = findProvince(map, otherId)
      if (!other) continue
      facts.push({
        a: province.id,
        b: other.id,
        aName: province.name,
        bName: other.name,
        intact: province.controller === other.controller,
      })
    }
  }
  facts.sort((a, b) => a.aName.localeCompare(b.aName) || a.bName.localeCompare(b.bName))
  return facts
}

function renderProvince(province: Province): string {
  const units = province.units
    .map((unit) => `${unit.id} ${unit.name} ${unit.faction} ${unit.kind} str ${unit.strength} mor ${unit.morale}`)
    .join("; ")
  const rails = province.rail.join(",") || "-"
  return [
    province.id,
    province.name,
    province.terrain,
    `owner ${province.owner}`,
    `held ${province.controller}`,
    `sup ${province.supply}`,
    `unr ${province.unrest}`,
    `fort ${province.fort}`,
    province.depot ? `depot ${province.depot}` : "",
    `neigh ${province.neighbors.join(",")}`,
    `rail ${rails}`,
    `units ${units || "none"}`,
  ]
    .filter(Boolean)
    .join(" | ")
}

function renderContact(contact: FrontContact): string {
  const attackers = contact.attackers.map((unit) => `${unit.id} ${unit.name}`).join(", ")
  const defenders = contact.defenders.length
    ? contact.defenders.map((unit) => `${unit.id} ${unit.name} str ${unit.strength} mor ${unit.morale}`).join(", ")
    : "none"
  const garrison = contact.garrisonName ? ` garrison left ${contact.garrisonName}` : ""
  return `${contact.fromId} ${contact.fromName} (sup ${contact.fromSupply}) -> ${contact.targetId} ${contact.targetName} | ${contact.odds} | terrain ${contact.terrain} fort ${contact.fort} target sup ${contact.targetSupply} | attackers ${attackers} | defenders ${defenders}${garrison}${contact.objective ? " | objective" : ""}`
}

function preparedQueueLines(map: GameState, prepared: Prepared): string[] {
  const lines: string[] = []
  for (const id of prepared.used) {
    const located = findUnit(map, id)
    if (located) lines.push(`Ordered: ${located.unit.name} in ${located.province.name}`)
  }
  for (const id of prepared.fortified) {
    lines.push(`Ordered: fortify ${findProvince(map, id)?.name ?? id}`)
  }
  return lines
}

function rulesDispatch(
  situation: Situation,
  messages: AdvisorChatMessage[],
): { reply: string; orders: AdvisorOrder[] } {
  if (situation.over) {
    return {
      reply: `${situation.date}. The campaign is over, and the map is the final position. Eastern victory points stand at ${situation.captured} of ${situation.available}. I can still read it. I will not add orders.`,
      orders: [],
    }
  }

  const focus = focusBattle(situation, messages)
  if (focus) return focusedReply(situation, focus)

  const sentences = [
    `${situation.date}, fortnight ${situation.fortnight} of ${situation.length}. Eastern victory points stand at ${situation.captured} of ${situation.available}.`,
  ]
  if (situation.next) {
    sentences.push(
      `${situation.next.name} is the next object, by ${situation.next.date}${situation.next.overdue ? ", and that date has passed" : ""}.`,
    )
  }
  if (!situation.homeHeld) {
    sentences.push(`${situation.homeName} is not in our hands.`)
  } else if (situation.homeLost) {
    sentences.push(`${situation.homeName} is ours again, but it has already been lost once. A brilliant is no longer open.`)
  }

  const chosen = chooseContact(axisContacts(situation.contacts))
  const weakest = situation.contacts[0]
  if (!weakest) {
    sentences.push(
      "No formation of ours can march. Every border province is below supply 30, or every formation there is already ordered.",
    )
  } else {
    sentences.push(`The weakest Russian contact we can march against is ${weakest.targetName}. ${describeContact(weakest)}`)
    if (chosen && (chosen.fromId !== weakest.fromId || chosen.targetId !== weakest.targetId)) {
      const why = chosen.objective
        ? `${chosen.targetName} is the object on the Gorlice front.`
        : `${chosen.targetName} is the contact I would use on the Gorlice front.`
      sentences.push(`${why} ${describeContact(chosen)} I would file that attack, and leave it for you to accept.`)
    } else if (chosen) {
      sentences.push("I would file that attack, and leave it for you to accept. I do not fight it myself.")
    } else if (!weakest.empty && Number.isFinite(weakest.ratio) && weakest.ratio < 1) {
      sentences.push(
        `I would not spend the fortnight on ${weakest.targetName}. The engine's odds are under 1 : 1 before the dice.`,
      )
    } else {
      sentences.push("I would not pull the armies off the Gorlice front for a softer contact elsewhere.")
    }
  }

  const rail = chosen ? railBetween(situation, chosen.fromName, chosen.targetName) : undefined
  if (rail && !rail.intact) {
    sentences.push(`The rail ${rail.aName}–${rail.bName} is cut while the two ends are held by different sides.`)
  }

  const pool = situation.combined.find((battle) => battle.targetId !== chosen?.targetId)
  if (pool) sentences.push(poolSentence(pool))

  const orders: AdvisorOrder[] = []
  if (chosen) orders.push({ type: "attack", from: chosen.fromId, target: chosen.targetId, unitIds: chosen.unitIds })
  else if (situation.digSite) {
    orders.push({ type: "fortify", provinceId: situation.digSite.id })
    sentences.push(
      `${situation.digSite.name} can still dig. Supply there is ${situation.digSite.supply}, fort ${situation.digSite.fort}.`,
    )
  }

  sentences.push(
    "I have not seen the Russian orders for this fortnight, and I will not guess them. These odds are against the garrison as it stands. A simultaneous march can change the fight.",
  )
  return { reply: sentences.join(" "), orders }
}

function describeContact(contact: FrontContact): string {
  const defenders = contact.defenders.length
    ? contact.defenders
        .map((unit) => `${unit.name} (strength ${unit.strength}, morale ${unit.morale})`)
        .join(", ")
    : "no garrison"
  const attackers = contact.attackers.map((unit) => unit.name).join(", ")
  const garrison = contact.garrisonName
    ? ` ${contact.garrisonName} stays on the ${contact.fromName} depot.`
    : ""
  const odds = contact.odds.endsWith(".") ? contact.odds : `${contact.odds}.`
  return `${contact.targetName} is ${contact.terrain}, fort ${contact.fort}, supply ${contact.targetSupply}, held by ${defenders}. From ${contact.fromName} (supply ${contact.fromSupply}) the engine rates ${attackers} at ${odds}${garrison}`
}

/** The Gorlice–Tarnów blow, not the holding front in East Prussia and Courland. */
function axisContacts(contacts: FrontContact[]): FrontContact[] {
  const axisFrom = new Set([
    "krakow",
    "katowice",
    "oberschlesien",
    "stanislawow",
    "podkarpatska_rus",
    "bucovina",
    "tesinsko",
    "eastern_slovakia",
    "czeske_slezsko",
  ])
  const axis = contacts.filter((contact) => axisFrom.has(contact.fromId))
  return axis.length ? axis : contacts
}

function chooseContact(contacts: FrontContact[]): FrontContact | null {
  const best = contacts[0]
  if (!best) return null
  const objective = contacts.find(
    (contact) =>
      contact.objective &&
      (contact.empty || contact.ratio >= 1) &&
      (best.empty || !Number.isFinite(best.ratio) || contact.ratio >= best.ratio - 0.35),
  )
  const pick = objective ?? best
  if (!pick.empty && Number.isFinite(pick.ratio) && pick.ratio < 1) return null
  return pick
}

function digSite(
  map: GameState,
  fortified: Set<string>,
): { id: string; name: string; supply: number; fort: number } | null {
  const rows = map.provinces.filter((province) => {
    if (fortified.has(province.id)) return false
    if (province.controller !== "central" || province.supply < 40 || province.fort >= 3) return false
    return province.units.some((unit) => unit.faction === "central")
  })
  const frontier = rows.filter((province) =>
    province.neighbors.some((id) => findProvince(map, id)?.controller === "russia"),
  )
  const pool = frontier.length ? frontier : rows
  pool.sort(
    (a, b) =>
      Number(b.depot === "central") - Number(a.depot === "central") ||
      a.fort - b.fort ||
      a.name.localeCompare(b.name),
  )
  const dig = pool[0]
  return dig ? { id: dig.id, name: dig.name, supply: dig.supply, fort: dig.fort } : null
}

function railBetween(situation: Situation, aName: string, bName: string): RailFact | undefined {
  return situation.rails.find(
    (rail) =>
      (rail.aName === aName && rail.bName === bName) || (rail.aName === bName && rail.bName === aName),
  )
}

function renderConversation(messages: AdvisorChatMessage[]): string {
  const recent = messages.slice(-12)
  if (!recent.length) return "Player: What should I do this fortnight?"
  return recent
    .map((message) => `${message.role === "user" ? "Player" : "Falkenhayn"}: ${message.content}`)
    .join("\n")
}

function combinedRuleText(): string {
  const two = flankMultiplier(2)
  const three = flankMultiplier(3)
  const four = flankMultiplier(4)
  const extra = Math.round(ENCIRCLEMENT_DEFENDER_LOSS * 100)
  return `Same-turn attacks on one province are one battle. The engine adds the columns, then multiplies by ${two} for two directions, ${three} for three, and ${four} for four or more. Encirclement, when no friendly exit remains, adds ${extra} percent to the defender's losses and blocks the retreat.`
}

function combinedBattles(prepared: Prepared): CombinedBattle[] {
  const { map, used, queued } = prepared
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  const byTarget = new Map<string, CombinedProng[]>()
  for (const province of map.provinces) {
    if (province.controller !== "central" || province.supply < 30) continue
    for (const neighborId of province.neighbors) {
      const target = findProvince(map, neighborId)
      if (!target || target.controller === "central") continue
      const queuedHere = attacks.find((order) => order.from === province.id && order.target === target.id)
      let unitIds: string[] = []
      let queuedProng = false
      if (queuedHere) {
        unitIds = queuedHere.unitIds.filter((id) => {
          const located = findUnit(map, id)
          return located?.province.id === province.id && located.unit.faction === "central"
        })
        queuedProng = unitIds.length > 0
      } else {
        const available = independentFormations(
          province.units.filter((unit) => unit.faction === "central" && !used.has(unit.id)),
        )
        unitIds = leaveDepotGarrison(available, province.depot === "central", false).map((unit) => unit.id)
      }
      if (!unitIds.length) continue
      const prong: CombinedProng = {
        fromId: province.id,
        fromName: province.name,
        unitIds,
        names: unitIds.map((id) => findUnit(map, id)?.unit.name ?? id),
        queued: queuedProng,
      }
      const list = byTarget.get(target.id) ?? []
      list.push(prong)
      byTarget.set(target.id, list)
    }
  }

  const battles: CombinedBattle[] = []
  for (const [targetId, prongs] of byTarget) {
    if (prongs.length < 2) continue
    prongs.sort((a, b) => a.fromName.localeCompare(b.fromName) || a.fromId.localeCompare(b.fromId))
    const preview = combinedEngagementOdds(
      map,
      targetId,
      prongs.map((prong) => ({ fromId: prong.fromId, unitIds: prong.unitIds })),
    )
    const target = findProvince(map, targetId)
    if (!preview || !target) continue
    const queuedProngs = prongs.filter((prong) => prong.queued)
    const queuedPreview = queuedProngs.length
      ? combinedEngagementOdds(
          map,
          targetId,
          queuedProngs.map((prong) => ({ fromId: prong.fromId, unitIds: prong.unitIds })),
        )
      : null
    battles.push({
      targetId,
      targetName: target.name,
      prongs,
      ratio: preview.ratio,
      multiplier: preview.multiplier,
      origins: preview.origins,
      encircled: preview.encircled,
      odds: formatOdds(preview) ?? "odds unknown",
      queuedRatio: queuedPreview && Number.isFinite(queuedPreview.ratio) ? queuedPreview.ratio : null,
      queuedOdds: formatOdds(queuedPreview),
    })
  }
  battles.sort(
    (a, b) => b.prongs.length - a.prongs.length || b.ratio - a.ratio || a.targetName.localeCompare(b.targetName),
  )
  return battles
}

function renderBattle(battle: CombinedBattle): string {
  const columns = battle.prongs
    .map(
      (prong) =>
        `${prong.fromId} ${prong.fromName}${prong.queued ? " queued" : ""} [${prong.unitIds.join(" ")} ${prong.names.join(", ")}]`,
    )
    .join("; ")
  const queued = battle.prongs.filter((prong) => prong.queued)
  const free = battle.prongs.filter((prong) => !prong.queued)
  const adding =
    queued.length && free.length && battle.queuedRatio !== null
      ? ` | with your queued attack from ${joinAnd(queued.map((prong) => prong.fromName))}, adding ${joinAnd(free.map((prong) => prong.fromName))} makes it ${printRatio(battle.ratio)} (queued alone ${printRatio(battle.queuedRatio)})`
      : ""
  const ring = battle.encircled ? " | encircled" : ""
  return `${battle.targetId} ${battle.targetName} | ${battle.origins} directions | flank ×${battle.multiplier} | ${battle.odds}${ring}${adding} | columns ${columns}`
}

function soften(odds: string): string {
  if (!odds) return odds
  return odds.charAt(0).toLowerCase() + odds.slice(1)
}

function poolSentence(battle: CombinedBattle): string {
  const names = joinAnd(battle.prongs.map((prong) => prong.fromName))
  const lead = `${names} into ${battle.targetName} are one battle, ${soften(battle.odds)} The flank multiplier is ${battle.multiplier}.`
  const queued = battle.prongs.filter((prong) => prong.queued)
  const free = battle.prongs.filter((prong) => !prong.queued)
  if (queued.length && free.length && battle.queuedRatio !== null) {
    return `${lead} With your queued attack from ${joinAnd(queued.map((prong) => prong.fromName))}, adding ${joinAnd(free.map((prong) => prong.fromName))} makes it ${printRatio(battle.ratio)}.`
  }
  return lead
}

function focusedReply(
  situation: Situation,
  focus: CombinedBattle,
): { reply: string; orders: AdvisorOrder[] } {
  const names = joinAnd(focus.prongs.map((prong) => prong.fromName))
  const sentences = [
    `${situation.date}. Doing it together is one battle. The engine pools the columns before the dice.`,
    `${names} into ${focus.targetName} are one battle, ${soften(focus.odds)} The flank multiplier on ${focus.origins} directions is ${focus.multiplier}.`,
  ]
  const queued = focus.prongs.filter((prong) => prong.queued)
  const free = focus.prongs.filter((prong) => !prong.queued)
  if (queued.length && free.length && focus.queuedRatio !== null) {
    sentences.push(
      `With your queued attack from ${joinAnd(queued.map((prong) => prong.fromName))}, adding ${joinAnd(free.map((prong) => prong.fromName))} makes it ${printRatio(focus.ratio)}. The queued columns alone are ${printRatio(focus.queuedRatio)}.`,
    )
  }
  const chosen = chooseContact(axisContacts(situation.contacts))
  if (chosen && chosen.targetId !== focus.targetId && Number.isFinite(chosen.ratio) && chosen.ratio > focus.ratio) {
    const odds = soften(chosen.odds.endsWith(".") ? chosen.odds : `${chosen.odds}.`)
    sentences.push(
      `${chosen.fromName} into ${chosen.targetName} is still the stronger blow, ${odds} I can file the ${focus.targetName} battle for you to accept.`,
    )
  } else {
    sentences.push("I would file that battle, and leave it for you to accept. I do not fight it myself.")
  }
  if (focus.encircled) sentences.push(`${focus.targetName} would be surrounded. The defender cannot retreat.`)
  sentences.push(
    "I have not seen the Russian orders for this fortnight, and I will not guess them. These odds are against the garrison as it stands. A simultaneous march can change the fight.",
  )
  return {
    reply: sentences.join(" "),
    orders: free.map((prong) => ({
      type: "attack" as const,
      from: prong.fromId,
      target: focus.targetId,
      unitIds: prong.unitIds,
    })),
  }
}

function focusBattle(situation: Situation, messages: AdvisorChatMessage[]): CombinedBattle | null {
  const last = [...messages].reverse().find((message) => message.role === "user")
  if (!last || !/together|combin|concentric|converg|pool|pincer|at once/i.test(last.content)) return null
  const blob = messages.map((message) => message.content).join("\n")
  const named = situation.combined.filter((battle) => mentionsBattle(blob, battle))
  const pool = named.length ? named : situation.combined
  return [...pool].sort(byBattleWeight)[0] ?? null
}

function mentionsBattle(blob: string, battle: CombinedBattle): boolean {
  const hay = blob.toLowerCase()
  if (hay.includes(battle.targetName.toLowerCase())) return true
  return battle.prongs.filter((prong) => hay.includes(prong.fromName.toLowerCase())).length >= 2
}

function byBattleWeight(a: CombinedBattle, b: CombinedBattle): number {
  return b.prongs.length - a.prongs.length || b.ratio - a.ratio || a.targetName.localeCompare(b.targetName)
}

function printRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return "undefended"
  return `${ratio.toFixed(2)} : 1`
}

function joinAnd(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

function classifySuggestions(
  prepared: Prepared,
  raw: unknown[],
  queued: PlayerOrder[],
): { cards: AdvisorCard[]; dropped: number } {
  let dropped = 0
  const cards: AdvisorCard[] = []
  const accepted: AdvisorOrder[] = []
  for (const item of raw) {
    const parsed = normalizeOrders(prepared.map, item)
    if (!parsed.orders.length) {
      dropped += Math.max(1, parsed.skipped)
      continue
    }
    dropped += parsed.skipped
    for (const order of parsed.orders) {
      if (
        accepted.some((prior) => sameOrder(prior, order)) ||
        cards.some((card) => sameOrder(card.order, order) || card.companions.some((prior) => sameOrder(prior, order)))
      ) {
        dropped += 1
        continue
      }
      const card = assessOne(prepared, order, queued, accepted)
      if (!card) {
        dropped += 1
        continue
      }
      cards.push(card)
      if (card.valid) accepted.push(order)
    }
  }
  return { cards: groupAttackCards(prepared.map, cards, queued).slice(0, MAX_SUGGESTIONS), dropped }
}

function assessOrders(prepared: Prepared, orders: AdvisorOrder[], queued: PlayerOrder[]): AdvisorCard[] {
  const { cards } = classifySuggestions(prepared, orders, queued)
  return cards.filter((card) => card.valid)
}

function groupAttackCards(map: GameState, cards: AdvisorCard[], queued: PlayerOrder[]): AdvisorCard[] {
  const result: AdvisorCard[] = []
  const indexByTarget = new Map<string, number>()
  for (const card of cards) {
    if (card.order.type !== "attack" || !card.valid) {
      result.push(card)
      continue
    }
    const existing = indexByTarget.get(card.order.target)
    if (existing === undefined) {
      indexByTarget.set(card.order.target, result.length)
      result.push(card)
      continue
    }
    result[existing] = mergeAttackCard(map, result[existing], card, queued)
  }
  return result
}

function mergeAttackCard(
  map: GameState,
  into: AdvisorCard,
  extra: AdvisorCard,
  queued: PlayerOrder[],
): AdvisorCard {
  const orders = [into.order, ...into.companions, extra.order, ...extra.companions].filter(
    (order): order is Extract<AdvisorOrder, { type: "attack" }> => order.type === "attack",
  )
  const target = orders[0].target
  const queuedProngs = queued.flatMap((order) =>
    order.type === "attack" && order.target === target ? [{ fromId: order.from, unitIds: order.unitIds }] : [],
  )
  const preview = combinedEngagementOdds(map, target, [
    ...queuedProngs,
    ...orders.map((order) => ({ fromId: order.from, unitIds: order.unitIds })),
  ])
  const odds = formatOdds(preview)
  const fromNames = orders.map((order) => nameOf(map, order.from))
  const queuedNames = queuedProngs.map((prong) => nameOf(map, prong.fromId))
  return {
    id: into.id,
    order: orders[0],
    companions: orders.slice(1),
    label: `Attack ${nameOf(map, target)} from ${joinAnd(fromNames)}`,
    valid: true,
    note: null,
    odds,
    detail: detailForAttacks(map, orders, queuedNames, odds),
  }
}

function assessOne(
  prepared: Prepared,
  order: AdvisorOrder,
  queued: PlayerOrder[],
  accepted: AdvisorOrder[],
): AdvisorCard | null {
  const gate = centralGate(prepared.map, order)
  if (gate === "drop") return null
  const clone = structuredClone(prepared.map)
  if (order.type === "recruit" || order.type === "cancelRecruit") {
    clone.treasury = {
      central: { ...prepared.purse.treasury.central },
      russia: { ...prepared.purse.treasury.russia },
    }
    clone.queue = prepared.purse.queue.map((job) => ({ ...job }))
  }
  const resolution = applyConcrete(clone, order, new Set(prepared.used), new Set(prepared.fortified))
  const valid = !gate && resolution.status === "applied"
  if (valid) commit(prepared, order, clone)
  const odds = order.type === "attack" ? oddsFor(prepared.map, order, queued, accepted) : null
  return {
    id: crypto.randomUUID(),
    order,
    companions: [],
    label: labelFor(prepared.map, order),
    valid,
    note: valid ? null : gate || resolution.summary,
    odds,
    detail: valid ? detailFor(prepared.map, order, odds) : null,
  }
}

function oddsFor(
  map: GameState,
  order: Extract<AdvisorOrder, { type: "attack" }>,
  queued: PlayerOrder[],
  accepted: AdvisorOrder[],
): string | null {
  const prongs = [
    ...queued.flatMap((item) =>
      item.type === "attack" && item.target === order.target ? [{ fromId: item.from, unitIds: item.unitIds }] : [],
    ),
    ...accepted.flatMap((item) =>
      item.type === "attack" && item.target === order.target ? [{ fromId: item.from, unitIds: item.unitIds }] : [],
    ),
    { fromId: order.from, unitIds: order.unitIds },
  ]
  const preview =
    prongs.length > 1
      ? combinedEngagementOdds(map, order.target, prongs)
      : engagementOdds(map, order.from, order.target, order.unitIds)
  return formatOdds(preview)
}

export function formatOdds(preview: EngagementPreview | null): string | null {
  if (!preview) return null
  if (preview.empty && preview.origins < 2) return "Undefended, before the dice."
  const ratio =
    preview.empty || !Number.isFinite(preview.ratio) ? "undefended" : `${preview.ratio.toFixed(2)} : 1`
  if (preview.origins >= 2) {
    const shape = preview.origins === 2 ? "Two-pronged" : "Concentric"
    const ring = preview.encircled ? ", and the defender is surrounded" : ""
    return `${shape}, about ${ratio} before the dice${ring}.`
  }
  return `About ${ratio} before the dice.`
}

function labelFor(map: GameState, order: AdvisorOrder): string {
  if (order.type === "attack") {
    return `Attack ${nameOf(map, order.target)} from ${nameOf(map, order.from)}`
  }
  if (order.type === "move") {
    const located = findUnit(map, order.unitId)
    return `Move ${located?.unit.name ?? order.unitId} to ${nameOf(map, order.to)}`
  }
  if (order.type === "fortify") return `Fortify ${nameOf(map, order.provinceId)}`
  if (order.type === "recruit") {
    return `Raise ${KIND_LABEL[order.unitKind].toLowerCase()} at ${nameOf(map, order.provinceId)}`
  }
  return "Cancel a formation in the yards"
}

function detailForAttacks(
  map: GameState,
  orders: Extract<AdvisorOrder, { type: "attack" }>[],
  queuedNames: string[],
  odds: string | null,
): string {
  const target = findProvince(map, orders[0].target)
  const defenders = (target?.units ?? [])
    .filter((unit) => unit.faction === target?.controller)
    .map((unit) => `${unit.name} (strength ${unit.strength}, morale ${unit.morale})`)
    .join(", ")
  const columns = orders
    .map((order) => {
      const names = order.unitIds.map((id) => findUnit(map, id)?.unit.name ?? id).join(", ")
      return `${nameOf(map, order.from)}: ${names}`
    })
    .join("; ")
  const lead = queuedNames.length
    ? `With the queued attack from ${joinAnd(queuedNames)}, this is one battle. ${odds ?? ""}`
    : odds
  return [lead, `Columns: ${columns}.`, defenders ? `Defenders: ${defenders}.` : "The province is empty."]
    .filter(Boolean)
    .join(" ")
}

function detailFor(map: GameState, order: AdvisorOrder, odds: string | null): string {
  if (order.type === "attack") {
    const target = findProvince(map, order.target)
    const from = findProvince(map, order.from)
    const defenders = (target?.units ?? [])
      .filter((unit) => unit.faction === target?.controller)
      .map((unit) => `${unit.name} (strength ${unit.strength}, morale ${unit.morale})`)
      .join(", ")
    return [
      odds,
      defenders ? `Defenders: ${defenders}.` : "The province is empty.",
      from ? `${from.name} supply ${from.supply}.` : "",
    ]
      .filter(Boolean)
      .join(" ")
  }
  if (order.type === "move") {
    const located = findUnit(map, order.unitId)
    return located
      ? `${located.unit.name} would march from ${located.province.name} (supply ${located.province.supply}) to ${nameOf(map, order.to)}.`
      : "Move."
  }
  if (order.type === "fortify") {
    const province = findProvince(map, order.provinceId)
    return province
      ? `${province.name} fort ${province.fort} would become ${province.fort + 1}. Supply ${province.supply}.`
      : "Fortify."
  }
  if (order.type === "recruit") {
    const cost = RECRUIT[order.unitKind]
    const province = findProvince(map, order.provinceId)
    return `${cost.label}: ${cost.mp} manpower, ${cost.ip} industry. ${province?.name ?? "The yard"} supply ${province?.supply ?? "?"}.`
  }
  return "The manpower and industry would be returned."
}

function nameOf(map: GameState, id: string): string {
  return findProvince(map, id)?.name ?? id
}

function prepareStaff(state: GameState, queued: PlayerOrder[]): Prepared {
  const map = staffMap(state)
  const used = new Set<string>()
  const fortified = new Set<string>()
  const purse = structuredClone(map)
  const attacking = new Set<string>()
  for (const order of queued) {
    if (order.type !== "attack") continue
    for (const id of unitsOf(map, order)) attacking.add(id)
  }
  purse.treasury.central = spendable(map, "central", attacking)
  for (const order of queued) {
    if (!isAdvisorOrder(order)) continue
    if (centralGate(map, order)) continue
    const clone = structuredClone(map)
    if (order.type === "recruit" || order.type === "cancelRecruit") {
      clone.treasury.central = { ...purse.treasury.central }
      clone.queue = purse.queue.map((job) => ({ ...job }))
    }
    const resolution = applyConcrete(clone, order, new Set(used), new Set(fortified))
    if (resolution.status !== "applied") continue
    commit({ map, used, fortified, purse, queued }, order, clone)
  }
  return { map, used, fortified, purse, queued }
}

function commit(prepared: Prepared, order: AdvisorOrder, clone: GameState): void {
  if (order.type === "move" || order.type === "attack") {
    for (const id of unitsOf(prepared.map, order)) prepared.used.add(id)
  } else if (order.type === "fortify") {
    prepared.fortified.add(order.provinceId)
  } else if (order.type === "recruit" || order.type === "cancelRecruit") {
    prepared.purse.treasury.central = { ...clone.treasury.central }
    prepared.purse.queue = clone.queue.map((job) => ({ ...job }))
  }
}

function unitsOf(map: GameState, order: AdvisorOrder | PlayerOrder): string[] {
  if (order.type === "move") {
    const unitId = "unitId" in order ? order.unitId : ""
    const located = findUnit(map, unitId)
    if (!located) return unitId ? [unitId] : []
    return partyOf(located.province.units, [unitId]).map((unit) => unit.id)
  }
  if (order.type === "attack") {
    const from = findProvince(map, order.from)
    if (!from) return order.unitIds
    return partyOf(from.units, order.unitIds).map((unit) => unit.id)
  }
  return []
}

function applyConcrete(
  state: GameState,
  order: AdvisorOrder,
  used: Set<string>,
  fortified: Set<string>,
): { status: "applied" | "rejected"; summary: string } {
  if (order.type === "move") {
    return applyMove(state, { type: "move", unit: order.unitId, to: order.to }, used)
  }
  if (order.type === "attack") {
    return applyAttack(
      state,
      { type: "attack", from: order.from, target: order.target, units: order.unitIds },
      used,
      4,
      new Set(),
    )
  }
  if (order.type === "fortify") {
    return applyFortify(state, { type: "fortify", province: order.provinceId }, fortified)
  }
  if (order.type === "recruit") {
    return applyRecruit(state, {
      type: "recruit",
      faction: "central",
      province: order.provinceId,
      kind: order.unitKind,
    })
  }
  return applyCancelRecruit(state, { type: "cancelRecruit", id: order.buildId })
}

/** `drop` means the suggestion names something that is not ours, or does not exist. */
function centralGate(map: GameState, order: AdvisorOrder): string | null | "drop" {
  if (order.type === "move") {
    const located = findUnit(map, order.unitId)
    if (!located) return "drop"
    if (located.unit.faction !== "central") return "drop"
    return null
  }
  if (order.type === "attack") {
    if (!order.unitIds.length) return "drop"
    const from = findProvince(map, order.from)
    const target = findProvince(map, order.target)
    if (!from || !target) return "drop"
    if (from.controller !== "central") return "drop"
    for (const id of order.unitIds) {
      const located = findUnit(map, id)
      if (!located || located.unit.faction !== "central" || located.province.id !== from.id) return "drop"
    }
    return null
  }
  if (order.type === "fortify") {
    const province = findProvince(map, order.provinceId)
    if (!province) return "drop"
    if (province.controller !== "central") return "drop"
    return null
  }
  if (order.type === "recruit") {
    const province = findProvince(map, order.provinceId)
    if (!province) return "drop"
    if (!RECRUIT[order.unitKind]) return "drop"
    return null
  }
  const job = map.queue.find((item) => item.id === order.buildId)
  if (!job) return "That formation is not in the yards."
  if (job.faction !== "central") return "drop"
  return null
}

function normalizeOrders(map: GameState, raw: unknown): { orders: AdvisorOrder[]; skipped: number } {
  if (!raw || typeof raw !== "object") return { orders: [], skipped: 0 }
  const item = raw as Record<string, unknown>
  if (item.type !== "attacks") {
    const order = normalizeOrder(map, raw)
    return order ? { orders: [order], skipped: 0 } : { orders: [], skipped: 0 }
  }
  const target = stringField(item.target)
  if (!target || !Array.isArray(item.prongs)) return { orders: [], skipped: 0 }
  const orders: AdvisorOrder[] = []
  let skipped = 0
  for (const prong of item.prongs) {
    if (!prong || typeof prong !== "object") {
      skipped += 1
      continue
    }
    const order = normalizeOrder(map, { ...(prong as Record<string, unknown>), type: "attack", target })
    if (order) orders.push(order)
    else skipped += 1
  }
  return { orders, skipped }
}

function normalizeOrder(map: GameState, raw: unknown): AdvisorOrder | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  const type = item.type
  if (type === "move") {
    const unitRaw = stringField(item.unitId) ?? stringField(item.unit)
    const toRaw = stringField(item.to)
    if (!unitRaw || !toRaw) return null
    const unitId = resolveUnit(map, unitRaw)
    const to = resolveProvince(map, toRaw)
    if (!unitId || !to) return null
    return { type: "move", unitId, to }
  }
  if (type === "attack") {
    const fromRaw = stringField(item.from)
    const targetRaw = stringField(item.target)
    const ids = stringList(item.unitIds) ?? stringList(item.units)
    if (!fromRaw || !targetRaw || !ids?.length) return null
    const from = resolveProvince(map, fromRaw)
    const target = resolveProvince(map, targetRaw)
    if (!from || !target) return null
    const unitIds: string[] = []
    for (const id of ids) {
      const resolved = resolveUnit(map, id)
      if (!resolved) return null
      unitIds.push(resolved)
    }
    return { type: "attack", from, target, unitIds }
  }
  if (type === "fortify") {
    const provinceRaw = stringField(item.provinceId) ?? stringField(item.province)
    if (!provinceRaw) return null
    const provinceId = resolveProvince(map, provinceRaw)
    if (!provinceId) return null
    return { type: "fortify", provinceId }
  }
  if (type === "recruit") {
    const provinceRaw = stringField(item.provinceId) ?? stringField(item.province)
    const kind = stringField(item.unitKind) ?? stringField(item.kind)
    if (!provinceRaw || !isKind(kind)) return null
    const provinceId = resolveProvince(map, provinceRaw)
    if (!provinceId) return null
    return { type: "recruit", provinceId, unitKind: kind }
  }
  if (type === "cancelRecruit") {
    const buildId = stringField(item.buildId) ?? stringField(item.id)
    if (!buildId) return null
    return { type: "cancelRecruit", buildId }
  }
  return null
}

function resolveProvince(map: GameState, raw: string): string | null {
  const needle = normalizeName(raw)
  for (const province of map.provinces) {
    const labels = [province.id, province.name, ...(CATALOG_BY_ID[province.id]?.aliases ?? [])]
    if (labels.some((label) => normalizeName(label) === needle)) return province.id
  }
  return null
}

function resolveUnit(map: GameState, raw: string): string | null {
  const needle = normalizeName(raw)
  for (const province of map.provinces) {
    for (const unit of province.units) {
      if (unit.id === raw || normalizeName(unit.name) === needle) return unit.id
    }
  }
  return null
}

function isKind(value: string | null): value is UnitKind {
  return value === "infantry" || value === "cavalry" || value === "artillery"
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null
  const ids = value.map((item) => item.trim()).filter(Boolean)
  return ids.length ? ids : null
}

function isAdvisorOrder(order: PlayerOrder): order is AdvisorOrder {
  return order.type !== "text"
}

function sameOrder(a: AdvisorOrder, b: AdvisorOrder): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function snap(unit: Unit): UnitSnap {
  return {
    id: unit.id,
    name: unit.name,
    faction: unit.faction,
    strength: unit.strength,
    morale: unit.morale,
    kind: unit.kind,
  }
}

function deniesCombined(sentence: string): boolean {
  return /does not show combined|each column separately|will not pool|won't pool|not pool these|previews each column|columns stay separate|cannot promise the (dice or the )?engine will pool/i.test(
    sentence,
  )
}

function leaksRussianPlan(sentence: string): boolean {
  return /\b(stavka|the russian staff|russia|the russians)\b[^.?!]{0,80}\b(will|shall|is about to|are about to|plans to|intends to|is going to)\s+(attack|move|retreat|strike|advance|order|redeploy)/i.test(
    sentence,
  )
}

function inventsUnit(sentence: string, known: Set<string>): boolean {
  const ids = sentence.match(/\bg-[a-z0-9-]+\b/g) ?? []
  return ids.some((id) => !known.has(id))
}

function parseModel(text: string): { reply: string; suggestions: unknown[] } | null {
  const stripped = stripFence(text)
  const direct = readJson(stripped) ?? readJson(sliceObject(stripped))
  if (!direct || typeof direct !== "object") return null
  const record = direct as { reply?: unknown; suggestions?: unknown }
  const reply = typeof record.reply === "string" ? record.reply.trim() : ""
  const suggestions = Array.isArray(record.suggestions) ? record.suggestions : []
  if (!reply && suggestions.length === 0) return null
  return { reply, suggestions }
}

function readJson(text: string | null): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function sliceObject(text: string): string | null {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  return text.slice(start, end + 1)
}

function stripFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}
