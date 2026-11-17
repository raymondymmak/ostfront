import { independentFormations, partyOf } from "@/lib/engine/echelon"
import { findProvince } from "@/lib/engine/turn"
import { leaveDepotGarrison, type QueuedOrder } from "@/lib/orders"
import type { GameState } from "@/lib/types"
import type { LegalTargets } from "@/lib/ui/types"

/**
 * UI-side march / attack legality for map highlights and order hints.
 * Mirrors validateMove / validateAttack in lib/engine/simultaneous.ts without
 * duplicating combat math.
 */
export function legalTargets(state: GameState, provinceId: string, queue: QueuedOrder[]): LegalTargets {
  const empty: LegalTargets = { from: provinceId, move: [], attack: [], blocked: [], depotWarn: [] }
  const from = findProvince(state, provinceId)
  if (!from) return empty
  if (from.controller !== "central") {
    return {
      ...empty,
      blocked: from.neighbors.map((id) => ({
        id,
        reason: "Stavka does not take your arrows. Start in a Central Powers province.",
      })),
    }
  }

  const claimed = new Set(queue.flatMap((order) => (order.kind === "fortify" ? [] : order.unitIds)))
  const available = independentFormations(
    from.units.filter((unit) => unit.faction === "central" && !claimed.has(unit.id)),
  )
  if (!available.length) {
    return {
      ...empty,
      blocked: from.neighbors.map((id) => ({
        id,
        reason: `${from.name} has no unassigned formation.`,
      })),
    }
  }

  const move: string[] = []
  const attack: string[] = []
  const blocked: LegalTargets["blocked"] = []
  const depotWarn: LegalTargets["depotWarn"] = []

  for (const toId of from.neighbors) {
    const to = findProvince(state, toId)
    if (!to) continue
    if (!from.neighbors.includes(toId)) {
      blocked.push({
        id: toId,
        reason: `${from.name} and ${to.name} do not share a border. The engine will reject the order so you can see why.`,
      })
      continue
    }
    if (from.supply < 30) {
      blocked.push({
        id: toId,
        reason: `${from.name} is below supply 30. The engine will refuse the advance.`,
      })
      continue
    }
    if (to.controller === "central") {
      move.push(toId)
    } else {
      attack.push(toId)
    }

    const chosen = leaveDepotGarrison(available, from.depot === "central", false)
    const departing = new Set(partyOf(from.units, chosen.map((unit) => unit.id)).map((unit) => unit.id))
    const remaining = independentFormations(
      from.units.filter((unit) => unit.faction === "central" && !departing.has(unit.id) && !claimed.has(unit.id)),
    )
    if (from.depot === "central" && remaining.length === 0 && (move.includes(toId) || attack.includes(toId))) {
      depotWarn.push({
        id: toId,
        reason: `This arrow empties the ${from.name} depot. Leave a garrison unless you mean to abandon it.`,
      })
    }
  }

  return { from: provinceId, move, attack, blocked, depotWarn }
}

export function legalTargetHoverNote(targets: LegalTargets, provinceId: string): string | null {
  const blocked = targets.blocked.find((item) => item.id === provinceId)
  if (blocked) return blocked.reason
  const warn = targets.depotWarn.find((item) => item.id === provinceId)
  return warn?.reason ?? null
}