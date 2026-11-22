import { describe, expect, it } from "vitest"
import {
  closeTopmostTeachWindow,
  createDefaultTeachWindows,
  focusTeachWindow,
  isTeachWindowOpen,
  openTeachWindowsOverlap,
  TEACH_WINDOW_SIZE_HINTS,
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

  it("keeps open windows from overlapping at common desktop sizes", () => {
    for (const [w, h] of [
      [1440, 820],
      [1440, 900 - 80],
      [1280, 800 - 80],
      [1024, 700],
    ] as const) {
      const windows = createDefaultTeachWindows(w, h)
      expect(openTeachWindowsOverlap(windows, w, h)).toBe(false)
      const lesson = windows.find((item) => item.id === "lesson")!
      const legend = windows.find((item) => item.id === "legend")!
      // Legend sits to the right of the Lesson column, not under it.
      expect(legend.x).toBeGreaterThanOrEqual(
        lesson.x + TEACH_WINDOW_SIZE_HINTS.lesson.w,
      )
    }
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
