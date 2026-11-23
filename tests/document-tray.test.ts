import { describe, expect, it } from "vitest"
import {
  applyPersistedLayout,
  isStowed,
  pointerMovedEnough,
  restoreWindow,
  stowTopmostWindow,
  stowWindow,
} from "@/lib/ui/document-tray"
import { createDefaultTableWindows, focusWindow, isWindowOpen } from "@/lib/ui/table-windows"
import { createDefaultTeachWindows, isTeachWindowOpen } from "@/lib/ui/teach-windows"

describe("document-tray", () => {
  it("stows an open paper into the tray and restores it", () => {
    let windows = createDefaultTableWindows(1440, 820)
    expect(isWindowOpen(windows, "orders")).toBe(true)
    windows = stowWindow(windows, "orders")
    expect(isStowed(windows, "orders")).toBe(true)
    expect(isWindowOpen(windows, "orders")).toBe(false)
    windows = restoreWindow(windows, "orders", { x: 80, y: 90 })
    expect(isWindowOpen(windows, "orders")).toBe(true)
    const orders = windows.find((item) => item.id === "orders")
    expect(orders?.x).toBe(80)
    expect(orders?.y).toBe(90)
  })

  it("Escape helper stows the topmost open paper", () => {
    let windows = createDefaultTableWindows(1440, 820)
    windows = focusWindow(windows, "log")
    windows = focusWindow(windows, "advisor")
    expect(isWindowOpen(windows, "advisor")).toBe(true)
    windows = stowTopmostWindow(windows)
    expect(isWindowOpen(windows, "advisor")).toBe(false)
    expect(isStowed(windows, "advisor")).toBe(true)
    expect(isWindowOpen(windows, "log")).toBe(true)
  })

  it("treats small pointer jitter as a click, larger travel as a tray lift", () => {
    const start = { clientX: 10, clientY: 10 }
    expect(pointerMovedEnough(start, { clientX: 12, clientY: 11 })).toBe(false)
    expect(pointerMovedEnough(start, { clientX: 10, clientY: 30 })).toBe(true)
  })

  it("applies persisted tray/open layout onto defaults", () => {
    const defaults = createDefaultTeachWindows(1440, 820)
    const persisted = {
      windows: defaults.map((item) =>
        item.id === "orders" ? { ...item, open: false, x: 12, y: 34 } : item,
      ),
    }
    const merged = applyPersistedLayout(defaults, persisted)
    expect(isTeachWindowOpen(merged, "orders")).toBe(false)
    expect(merged.find((item) => item.id === "orders")?.x).toBe(12)
    expect(isTeachWindowOpen(merged, "lesson")).toBe(true)
  })
})
