import { describe, expect, it } from "vitest"
import {
  closeTopmostTeachWindow,
  createDefaultTeachWindows,
  focusTeachWindow,
  isTeachWindowOpen,
  topmostTeachWindow,
  toggleTeachWindow,
} from "@/lib/ui/teach-windows"

describe("teach-windows", () => {
  it("defaults open Lesson, Orders, and Legend", () => {
    const windows = createDefaultTeachWindows(1440, 820)
    expect(isTeachWindowOpen(windows, "lesson")).toBe(true)
    expect(isTeachWindowOpen(windows, "orders")).toBe(true)
    expect(isTeachWindowOpen(windows, "legend")).toBe(true)
    expect(isTeachWindowOpen(windows, "province")).toBe(false)
  })

  it("keeps Lesson above Legend on a common desktop stage", () => {
    const windows = createDefaultTeachWindows(1440, 820)
    const lesson = windows.find((item) => item.id === "lesson")!
    const legend = windows.find((item) => item.id === "legend")!
    expect(lesson.y).toBeLessThan(legend.y)
    expect(lesson.y + 200).toBeLessThanOrEqual(legend.y + 8)
  })

  it("Escape helper closes the topmost open teach window", () => {
    let windows = createDefaultTeachWindows()
    windows = focusTeachWindow(windows, "province")
    windows = focusTeachWindow(windows, "lesson")
    expect(topmostTeachWindow(windows)).toBe("lesson")
    windows = closeTopmostTeachWindow(windows)
    expect(isTeachWindowOpen(windows, "lesson")).toBe(false)
    expect(topmostTeachWindow(windows)).toBe("province")
  })

  it("toggle closes Lesson when already open", () => {
    let windows = createDefaultTeachWindows()
    expect(isTeachWindowOpen(windows, "lesson")).toBe(true)
    windows = toggleTeachWindow(windows, "lesson")
    expect(isTeachWindowOpen(windows, "lesson")).toBe(false)
  })
})
