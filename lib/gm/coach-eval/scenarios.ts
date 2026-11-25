import { createInitialState } from "@/lib/data/scenario"
import { formatDate } from "@/lib/format"
import { renderAdvisorGameFacts } from "@/lib/gm/advisor-game-facts"
import { buildSituation, staffMap } from "@/lib/gm/advisor"
import { formatCoachOddsPhrase } from "@/lib/gm/campaign-coach"
import {
  combinedEngagementOdds,
  engagementOdds,
  resolveTurn,
} from "@/lib/engine/turn"
import { independentFormations } from "@/lib/engine/echelon"
import { leaveDepotGarrison } from "@/lib/orders"
import { provinceLabel } from "@/lib/news/battle"
import { legalTargets } from "@/lib/ui/legal-targets"
import type { GameState, PlayerOrder, TurnRecord, Unit } from "@/lib/types"
import type { CoachEvalFacts, CoachEvalFixture, CoachEvalScenario } from "@/lib/gm/coach-eval/types"

function cloneState(state: GameState): GameState {
  return structuredClone(state)
}

function centralUnitIds(state: GameState, provinceId: string): string[] {
  const province = state.provinces.find((item) => item.id === provinceId)
  if (!province) return []
  return province.units.filter((unit) => unit.faction === "central").map((unit) => unit.id)
}

function trimRatio(raw: number): string {
  return (Math.round(raw * 10) / 10).toFixed(1).replace(/\.0$/, "")
}

function oddsTrimmed(preview: { ratio: number; empty?: boolean } | null): string[] {
  if (!preview || preview.empty || !Number.isFinite(preview.ratio)) return []
  return [trimRatio(preview.ratio)]
}

function catalogNames(state: GameState): string[] {
  return state.provinces.map((province) => province.name)
}

function attackOrder(from: string, target: string, unitIds: string[]): PlayerOrder {
  return { type: "attack", from, target, unitIds }
}

/** Starve Katowice so a queued Kielce attack is legal but badly odds-rated. */
function underSuppliedKatowice(): CoachEvalFixture {
  const state = cloneState(createInitialState("normal"))
  const katowice = state.provinces.find((province) => province.id === "katowice")
  if (!katowice) throw new Error("katowice missing from scenario")
  katowice.supplyModifier = -55

  const map = staffMap(state)
  const unitIds = centralUnitIds(map, "katowice")
  if (!unitIds.length) throw new Error("no central units in Katowice")
  const preview = engagementOdds(map, "katowice", "kielce", unitIds)
  if (!preview || !Number.isFinite(preview.ratio) || preview.ratio >= 1) {
    throw new Error(`expected under-supply Katowice→Kielce odds < 1, got ${preview?.ratio}`)
  }
  if (map.provinces.find((province) => province.id === "katowice")!.supply >= 60) {
    throw new Error("expected Katowice effective supply well below a fed column")
  }
  const queued = [attackOrder("katowice", "kielce", unitIds)]
  const phrase = formatCoachOddsPhrase(preview)
  if (!phrase) throw new Error("missing odds phrase for under-supply fixture")

  const facts: CoachEvalFacts = {
    allowedProvinceNames: catalogNames(map),
    allowedOddsTrimmed: oddsTrimmed(preview),
  }
  return {
    state,
    log: [],
    messages: [{ role: "user", content: "Does my Katowice attack look sound?" }],
    queuedOrders: queued,
    selectedProvinceId: "katowice",
    facts,
  }
}

/** Forward push at Kielce while Ermland-Masuren is emptied on the Russian border. */
function exposedFlank(): CoachEvalFixture {
  const state = cloneState(createInitialState("normal"))
  const ermland = state.provinces.find((province) => province.id === "ermland_masuren")
  if (!ermland) throw new Error("ermland_masuren missing")
  ermland.units = []

  const map = staffMap(state)
  const emptied = map.provinces.find((province) => province.id === "ermland_masuren")!
  if (emptied.units.length !== 0) throw new Error("Ermland should be ungarrisoned")
  const russianNeighbors = emptied.neighbors.filter(
    (id) => map.provinces.find((province) => province.id === id)?.controller === "russia",
  )
  if (!russianNeighbors.includes("bialystok") || !russianNeighbors.includes("plock")) {
    throw new Error("Ermland must border Białystok and Płock")
  }

  const unitIds = centralUnitIds(map, "krakow")
  const preview = engagementOdds(map, "krakow", "kielce", unitIds)
  if (!preview) throw new Error("Kraków→Kielce preview missing")

  return {
    state,
    log: [],
    messages: [
      {
        role: "user",
        content: "I am pushing hard at Kielce from Kraków. Does the plan look solid?",
      },
    ],
    queuedOrders: [attackOrder("krakow", "kielce", unitIds)],
    selectedProvinceId: "krakow",
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: oddsTrimmed(preview),
    },
  }
}

function clerkRequest(): CoachEvalFixture {
  const state = createInitialState("normal")
  const map = staffMap(state)
  return {
    state,
    log: [],
    messages: [
      {
        role: "user",
        content: "Just tell me the best move and file an attack for me.",
      },
    ],
    queuedOrders: [],
    selectedProvinceId: null,
    facts: {
      allowedProvinceNames: catalogNames(map),
      // Rules/live may quote strongest contact odds — allow any contact ratio on the map.
      allowedOddsTrimmed: mapContactOdds(map),
    },
  }
}

/**
 * Odds the rules coach may quote from DISPATCH contacts.
 * Must match `frontContacts` in advisor.ts: independentFormations + leaveDepotGarrison,
 * not every central unit in the province.
 */
function mapContactOdds(map: GameState): string[] {
  const fromSituation = buildSituation(map, [])
    .contacts.filter((contact) => Number.isFinite(contact.ratio))
    .map((contact) => trimRatio(contact.ratio))
  const out = new Set<string>(fromSituation)
  // Belt-and-braces: recompute the same columns in case situation formatting drifts.
  for (const province of map.provinces) {
    if (province.controller !== "central" || province.supply < 30) continue
    const available = independentFormations(
      province.units.filter((unit) => unit.faction === "central"),
    )
    if (!available.length) continue
    const chosen = leaveDepotGarrison(available, province.depot === "central", false)
    if (!chosen.length) continue
    const unitIds = chosen.map((unit) => unit.id)
    for (const neighborId of province.neighbors) {
      const target = map.provinces.find((item) => item.id === neighborId)
      if (!target || target.controller === "central") continue
      const preview = engagementOdds(map, province.id, neighborId, unitIds)
      for (const trimmed of oddsTrimmed(preview)) out.add(trimmed)
    }
  }
  return [...out]
}

function pushbackFollowUp(): CoachEvalFixture {
  const state = createInitialState("normal")
  const map = staffMap(state)
  return {
    state,
    log: [],
    messages: [
      { role: "user", content: "Does my plan look good?" },
      {
        role: "advisor",
        content:
          "What do you expect Kielce to do for the Lemberg push? The strongest contact is Kraków into Kielce at about 5.8:1 if the Russians don't reinforce.",
      },
      { role: "user", content: "I don't know, just tell me what to do." },
    ],
    queuedOrders: [],
    selectedProvinceId: null,
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: mapContactOdds(map),
    },
  }
}

/** Sensible concentric Kraków + Katowice into Kielce. */
function soundPlan(): CoachEvalFixture {
  const state = createInitialState("normal")
  const map = staffMap(state)
  const krakowIds = centralUnitIds(map, "krakow")
  const katowiceIds = centralUnitIds(map, "katowice")
  if (!krakowIds.length || !katowiceIds.length) {
    throw new Error("missing Kraków or Katowice attackers for sound plan")
  }
  const combined = combinedEngagementOdds(map, "kielce", [
    { fromId: "krakow", unitIds: krakowIds },
    { fromId: "katowice", unitIds: katowiceIds },
  ])
  if (!combined || !Number.isFinite(combined.ratio) || combined.ratio < 3) {
    throw new Error(`expected strong concentric odds, got ${combined?.ratio}`)
  }
  const single = engagementOdds(map, "krakow", "kielce", krakowIds)
  const allowed = new Set<string>([
    ...oddsTrimmed(combined),
    ...oddsTrimmed(single),
  ])

  return {
    state,
    log: [],
    messages: [
      {
        role: "user",
        content: "Sanity-check my concentric Kielce attack?",
      },
    ],
    queuedOrders: [
      attackOrder("krakow", "kielce", krakowIds),
      attackOrder("katowice", "kielce", katowiceIds),
    ],
    selectedProvinceId: "krakow",
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: [...allowed],
    },
  }
}

/**
 * Player saw strong Kraków→Kielce odds, but Stavka reinforced Kielce before resolve;
 * roll 1 fails. Chronicle is fortnight 1.
 */
function postBattleSurprise(): CoachEvalFixture {
  const baseline = createInitialState("normal")
  const baselineMap = staffMap(baseline)
  const unitIds = centralUnitIds(baselineMap, "krakow")
  const queuedPreview = engagementOdds(baselineMap, "krakow", "kielce", unitIds)
  if (!queuedPreview || queuedPreview.ratio < 4) {
    throw new Error(`expected strong pre-reinforce odds, got ${queuedPreview?.ratio}`)
  }

  const reinforced = cloneState(baseline)
  const kielce = reinforced.provinces.find((province) => province.id === "kielce")!
  for (const srcId of ["warszawa", "lodz", "plock", "bialystok", "lublin"] as const) {
    const src = reinforced.provinces.find((province) => province.id === srcId)
    if (!src) continue
    const movers: Unit[] = src.units.filter((unit) => unit.faction === "russia")
    src.units = src.units.filter((unit) => unit.faction !== "russia")
    kielce.units.push(...movers)
  }

  const { record, state: after } = resolveTurn(
    reinforced,
    {
      proposals: [{ type: "attack", from: "krakow", target: "kielce", units: unitIds }],
      events: [],
      narration: "Mackensen drives on Kielce.",
      diplomacy: [],
    },
    { rng: () => 0 },
  )
  const battleRes = record.resolutions.find((item) => item.battle)
  if (!battleRes?.battle || battleRes.battle.attackerWon) {
    throw new Error("expected reinforced Kielce assault to fail on roll 1")
  }
  const oddsMatch = battleRes.summary.match(/odds\s+([\d.]+)/i)
  const resolvedTrimmed = oddsMatch ? [trimRatio(Number(oddsMatch[1]))] : []

  const log: TurnRecord[] = [record]
  return {
    state: after,
    log,
    messages: [
      {
        role: "user",
        content: "How did the Kielce attack go? Why did it fail?",
      },
    ],
    queuedOrders: [],
    selectedProvinceId: "kielce",
    facts: {
      allowedProvinceNames: catalogNames(staffMap(after)),
      allowedOddsTrimmed: [
        ...resolvedTrimmed,
        ...oddsTrimmed(queuedPreview),
      ],
      battleFortnight: record.turn + 1,
      battleDate: record.date,
    },
  }
}

/** Fortify Kraków while also attacking Kielce from Kraków — same garrison, conflicting jobs. */
function fortifyAttackConflict(): CoachEvalFixture {
  const state = createInitialState("normal")
  const map = staffMap(state)
  const unitIds = centralUnitIds(map, "krakow")
  if (!unitIds.length) throw new Error("no Kraków attackers for fortify/attack conflict")
  const preview = engagementOdds(map, "krakow", "kielce", unitIds)
  const queued: PlayerOrder[] = [
    { type: "fortify", provinceId: "krakow" },
    attackOrder("krakow", "kielce", unitIds),
  ]
  return {
    state,
    log: [],
    messages: [
      {
        role: "user",
        content: "Does my queued plan look sound?",
      },
    ],
    queuedOrders: queued,
    selectedProvinceId: "krakow",
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: [...oddsTrimmed(preview), ...mapContactOdds(map)],
    },
  }
}

/** Central-held Lublin can order an attack on neighbor Warsaw — coach must not deny contact. */
function reachableWarsawFromLublin(): CoachEvalFixture {
  const state = cloneState(createInitialState("normal"))
  const lublin = state.provinces.find((province) => province.id === "lublin")
  const krakow = state.provinces.find((province) => province.id === "krakow")
  if (!lublin || !krakow) throw new Error("lublin/krakow missing")
  if (!lublin.neighbors.includes("warszawa")) {
    throw new Error("fixture invalid: Lublin must border Warszawa")
  }
  lublin.controller = "central"
  lublin.supply = 100
  lublin.units = krakow.units.filter((unit) => unit.faction === "central").map((unit) => ({
    ...unit,
    province: "lublin",
  }))
  krakow.units = krakow.units.filter((unit) => unit.faction !== "central")
  const map = staffMap(state)
  map.provinces.find((province) => province.id === "lublin")!.supply = 100
  const legal = legalTargets(map, "lublin", [])
  if (!legal.attack.includes("warszawa")) {
    throw new Error(`expected orderable Warszawa from Lublin, got attack=${legal.attack.join(",")}`)
  }
  return {
    state: map,
    log: [],
    messages: [
      {
        role: "user",
        content: "From Lublin, can I reach Warsaw this fortnight? The map shows no contact.",
      },
    ],
    queuedOrders: [],
    selectedProvinceId: "lublin",
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: mapContactOdds(map),
      mustContain: ["warsaw", "orderable", "lublin"],
      mustNotContain: ["no open march", "not share a border", "no contact"],
    },
  }
}

/** Do not quote attack odds into a province the Central Powers already hold. */
function attackCapturedProvince(): CoachEvalFixture {
  const state = cloneState(createInitialState("normal"))
  const lublin = state.provinces.find((province) => province.id === "lublin")
  const kielce = state.provinces.find((province) => province.id === "kielce")
  const krakow = state.provinces.find((province) => province.id === "krakow")
  if (!lublin || !kielce || !krakow) throw new Error("lublin/kielce/krakow missing")
  lublin.controller = "central"
  kielce.controller = "central"
  lublin.units = krakow.units.filter((unit) => unit.faction === "central")
  krakow.units = krakow.units.filter((unit) => unit.faction !== "central")
  const map = staffMap(state)
  const unitIds = centralUnitIds(map, "lublin")
  if (!unitIds.length) throw new Error("no Lublin attackers")
  const queued = [attackOrder("lublin", "kielce", unitIds)]
  return {
    state: map,
    log: [],
    messages: [{ role: "user", content: "Does my queued attack on Kielce look sound after we took it?" }],
    queuedOrders: queued,
    selectedProvinceId: "lublin",
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: [],
      mustContain: ["already held", "kielce"],
      mustNotContain: [":1"],
    },
  }
}

/** Supply below 30 blocks the march — explain the limit, do not quote odds. */
function supplyRejectedQueuedAttack(): CoachEvalFixture {
  const state = cloneState(createInitialState("normal"))
  const lublin = state.provinces.find((province) => province.id === "lublin")
  const krakow = state.provinces.find((province) => province.id === "krakow")
  if (!lublin || !krakow) throw new Error("lublin/krakow missing")
  lublin.controller = "central"
  lublin.units = krakow.units.filter((unit) => unit.faction === "central")
  krakow.units = krakow.units.filter((unit) => unit.faction !== "central")
  const map = staffMap(state)
  const lublinMap = map.provinces.find((province) => province.id === "lublin")!
  lublinMap.supply = 26
  const unitIds = centralUnitIds(map, "lublin")
  const target = lublin.neighbors.find(
    (id) => map.provinces.find((province) => province.id === id)?.controller === "russia",
  )
  if (!target) throw new Error("no Russian neighbor from Lublin")
  const queued = [attackOrder("lublin", target, unitIds)]
  return {
    state: map,
    log: [],
    messages: [{ role: "user", content: "What odds do I have marching from Lublin this fortnight?" }],
    queuedOrders: queued,
    selectedProvinceId: "lublin",
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: [],
      mustContain: ["supply", "30"],
      mustNotContain: [":1"],
    },
  }
}

/** Chronicle fortnight 2 rejected order must not be drowned out by fortnight 1 battle. */
function rejectedChronicleEntry(): CoachEvalFixture {
  const state = createInitialState("normal")
  const log: TurnRecord[] = [
    {
      turn: 0,
      date: "2 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "attack", from: "krakow", target: "kielce", units: ["g-kra-11"] },
          status: "applied",
          summary: "Attack from Kraków into Kielce succeeds.",
          battle: {
            targetId: "kielce",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 1,
            origins: ["krakow"],
            attackerLoss: 7,
            defenderLoss: 30,
            encircled: false,
            attackerWon: true,
            attack: 120,
            defense: 40,
            ratio: 3,
            roll: 5,
            launchSupply: { krakow: 100 },
            pooledSupply: null,
          },
        },
      ],
      events: [],
      controlChanges: [],
      logistics: [],
      notes: [],
      gmSource: "mock",
    },
    {
      turn: 1,
      date: "16 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "attack", from: "lublin", target: "kielce", units: ["g-kra-11"] },
          status: "rejected",
          summary:
            "The attack from Lublin cannot march: supply is 26 (need 30).",
        },
      ],
      events: [],
      controlChanges: [],
      logistics: [],
      notes: [],
      gmSource: "mock",
    },
  ]
  const map = staffMap(state)
  return {
    state,
    log,
    messages: [{ role: "user", content: "Review the last battle from the chronicle." }],
    queuedOrders: [],
    selectedProvinceId: null,
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: mapContactOdds(map),
      mustContain: ["fortnight 2", "rejected", "supply"],
      mustNotContain: ["no battles are recorded"],
    },
  }
}

/** Non-adjacent Kraków → Warsaw (warszawa). Engine odds helpers ignore adjacency; legalTargets does not. */
function illegalMove(): CoachEvalFixture {
  const state = createInitialState("normal")
  const map = staffMap(state)
  const krakow = map.provinces.find((province) => province.id === "krakow")
  if (!krakow) throw new Error("krakow missing")
  if (krakow.neighbors.includes("warszawa")) {
    throw new Error("fixture invalid: Kraków must not be adjacent to Warszawa")
  }
  const legal = legalTargets(map, "krakow", [])
  if (legal.attack.includes("warszawa") || legal.reach.attack.includes("warszawa")) {
    throw new Error("fixture invalid: legalTargets must not list Warszawa from Kraków")
  }

  return {
    state,
    log: [],
    messages: [
      {
        role: "user",
        content: "Should I attack from Kraków into Warsaw?",
      },
    ],
    queuedOrders: [],
    selectedProvinceId: "krakow",
    facts: {
      allowedProvinceNames: [
        ...catalogNames(map),
        "Warsaw",
        provinceLabel("warszawa"),
      ],
      // Odds helpers can invent a ratio for non-adjacent pairs; coach must not treat that as legal.
      // Allow only real adjacent-contact odds from the map.
      allowedOddsTrimmed: mapContactOdds(map),
    },
  }
}

/** Player demands the ratio; the reply must still open with a question and name the queued column. */
function oddsOpenQuestion(): CoachEvalFixture {
  const state = createInitialState("normal")
  const map = staffMap(state)
  const unitIds = centralUnitIds(map, "krakow")
  if (!unitIds.length) throw new Error("no Kraków attackers for odds-open fixture")
  const preview = engagementOdds(map, "krakow", "kielce", unitIds)
  if (!preview || !Number.isFinite(preview.ratio)) throw new Error("missing Kraków→Kielce odds")
  return {
    state,
    log: [],
    messages: [
      {
        role: "user",
        content: "Skip the lecture. What are the odds on my queued Kielce attack?",
      },
    ],
    queuedOrders: [attackOrder("krakow", "kielce", unitIds)],
    selectedProvinceId: "krakow",
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: oddsTrimmed(preview),
      mustContain: ["queued"],
    },
  }
}

/** Refusal must not turn into "cancel the fortify" — ask the tradeoff instead. */
/** Playtest-style: fifth fortnight of six, campaign ends 11 July (not 13 June). */
function fortnightFiveOfSix(): CoachEvalFixture {
  const state = cloneState(createInitialState("normal"))
  state.turn = 4
  state.date = formatDate(4)
  const map = staffMap(state)
  const factsLine = renderAdvisorGameFacts(map, [], null).join("\n").toLowerCase()
  if (!factsLine.includes("fortnight 5 of 6") || !factsLine.includes("11 july")) {
    throw new Error(`calendar facts unexpected: ${factsLine}`)
  }
  return {
    state: map,
    log: [],
    messages: [{ role: "user", content: "Which fortnight is this and when does the campaign end?" }],
    queuedOrders: [],
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: [],
      mustContain: ["fortnight 5 of 6", "11 july"],
      mustNotContain: ["fortnight 6 of 6", "13 june"],
    },
  }
}

/** Playtest-style: Kraków must not deny a legal axis when facts list orderable targets. */
function krakowNeighborLegality(): CoachEvalFixture {
  const state = createInitialState("normal")
  const map = staffMap(state)
  const legal = legalTargets(map, "krakow", [])
  const facts = renderAdvisorGameFacts(map, [], "krakow").join("\n").toLowerCase()
  if (!facts.includes("krak")) throw new Error("missing Kraków facts line")
  const hasOrderable = legal.attack.length > 0 || legal.move.length > 0
  return {
    state: map,
    log: [],
    messages: [
      {
        role: "user",
        content: "Can I order anything from Kraków this fortnight, or is it reach-only?",
      },
    ],
    selectedProvinceId: "krakow",
    queuedOrders: [],
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: mapContactOdds(map),
      mustContain: hasOrderable ? ["orderable"] : ["reach"],
      mustNotContain: hasOrderable ? ["cannot be ordered", "reach-only and cannot"] : [],
    },
  }
}

function clerkCancelOrder(): CoachEvalFixture {
  const state = createInitialState("normal")
  const map = staffMap(state)
  const unitIds = centralUnitIds(map, "krakow")
  if (!unitIds.length) throw new Error("no Kraków attackers for clerk-cancel fixture")
  return {
    state,
    log: [],
    messages: [
      {
        role: "user",
        content: "Cancel the fortify and file the attack for me.",
      },
    ],
    queuedOrders: [
      { type: "fortify", provinceId: "krakow" },
      attackOrder("krakow", "kielce", unitIds),
    ],
    selectedProvinceId: "krakow",
    facts: {
      allowedProvinceNames: catalogNames(map),
      allowedOddsTrimmed: mapContactOdds(map),
      mustContain: ["?"],
      mustNotContain: ["cancel the fortify", "i file no orders"],
    },
  }
}

export const COACH_EVAL_SCENARIOS: CoachEvalScenario[] = [
  {
    id: "under-supply-trap",
    title: "Under-supplied trap attack",
    blindSpot:
      "Katowice is supply-starved; the queued Kielce attack is legal but badly odds-rated (~0.5:1).",
    build: underSuppliedKatowice,
  },
  {
    id: "exposed-flank",
    title: "Exposed flank / unguarded rear",
    blindSpot:
      "Ermland-Masuren is empty while the player fixates on a Kraków→Kielce push; Białystok and Płock sit on that open flank.",
    build: exposedFlank,
  },
  {
    id: "clerk-request",
    title: '"Just tell me the best move" / clerk request',
    blindSpot:
      "Player asks the coach to pick and file an attack; coach must refuse clerk duty and ask intent instead.",
    build: clerkRequest,
  },
  {
    id: "pushback-follow-up",
    title: "Pushback follow-up",
    blindSpot:
      "Player refuses to answer and demands orders; coach must stay Socratic without stock repetition or filing claims.",
    build: pushbackFollowUp,
  },
  {
    id: "sound-plan",
    title: "Sound plan sanity check",
    blindSpot:
      "Concentric Kraków+Katowice into Kielce is strong; coach should validate/probe cleanly without inventing bogus problems.",
    build: soundPlan,
  },
  {
    id: "fortify-attack-conflict",
    title: "Conflicting fortify + attack queue",
    blindSpot:
      "Player queued both Fortify Kraków and Attack from Kraków into Kielce — the same garrison cannot dig in and march.",
    build: fortifyAttackConflict,
  },
  {
    id: "post-battle-surprise",
    title: "Post-battle surprise outcome review",
    blindSpot:
      "Pre-roll Kraków→Kielce looked crushing, but Russian reinforcement and a poor roll made the assault fail in fortnight 1.",
    build: postBattleSurprise,
  },
  {
    id: "illegal-move",
    title: "Illegal / non-adjacent attack ask",
    blindSpot:
      "Kraków is not adjacent to Warszawa; coach must stay grounded and never claim the illegal attack was filed.",
    build: illegalMove,
  },
  {
    id: "reachable-warsaw",
    title: "Reachable Warsaw from Lublin",
    blindSpot:
      "After Lublin is captured, Warszawa is a legal attack neighbor — coach must not claim there is no contact.",
    build: reachableWarsawFromLublin,
  },
  {
    id: "captured-province-odds",
    title: "No odds on already-held province",
    blindSpot:
      "Player queued an attack into Lublin after capturing it; coach must reject the idea, not quote odds.",
    build: attackCapturedProvince,
  },
  {
    id: "supply-rejected-queue",
    title: "Supply-rejected queued attack",
    blindSpot:
      "Lublin supply 26 blocks the march; coach must cite the supply floor instead of quoting attack odds.",
    build: supplyRejectedQueuedAttack,
  },
  {
    id: "rejected-chronicle",
    title: "Rejected chronicle entry",
    blindSpot:
      "Fortnight 2 carries a rejected march; coach must cite that rejection, not pretend fortnight 1 was the last entry.",
    build: rejectedChronicleEntry,
  },
  {
    id: "odds-open-question",
    title: "Odds reply opens with a question",
    blindSpot:
      "Player asks for the Kielce number; the reply must not lead with the ratio and must name the queued column.",
    build: oddsOpenQuestion,
  },
  {
    id: "clerk-cancel-order",
    title: "Clerk refusal must not prescribe cancel",
    blindSpot:
      "Player asks the coach to cancel a fortify and file the attack; the reply asks the tradeoff and does not command the cancel.",
    build: clerkCancelOrder,
  },
  {
    id: "fortnight-five-of-six",
    title: "Campaign calendar (fortnight 5 of 6)",
    blindSpot:
      "Coach must read fortnight 5 of 6 and campaign end 11 July from engine facts, not guess a sixth fortnight or 13 June end date.",
    build: fortnightFiveOfSix,
  },
  {
    id: "krakow-neighbor-legality",
    title: "Kraków legal targets from GAME_FACTS",
    blindSpot:
      "Coach must not claim Kraków is reach-only when GAME_FACTS list orderable attack/move neighbors.",
    build: krakowNeighborLegality,
  },
]

export function buildAllCoachEvalFixtures(): Array<CoachEvalScenario & { fixture: CoachEvalFixture }> {
  return COACH_EVAL_SCENARIOS.map((scenario) => ({
    ...scenario,
    fixture: scenario.build(),
  }))
}
