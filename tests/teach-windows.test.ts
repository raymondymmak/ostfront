import { describe, expect, it } from "vitest"
import {
  closeTopmostTeachWindow,
  createDefaultTeachWindows,
  focusTeachWindow,
  isTeachWindowOpen,
  openTeachWindowRects,
  openTeachWindowsOverlap,
  rectsOverlap,
  TEACH_WINDOW_SIZE_HINTS,
  teachWindowHeights,
  topmostTeachWindow,
  toggleTeachWindow,
} from "@/lib/ui/teach-windows"
import { TABLE_WINDOW_MARGIN } from "@/lib/ui/table-windows"

describe("teach-windows", () => {
  it("defaults open Lesson, Orders, and Legend", () => {
    const windows = createDefaultTeachWindows(1440, 820)
    expect(isTeachWindowOpen(windows, "lesson")).toBe(true)
    expect(isTeachWindowOpen(windows, "orders")).toBe(true)
    expect(isTeachWindowOpen(windows, "legend")).toBe(true)
    expect(isTeachWindowOpen(windows, "province")).toBe(false)
  })

  it("stacks Legend under Lesson in the left column without overlap", () => {
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
      const heights = teachWindowHeights(w, h)
      // Same left edge; Legend starts below Lesson with a gap.
      expect(legend.x).toBe(lesson.x)
      expect(legend.x).toBe(TABLE_WINDOW_MARGIN)
      expect(legend.y).toBeGreaterThanOrEqual(lesson.y + heights.lesson)
      expect(legend.y + heights.legend).toBeLessThanOrEqual(h - TABLE_WINDOW_MARGIN + 1)
      // Left column stays left of mid-stage so Kraków/Kielce/Lublin stay clear.
      expect(lesson.x + TEACH_WINDOW_SIZE_HINTS.lesson.w).toBeLessThan(w * 0.45)
    }
  })

  it("keeps Lesson taller than Legend so Resolve has room in the left stack", () => {
    const heights = teachWindowHeights(1440, 820)
    expect(heights.lesson).toBeGreaterThan(heights.legend)
    expect(heights.lesson).toBeGreaterThanOrEqual(360)
  })

  it("open rects for Lesson and Legend do not overlap at 1440×820", () => {
    const windows = createDefaultTeachWindows(1440, 820)
    const rects = openTeachWindowRects(windows, 1440, 820)
    const lesson = rects.find((item) => item.id === "lesson")!
    const legend = rects.find((item) => item.id === "legend")!
    expect(rectsOverlap(lesson, legend, 12)).toBe(false)
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
