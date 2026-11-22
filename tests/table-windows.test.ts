import { describe, expect, it } from "vitest"
import {
  closeTopmostWindow,
  closeWindow,
  createDefaultTableWindows,
  focusWindow,
  isWindowOpen,
  moveWindow,
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
})
