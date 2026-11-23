import { describe, expect, it } from "vitest"
import {
  dragPreservesSize,
  pointerInTrayZone,
  positionAfterPointerDrag,
  resolveWindowHeight,
  stageHeightForWindows,
} from "@/lib/ui/window-drag"
import { DOCUMENT_TRAY_HEIGHT, TABLE_WINDOW_MARGIN } from "@/lib/ui/table-windows"

describe("window-drag", () => {
  it("press-drag-release moves by pointer delta without an extra place click", () => {
    const origin = { x: 100, y: 120 }
    const size = { w: 320, h: 400 }
    const stage = { width: 1440, height: 820 }
    const start = { clientX: 200, clientY: 150 }
    // Pointer moves 40 right, 30 down — release at the new point (no second click).
    const moved = positionAfterPointerDrag(origin, start, { clientX: 240, clientY: 180 }, size, stage)
    expect(moved).toEqual({ x: 140, y: 150 })
    // Size argument is unchanged by the helper (Orders expand regression).
    expect(dragPreservesSize(size, size)).toBe(true)
  })

  it("clamps so the paper cannot leave the stage above the tray", () => {
    const size = { w: 300, h: 200 }
    const stage = { width: 1024, height: 768 }
    const usable = stageHeightForWindows(stage.height)
    const next = positionAfterPointerDrag(
      { x: 10, y: 10 },
      { clientX: 0, clientY: 0 },
      { clientX: 5000, clientY: 5000 },
      size,
      stage,
    )
    expect(next.x).toBe(stage.width - size.w - TABLE_WINDOW_MARGIN)
    expect(next.y).toBe(usable - size.h - TABLE_WINDOW_MARGIN)
    expect(next.y + size.h).toBeLessThanOrEqual(stage.height - DOCUMENT_TRAY_HEIGHT)
  })

  it("does not grow locked height when the window is dragged upward", () => {
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

  it("detects the tray drop zone along the stage bottom", () => {
    expect(pointerInTrayZone(780, 820)).toBe(true)
    expect(pointerInTrayZone(100, 820)).toBe(false)
  })
})
