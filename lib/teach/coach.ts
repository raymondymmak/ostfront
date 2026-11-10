import { combinedEngagementOdds } from "@/lib/engine/turn"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import type { GameState } from "@/lib/types"
import type { LessonMeta, TeachVariant } from "@/lib/teach/lessons"

export type CoachHighlight = {
  provinceId?: string
  uiId?: string
  label: string
}

export type CoachHint = {
  level: number
  text: string
  highlights: CoachHighlight[]
}

export function coachHints(
  meta: LessonMeta,
  state: GameState,
  variant: TeachVariant,
): CoachHint[] {
  if (variant === "silent") return []
  if (meta.lessonType === "supply") {
    return coachSupplyHints(meta, state)
  }

  const target = meta.targetProvinceId
  const previews = meta.prongProvinceIds.map((fromId) =>
    combinedEngagementOdds(state, target, [{ fromId, unitIds: teachUnitsFrom(state, fromId) }]),
  )
  const combined = combinedEngagementOdds(
    state,
    target,
    meta.prongProvinceIds.map((fromId) => ({ fromId, unitIds: teachUnitsFrom(state, fromId) })),
  )
  const targetName = CATALOG_BY_ID[target]?.name ?? target

  const hints: CoachHint[] = [
    {
      level: 1,
      text: `Select ${targetName} on the map and read the defender strength in the Province tab.`,
      highlights: [{ provinceId: target, uiId: "tab-province", label: targetName }],
    },
    {
      level: 2,
      text: `Queue an attack from each friendly prong (${meta.prongProvinceIds.map((id) => CATALOG_BY_ID[id]?.name ?? id).join(" and ")}) into the same target. Watch the Orders tab for a pooled odds line.`,
      highlights: [
        ...meta.prongProvinceIds.map((id) => ({ provinceId: id, label: CATALOG_BY_ID[id]?.name ?? id })),
        { uiId: "tab-orders", label: "Orders" },
      ],
    },
  ]

  if (combined && previews.every(Boolean)) {
    const single = Math.max(...previews.map((p) => p!.ratio))
    hints.push({
      level: 3,
      text: `Engine preview: one prong peaks around ${single.toFixed(2)} before the die; combined from ${combined.origins} directions is ${combined.ratio.toFixed(2)} with a ×${combined.multiplier.toFixed(2)} flank bonus. Same fortnight, same target — one battle.`,
      highlights: [
        { provinceId: target, label: targetName },
        { uiId: "attack-odds", label: "Attack odds" },
      ],
    })
  }

  return hints
}

function coachSupplyHints(meta: LessonMeta, state: GameState): CoachHint[] {
  const [heavyId, fedId] = meta.prongProvinceIds
  const target = meta.targetProvinceId
  const heavyUnits = teachUnitsFrom(state, heavyId)
  const fedUnits = teachUnitsFrom(state, fedId)
  const heavyPreview = combinedEngagementOdds(state, target, [{ fromId: heavyId, unitIds: heavyUnits }])
  const fedPreview = combinedEngagementOdds(state, target, [{ fromId: fedId, unitIds: fedUnits }])
  const heavyProvince = state.provinces.find((p) => p.id === heavyId)!
  const fedProvince = state.provinces.find((p) => p.id === fedId)!
  const targetName = CATALOG_BY_ID[target]?.name ?? target

  return [
    {
      level: 1,
      text: `Turn on Supply on the map. Compare ${heavyProvince.name} (${heavyProvince.supply}) with ${fedProvince.name} (${fedProvince.supply}). Formations need supply ≥ 30 to march.`,
      highlights: [
        { provinceId: heavyId, uiId: "map-mode-supply", label: heavyProvince.name },
        { provinceId: fedId, uiId: "map-mode-supply", label: fedProvince.name },
      ],
    },
    {
      level: 2,
      text: `Queue one attack on ${targetName}. Read the engine preview attack/defence values in Orders — never trust headcount alone.`,
      highlights: [
        { provinceId: target, uiId: "tab-province", label: targetName },
        { uiId: "tab-orders", label: "Orders" },
      ],
    },
    {
      level: 3,
      text:
        heavyPreview && fedPreview
          ? `Engine preview before the die: ${heavyProvince.name} attack ${heavyPreview.attack.toFixed(1)} (ratio ${heavyPreview.ratio.toFixed(2)}) vs ${fedProvince.name} attack ${fedPreview.attack.toFixed(1)} (ratio ${fedPreview.ratio.toFixed(2)}). Attacker supply factor is max(0.15, supply÷100).`
          : `Check attack odds in Orders after queuing from either launch province.`,
      highlights: [
        { uiId: "attack-odds", label: "Attack odds" },
        { uiId: "map-mode-supply", label: "Supply overlay" },
      ],
    },
  ]
}

function teachUnitsFrom(state: GameState, provinceId: string): string[] {
  const province = state.provinces.find((p) => p.id === provinceId)
  if (!province) return []
  return province.units.filter((u) => u.faction === "central").map((u) => u.id)
}

export function coachPrompt(meta: LessonMeta): { question: string; intro: string } {
  return {
    question: meta.question,
    intro:
      meta.variant === "guided"
        ? "This is a short teaching drill. Answer on the map with queued orders, then add a sentence of reasoning before you resolve."
        : "Silent variation: plan and resolve without coach hints.",
  }
}
