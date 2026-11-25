import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import type { QueuedOrder } from "@/lib/orders"
import {
  ARMY_CHIP_MIN_ZOOM,
  armyChips,
  edgePanDirections,
  ownsDragPointer,
  reduceChipDrag,
  type ChipDragAction,
  type ChipPointer,
} from "@/lib/ui/drag-order"
import type { GameState } from "@/lib/types"

function ids() {
  let n = 0
  return () => `chip-${++n}`
}

function drop(
  state: GameState,
  queue: QueuedOrder[],
  unitId: string,
  fromId: string,
  hoverId: string | null,
  allocateId: () => string = ids(),
  point = { x: 200, y: 150 },
) {
  const start = reduceChipDrag(
    state,
    queue,
    null,
    { type: "start", unitId, fromId, x: 20, y: 20, width: 400, height: 300 },
    allocateId,
  )
  const moved = reduceChipDrag(
    state,
    start.queue,
    start.drag,
    { type: "move", ...point, width: 400, height: 300, hoverId },
    allocateId,
  )
  return { moved, dropped: reduceChipDrag(state, moved.queue, moved.drag, { type: "drop" }, allocateId) }
}

describe("army chips", () => {
  it("hides chips until the camera is zoomed in past the opening frame", () => {
    const state = createInitialState()
    expect(armyChips(state.provinces, ARMY_CHIP_MIN_ZOOM - 0.01)).toEqual([])
    const chips = armyChips(state.provinces, ARMY_CHIP_MIN_ZOOM)
    const mackensen = chips.find((chip) => chip.unitId === "g-kra-11")
    const russian = chips.find((chip) => chip.unitId === "g-kie-inf")
    expect(mackensen).toMatchObject({ provinceId: "krakow", draggable: true, strength: 64, dx: 16 })
    expect(russian).toMatchObject({ provinceId: "kielce", draggable: false })
  })

  it("omits a formation standing under a parent in the same province", () => {
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    krakow.units.push({
      id: "child",
      name: "Child",
      faction: "central",
      strength: 10,
      morale: 50,
      kind: "infantry",
      parentId: "g-kra-11",
    })
    expect(armyChips(state.provinces, 8).some((chip) => chip.unitId === "child")).toBe(false)
    const result = drop(state, [], "child", "krakow", "kielce")
    expect(result.dropped.queued).toBe(false)
    expect(result.dropped.queue).toEqual([])
    expect(result.dropped.reason).toMatch(/another command/)
  })
})

describe("ownsDragPointer", () => {
  it("keeps the drag on the finger that started it", () => {
    expect(ownsDragPointer(null, 1, "start")).toBe(true)
    expect(ownsDragPointer(1, 2, "start")).toBe(false)
    expect(ownsDragPointer(1, 1, "move")).toBe(true)
    expect(ownsDragPointer(1, 2, "move")).toBe(false)
    expect(ownsDragPointer(1, 1, "end")).toBe(true)
    expect(ownsDragPointer(1, 2, "end")).toBe(false)
    expect(ownsDragPointer(null, 2, "end")).toBe(false)
  })
})

describe("edge pan", () => {
  it("names the edges the pointer is near, including corners", () => {
    expect(edgePanDirections(10, 120, 400, 300)).toEqual(["left"])
    expect(edgePanDirections(360, 10, 400, 300)).toEqual(["right", "up"])
    expect(edgePanDirections(200, 150, 400, 300)).toEqual([])
    expect(edgePanDirections(0, 0, 0, 300)).toEqual([])
  })
})

describe("reduceChipDrag", () => {
  it("queues one formation on a legal attack and a legal move", () => {
    const state = createInitialState()
    const attack = drop(state, [], "g-kra-11", "krakow", "kielce")
    expect(attack.moved.valid).toBe(true)
    expect(attack.moved.queued).toBe(false)
    expect(attack.moved.queue).toEqual([])
    expect(attack.dropped.queued).toBe(true)
    expect(attack.dropped.drag).toBeNull()
    expect(attack.dropped.queue).toEqual([
      { id: "chip-1", kind: "attack", from: "krakow", to: "kielce", unitIds: ["g-kra-11"] },
    ])

    const move = drop(state, [], "g-kra-art", "krakow", "katowice")
    expect(move.dropped.queue[0]).toMatchObject({ kind: "move", to: "katowice", unitIds: ["g-kra-art"] })
  })

  it("leaves the queue unchanged for a non-neighbour, the same province, low supply, and a Russian chip", () => {
    const state = createInitialState()
    const queue: QueuedOrder[] = [
      { id: "keep", kind: "fortify", from: "krakow", unitIds: [] },
    ]
    const far = drop(state, queue, "g-kra-11", "krakow", "warszawa")
    expect(far.moved.valid).toBe(false)
    expect(far.moved.pan).toEqual([])
    expect(far.dropped.queued).toBe(false)
    expect(far.dropped.queue).toBe(queue)
    expect(far.dropped.reason).toMatch(/do not share a border/)

    const same = drop(state, queue, "g-kra-11", "krakow", "krakow")
    expect(same.dropped.queue).toBe(queue)
    expect(same.dropped.reason).toMatch(/already in/)

    const starved = createInitialState()
    starved.provinces.find((province) => province.id === "krakow")!.supply = 29
    const blocked = drop(starved, [], "g-kra-11", "krakow", "kielce", () => {
      throw new Error("illegal drop must not allocate an id")
    })
    expect(blocked.dropped.queued).toBe(false)
    expect(blocked.dropped.queue).toEqual([])
    expect(blocked.dropped.reason).toMatch(/supply 30/i)

    const russian = drop(state, queue, "g-kie-inf", "kielce", "krakow", () => {
      throw new Error("illegal drop must not allocate an id")
    })
    expect(russian.dropped.queue).toBe(queue)
    expect(russian.dropped.reason).toMatch(/Central Powers/)
  })

  it("moves a formation off its old order and appends onto an existing arrow", () => {
    const state = createInitialState()
    const queue: QueuedOrder[] = [
      { id: "lemberg", kind: "attack", from: "krakow", to: "lwow", unitIds: ["g-kra-11", "g-kra-x"] },
    ]
    const retarget = drop(state, queue, "g-kra-11", "krakow", "kielce")
    expect(retarget.dropped.queue).toEqual([
      { id: "lemberg", kind: "attack", from: "krakow", to: "lwow", unitIds: ["g-kra-x"] },
      { id: "chip-1", kind: "attack", from: "krakow", to: "kielce", unitIds: ["g-kra-11"] },
    ])

    const merged = drop(state, retarget.dropped.queue, "g-kra-art", "krakow", "kielce")
    const kielce = merged.dropped.queue.find((order) => order.to === "kielce")
    expect(kielce?.unitIds).toEqual(["g-kra-11", "g-kra-art"])
    expect(kielce?.id).toBe("chip-1")
  })

  it("still queues the last formation out of a depot and says so", () => {
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    krakow.units = krakow.units.filter((unit) => unit.id === "g-kra-11")
    const result = drop(state, [], "g-kra-11", "krakow", "katowice")
    expect(result.dropped.queued).toBe(true)
    expect(result.dropped.reason).toMatch(/empties the Kraków depot/)
  })

  it("cancels without writing, and reports edge pan while the pointer is dragging", () => {
    const state = createInitialState()
    const queue: QueuedOrder[] = []
    const started = reduceChipDrag(
      state,
      queue,
      null,
      { type: "start", unitId: "g-kra-11", fromId: "krakow", x: 8, y: 10, width: 400, height: 300 },
      ids(),
    )
    expect(started.pan).toEqual(["left", "up"])
    expect(started.queue).toBe(queue)
    const cancelled = reduceChipDrag(state, queue, started.drag, { type: "cancel" }, ids())
    expect(cancelled).toEqual({ drag: null, queue, valid: false, queued: false, reason: null, pan: [] })

    const missing = reduceChipDrag(state, queue, null, { type: "drop" }, ids())
    expect(missing.queue).toBe(queue)
    const orphan: ChipPointer = {
      unitId: "g-kra-11",
      fromId: "krakow",
      x: 1,
      y: 1,
      width: 10,
      height: 10,
      hoverId: "kielce",
    }
    const movedAway: ChipDragAction = { type: "move", x: 4, y: 4, width: 10, height: 10, hoverId: null }
    expect(reduceChipDrag(state, queue, orphan, movedAway, ids()).valid).toBe(false)
  })

  it("is what the map chips and both shells call", () => {
    const chips = readFileSync("components/army-chips.tsx", "utf8")
    expect(chips).toContain("reduceChipDrag")
    expect(chips).toContain("ownsDragPointer")
    expect(chips).toContain("pointerIdRef")
    expect(chips).toContain('data-testid="army-chip"')
    expect(chips).toContain("panBy")
    const game = readFileSync("components/game-app.tsx", "utf8")
    const teach = readFileSync("components/teaching-app.tsx", "utf8")
    expect(game).toContain("onChipDrop")
    expect(teach).toContain("onChipDrop")
  })
})
