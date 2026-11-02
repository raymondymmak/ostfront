import { RECRUIT } from "@/lib/engine/economy"
import {
  applyAttack,
  applyCancelRecruit,
  applyFortify,
  applyMove,
  applyRecruit,
  combinedEngagementOdds,
  findProvince,
  findUnit,
  type EngagementPreview,
} from "@/lib/engine/turn"
import { queueMark, unitsOf } from "@/lib/gm/advisor-cards"
import type { AdvisorOrder } from "@/lib/gm/advisor-types"
import type { GameState, PlayerOrder, Purse, UnitKind } from "@/lib/types"

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

const UNIT_KINDS: UnitKind[] = ["infantry", "cavalry", "artillery"]

export type ProvinceActionState = {
  fortify: { queued: boolean; disabled: boolean; reason: string | null }
  recruit: Record<UnitKind, { queued: boolean; disabled: boolean; reason: string | null }>
  yardSlotsLeft: number
}

/** Whether Fortify and Raise troops can still be queued from this province. */
export function provinceActionState(
  state: GameState,
  provinceId: string,
  queue: QueuedOrder[],
  budget: Purse,
): ProvinceActionState {
  const province = findProvince(state, provinceId)
  const fortifyQueued = queue.some((order) => order.kind === "fortify" && order.from === provinceId)
  let fortifyReason: string | null = null
  if (fortifyQueued) fortifyReason = "Fortify queued"
  else if ((province?.fort ?? 0) >= 3) fortifyReason = "Fortified to level 3"
  else if ((province?.supply ?? 0) < 40) fortifyReason = `Supply ${province?.supply ?? 0}, need 40 to dig`
  else if (!province?.units.some((unit) => unit.faction === "central")) fortifyReason = "No garrison to dig in"

  const jobs = state.queue.filter((job) => job.provinceId === provinceId && job.faction === "central")
  const queuedRecruits = queue.filter((order) => order.kind === "recruit" && order.from === provinceId)
  const cancels = queue.filter(
    (order) => order.kind === "cancelRecruit" && jobs.some((job) => job.id === order.buildId),
  )
  const yardSlotsLeft = Math.max(0, 2 - jobs.length - queuedRecruits.length + cancels.length)

  const recruit = {} as ProvinceActionState["recruit"]
  for (const kind of UNIT_KINDS) {
    const queued = queuedRecruits.some((order) => order.unitKind === kind)
    const affordable = budget.mp >= RECRUIT[kind].mp && budget.ip >= RECRUIT[kind].ip
    let reason: string | null = null
    if (queued) reason = "Queued"
    else if (!affordable) reason = "Can't afford"
    else if (yardSlotsLeft === 0) reason = "Yards full (2 in progress)"
    recruit[kind] = { queued, disabled: reason !== null, reason }
  }

  return {
    fortify: { queued: fortifyQueued, disabled: fortifyReason !== null, reason: fortifyReason },
    recruit,
    yardSlotsLeft,
  }
}

/**
 * File advisor orders onto the queue.
 * Accept files every order on the card or none. A card that now overlaps the
 * queue is a conflict and is not filed until Override. Override removes those
 * divisions from the orders that already claim them, then files the new order.
 * An existing column that still has other divisions stays. A column with the
 * same type, origin, and target is extended, not copied.
 */
export function applyAdvisorToQueue(
  state: GameState,
  queue: QueuedOrder[],
  orders: AdvisorOrder[],
  mode: "accept" | "override",
): { queue: QueuedOrder[]; accepted: boolean; reason?: string } {
  const refused = refuseAdvisorOrders(state, queue, orders, mode)
  if (refused) return { queue, accepted: false, reason: refused }

  const drafts = advisorDrafts(state, orders)
  let next = queue.map((item) => ({ ...item, unitIds: [...item.unitIds] }))
  if (mode === "override") {
    const replacing = new Set(drafts.flatMap((draft) => draft.unitIds))
    next = next.flatMap((item) => {
      if ((item.kind !== "move" && item.kind !== "attack") || !item.unitIds.some((id) => replacing.has(id))) {
        return [item]
      }
      const unitIds = item.unitIds.filter((id) => !replacing.has(id))
      if (!unitIds.length) return []
      return [{ ...item, unitIds }]
    })
  }

  for (const draft of drafts) {
    if (draft.kind === "fortify" || draft.kind === "recruit" || draft.kind === "cancelRecruit") {
      if (next.some((item) => sameQueued(item, draft))) {
        return { queue, accepted: false, reason: UNAPPLICABLE }
      }
      next = [...next, { ...draft, id: crypto.randomUUID() }]
      continue
    }
    const claimed = new Set(next.flatMap((item) => item.unitIds))
    if (draft.unitIds.some((id) => claimed.has(id))) {
      return { queue, accepted: false, reason: UNAPPLICABLE }
    }
    const index = next.findIndex(
      (item) => item.kind === draft.kind && item.from === draft.from && item.to === draft.to,
    )
    if (index >= 0) {
      const existing = next[index]
      const unitIds = [...existing.unitIds]
      for (const id of draft.unitIds) {
        if (!unitIds.includes(id)) unitIds.push(id)
      }
      next = next.map((item, itemIndex) => (itemIndex === index ? { ...existing, unitIds } : item))
      continue
    }
    next = [...next, { ...draft, id: crypto.randomUUID(), unitIds: [...draft.unitIds] }]
  }
  return { queue: next, accepted: true }
}

const UNAPPLICABLE = "This order can no longer be applied. Nothing was filed."

function refuseAdvisorOrders(
  state: GameState,
  queue: QueuedOrder[],
  orders: AdvisorOrder[],
  mode: "accept" | "override",
): string | null {
  if (!orders.length) return UNAPPLICABLE
  const queued = queuedToPlayerOrders(queue)
  const mark = queueMark(state, orders, queued)
  if (mode === "accept" && mark.state === "duplicate") return "Already queued. Nothing was filed."
  if (mode === "accept" && mark.state === "conflict") {
    const which = mark.conflict ? ` (${mark.conflict})` : ""
    return `This conflicts with a queued order${which}. Use Override. Nothing was filed.`
  }
  if (advisorDrafts(state, orders).length !== orders.length) return UNAPPLICABLE
  return engineRefusal(state, queue, orders, mode)
}

function engineRefusal(
  state: GameState,
  queue: QueuedOrder[],
  orders: AdvisorOrder[],
  mode: "accept" | "override",
): string | null {
  const replacing = new Set<string>()
  if (mode === "override") {
    for (const order of orders) {
      for (const id of unitsOf(state, order)) replacing.add(id)
    }
  }
  const used = new Set<string>()
  for (const order of queuedToPlayerOrders(queue)) {
    for (const id of unitsOf(state, order)) {
      if (!replacing.has(id)) used.add(id)
    }
  }
  const fortified = new Set<string>()
  for (const item of queue) {
    if (item.kind !== "fortify") continue
    if (
      mode === "override" &&
      orders.some((order) => order.type === "fortify" && order.provinceId === item.from)
    ) {
      continue
    }
    fortified.add(item.from)
  }
  let economy = structuredClone(state)
  for (const order of orders) {
    const yard = order.type === "recruit" || order.type === "cancelRecruit"
    const clone = yard ? economy : structuredClone(state)
    const resolution = applyAdvisorOrder(clone, order, used, fortified)
    if (resolution.status !== "applied") return `${resolution.summary} Nothing was filed.`
    if (order.type === "move" || order.type === "attack") {
      for (const id of unitsOf(state, order)) used.add(id)
    } else if (order.type === "fortify") {
      fortified.add(order.provinceId)
    } else {
      economy = clone
    }
  }
  return null
}

function applyAdvisorOrder(
  state: GameState,
  order: AdvisorOrder,
  used: Set<string>,
  fortified: Set<string>,
): { status: "applied" | "rejected"; summary: string } {
  if (order.type === "move") {
    return applyMove(state, { type: "move", unit: order.unitId, to: order.to }, used)
  }
  if (order.type === "attack") {
    return applyAttack(
      state,
      { type: "attack", from: order.from, target: order.target, units: order.unitIds },
      used,
      4,
      new Set(),
    )
  }
  if (order.type === "fortify") {
    return applyFortify(state, { type: "fortify", province: order.provinceId }, fortified)
  }
  if (order.type === "recruit") {
    return applyRecruit(state, {
      type: "recruit",
      faction: "central",
      province: order.provinceId,
      kind: order.unitKind,
    })
  }
  return applyCancelRecruit(state, { type: "cancelRecruit", id: order.buildId })
}

function advisorDrafts(state: GameState, orders: AdvisorOrder[]): QueuedOrder[] {
  const drafts: QueuedOrder[] = []
  for (const order of orders) {
    if (order.type === "fortify") {
      drafts.push({ id: "", kind: "fortify", from: order.provinceId, unitIds: [] })
    } else if (order.type === "recruit") {
      drafts.push({
        id: "",
        kind: "recruit",
        from: order.provinceId,
        unitIds: [],
        unitKind: order.unitKind,
      })
    } else if (order.type === "cancelRecruit") {
      drafts.push({ id: "", kind: "cancelRecruit", from: "", unitIds: [], buildId: order.buildId })
    } else if (order.type === "move") {
      const located = findUnit(state, order.unitId)
      if (!located) continue
      drafts.push({ id: "", kind: "move", from: located.province.id, to: order.to, unitIds: [order.unitId] })
    } else {
      drafts.push({
        id: "",
        kind: "attack",
        from: order.from,
        to: order.target,
        unitIds: [...order.unitIds],
      })
    }
  }
  return drafts
}

function sameQueued(a: QueuedOrder, b: QueuedOrder): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === "fortify") return a.from === b.from
  if (a.kind === "recruit") return a.from === b.from && a.unitKind === b.unitKind
  if (a.kind === "cancelRecruit") return a.buildId === b.buildId
  return false
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
