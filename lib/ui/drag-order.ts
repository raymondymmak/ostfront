import { formationStrength, independentFormations } from "@/lib/engine/echelon"
import { previewMarch } from "@/lib/ui/legal-targets"
import type { QueuedOrder } from "@/lib/orders"
import type { Faction, GameState, Province } from "@/lib/types"

/**
 * Drag one formation chip onto a province.
 *
 * The reducer decides the queue. A drop is legal only when `previewMarch`
 * says the resolver would accept it. An illegal drop returns the same queue
 * and a one-line reason. Battles, retreats, and supply changes during the
 * fortnight stay on the resolution record.
 *
 * Chips appear only once the camera is past the opening frame (zoom 6.83).
 */
export const ARMY_CHIP_MIN_ZOOM = 7.4
export const DRAG_EDGE_PX = 48

/** One pointer owns the drag. A second finger cannot start, move, or commit it. */
export function ownsDragPointer(
  activeId: number | null,
  pointerId: number,
  phase: "start" | "move" | "end",
): boolean {
  if (phase === "start") return activeId == null
  return activeId === pointerId
}
const CHIP_ORIGIN_PX = 16
const CHIP_PITCH_PX = 26

export type PanDir = "left" | "right" | "up" | "down"

export type ArmyChip = {
  unitId: string
  name: string
  strength: number
  faction: Faction
  provinceId: string
  draggable: boolean
  dx: number
  dy: number
  centroid: [number, number]
}

export type ChipPointer = {
  unitId: string
  fromId: string
  x: number
  y: number
  width: number
  height: number
  hoverId: string | null
}

export type ChipDragAction =
  | {
      type: "start"
      unitId: string
      fromId: string
      x: number
      y: number
      width: number
      height: number
    }
  | {
      type: "move"
      x: number
      y: number
      width: number
      height: number
      hoverId: string | null
    }
  | { type: "drop" }
  | { type: "cancel" }

export type ChipDragView = {
  drag: ChipPointer | null
  queue: QueuedOrder[]
  /** Hover is a legal move or attack for this one formation. */
  valid: boolean
  /** Drop wrote that order. Illegal drops leave `queue` as the same array. */
  queued: boolean
  reason: string | null
  pan: PanDir[]
}

export type ChipDrop = {
  queue: QueuedOrder[]
  queued: boolean
  reason: string | null
}

type ChipProvince = Province & { centroid?: [number, number] }

export function armyChips(provinces: readonly ChipProvince[], zoom: number): ArmyChip[] {
  if (!Number.isFinite(zoom) || zoom < ARMY_CHIP_MIN_ZOOM) return []
  const chips: ArmyChip[] = []
  for (const province of provinces) {
    const formations = independentFormations(province.units).slice().sort((a, b) => a.id.localeCompare(b.id))
    formations.forEach((unit, index) => {
      chips.push({
        unitId: unit.id,
        name: unit.name,
        strength: formationStrength(province.units, unit),
        faction: unit.faction,
        provinceId: province.id,
        draggable: unit.faction === "central" && province.controller === "central",
        dx: CHIP_ORIGIN_PX + (index % 4) * CHIP_PITCH_PX,
        dy: CHIP_ORIGIN_PX + Math.floor(index / 4) * 22,
        centroid: province.centroid ?? [0, 0],
      })
    })
  }
  return chips
}

export function edgePanDirections(
  x: number,
  y: number,
  width: number,
  height: number,
  margin = DRAG_EDGE_PX,
): PanDir[] {
  if (!(width > 0) || !(height > 0) || !(margin > 0)) return []
  const dirs: PanDir[] = []
  if (x <= margin) dirs.push("left")
  if (x >= width - margin) dirs.push("right")
  if (y <= margin) dirs.push("up")
  if (y >= height - margin) dirs.push("down")
  return dirs
}

function idle(queue: QueuedOrder[]): ChipDragView {
  return { drag: null, queue, valid: false, queued: false, reason: null, pan: [] }
}

function stripUnit(queue: QueuedOrder[], unitId: string): QueuedOrder[] {
  let changed = false
  const next = queue.flatMap((order) => {
    if ((order.kind !== "move" && order.kind !== "attack") || !order.unitIds.includes(unitId)) return [order]
    changed = true
    const unitIds = order.unitIds.filter((id) => id !== unitId)
    return unitIds.length ? [{ ...order, unitIds }] : []
  })
  return changed ? next : queue
}

function placeUnit(
  queue: QueuedOrder[],
  unitId: string,
  fromId: string,
  kind: "move" | "attack",
  to: string,
  allocateId: () => string,
): QueuedOrder[] {
  const already = queue.find(
    (order) => order.kind === kind && order.from === fromId && order.to === to && order.unitIds.includes(unitId),
  )
  if (already && queue.every((order) => order === already || !order.unitIds.includes(unitId))) return queue
  const stripped = stripUnit(queue, unitId)
  const index = stripped.findIndex((order) => order.kind === kind && order.from === fromId && order.to === to)
  if (index >= 0) {
    const existing = stripped[index]
    const next = stripped.slice()
    next[index] = { ...existing, unitIds: [...existing.unitIds, unitId] }
    return next
  }
  return [
    ...stripped,
    { id: allocateId(), kind, from: fromId, to, unitIds: [unitId] },
  ]
}

function classify(
  state: GameState,
  queue: QueuedOrder[],
  unitId: string,
  fromId: string,
  hoverId: string | null,
): { valid: boolean; kind: "move" | "attack" | null; reason: string | null } {
  if (!hoverId) {
    return { valid: false, kind: null, reason: "Release on a neighbouring province." }
  }
  const verdict = previewMarch(state, stripUnit(queue, unitId), fromId, hoverId, { unitId })
  if (!verdict.ok) return { valid: false, kind: null, reason: verdict.hover }
  return { valid: true, kind: verdict.kind, reason: verdict.warning }
}

function paint(queue: QueuedOrder[], drag: ChipPointer | null, classified: ReturnType<typeof classify>): ChipDragView {
  return {
    drag,
    queue,
    valid: classified.valid,
    queued: false,
    reason: classified.reason,
    pan: drag ? edgePanDirections(drag.x, drag.y, drag.width, drag.height) : [],
  }
}

export function reduceChipDrag(
  state: GameState,
  queue: QueuedOrder[],
  drag: ChipPointer | null,
  action: ChipDragAction,
  allocateId: () => string,
): ChipDragView {
  if (action.type === "cancel") return idle(queue)
  if (action.type === "start") {
    const next: ChipPointer = {
      unitId: action.unitId,
      fromId: action.fromId,
      x: action.x,
      y: action.y,
      width: action.width,
      height: action.height,
      hoverId: null,
    }
    return paint(queue, next, classify(state, queue, next.unitId, next.fromId, null))
  }
  if (!drag) return idle(queue)
  if (action.type === "move") {
    const next: ChipPointer = {
      unitId: drag.unitId,
      fromId: drag.fromId,
      x: action.x,
      y: action.y,
      width: action.width,
      height: action.height,
      hoverId: action.hoverId,
    }
    return paint(queue, next, classify(state, queue, next.unitId, next.fromId, next.hoverId))
  }
  const classified = classify(state, queue, drag.unitId, drag.fromId, drag.hoverId)
  if (!classified.valid || !classified.kind || !drag.hoverId) {
    return { ...idle(queue), reason: classified.reason }
  }
  const nextQueue = placeUnit(queue, drag.unitId, drag.fromId, classified.kind, drag.hoverId, allocateId)
  return {
    drag: null,
    queue: nextQueue,
    valid: true,
    queued: true,
    reason: classified.reason,
    pan: [],
  }
}
