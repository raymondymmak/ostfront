import { createInitialState } from "@/lib/data/scenario"
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
]

export function buildAllCoachEvalFixtures(): Array<CoachEvalScenario & { fixture: CoachEvalFixture }> {
  return COACH_EVAL_SCENARIOS.map((scenario) => ({
    ...scenario,
    fixture: scenario.build(),
  }))
}
