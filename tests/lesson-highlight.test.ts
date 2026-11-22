import { describe, expect, it, vi } from "vitest"
import {
  lessonFocusActive,
  lessonFocusAttribute,
  startLessonTargetPulse,
} from "@/lib/map/lesson-highlight"

describe("lesson highlight", () => {
  it("serializes target and source province ids for QA", () => {
    expect(lessonFocusActive(undefined)).toBe(false)
    expect(
      lessonFocusAttribute({ targets: ["lublin"], sources: ["krakow", "kielce"] }),
    ).toBe("target:lublin;source:krakow,kielce")
    expect(lessonFocusAttribute({ targets: [], sources: [] })).toBeUndefined()
  })

  it("holds steady opacity when reduced motion is preferred", () => {
    const setOpacity = vi.fn()
    const stop = startLessonTargetPulse(setOpacity, true)
    expect(setOpacity).toHaveBeenCalledWith(0.95)
    stop()
  })

  it("starts a pulse frame when motion is allowed", () => {
    const setOpacity = vi.fn()
    const raf = vi.fn(() => 1)
    const caf = vi.fn()
    vi.stubGlobal("requestAnimationFrame", raf)
    vi.stubGlobal("cancelAnimationFrame", caf)
    const stop = startLessonTargetPulse(setOpacity, false)
    expect(raf).toHaveBeenCalled()
    stop()
    expect(caf).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
