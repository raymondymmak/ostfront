import { combinedEngagementOdds, findProvince } from "@/lib/engine/turn"
import type { LessonMeta } from "@/lib/teach/lessons"
import type { GameState, PlayerOrder } from "@/lib/types"

export type SupplyPlanAnalysis = {
  heavyFromId: string
  fedFromId: string
  targetProvinceId: string
  heavyPreview: NonNullable<ReturnType<typeof combinedEngagementOdds>>
  fedPreview: NonNullable<ReturnType<typeof combinedEngagementOdds>>
  chosenFrom: string | null
  engineLines: string[]
}

export function analyzeSupplyLesson(
  state: GameState,
  meta: LessonMeta,
  orders: PlayerOrder[],
): SupplyPlanAnalysis {
  const [heavyFromId, fedFromId] = meta.prongProvinceIds
  const attack = orders.find((order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack")
  const heavyProvince = findProvince(state, heavyFromId)!
  const fedProvince = findProvince(state, fedFromId)!
  const heavyUnit = heavyProvince.units.find((u) => u.faction === "central")!.id
  const fedUnit = fedProvince.units.find((u) => u.faction === "central")!.id

  const heavyPreview = combinedEngagementOdds(state, meta.targetProvinceId, [
    { fromId: heavyFromId, unitIds: [heavyUnit] },
  ])
  const fedPreview = combinedEngagementOdds(state, meta.targetProvinceId, [
    { fromId: fedFromId, unitIds: [fedUnit] },
  ])

  if (!heavyPreview || !fedPreview) {
    throw new Error("Supply lesson previews could not be computed on the server board.")
  }

  const heavyName = heavyProvince.name
  const fedName = fedProvince.name
  const engineLines = [
    `Engine attack from ${heavyName} (supply ${heavyProvince.supply}): attack ${heavyPreview.attack.toFixed(1)} vs defence ${heavyPreview.defense.toFixed(1)}, ratio ${heavyPreview.ratio.toFixed(2)} before the die.`,
    `Engine attack from ${fedName} (supply ${fedProvince.supply}): attack ${fedPreview.attack.toFixed(1)} vs defence ${fedPreview.defense.toFixed(1)}, ratio ${fedPreview.ratio.toFixed(2)} before the die.`,
    `Stronger preview before the die: ${fedPreview.ratio >= heavyPreview.ratio ? fedName : heavyName} (${Math.max(fedPreview.ratio, heavyPreview.ratio).toFixed(2)} vs ${Math.min(fedPreview.ratio, heavyPreview.ratio).toFixed(2)}).`,
  ]

  return {
    heavyFromId,
    fedFromId,
    targetProvinceId: meta.targetProvinceId,
    heavyPreview,
    fedPreview,
    chosenFrom: attack?.from ?? null,
    engineLines,
  }
}
