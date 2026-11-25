import { independentFormations, partyOf } from "@/lib/engine/echelon"
import { findProvince } from "@/lib/engine/turn"
import type { GameState, Province } from "@/lib/types"
import type { QueuedOrder } from "@/lib/orders"
import { provinceLabel } from "@/lib/news/battle"

const SUPPLY_WARN_FLOOR = 40

/** Provinces whose queued arrows would leave the depot with no garrison. */
export function provinceIdsThatWouldEmptyDepot(map: GameState, queue: QueuedOrder[]): string[] {
  const seen = new Set<string>()
  const emptying: string[] = []
  const claimed = claimedUnits(queue)
  for (const order of queue) {
    if (order.kind === "fortify" || order.kind === "recruit" || order.kind === "cancelRecruit") continue
    const fromId = order.from
    if (seen.has(fromId)) continue
    seen.add(fromId)
    const from = findProvince(map, fromId)
    if (!from || from.depot !== "central") continue
    const departing = new Set(partyOf(from.units, order.unitIds).map((unit) => unit.id))
    const staying = independentFormations(
      from.units.filter((unit) => unit.faction === "central" && !departing.has(unit.id) && !claimed.has(unit.id)),
    )
    if (staying.length === 0) emptying.push(fromId)
  }
  return emptying
}

export function lowSupplyMarchWarning(from: Province): string | null {
  if (from.controller !== "central" || from.supply >= SUPPLY_WARN_FLOOR) return null
  return `${from.name} supply is ${from.supply}. Columns march at reduced strength and the province risks falling below 30 next fortnight.`
}

export function mergeOrderWarnings(...parts: Array<string | null | undefined>): string | null {
  const lines = parts.map((item) => item?.trim()).filter(Boolean) as string[]
  return lines.length ? lines.join(" ") : null
}

export function queuedOrderRiskNotes(map: GameState, order: QueuedOrder): string[] {
  const from = findProvince(map, order.from)
  if (!from) return []
  const notes: string[] = []
  const supply = lowSupplyMarchWarning(from)
  if (supply) notes.push(supply)
  if (
    from.depot === "central" &&
    order.kind !== "fortify" &&
    order.kind !== "recruit" &&
    order.kind !== "cancelRecruit"
  ) {
    const claimed = new Set<string>()
    const departing = new Set(order.unitIds)
    const staying = independentFormations(
      from.units.filter((unit) => unit.faction === "central" && !departing.has(unit.id) && !claimed.has(unit.id)),
    )
    if (staying.length === 0) {
      notes.push(`This order empties the ${provinceLabel(from.id)} depot. Leave a garrison unless you mean to abandon it.`)
    }
  }
  return notes
}

function claimedUnits(queue: QueuedOrder[]): Set<string> {
  return new Set(
    queue.flatMap((item) =>
      item.kind === "fortify" || item.kind === "recruit" || item.kind === "cancelRecruit" ? [] : item.unitIds,
    ),
  )
}