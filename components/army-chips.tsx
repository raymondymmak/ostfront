"use client"

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import type * as maplibregl from "maplibre-gl"
import type { MapProvince } from "@/components/war-map"
import type { QueuedOrder } from "@/lib/orders"
import {
  ARMY_CHIP_MIN_ZOOM,
  armyChips,
  edgePanDirections,
  ownsDragPointer,
  reduceChipDrag,
  type ArmyChip,
  type ChipDragView,
  type ChipDrop,
  type ChipPointer,
  type PanDir,
} from "@/lib/ui/drag-order"
import type { GameState } from "@/lib/types"

type ArmyChipsProps = {
  map: maplibregl.Map | null
  provinces: MapProvince[]
  treasury: GameState["treasury"]
  orders: QueuedOrder[]
  /** When false, chips still show but do not accept a drag. */
  enabled: boolean
  frame: RefObject<HTMLElement | null>
  onChipDrop?: (drop: ChipDrop) => void
}

type Ghost = {
  clientX: number
  clientY: number
  name: string
  strength: number
  valid: boolean
  reason: string | null
  pan: PanDir[]
}

function asState(provinces: MapProvince[], treasury: GameState["treasury"]): GameState {
  return { provinces, treasury } as unknown as GameState
}

export function ArmyChips({ map, provinces, treasury, orders, enabled, frame, onChipDrop }: ArmyChipsProps) {
  const [shown, setShown] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const provincesRef = useRef(provinces)
  const treasuryRef = useRef(treasury)
  const ordersRef = useRef(orders)
  const dragRef = useRef<ChipPointer | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const clientRef = useRef({ x: 0, y: 0 })
  const metaRef = useRef({ name: "", strength: 0 })
  const nodes = useRef(new Map<string, HTMLButtonElement>())
  const dropRef = useRef(onChipDrop)
  const frameRef = useRef(frame)
  const mapRef = useRef(map)
  const blockedRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    provincesRef.current = provinces
    treasuryRef.current = treasury
    ordersRef.current = orders
    dropRef.current = onChipDrop
    frameRef.current = frame
    mapRef.current = map
  })

  const place = () => {
    const current = mapRef.current
    if (!current) return
    const zoom = current.getZoom()
    for (const chip of armyChips(provincesRef.current, zoom)) {
      const el = nodes.current.get(chip.unitId)
      if (!el) continue
      const point = current.project(chip.centroid)
      el.style.transform = `translate(${point.x + chip.dx}px, ${point.y + chip.dy}px) translate(-50%, -50%)`
    }
  }
  const placeRef = useRef(place)
  useLayoutEffect(() => {
    placeRef.current = place
  })

  useEffect(() => {
    if (!map) return
    const onZoom = () => {
      const show = map.getZoom() >= ARMY_CHIP_MIN_ZOOM
      setShown((prev) => (prev === show ? prev : show))
      placeRef.current()
    }
    onZoom()
    map.on("zoom", onZoom)
    const onMove = () => placeRef.current()
    map.on("move", onMove)
    return () => {
      map.off("zoom", onZoom)
      map.off("move", onMove)
    }
  }, [map])

  useLayoutEffect(() => {
    placeRef.current()
  }, [shown, provinces, map])

  function canvasPoint(event: { clientX: number; clientY: number }) {
    const current = mapRef.current
    if (!current) return null
    const rect = current.getCanvas().getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    }
  }

  function hoverAt(x: number, y: number): string | null {
    const current = mapRef.current
    if (!current?.getLayer("provinces")) return null
    const feature = current.queryRenderedFeatures([x, y], { layers: ["provinces"] })[0]
    const id = feature?.properties?.id
    return typeof id === "string" ? id : null
  }

  function markBlocked(id: string | null) {
    const current = mapRef.current
    const previous = blockedRef.current
    if (current?.getSource("provinces")) {
      if (previous && previous !== id) {
        current.setFeatureState({ source: "provinces", id: previous }, { blocked: false })
      }
      if (id) current.setFeatureState({ source: "provinces", id }, { blocked: true })
      else if (previous) current.setFeatureState({ source: "provinces", id: previous }, { blocked: false })
    }
    blockedRef.current = id
  }

  function writeAttrs(view: ChipDragView) {
    const el = frameRef.current.current
    if (!el) return
    if (!view.drag) {
      el.removeAttribute("data-drag-order")
      el.removeAttribute("data-drag-pan")
      el.removeAttribute("data-drag-reason")
      el.removeAttribute("data-drag-block")
      markBlocked(null)
      return
    }
    el.setAttribute("data-drag-order", view.valid ? "valid" : "invalid")
    if (view.pan.length) el.setAttribute("data-drag-pan", view.pan.join(","))
    else el.removeAttribute("data-drag-pan")
    const block = !view.valid && view.drag.hoverId && view.reason ? view.drag.hoverId : null
    if (block && view.reason) {
      el.setAttribute("data-drag-block", block)
      el.setAttribute("data-drag-reason", view.reason)
    } else {
      el.removeAttribute("data-drag-block")
      el.removeAttribute("data-drag-reason")
    }
    markBlocked(block)
  }

  function showView(view: ChipDragView, clientX: number, clientY: number) {
    dragRef.current = view.drag
    setDraggingId(view.drag?.unitId ?? null)
    writeAttrs(view)
    if (!view.drag) {
      setGhost(null)
      return
    }
    clientRef.current = { x: clientX, y: clientY }
    setGhost({
      clientX,
      clientY,
      name: metaRef.current.name,
      strength: metaRef.current.strength,
      valid: view.valid,
      reason: view.reason,
      pan: view.pan,
    })
  }

  const apiRef = useRef({ canvasPoint, hoverAt, showView, writeAttrs })
  useLayoutEffect(() => {
    apiRef.current = { canvasPoint, hoverAt, showView, writeAttrs }
  })

  const dragging = ghost !== null
  const ghostValid = ghost?.valid ?? false

  useEffect(() => {
    if (!dragging) return
    const previous = document.body.style.cursor
    document.body.style.cursor = ghostValid ? "grabbing" : "not-allowed"
    return () => {
      document.body.style.cursor = previous
    }
  }, [dragging, ghostValid])

  useEffect(() => {
    if (!dragging || !map) return
    let frameId = 0
    const step = () => {
      const drag = dragRef.current
      if (drag) {
        const dirs = edgePanDirections(drag.x, drag.y, drag.width, drag.height)
        let dx = 0
        let dy = 0
        if (dirs.includes("left")) dx -= 14
        if (dirs.includes("right")) dx += 14
        if (dirs.includes("up")) dy -= 14
        if (dirs.includes("down")) dy += 14
        if (dx || dy) {
          map.panBy([dx, dy], { animate: false })
          const hoverId = apiRef.current.hoverAt(drag.x, drag.y)
          if (hoverId !== drag.hoverId) {
            const view = reduceChipDrag(
              asState(provincesRef.current, treasuryRef.current),
              ordersRef.current,
              drag,
              { type: "move", x: drag.x, y: drag.y, width: drag.width, height: drag.height, hoverId },
              () => "",
            )
            apiRef.current.showView(view, clientRef.current.x, clientRef.current.y)
          }
        }
      }
      frameId = requestAnimationFrame(step)
    }
    frameId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameId)
  }, [dragging, map])

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: PointerEvent) => {
      if (!ownsDragPointer(pointerIdRef.current, event.pointerId, "move")) return
      const drag = dragRef.current
      const point = apiRef.current.canvasPoint(event)
      if (!drag || !point) return
      const view = reduceChipDrag(
        asState(provincesRef.current, treasuryRef.current),
        ordersRef.current,
        drag,
        { type: "move", ...point, hoverId: apiRef.current.hoverAt(point.x, point.y) },
        () => "",
      )
      apiRef.current.showView(view, event.clientX, event.clientY)
    }
    const onUp = (event: PointerEvent) => {
      if (!ownsDragPointer(pointerIdRef.current, event.pointerId, "end")) return
      const drag = dragRef.current
      if (!drag) return
      const point = apiRef.current.canvasPoint(event)
      const hoverId = point ? apiRef.current.hoverAt(point.x, point.y) : drag.hoverId
      const located = point
        ? reduceChipDrag(
            asState(provincesRef.current, treasuryRef.current),
            ordersRef.current,
            drag,
            { type: "move", ...point, hoverId },
            () => "",
          )
        : { drag }
      const view = reduceChipDrag(
        asState(provincesRef.current, treasuryRef.current),
        ordersRef.current,
        located.drag,
        { type: "drop" },
        () => crypto.randomUUID(),
      )
      dragRef.current = null
      pointerIdRef.current = null
      mapRef.current?.dragPan.enable()
      setDraggingId(null)
      setGhost(null)
      apiRef.current.writeAttrs({ ...view, drag: null })
      dropRef.current?.({ queue: view.queue, queued: view.queued, reason: view.reason })
    }
    const onCancel = (event: PointerEvent) => {
      if (!ownsDragPointer(pointerIdRef.current, event.pointerId, "end")) return
      const drag = dragRef.current
      if (!drag) return
      const view = reduceChipDrag(asState(provincesRef.current, treasuryRef.current), ordersRef.current, drag, { type: "cancel" }, () => "")
      dragRef.current = null
      pointerIdRef.current = null
      mapRef.current?.dragPan.enable()
      setDraggingId(null)
      setGhost(null)
      apiRef.current.writeAttrs(view)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
    }
  }, [dragging])

  if (!shown || !map) return null
  const chips = armyChips(provinces, map.getZoom())

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, chip: ArmyChip) {
    if (!enabled || !chip.draggable || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (!ownsDragPointer(pointerIdRef.current, event.pointerId, "start")) return
    const point = canvasPoint(event)
    if (!point) return
    // Army drag draws the arrow. Map pan stays available for touches that miss a chip.
    mapRef.current?.dragPan.disable()
    pointerIdRef.current = event.pointerId
    metaRef.current = { name: chip.name, strength: chip.strength }
    const view = reduceChipDrag(
      asState(provincesRef.current, treasuryRef.current),
      ordersRef.current,
      null,
      { type: "start", unitId: chip.unitId, fromId: chip.provinceId, ...point },
      () => "",
    )
    showView(view, event.clientX, event.clientY)
    if (!view.drag) mapRef.current?.dragPan.enable()
  }

  return (
    <>
      <div className="map-drag-layer pointer-events-none absolute inset-0 z-10" data-testid="map-drag-layer">
        {chips.map((chip) => (
          <button
            key={chip.unitId}
            type="button"
            ref={(node) => {
              if (node) nodes.current.set(chip.unitId, node)
              else nodes.current.delete(chip.unitId)
            }}
            data-testid="army-chip"
            data-unit-id={chip.unitId}
            data-province={chip.provinceId}
            data-chip-draggable={chip.draggable ? "true" : "false"}
            aria-label={`${chip.name}, strength ${chip.strength}`}
            title={chip.draggable ? `Drag ${chip.name}` : chip.name}
            disabled={!chip.draggable || !enabled}
            onPointerDown={(event) => onPointerDown(event, chip)}
            className={`absolute top-0 left-0 min-w-5 rounded-sm border px-1 text-[10px] leading-5 font-semibold tabular-nums shadow-[0_1px_2px_rgba(36,28,20,0.35)] ${
              chip.faction === "central"
                ? "border-[#6b542c] bg-[#f4e4b8] text-[#2a2118]"
                : "border-[#3e4c57] bg-[#d5dde3] text-[#1c2830]"
            } ${chip.draggable && enabled ? "pointer-events-auto cursor-grab" : "pointer-events-none"} ${
              draggingId === chip.unitId ? "opacity-40" : ""
            }`}
            style={{ touchAction: "none" }}
          >
            {chip.strength}
          </button>
        ))}
      </div>
      {ghost && (
        <div
          className={`pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-sm border px-1.5 py-0.5 text-[10px] leading-snug font-semibold shadow-[0_6px_16px_rgba(36,28,20,0.28)] ${
            ghost.valid ? "border-[#2f6b3a] bg-[#f4e4b8] text-[#2a2118]" : "border-[#8a3a32] bg-[#f6e4dc] text-[#3d221c]"
          }`}
          style={{ left: ghost.clientX, top: ghost.clientY }}
          data-testid="army-chip-ghost"
          data-drag-order={ghost.valid ? "valid" : "invalid"}
          data-drag-pan={ghost.pan.join(",") || undefined}
        >
          <span className="tabular-nums">{ghost.strength}</span>
          {ghost.reason ? <span className="mt-0.5 block max-w-[14rem] font-normal">{ghost.reason}</span> : null}
        </div>
      )}
    </>
  )
}
