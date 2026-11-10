import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { applySupply, createInitialState } from "@/lib/data/scenario"
import { findProvince } from "@/lib/engine/turn"
import type { GameState, PlayerOrder, Unit } from "@/lib/types"

export const CONVERGING_LUBLIN_ID = "converging-lublin" as const
export const SUPPLY_TRADEOFF_ID = "supply-tradeoff" as const

export type TeachLessonId = typeof CONVERGING_LUBLIN_ID | typeof SUPPLY_TRADEOFF_ID

export type TeachLessonType = "convergence" | "supply"

export const TEACH_LESSON_IDS = [CONVERGING_LUBLIN_ID, SUPPLY_TRADEOFF_ID] as const

export type TeachVariant = "guided" | "silent"

/** Combat dice for the guided resolution (roll 1 → unfavourable variance). */
export const TEACH_GUIDED_COMBAT_ROLL = 1
/** Combat dice for the silent resolution (roll 4 → middling variance). */
export const TEACH_SILENT_COMBAT_ROLL = 4

const LESSON_TARGET = "lublin"

function unit(partial: Unit): Unit {
  return {
    echelon: "army",
    maxStrength: partial.strength,
    ...partial,
  }
}

/**
 * Server-owned lesson boards. The client displays a copy from GET /api/teach/session;
 * POST /api/teach/resolve never trusts a client-supplied GameState.
 */
export function authoritativeLessonState(
  lessonId: TeachLessonId,
  variant: TeachVariant,
): GameState {
  if (lessonId === SUPPLY_TRADEOFF_ID) {
    return authoritativeSupplyLessonState(variant)
  }
  if (lessonId !== CONVERGING_LUBLIN_ID) {
    throw new Error(`Unknown teaching lesson: ${lessonId}`)
  }
  const state = createInitialState("easy")
  state.turn = 0
  state.date = "2 May 1915"
  state.seed = variant === "guided" ? 19150502 : 19150503

  for (const province of state.provinces) {
    if (province.depot === "central" && province.id !== "krakow") {
      province.units = province.units.filter((u) => u.faction !== "central" || u.kind === "artillery")
    }
    if (province.depot === "russia") {
      province.units = []
    }
  }

  const krakow = findProvince(state, "krakow")!
  krakow.units = [
    unit({
      id: "teach-11",
      name: "11th Army (Mackensen)",
      faction: "central",
      kind: "infantry",
      strength: 40,
      morale: 80,
    }),
    unit({
      id: "teach-art",
      name: "Heavy Artillery",
      faction: "central",
      kind: "artillery",
      strength: 12,
      morale: 82,
    }),
  ]

  const kielce = findProvince(state, "kielce")!
  kielce.controller = "central"
  kielce.owner = "central"
  kielce.depot = "central"
  kielce.units = [
    unit({
      id: "teach-kie",
      name: "X Corps",
      faction: "central",
      kind: "infantry",
      strength: 38,
      morale: 76,
    }),
  ]

  const katowice = findProvince(state, "katowice")!
  katowice.units = [
    unit({
      id: "teach-kat",
      name: "Silesian Corps",
      faction: "central",
      kind: "infantry",
      strength: 36,
      morale: 74,
    }),
  ]

  const lublin = findProvince(state, "lublin")!
  lublin.fort = variant === "guided" ? 2 : lublin.fort
  lublin.units = [
    unit({
      id: "teach-xxiv",
      name: "XXIV Corps",
      faction: "russia",
      kind: "infantry",
      strength: variant === "guided" ? 82 : 68,
      morale: 66,
    }),
  ]

  applySupply(state)
  return state
}

/** Supply lesson: Heavy Corps on Katowice (lower supply) vs lean column from Kraków depot rail. */
function authoritativeSupplyLessonState(variant: TeachVariant): GameState {
  const state = createInitialState("easy")
  state.turn = 0
  state.date = "2 May 1915"
  state.seed = variant === "guided" ? 19150510 : 19150511

  for (const province of state.provinces) {
    if (province.id === "krakow" || province.id === "katowice") continue
    if (province.depot === "central") {
      province.units = province.units.filter((u) => u.faction !== "central" || u.kind === "artillery")
    }
    if (province.controller === "russia" || province.owner === "russia") {
      if (province.id !== "kielce") province.units = []
    }
  }

  const krakow = findProvince(state, "krakow")!
  krakow.units = [
    unit({
      id: "teach-fed",
      name: "Fed Corps",
      faction: "central",
      kind: "infantry",
      strength: 36,
      morale: 78,
    }),
  ]

  const katowice = findProvince(state, "katowice")!
  katowice.supplyModifier = -45
  katowice.units = [
    unit({
      id: "teach-heavy",
      name: "Heavy Corps",
      faction: "central",
      kind: "infantry",
      strength: 72,
      morale: 76,
    }),
  ]

  const kielce = findProvince(state, "kielce")!
  kielce.units = [
    unit({
      id: "teach-def",
      name: "Russian IX",
      faction: "russia",
      kind: "infantry",
      strength: variant === "guided" ? 32 : 34,
      morale: 68,
    }),
  ]

  applySupply(state)
  return state
}

export type LessonMeta = {
  lessonId: TeachLessonId
  lessonType: TeachLessonType
  variant: TeachVariant
  targetProvinceId: string
  targetName: string
  prongProvinceIds: string[]
  title: string
  question: string
}

export function lessonMeta(lessonId: TeachLessonId, variant: TeachVariant): LessonMeta {
  if (lessonId === SUPPLY_TRADEOFF_ID) {
    const target = "kielce"
    const targetName = CATALOG_BY_ID[target]?.name ?? target
    const heavy = "katowice"
    const fed = "krakow"
    const heavyName = CATALOG_BY_ID[heavy]?.name ?? heavy
    const fedName = CATALOG_BY_ID[fed]?.name ?? fed
    return {
      lessonId,
      lessonType: "supply",
      variant,
      targetProvinceId: target,
      targetName,
      prongProvinceIds: [heavy, fed],
      title: "Supply vs headcount",
      question:
        variant === "guided"
          ? `${targetName} is held by Russian IX. You may strike once from ${heavyName} (Heavy Corps) or from ${fedName} (Fed Corps). Toggle Supply on the map. Which launch gives the stronger attack in the engine preview — and why?`
          : `Same trade-off without coach hints: choose one assault on ${targetName}, predict the outcome, and explain whether headcount or supply drives attack power.`,
    }
  }
  if (lessonId !== CONVERGING_LUBLIN_ID) {
    throw new Error(`Unknown teaching lesson: ${lessonId}`)
  }
  const targetName = CATALOG_BY_ID[LESSON_TARGET]?.name ?? LESSON_TARGET
  const prongs = ["krakow", "kielce"] as const
  return {
    lessonId,
    lessonType: "convergence",
    variant,
    targetProvinceId: LESSON_TARGET,
    targetName,
    prongProvinceIds: [...prongs],
    title: "Converging attacks on Lublin",
    question:
      variant === "guided"
        ? `${targetName} holds XXIV Corps. You have usable strength at Kraków and at Kielce (recently taken). How would you strike ${targetName} this fortnight, and what rule makes a two-direction attack different from two separate blows?`
        : `The board is similar to your last drill, but the defender strength differs. Plan an assault on ${targetName} from Kraków and Kielce without coach help, and state why.`,
  }
}

export type TeachSessionRecord = {
  lessonId: TeachLessonId
  variant: TeachVariant
  reasoning: string
  selectedProvinceIds: string[]
  orders: PlayerOrder[]
  planSummary: string
  outcomeSummary: string
  feedbackKind: string
  recordedAt: string
}
