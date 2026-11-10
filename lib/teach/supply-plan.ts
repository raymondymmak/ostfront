import { combinedEngagementOdds, findProvince } from "@/lib/engine/turn"
import { garrisonStrengthInProvince, provinceSupplyCapacity } from "@/lib/engine/supply"
import type { LessonMeta } from "@/lib/teach/lessons"
import type { GameState, PlayerOrder } from "@/lib/types"

export type SupplyPlanAnalysis = {
  heavyFromId: string
  fedFromId: string
  targetProvinceId: string
  heavyPreview: NonNullable<ReturnType<typeof combinedEngagementOdds>>
  fedPreview: NonNullable<ReturnType<typeof combinedEngagementOdds>>
  combinedPreview: ReturnType<typeof combinedEngagementOdds>
  allInConvergence: boolean
  chosenFrom: string | null
  engineLines: string[]
}

export function analyzeSupplyLesson(
  state: GameState,
  meta: LessonMeta,
  orders: PlayerOrder[],
): SupplyPlanAnalysis {
  const [heavyFromId, fedFromId] = meta.prongProvinceIds
  const attacks = orders.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> =>
      order.type === "attack" && order.target === meta.targetProvinceId,
  )
  const origins = new Set(attacks.map((order) => order.from))
  const allInConvergence = origins.has(heavyFromId) && origins.has(fedFromId)
  const attack = attacks[0] ?? null

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
  const combinedPreview = allInConvergence
    ? combinedEngagementOdds(state, meta.targetProvinceId, [
        { fromId: heavyFromId, unitIds: [heavyUnit] },
        { fromId: fedFromId, unitIds: [fedUnit] },
      ])
    : null

  if (!heavyPreview || !fedPreview) {
    throw new Error("Supply lesson previews could not be computed on the server board.")
  }

  const heavyName = heavyProvince.name
  const fedName = fedProvince.name
  const heavyCap = provinceSupplyCapacity(heavyProvince)
  const heavyStr = garrisonStrengthInProvince(heavyProvince)

  const engineLines = [
    `Engine attack from ${heavyName} (supply ${heavyProvince.supply}, capacity ${heavyCap}, garrison ${heavyStr}): attack ${heavyPreview.attack.toFixed(1)} vs defence ${heavyPreview.defense.toFixed(1)}, ratio ${heavyPreview.ratio.toFixed(2)} before the die.`,
    `Engine attack from ${fedName} (supply ${fedProvince.supply}): attack ${fedPreview.attack.toFixed(1)} vs defence ${fedPreview.defense.toFixed(1)}, ratio ${fedPreview.ratio.toFixed(2)} before the die.`,
    `Stronger single-prong preview: ${fedPreview.ratio >= heavyPreview.ratio ? fedName : heavyName} (${Math.max(fedPreview.ratio, heavyPreview.ratio).toFixed(2)} vs ${Math.min(fedPreview.ratio, heavyPreview.ratio).toFixed(2)}).`,
  ]
  if (combinedPreview) {
    engineLines.push(
      `All-in convergence (starved prong): pooled attack ${combinedPreview.attack.toFixed(1)} vs defence ${combinedPreview.defense.toFixed(1)}, ratio ${combinedPreview.ratio.toFixed(2)} before the die — worst launch supply with objective choke; no flank bonus (×${combinedPreview.multiplier.toFixed(2)}).`,
    )
  }

  return {
    heavyFromId,
    fedFromId,
    targetProvinceId: meta.targetProvinceId,
    heavyPreview,
    fedPreview,
    combinedPreview,
    allInConvergence,
    chosenFrom: attack?.from ?? null,
    engineLines,
  }
}
