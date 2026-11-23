import { describe, expect, it } from "vitest"
import {
  applyPersistedLayout,
  isStowed,
  liftPersistedWindowsAboveTray,
  pointerMovedEnough,
  restoreWindow,
  stowTopmostWindow,
  stowWindow,
} from "@/lib/ui/document-tray"
import { trayTopY } from "@/lib/ui/window-drag"
import { WINDOW_HEADER_HEIGHT } from "@/lib/ui/table-windows"
import {
  createDefaultTableWindows,
  focusWindow,
  isWindowOpen,
  resizeWindow,
} from "@/lib/ui/table-windows"
import { createDefaultTeachWindows, isTeachWindowOpen } from "@/lib/ui/teach-windows"
import { readFileSync } from "node:fs"

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

  it("retains width and height across stow / restore and session merge", () => {
    let windows = createDefaultTableWindows(1440, 820)
    windows = resizeWindow(windows, "orders", { width: 412, height: 501 })
    windows = stowWindow(windows, "orders")
    expect(isStowed(windows, "orders")).toBe(true)
    windows = restoreWindow(windows, "orders", { x: 40, y: 60 })
    const orders = windows.find((item) => item.id === "orders")
    expect(orders?.width).toBe(412)
    expect(orders?.height).toBe(501)
    expect(orders?.x).toBe(40)

    const defaults = createDefaultTeachWindows(1440, 820)
    const persisted = {
      windows: defaults.map((item) =>
        item.id === "orders"
          ? { ...item, open: false, x: 12, y: 34, width: 390, height: 440 }
          : item,
      ),
    }
    const merged = applyPersistedLayout(defaults, persisted)
    expect(isTeachWindowOpen(merged, "orders")).toBe(false)
    expect(merged.find((item) => item.id === "orders")?.width).toBe(390)
    expect(merged.find((item) => item.id === "orders")?.height).toBe(440)
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

  it("is drag-first: no Stow buttons; tray highlights on drop; Enter takes a tab out", () => {
    const tray = readFileSync("components/document-tray.tsx", "utf8")
    const paper = readFileSync("components/floating-window.tsx", "utf8")
    expect(tray).toContain("dropHighlight")
    expect(tray).toContain("data-drop-active")
    expect(tray).toContain("onRestoreAt")
    expect(tray).toMatch(/Enter/)
    expect(tray).not.toContain("onStow")
    expect(paper).not.toMatch(/>Stow</)
    expect(paper).not.toContain("floating-window-stow")
    expect(paper).not.toMatch(/getByRole\([^\)]*Stow/)
    expect(paper).toContain("onTrayHover")
    expect(paper).toContain("data-over-tray")
    expect(paper).toContain("shouldFileIntoTray")
    expect(paper).toContain("liftYAboveTray")
  })

  it("lifts session positions whose header sits under the tray (OHL stuck case)", () => {
    const stageH = 820
    const stuckY = trayTopY(stageH) - WINDOW_HEADER_HEIGHT + 12
    let windows = createDefaultTableWindows(1440, stageH)
    windows = windows.map((item) =>
      item.id === "ohl" ? { ...item, open: true, y: stuckY } : item,
    )
    const lifted = liftPersistedWindowsAboveTray(windows, stageH)
    const ohl = lifted.find((item) => item.id === "ohl")
    expect(ohl).toBeTruthy()
    expect(ohl!.y + WINDOW_HEADER_HEIGHT).toBeLessThanOrEqual(trayTopY(stageH))
  })
})
