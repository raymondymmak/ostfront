import { partyOf } from "@/lib/engine/echelon"
import { findProvince, findUnit } from "@/lib/engine/turn"
import { KIND_LABEL } from "@/lib/format"
import type { AdvisorCard, AdvisorOrder, AdvisorQueueState } from "@/lib/gm/advisor-types"
import type { GameState, PlayerOrder } from "@/lib/types"

/** Actionable cards, then every duplicate. Duplicates do not use a slot. */
export const ADVISOR_CARD_CAP = 3

export function rankAdvisorCards(cards: AdvisorCard[]): AdvisorCard[] {
  const duplicates = cards.filter((card) => card.queue === "duplicate")
  const actionable = cards.filter((card) => card.queue !== "duplicate")
  const weight = (card: AdvisorCard) => {
    if (!card.valid) return 2
    if (card.queue === "conflict") return 1
    return 0
  }
  const ranked = [...actionable].sort((a, b) => weight(a) - weight(b))
  return [...ranked.slice(0, ADVISOR_CARD_CAP), ...duplicates]
}

export function queueMark(
  map: GameState,
  orders: AdvisorOrder[],
  queued: PlayerOrder[],
): { state: AdvisorQueueState; conflict: string | null } {
  const concrete = queued.filter(isAdvisorOrder)
  if (!orders.length) return { state: "new", conflict: null }
  const overlaps: AdvisorOrder[] = []
  let exactOrders = 0
  for (const order of orders) {
    const exact = concrete.find((item) => sameOrder(order, item))
    if (exact) {
      exactOrders += 1
      if (!overlaps.some((prior) => sameOrder(prior, exact))) overlaps.push(exact)
      continue
    }
    for (const item of concrete) {
      if (!sharesCommitment(map, order, item)) continue
      if (!overlaps.some((prior) => sameOrder(prior, item))) overlaps.push(item)
    }
  }
  if (exactOrders === orders.length) return { state: "duplicate", conflict: null }
  if (overlaps.length) {
    return { state: "conflict", conflict: overlaps.map((item) => labelFor(map, item)).join("; ") }
  }
  return { state: "new", conflict: null }
}

/** Mark open cards against the queue the player has now. */
export function refreshAdvisorCards(
  state: GameState,
  cards: AdvisorCard[],
  queued: PlayerOrder[],
): AdvisorCard[] {
  return cards.map((card) => {
    const mark = queueMark(state, [card.order, ...card.companions], queued)
    if (mark.state === card.queue && mark.conflict === card.conflict) return card
    return { ...card, queue: mark.state, conflict: mark.conflict }
  })
}

export function sameOrder(a: AdvisorOrder, b: AdvisorOrder): boolean {
  if (a.type !== b.type) return false
  if (a.type === "attack" && b.type === "attack") {
    return a.from === b.from && a.target === b.target && sameIds(a.unitIds, b.unitIds)
  }
  if (a.type === "move" && b.type === "move") return a.unitId === b.unitId && a.to === b.to
  if (a.type === "fortify" && b.type === "fortify") return a.provinceId === b.provinceId
  if (a.type === "recruit" && b.type === "recruit") {
    return a.provinceId === b.provinceId && a.unitKind === b.unitKind
  }
  if (a.type === "cancelRecruit" && b.type === "cancelRecruit") return a.buildId === b.buildId
  return false
}

export function unitsOf(map: GameState, order: AdvisorOrder | PlayerOrder): string[] {
  if (order.type === "move") {
    const unitId = "unitId" in order ? order.unitId : ""
    const located = findUnit(map, unitId)
    if (!located) return unitId ? [unitId] : []
    return partyOf(located.province.units, [unitId]).map((unit) => unit.id)
  }
  if (order.type === "attack") {
    const from = findProvince(map, order.from)
    if (!from) return order.unitIds
    return partyOf(from.units, order.unitIds).map((unit) => unit.id)
  }
  return []
}

export function labelFor(map: GameState, order: AdvisorOrder): string {
  if (order.type === "attack") {
    return `Attack ${nameOf(map, order.target)} from ${nameOf(map, order.from)}`
  }
  if (order.type === "move") {
    const located = findUnit(map, order.unitId)
    return `Move ${located?.unit.name ?? order.unitId} to ${nameOf(map, order.to)}`
  }
  if (order.type === "fortify") return `Fortify ${nameOf(map, order.provinceId)}`
  if (order.type === "recruit") {
    return `Raise ${KIND_LABEL[order.unitKind].toLowerCase()} at ${nameOf(map, order.provinceId)}`
  }
  return "Cancel a formation in the yards"
}

export function nameOf(map: GameState, id: string): string {
  return findProvince(map, id)?.name ?? id
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const right = new Set(b)
  return a.every((id) => right.has(id))
}

function sharesCommitment(map: GameState, order: AdvisorOrder, queued: AdvisorOrder): boolean {
  const left = new Set(unitsOf(map, order))
  for (const id of unitsOf(map, queued)) {
    if (left.has(id)) return true
  }
  if (order.type === "fortify" && queued.type === "fortify") return order.provinceId === queued.provinceId
  if (order.type === "recruit" && queued.type === "recruit") {
    return order.provinceId === queued.provinceId && order.unitKind === queued.unitKind
  }
  if (order.type === "cancelRecruit" && queued.type === "cancelRecruit") return order.buildId === queued.buildId
  return false
}

function isAdvisorOrder(order: PlayerOrder): order is AdvisorOrder {
  return order.type !== "text"
}
