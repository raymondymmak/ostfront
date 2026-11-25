import { scenarioSpec } from "@/lib/data/objectives"
import { findProvince } from "@/lib/engine/turn"
import { standing } from "@/lib/engine/victory"
import { formatDate } from "@/lib/format"
import { centralEncirclementRiskIds } from "@/lib/ui/encirclement-risk"
import { legalTargets } from "@/lib/ui/legal-targets"
import { provinceIdsThatWouldEmptyDepot } from "@/lib/ui/order-warnings"
import { playerOrdersToQueued } from "@/lib/orders"
import { provinceLabel } from "@/lib/news/battle"
import type { GameState, PlayerOrder } from "@/lib/types"

/** Compact engine facts (5–8 lines) injected before each advisor reply — no full-board dump. */
export function renderAdvisorGameFacts(
  map: GameState,
  queued: PlayerOrder[],
  selectedProvinceId?: string | null,
): string[] {
  const spec = scenarioSpec(map.scenario)
  const fortnight = Math.min(map.turn + 1, spec.length)
  const remaining = Math.max(0, spec.length - (map.turn + 1))
  const endDate = formatDate(spec.length - 1)
  const board = standing(map)
  const lines: string[] = [
    `Fortnight ${fortnight} of ${spec.length}; ${remaining} fortnight(s) remain; campaign ends ${endDate} (${spec.kicker}).`,
    `Dispatch date: ${map.date}.`,
    `Eastern victory points held: ${board.captured} of ${board.available}.`,
  ]

  const queue = playerOrdersToQueued(queued)
  const focusIds = focusProvinceIds(map, queued, selectedProvinceId)
  for (const fromId of focusIds.slice(0, 2)) {
  const slice = legalMoveFactLine(map, fromId, queue)
    if (slice) lines.push(slice)
  }

  const lowSupply = map.provinces
    .filter((province) => province.controller === "central" && province.supply < 30)
    .map((province) => provinceLabel(province.id))
  if (lowSupply.length) {
    lines.push(`Central provinces below supply 30 (cannot march): ${lowSupply.join(", ")}.`)
  }

  const depotEmpty = provinceIdsThatWouldEmptyDepot(map, queue).map((id) => provinceLabel(id))
  if (depotEmpty.length) {
    lines.push(`Queued march(es) would empty depot(s): ${depotEmpty.join(", ")}.`)
  }

  const encircle = centralEncirclementRiskIds(map, queue).map((id) => provinceLabel(id))
  if (encircle.length) {
    lines.push(`Encirclement risk (thin friendly exits): ${encircle.join(", ")}.`)
  }

  if (map.result) {
    lines.push("Campaign is over; do not suggest orders.")
  }

  return lines.slice(0, 8)
}

function focusProvinceIds(
  map: GameState,
  queued: PlayerOrder[],
  selectedProvinceId?: string | null,
): string[] {
  const ids = new Set<string>()
  if (selectedProvinceId) ids.add(selectedProvinceId)
  for (const order of queued) {
    if (order.type === "attack") ids.add(order.from)
    else if (order.type === "fortify" || order.type === "recruit") ids.add(order.provinceId)
    else if (order.type === "move") {
      const located = map.provinces
        .flatMap((province) => province.units.map((unit) => ({ unit, province })))
        .find((row) => row.unit.id === order.unitId)
      if (located) ids.add(located.province.id)
    }
  }
  if (!ids.size) {
    const krakow = map.provinces.find((province) => province.id === "krakow")
    if (krakow?.controller === "central") ids.add("krakow")
  }
  return [...ids]
}

function legalMoveFactLine(map: GameState, fromId: string, queue: ReturnType<typeof playerOrdersToQueued>): string | null {
  const from = findProvince(map, fromId)
  if (!from) return null
  const targets = legalTargets(map, fromId, queue)
  const orderAtk = targets.attack.map((id) => provinceLabel(id)).join(", ")
  const orderMove = targets.move.map((id) => provinceLabel(id)).join(", ")
  const reachAtk = targets.reach.attack
    .filter((id) => !targets.attack.includes(id))
    .map((id) => provinceLabel(id))
    .join(", ")
  const bits = [
    `From ${from.name} (supply ${from.supply}, ${from.controller})`,
    orderAtk ? `orderable attack → ${orderAtk}` : null,
    orderMove ? `orderable move → ${orderMove}` : null,
    reachAtk ? `reach-only attack (neighbor, not orderable now) → ${reachAtk}` : null,
    !targets.canOrder && targets.originNote ? targets.originNote : null,
  ].filter(Boolean)
  return bits.join("; ") + "."
}