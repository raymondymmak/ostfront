import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  clampWindowPosition,
  closeTopmostWindow,
  closeWindow,
  createDefaultTableWindows,
  DOCUMENT_TRAY_HEIGHT,
  focusWindow,
  isWindowOpen,
  moveWindow,
  TABLE_WINDOW_MARGIN,
  TABLE_WINDOW_SIZE_HINTS,
  toggleWindow,
  topmostOpenWindow,
} from "@/lib/ui/table-windows"
import {
  createDefaultTeachWindows,
  TEACH_WINDOW_SIZE_HINTS,
  teachWindowHeights,
} from "@/lib/ui/teach-windows"

describe("table-windows", () => {
  it("keeps Orders from OHL at 27rem and on the stage", () => {
    expect(TABLE_WINDOW_SIZE_HINTS.ohl.w).toBe(432)
    const source = readFileSync("components/ohl-orders-window.tsx", "utf8")
    expect(source).toContain('widthClassName="w-[min(27rem,calc(100%-1.5rem))]"')
    for (const width of [1440, 1024]) {
      const ohl = createDefaultTableWindows(width, 700).find((item) => item.id === "ohl")
      expect(ohl).toBeTruthy()
      expect(ohl!.x + TABLE_WINDOW_SIZE_HINTS.ohl.w).toBeLessThanOrEqual(width - TABLE_WINDOW_MARGIN)
      expect(ohl!.y).toBeGreaterThanOrEqual(TABLE_WINDOW_MARGIN)
    }
  })

  it("defaults open Orders, Legend, and Orders from OHL", () => {
    const windows = createDefaultTableWindows(1440, 820)
    expect(isWindowOpen(windows, "orders")).toBe(true)
    expect(isWindowOpen(windows, "legend")).toBe(true)
    expect(isWindowOpen(windows, "ohl")).toBe(true)
    expect(isWindowOpen(windows, "province")).toBe(false)
    expect(isWindowOpen(windows, "log")).toBe(false)
    expect(isWindowOpen(windows, "advisor")).toBe(false)
  })

  it("focus raises z and opens; toggle closes when open", () => {
    let windows = createDefaultTableWindows()
    windows = focusWindow(windows, "province")
    expect(isWindowOpen(windows, "province")).toBe(true)
    expect(topmostOpenWindow(windows)).toBe("province")
    windows = toggleWindow(windows, "province")
    expect(isWindowOpen(windows, "province")).toBe(false)
  })

  it("Escape helper closes the topmost open window", () => {
    let windows = createDefaultTableWindows()
    windows = focusWindow(windows, "log")
    windows = focusWindow(windows, "advisor")
    expect(topmostOpenWindow(windows)).toBe("advisor")
    windows = closeTopmostWindow(windows)
    expect(isWindowOpen(windows, "advisor")).toBe(false)
    expect(topmostOpenWindow(windows)).toBe("log")
  })

  it("move and close preserve other windows", () => {
    let windows = createDefaultTableWindows()
    windows = moveWindow(windows, "orders", 40, 60)
    const orders = windows.find((item) => item.id === "orders")
    expect(orders?.x).toBe(40)
    expect(orders?.y).toBe(60)
    windows = closeWindow(windows, "ohl")
    expect(isWindowOpen(windows, "ohl")).toBe(false)
    expect(isWindowOpen(windows, "orders")).toBe(true)
  })

  it("clamps default placement above the tray; header-only Y reaches the tray band", () => {
    const clamped = clampWindowPosition(2000, 2000, 300, 200, 1024, 768)
    expect(clamped.x).toBe(1024 - 300 - TABLE_WINDOW_MARGIN)
    // Default placement usable height excludes DOCUMENT_TRAY_HEIGHT (48).
    expect(clamped.y).toBe(768 - 48 - 200 - TABLE_WINDOW_MARGIN)
    const topLeft = clampWindowPosition(-40, -10, 300, 200, 1024, 768)
    expect(topLeft.x).toBe(TABLE_WINDOW_MARGIN)
    expect(topLeft.y).toBe(TABLE_WINDOW_MARGIN)
    const drag = clampWindowPosition(2000, 2000, 300, 200, 1024, 768, TABLE_WINDOW_MARGIN, {
      headerOnlyY: true,
    })
    // Header grip stays on-screen; body may overlap the tray.
    expect(drag.y).toBe(768 - 36 - TABLE_WINDOW_MARGIN)
  })

  it("places default Legend fully above the tray at common desktop sizes", () => {
    for (const [w, h] of [
      [1440, 820],
      [1280, 700],
      [1024, 650],
      // ~1024×726 viewport → map stage under the HUD
      [1024, 606],
    ] as const) {
      const windows = createDefaultTableWindows(w, h)
      const legend = windows.find((item) => item.id === "legend")
      expect(legend).toBeTruthy()
      expect(legend!.x).toBe(TABLE_WINDOW_MARGIN)
      expect(legend!.height).toBeTypeOf("number")
      const boxH = legend!.height!
      const trayTop = h - DOCUMENT_TRAY_HEIGHT
      expect(legend!.y).toBeGreaterThanOrEqual(TABLE_WINDOW_MARGIN)
      expect(legend!.y + boxH).toBeLessThanOrEqual(trayTop - TABLE_WINDOW_MARGIN)
    }
  })

  it("default open campaign and /teach rects do not overlap the tray", () => {
    const stages = [
      [1440, 820],
      [1280, 700],
      [1024, 650],
      [1024, 606],
    ] as const
    for (const [w, h] of stages) {
      const trayTop = h - DOCUMENT_TRAY_HEIGHT
      const usableH = h - DOCUMENT_TRAY_HEIGHT
      const belowMapMode = 100
      const m = TABLE_WINDOW_MARGIN
      const campaignH: Record<string, number> = {
        legend: 0,
        orders: Math.min(TABLE_WINDOW_SIZE_HINTS.orders.h, Math.max(240, usableH - belowMapMode - m)),
        ohl: TABLE_WINDOW_SIZE_HINTS.ohl.h,
      }
      for (const win of createDefaultTableWindows(w, h).filter((item) => item.open)) {
        const boxH = win.height ?? campaignH[win.id] ?? TABLE_WINDOW_SIZE_HINTS[win.id].h
        expect(win.y + boxH, `${win.id} @ ${w}x${h}`).toBeLessThanOrEqual(trayTop)
      }
      const teachHeights = teachWindowHeights(w, h)
      for (const win of createDefaultTeachWindows(w, h).filter((item) => item.open)) {
        const boxH = win.height ?? teachHeights[win.id] ?? TEACH_WINDOW_SIZE_HINTS[win.id].h
        expect(win.y + boxH, `${win.id} teach @ ${w}x${h}`).toBeLessThanOrEqual(trayTop)
      }
    }
  })
})
