import { combinedEngagementOdds, findProvince, type EngagementPreview } from "@/lib/engine/turn"
import type { GameState, PlayerOrder, UnitKind } from "@/lib/types"

export function leaveDepotGarrison<T extends { id: string; strength: number }>(
  available: T[],
  depot: boolean,
  commitAll: boolean,
): T[] {
  if (!commitAll && depot && available.length > 1) {
    return [...available]
      .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
      .slice(0, -1)
  }
  return available
}

/** The same shape the turn route receives. Text directives are not queued arrows. */
export function queuedToPlayerOrders(queue: QueuedOrder[]): PlayerOrder[] {
  const orders: PlayerOrder[] = []
  for (const order of queue) {
    if (order.kind === "fortify") {
      orders.push({ type: "fortify", provinceId: order.from })
    } else if (order.kind === "recruit" && order.unitKind) {
      orders.push({ type: "recruit", provinceId: order.from, unitKind: order.unitKind })
    } else if (order.kind === "cancelRecruit" && order.buildId) {
      orders.push({ type: "cancelRecruit", buildId: order.buildId })
    } else if (order.kind === "move" && order.to) {
      for (const unitId of order.unitIds) orders.push({ type: "move", unitId, to: order.to })
    } else if (order.kind === "attack" && order.to) {
      orders.push({ type: "attack", from: order.from, target: order.to, unitIds: order.unitIds })
    }
  }
  return orders
}

export type CombinedQueueLine = {
  targetId: string
  targetName: string
  fromNames: string[]
  preview: EngagementPreview
}

/** One line per target that already has two or more queued attacks. */
export function combinedQueueLines(state: GameState, queue: QueuedOrder[]): CombinedQueueLine[] {
  const groups = new Map<string, QueuedOrder[]>()
  for (const order of queue) {
    if (order.kind !== "attack" || !order.to || !order.unitIds.length) continue
    const list = groups.get(order.to) ?? []
    list.push(order)
    groups.set(order.to, list)
  }
  const lines: CombinedQueueLine[] = []
  for (const [targetId, mates] of groups) {
    if (mates.length < 2) continue
    const preview = combinedEngagementOdds(
      state,
      targetId,
      mates.map((order) => ({ fromId: order.from, unitIds: order.unitIds })),
    )
    const target = findProvince(state, targetId)
    if (!preview || !target) continue
    const fromNames = mates.map((order) => findProvince(state, order.from)?.name ?? order.from)
    fromNames.sort((a, b) => a.localeCompare(b))
    lines.push({ targetId, targetName: target.name, fromNames, preview })
  }
  lines.sort((a, b) => a.targetName.localeCompare(b.targetName))
  return lines
}

export type QueuedOrder = {
  id: string
  kind: "move" | "attack" | "fortify" | "recruit" | "cancelRecruit"
  from: string
  to?: string
  unitIds: string[]
  unitKind?: UnitKind
  buildId?: string
}
