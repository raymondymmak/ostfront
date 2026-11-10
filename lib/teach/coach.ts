import { combinedEngagementOdds } from "@/lib/engine/turn"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import type { GameState } from "@/lib/types"
import type { LessonMeta, TeachVariant } from "@/lib/teach/lessons"
import type { PlanAnalysis } from "@/lib/teach/plan"

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

export function coachRespondToReasoning(
  meta: LessonMeta,
  plan: PlanAnalysis,
  variant: TeachVariant,
): string | null {
  if (variant === "silent") return null
  if (!plan.attackProngs.length) {
    return "When you are ready, queue attacks on the map. Mention whether you intend one battle or two."
  }
  if (plan.convergingOnTarget === meta.targetProvinceId) {
    return "You have two prongs on the same target. Close the fortnight when satisfied; the resolver will show whether they merged."
  }
  return "Check whether both provinces point at the same objective this fortnight."
}
