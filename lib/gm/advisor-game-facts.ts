import { scenarioSpec } from "@/lib/data/objectives"
import { combinedEngagementOdds, engagementOdds, findProvince } from "@/lib/engine/turn"
import { standing } from "@/lib/engine/victory"
import { formatDate } from "@/lib/format"
import { centralEncirclementRiskIds } from "@/lib/ui/encirclement-risk"
import { legalTargets } from "@/lib/ui/legal-targets"
import { formatUiOddsForAdvisor } from "@/lib/ui/odds-band"
import {
  provinceIdsThatWouldEmptyDepot,
  provinceIdsWithThinDepotGarrison,
} from "@/lib/ui/order-warnings"
import { formatQueuedOrderLine, playerOrdersToQueued, type QueuedOrder } from "@/lib/orders"
import { provinceLabel } from "@/lib/news/battle"
import type { GameState, PlayerOrder } from "@/lib/types"

/** Compact engine facts (up to 10 lines) injected before each advisor reply — no full-board dump. */
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
  const queuedLine = renderQueuedArrowsLine(map, queue)
  if (queuedLine) lines.push(queuedLine)

  const oddsLine = renderQueuedUiOddsLine(map, queued, selectedProvinceId)
  if (oddsLine) lines.push(oddsLine)

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

  const depotThin = provinceIdsWithThinDepotGarrison(map, queue)
    .filter((id) => !depotEmpty.includes(id))
    .map((id) => provinceLabel(id))
  if (depotThin.length) {
    lines.push(`Queued march(es) leave thin depot garrison: ${depotThin.join(", ")}.`)
  }

  const encircle = centralEncirclementRiskIds(map).map((id) => provinceLabel(id))
  if (encircle.length) {
    lines.push(`Encirclement risk (thin friendly exits): ${encircle.join(", ")}.`)
  }

  if (map.result) {
    lines.push("Campaign is over; do not suggest orders.")
  }

  return lines.slice(0, 10)
}

function renderQueuedArrowsLine(map: GameState, queue: QueuedOrder[]): string | null {
  if (!queue.length) return "Queued arrows: none."
  const labels = queue
    .filter((order) => order.kind !== "cancelRecruit")
    .map((order) => formatQueuedOrderLine(map, order))
  if (!labels.length) return null
  const shown = labels.slice(0, 4)
  const extra = labels.length > shown.length ? ` (+${labels.length - shown.length} more)` : ""
  return `Queued arrows (engine board): ${shown.join("; ")}${extra}.`
}

function renderQueuedUiOddsLine(
  map: GameState,
  queued: PlayerOrder[],
  selectedProvinceId?: string | null,
): string | null {
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  if (!attacks.length) return null

  const focus =
    attacks.find((order) => order.from === selectedProvinceId) ??
    attacks.find((order) => order.target === selectedProvinceId) ??
    attacks[0]!
  const targetId = focus.target
  const target = findProvince(map, targetId)
  if (target?.controller === "central") return null

  const sameTarget = attacks.filter((order) => order.target === targetId)
  const preview =
    sameTarget.length >= 2
      ? combinedEngagementOdds(
          map,
          targetId,
          sameTarget.map((order) => ({ fromId: order.from, unitIds: order.unitIds })),
        )
      : engagementOdds(map, focus.from, targetId, focus.unitIds)
  if (!preview) return null
  return `Queued attack odds (Orders UI): ${provinceLabel(targetId)} — ${formatUiOddsForAdvisor(preview)}.`
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

function legalMoveFactLine(
  map: GameState,
  fromId: string,
  queue: QueuedOrder[],
): string | null {
  const from = findProvince(map, fromId)
  if (!from) return null
  const targets = legalTargets(map, fromId, queue)
  const orderAtk = targets.attack.map((id) => provinceLabel(id)).join(", ")
  const orderMove = targets.move.map((id) => provinceLabel(id)).join(", ")
  const blocked = targets.blocked
    .filter((item) => item.reason && item.reason.length < 120)
    .slice(0, 3)
    .map((item) => `${provinceLabel(item.id)} (${item.reason})`)
    .join("; ")
  const bits = [
    `From ${from.name} (supply ${from.supply}, ${from.controller})`,
    orderAtk ? `orderable attack → ${orderAtk}` : null,
    orderMove ? `orderable move → ${orderMove}` : null,
    blocked ? `blocked neighbors → ${blocked}` : null,
    !targets.canOrder && targets.originNote ? targets.originNote : null,
  ].filter(Boolean)
  return bits.join("; ") + "."
}