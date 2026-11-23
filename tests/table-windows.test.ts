import { describe, expect, it } from "vitest"
import {
  clampWindowPosition,
  closeTopmostWindow,
  closeWindow,
  createDefaultTableWindows,
  focusWindow,
  isWindowOpen,
  moveWindow,
  TABLE_WINDOW_MARGIN,
  toggleWindow,
  topmostOpenWindow,
} from "@/lib/ui/table-windows"

describe("table-windows", () => {
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

  it("places default Legend fully above the stage bottom at common desktop sizes", () => {
    for (const [w, h] of [
      [1440, 820],
      [1280, 700],
      [1024, 650],
    ] as const) {
      const windows = createDefaultTableWindows(w, h)
      const legend = windows.find((item) => item.id === "legend")
      expect(legend).toBeTruthy()
      expect(legend!.y).toBeGreaterThanOrEqual(TABLE_WINDOW_MARGIN)
      expect(legend!.y + 200).toBeLessThanOrEqual(h - TABLE_WINDOW_MARGIN)
    }
  })
})
