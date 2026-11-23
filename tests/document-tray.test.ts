import { describe, expect, it, vi } from "vitest"
import {
  applyPersistedLayout,
  CAMPAIGN_TRAY_ITEMS,
  defaultTrayOrder,
  insertIndexAtClientX,
  isStowed,
  liftPersistedWindowsAboveTray,
  normalizeTrayOrder,
  orderTrayItems,
  placeIdInOrder,
  pointerMovedEnough,
  restoreWindow,
  saveWindowSession,
  loadWindowSession,
  sessionStorageKey,
  shiftTrayId,
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
    expect(tray).toContain("tray-insert-marker")
    expect(tray).toContain("Alt+ArrowLeft")
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

  it("inserts a filed paper at the drop position among visible tabs", () => {
    const order = defaultTrayOrder(CAMPAIGN_TRAY_ITEMS)
    // Visible stowed: province, log, legend, advisor (orders+ohl out)
    const among = ["province", "log", "legend", "advisor"] as const
    const slots = [
      { left: 0, width: 100 },
      { left: 110, width: 100 },
      { left: 220, width: 100 },
      { left: 330, width: 100 },
    ]
    // Drop between Log (index 1) and Legend (index 2) → insert at 2
    expect(insertIndexAtClientX(200, slots)).toBe(2)
    const next = placeIdInOrder(order, "orders", 2, [...among])
    const visible = next.filter((id) => among.includes(id as (typeof among)[number]) || id === "orders")
    expect(visible).toEqual(["province", "log", "orders", "legend", "advisor"])
  })

  it("reorders a tab sideways among visible slots", () => {
    const order = ["orders", "province", "log", "legend", "advisor", "ohl"] as const
    const openById = { orders: true, ohl: true }
    // Visible: province, log, legend, advisor — move log right once
    const shifted = shiftTrayId([...order], "log", 1, openById)
    const visible = shifted.filter((id) => !openById[id as keyof typeof openById])
    expect(visible).toEqual(["province", "legend", "log", "advisor"])
  })

  it("persists trayOrder in sessionStorage with window layout", () => {
    const store = new Map<string, string>()
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    })
    const windows = createDefaultTableWindows(1440, 820)
    const trayOrder = placeIdInOrder(
      defaultTrayOrder(CAMPAIGN_TRAY_ITEMS),
      "orders",
      2,
      ["province", "log", "legend", "advisor"],
    )
    saveWindowSession("campaign", windows, trayOrder)
    const loaded = loadWindowSession<string>("campaign")
    expect(loaded?.trayOrder).toEqual(trayOrder)
    expect(normalizeTrayOrder(loaded?.trayOrder, defaultTrayOrder(CAMPAIGN_TRAY_ITEMS))).toEqual(
      trayOrder,
    )
    expect(orderTrayItems(CAMPAIGN_TRAY_ITEMS, trayOrder).map((item) => item.id)).toEqual(trayOrder)
    expect(store.get(sessionStorageKey("campaign"))).toContain("trayOrder")
    vi.unstubAllGlobals()
  })

  it("lifts session positions whose header sits under the tray (OHL stuck case)", () => {
    const stageH = 820
    const stuckY = trayTopY(stageH) - WINDOW_HEADER_HEIGHT + 12
    let windows = createDefaultTableWindows(1440, stageH)
    windows = windows.map((item) =>
      item.id === "ohl" ? { ...item, open: true, y: stuckY, z: 22 } : item,
    )
    const lifted = liftPersistedWindowsAboveTray(windows, stageH)
    const ohl = lifted.find((item) => item.id === "ohl")
    expect(ohl).toBeTruthy()
    expect(ohl!.y + WINDOW_HEADER_HEIGHT).toBeLessThanOrEqual(trayTopY(stageH))
    expect(ohl!.z).toBeGreaterThan(30)
  })

  it("lifts a locked-height Legend so the whole box stays above the tray", () => {
    const stageH = 805
    let windows = createDefaultTableWindows(1440, 820)
    const legend = windows.find((item) => item.id === "legend")
    expect(legend?.height).toBeTypeOf("number")
    // Stale Y from a taller stage (820 defaults on an 805 stage).
    windows = windows.map((item) =>
      item.id === "legend" ? { ...item, y: 424, height: 340 } : item,
    )
    const lifted = liftPersistedWindowsAboveTray(windows, stageH)
    const next = lifted.find((item) => item.id === "legend")!
    expect(next.y + (next.height ?? 340)).toBeLessThanOrEqual(trayTopY(stageH) - 8)
    expect(next.x).toBe(8)
  })
})
