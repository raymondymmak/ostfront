import { combinedEngagementOdds, findProvince } from "@/lib/engine/turn"
import { queuedToPlayerOrders, type QueuedOrder } from "@/lib/orders"
import type { GameState, PlayerOrder } from "@/lib/types"

export type AttackProng = { fromId: string; unitIds: string[]; targetId: string }

export type PlanAnalysis = {
  attackProngs: AttackProng[]
  targets: string[]
  convergingOnTarget: string | null
  originCountForTarget: number
  singleProngOnTarget: boolean
  loneProngFrom: string | null
  combinedPreview: ReturnType<typeof combinedEngagementOdds>
  bestSinglePreview: ReturnType<typeof combinedEngagementOdds>
  engineLines: string[]
}

export function analyzeOrders(state: GameState, orders: PlayerOrder[]): PlanAnalysis {
  const attackProngs: AttackProng[] = []
  for (const order of orders) {
    if (order.type !== "attack") continue
    attackProngs.push({
      fromId: order.from,
      unitIds: order.unitIds,
      targetId: order.target,
    })
  }
  const targets = [...new Set(attackProngs.map((p) => p.targetId))].sort()
  const byTarget = new Map<string, AttackProng[]>()
  for (const prong of attackProngs) {
    const list = byTarget.get(prong.targetId) ?? []
    list.push(prong)
    byTarget.set(prong.targetId, list)
  }

  let convergingOnTarget: string | null = null
  let originCountForTarget = 0
  for (const [targetId, prongs] of byTarget) {
    const origins = new Set(prongs.map((p) => p.fromId))
    if (origins.size >= 2) {
      convergingOnTarget = targetId
      originCountForTarget = origins.size
      break
    }
  }

  const focusTarget = convergingOnTarget ?? targets[0] ?? null
  const focusProngs = focusTarget ? (byTarget.get(focusTarget) ?? []) : []
  const combinedPreview =
    focusTarget && focusProngs.length >= 2
      ? combinedEngagementOdds(
          state,
          focusTarget,
          focusProngs.map((p) => ({ fromId: p.fromId, unitIds: p.unitIds })),
        )
      : null

  let bestSinglePreview: ReturnType<typeof combinedEngagementOdds> = null
  let loneProngFrom: string | null = null
  if (focusTarget && focusProngs.length) {
    for (const prong of focusProngs) {
      const preview = combinedEngagementOdds(state, focusTarget, [
        { fromId: prong.fromId, unitIds: prong.unitIds },
      ])
      if (preview && (!bestSinglePreview || preview.ratio > bestSinglePreview.ratio)) {
        bestSinglePreview = preview
        loneProngFrom = prong.fromId
      }
    }
  }

  const engineLines: string[] = []
  if (combinedPreview && focusTarget) {
    const targetName = findProvince(state, focusTarget)?.name ?? focusTarget
    engineLines.push(
      `Engine pooled odds on ${targetName}: ×${combinedPreview.multiplier.toFixed(2)} from ${combinedPreview.origins} directions, ratio ${combinedPreview.ratio.toFixed(2)} before the die.`,
    )
  }
  if (bestSinglePreview && loneProngFrom) {
    engineLines.push(
      `Strongest single prong (${loneProngFrom}) preview ratio ${bestSinglePreview.ratio.toFixed(2)} before the die.`,
    )
  }

  return {
    attackProngs,
    targets,
    convergingOnTarget,
    originCountForTarget,
    singleProngOnTarget: Boolean(focusTarget && focusProngs.length === 1),
    loneProngFrom,
    combinedPreview,
    bestSinglePreview,
    engineLines,
  }
}

export function planFromQueue(state: GameState, queue: QueuedOrder[]): PlanAnalysis {
  return analyzeOrders(state, queuedToPlayerOrders(queue))
}
