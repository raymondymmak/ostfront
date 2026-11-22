import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import {
  LESSON_FOCUS_FILL_LAYER,
  LESSON_SOURCE_DASH,
  LESSON_SOURCE_FILL_OPACITY,
  LESSON_SOURCE_LINE_WIDTH,
  LESSON_SOURCE_OUTLINE_LAYER,
  LESSON_TARGET_LINE_WIDTH,
  LESSON_TARGET_OUTLINE_LAYER,
  applyLessonFocusLayers,
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
    expect(
      lessonFocusAttribute({ targets: ["kielce"], sources: ["katowice", "krakow"] }),
    ).toBe("target:kielce;source:katowice,krakow")
    expect(lessonFocusAttribute({ targets: [], sources: [] })).toBeUndefined()
  })

  it("keeps source outlines thinner/dashed and distinct from the solid target ring", () => {
    expect(LESSON_SOURCE_LINE_WIDTH).toBeLessThan(LESSON_TARGET_LINE_WIDTH)
    expect(LESSON_SOURCE_DASH[0]).toBeGreaterThan(0)
    expect(LESSON_SOURCE_FILL_OPACITY).toBeGreaterThan(0.15)
    const layers = readFileSync("lib/map/war-map-layers.ts", "utf8")
    const sourceLayer = layers.indexOf("id: LESSON_SOURCE_OUTLINE_LAYER")
    const railCut = layers.indexOf('id: "rail-cut"')
    expect(sourceLayer).toBeGreaterThan(railCut)
    expect(layers.slice(sourceLayer, sourceLayer + 400)).toContain("line-dasharray")
    const warMap = readFileSync("components/war-map.tsx", "utf8")
    expect(warMap).toContain("applyLessonFocusLayers")
    expect(warMap).toContain("mapReady")
  })

  it("applies source and target filters onto lesson layers", () => {
    const filters: Record<string, unknown> = {}
    const paint: Record<string, unknown> = {}
    const map = {
      getLayer: (id: string) => ({ id }),
      setFilter: (id: string, filter: unknown) => {
        filters[id] = filter
      },
      setPaintProperty: (id: string, name: string, value: unknown) => {
        paint[`${id}:${name}`] = value
      },
    }
    applyLessonFocusLayers(map, {
      targets: ["lublin"],
      sources: ["krakow", "kielce"],
    })
    expect(filters[LESSON_FOCUS_FILL_LAYER]).toEqual([
      "in",
      ["get", "id"],
      ["literal", ["krakow", "kielce"]],
    ])
    expect(filters[LESSON_SOURCE_OUTLINE_LAYER]).toEqual([
      "in",
      ["get", "id"],
      ["literal", ["krakow", "kielce"]],
    ])
    expect(filters[LESSON_TARGET_OUTLINE_LAYER]).toEqual([
      "in",
      ["get", "id"],
      ["literal", ["lublin"]],
    ])
    expect(paint[`${LESSON_FOCUS_FILL_LAYER}:fill-opacity`]).toBe(LESSON_SOURCE_FILL_OPACITY)
    expect(paint[`${LESSON_SOURCE_OUTLINE_LAYER}:line-opacity`]).toBe(1)
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
