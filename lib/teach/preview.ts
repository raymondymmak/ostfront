import { independentFormations } from "@/lib/engine/echelon"
import { combinedEngagementOdds, type EngagementPreview } from "@/lib/engine/turn"
import { leaveDepotGarrison } from "@/lib/orders"
import type { GameState } from "@/lib/types"

/** Unit ids for a default teaching attack arrow — same rule as the map queue (`leaveDepotGarrison`). */
export function teachDefaultAttackUnitIds(state: GameState, fromId: string): string[] {
  const from = state.provinces.find((province) => province.id === fromId)
  if (!from) return []
  const available = independentFormations(from.units.filter((unit) => unit.faction === "central"))
  return leaveDepotGarrison(available, from.depot === "central", false).map((unit) => unit.id)
}

function teachProng(
  state: GameState,
  fromId: string,
): { fromId: string; unitIds: string[] } | null {
  const unitIds = teachDefaultAttackUnitIds(state, fromId)
  return unitIds.length ? { fromId, unitIds } : null
}

/** Engine preview for one or more teaching prongs — matches Orders tab odds before queueing. */
export function lessonEngagementPreview(
  state: GameState,
  targetId: string,
  fromIds: string[],
): EngagementPreview | null {
  const prongs = fromIds.map((fromId) => teachProng(state, fromId)).filter(Boolean) as {
    fromId: string
    unitIds: string[]
  }[]
  if (!prongs.length) return null
  return combinedEngagementOdds(state, targetId, prongs)
}

export function lessonSingleProngPreviews(
  state: GameState,
  targetId: string,
  fromIds: string[],
): Array<EngagementPreview | null> {
  return fromIds.map((fromId) => {
    const prong = teachProng(state, fromId)
    return prong ? combinedEngagementOdds(state, targetId, [prong]) : null
  })
}
