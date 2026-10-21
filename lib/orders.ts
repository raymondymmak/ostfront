import type { PlayerOrder, UnitKind } from "@/lib/types"

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

export type QueuedOrder = {
  id: string
  kind: "move" | "attack" | "fortify" | "recruit" | "cancelRecruit"
  from: string
  to?: string
  unitIds: string[]
  unitKind?: UnitKind
  buildId?: string
}
