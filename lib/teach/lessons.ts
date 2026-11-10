import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { applySupply, createInitialState } from "@/lib/data/scenario"
import { findProvince } from "@/lib/engine/turn"
import type { GameState, PlayerOrder, Unit } from "@/lib/types"

export const CONVERGING_LUBLIN_ID = "converging-lublin" as const

export type TeachLessonId = typeof CONVERGING_LUBLIN_ID

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

export type LessonMeta = {
  lessonId: TeachLessonId
  variant: TeachVariant
  targetProvinceId: string
  targetName: string
  prongProvinceIds: string[]
  title: string
  question: string
}

export function lessonMeta(lessonId: TeachLessonId, variant: TeachVariant): LessonMeta {
  if (lessonId !== CONVERGING_LUBLIN_ID) {
    throw new Error(`Unknown teaching lesson: ${lessonId}`)
  }
  const targetName = CATALOG_BY_ID[LESSON_TARGET]?.name ?? LESSON_TARGET
  const prongs =
    variant === "guided" ? (["krakow", "kielce"] as const) : (["katowice", "kielce"] as const)
  return {
    lessonId,
    variant,
    targetProvinceId: LESSON_TARGET,
    targetName,
    prongProvinceIds: [...prongs],
    title: "Converging attacks on Lublin",
    question:
      variant === "guided"
        ? `${targetName} holds XXIV Corps. You have usable strength at Kraków and at Kielce (recently taken). How would you strike ${targetName} this fortnight, and what rule makes a two-direction attack different from two separate blows?`
        : `The situation resembles your last drill, but the map is not identical: use Katowice and Kielce against ${targetName}. State your plan and reasoning; no coach will interrupt.`,
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
