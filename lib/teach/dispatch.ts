import { CATALOG_BY_ID } from "@/lib/data/catalog"
import type { LessonMeta } from "@/lib/teach/lessons"
import type { PlanAnalysis } from "@/lib/teach/plan"
import type { GameState, PlayerOrder } from "@/lib/types"

export type LessonDispatch = {
  lessonId: string
  variant: string
  targetProvinceId: string
  targetName: string
  planSummary: string
  engineFacts: string[]
  queuedAttacks: Array<{ from: string; fromName: string; target: string; units: string[] }>
  pooled: {
    origins: number
    multiplier: number
    ratioBeforeDie: number | null
  } | null
  pedagogicalCombatRoll: number | null
}

export function buildLessonDispatch(
  state: GameState,
  meta: LessonMeta,
  plan: PlanAnalysis,
  orders: PlayerOrder[],
  combatRoll: number | null,
): LessonDispatch {
  const targetName = CATALOG_BY_ID[meta.targetProvinceId]?.name ?? meta.targetProvinceId
  const queuedAttacks = orders
    .filter((order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack")
    .map((order) => ({
      from: order.from,
      fromName: CATALOG_BY_ID[order.from]?.name ?? order.from,
      target: order.target,
      units: order.unitIds,
    }))

  const pooled = plan.combinedPreview
    ? {
        origins: plan.combinedPreview.origins,
        multiplier: plan.combinedPreview.multiplier,
        ratioBeforeDie: plan.combinedPreview.ratio,
      }
    : null

  const planSummary = describePlan(plan, meta)
  const engineFacts = [...plan.engineLines]
  if (pooled) {
    engineFacts.push(
      `Pooled preview on ${targetName}: ${pooled.origins} directions, ×${pooled.multiplier.toFixed(2)}, ratio ${pooled.ratioBeforeDie!.toFixed(2)} before the die.`,
    )
  }

  return {
    lessonId: meta.lessonId,
    variant: meta.variant,
    targetProvinceId: meta.targetProvinceId,
    targetName,
    planSummary,
    engineFacts,
    queuedAttacks,
    pooled,
    pedagogicalCombatRoll: combatRoll,
  }
}

function describePlan(plan: PlanAnalysis, meta: LessonMeta): string {
  if (!plan.attackProngs.length) return "No attack orders queued."
  if (plan.convergingOnTarget === meta.targetProvinceId) {
    const origins = [...new Set(plan.attackProngs.map((p) => p.fromId))]
    return `Converging: ${origins.length} provinces attack ${meta.targetProvinceId} this fortnight (one merged battle if legal).`
  }
  if (plan.singleProngOnTarget) {
    return `Single prong on ${meta.targetProvinceId}.`
  }
  return `Attacks queued but not converging on ${meta.targetProvinceId}.`
}

export function dispatchForLlm(dispatch: LessonDispatch): string {
  return JSON.stringify(dispatch, null, 2)
}
