import { findProvince } from "@/lib/engine/turn"
import type { AdvisorOrder } from "@/lib/gm/advisor-types"
import { advisorDrafts, type QueuedOrder } from "@/lib/orders"
import type { GameState } from "@/lib/types"

/** Structured queue row for demo-check (kind, provinces, units). */
export type QueueEntrySnapshot = {
  kind: QueuedOrder["kind"]
  from: string
  to?: string
  fromName: string
  toName?: string
  unitIds: string[]
  unitKind?: QueuedOrder["unitKind"]
  buildId?: string
}

export function snapshotQueuedOrder(state: GameState, order: QueuedOrder): QueueEntrySnapshot {
  const from = findProvince(state, order.from)
  const to = order.to ? findProvince(state, order.to) : undefined
  return {
    kind: order.kind,
    from: order.from,
    to: order.to,
    fromName: from?.name ?? order.from,
    toName: to?.name,
    unitIds: [...order.unitIds].sort(),
    unitKind: order.unitKind,
    buildId: order.buildId,
  }
}

export function snapshotAdvisorCardOrders(state: GameState, orders: AdvisorOrder[]): QueueEntrySnapshot[] {
  return advisorDrafts(state, orders).map((draft) => snapshotQueuedOrder(state, { ...draft, id: "" }))
}
