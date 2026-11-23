import { describe, expect, it } from "vitest"
import {
  canDragDownToTray,
  dragPreservesSize,
  headerOverlapsTray,
  liftYAboveTray,
  maxRestingYAboveTray,
  pointerInTrayZone,
  positionAfterPointerDrag,
  resolveWindowHeight,
  shouldFileIntoTray,
  stageHeightForWindows,
  trayTopY,
} from "@/lib/ui/window-drag"
import {
  DOCUMENT_TRAY_HEIGHT,
  DOCUMENT_TRAY_Z,
  TABLE_WINDOW_MARGIN,
  WINDOW_HEADER_HEIGHT,
} from "@/lib/ui/table-windows"
import { createDefaultTableWindows } from "@/lib/ui/table-windows"

describe("window-drag", () => {
  it("press-drag-release moves by pointer delta without an extra place click", () => {
    const origin = { x: 100, y: 120 }
    const size = { w: 320, h: 400 }
    const stage = { width: 1440, height: 820 }
    const start = { clientX: 200, clientY: 150 }
    const moved = positionAfterPointerDrag(origin, start, { clientX: 240, clientY: 180 }, size, stage)
    expect(moved).toEqual({ x: 140, y: 150 })
    expect(dragPreservesSize(size, size)).toBe(true)
  })

  it("header-only Y clamp lets the body reach the tray while the grip stays on-screen", () => {
    const size = { w: 300, h: 200 }
    const stage = { width: 1024, height: 768 }
    const next = positionAfterPointerDrag(
      { x: 10, y: 10 },
      { clientX: 0, clientY: 0 },
      { clientX: 5000, clientY: 5000 },
      size,
      stage,
    )
    expect(next.x).toBe(stage.width - size.w - TABLE_WINDOW_MARGIN)
    expect(next.y).toBe(stage.height - WINDOW_HEADER_HEIGHT - TABLE_WINDOW_MARGIN)
    expect(next.y + WINDOW_HEADER_HEIGHT).toBeLessThanOrEqual(stage.height - TABLE_WINDOW_MARGIN)
    expect(next.y + size.h).toBeGreaterThan(stage.height - DOCUMENT_TRAY_HEIGHT)
    expect(canDragDownToTray(stage.height)).toBe(true)
  })

  it("does not change locked height when dragged up or down", () => {
    const locked = 360
    const preferredMax = 576
    const stageHeight = stageHeightForWindows(820)
    const atBottom = resolveWindowHeight({
      lockedHeight: locked,
      preferredMax,
      stageHeight,
      y: 400,
    })
    const atTop = resolveWindowHeight({
      lockedHeight: locked,
      preferredMax,
      stageHeight,
      y: 40,
    })
    expect(atBottom).toBe(locked)
    expect(atTop).toBe(locked)
    expect(dragPreservesSize({ w: 320, h: atBottom }, { w: 320, h: atTop })).toBe(true)
  })

  it("treats the whole tray bar (and below) as a drop zone, including the tray edge", () => {
    const stageH = 820
    const top = trayTopY(stageH)
    expect(pointerInTrayZone(top, stageH)).toBe(true)
    expect(pointerInTrayZone(top - 1, stageH)).toBe(false)
    expect(pointerInTrayZone(stageH + 20, stageH)).toBe(true)
    expect(pointerInTrayZone(100, stageH)).toBe(false)
  })

  it("files OHL when the short paper header overlaps the tray even if the pointer is above the bar", () => {
    const stageH = 820
    const trayTop = trayTopY(stageH)
    // Header straddles the tray edge — the OHL stuck-under-tray case.
    const ohlY = trayTop - WINDOW_HEADER_HEIGHT + 8
    expect(headerOverlapsTray(ohlY, stageH)).toBe(true)
    expect(
      shouldFileIntoTray({
        pointerY: trayTop - 4,
        windowY: ohlY,
        stageHeight: stageH,
      }),
    ).toBe(true)
    expect(
      shouldFileIntoTray({
        pointerY: trayTop,
        windowY: 40,
        stageHeight: stageH,
      }),
    ).toBe(true)
  })

  it("lifts resting Y so the header grip stays fully above the tray", () => {
    const stageH = 900
    const maxY = maxRestingYAboveTray(stageH)
    expect(maxY + WINDOW_HEADER_HEIGHT).toBeLessThanOrEqual(trayTopY(stageH))
    expect(liftYAboveTray(stageH - 10, stageH)).toBe(maxY)
    expect(liftYAboveTray(40, stageH)).toBe(40)
  })

  it("keeps default paper z above the document tray z", () => {
    const windows = createDefaultTableWindows(1440, 820)
    for (const win of windows) {
      expect(win.z).toBeGreaterThan(DOCUMENT_TRAY_Z)
    }
  })
})
