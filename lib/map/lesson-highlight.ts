/**
 * Teach-map lesson focus: brass outline on target + softer outline on source
 * provinces. Pulse respects prefers-reduced-motion.
 */

export const LESSON_TARGET_OUTLINE_LAYER = "lesson-target-outline"
export const LESSON_SOURCE_OUTLINE_LAYER = "lesson-source-outline"
export const LESSON_FOCUS_FILL_LAYER = "lesson-focus-fill"

/** Brass that reads on faction fills without replacing them. */
export const LESSON_HIGHLIGHT_BRASS = "#c6a15a"
export const LESSON_HIGHLIGHT_BRASS_DEEP = "#8a6a32"

export const LESSON_TARGET_LINE_WIDTH = 3.6
/** Thinner than the solid target ring; paired with a dasharray on the source layer. */
export const LESSON_SOURCE_LINE_WIDTH = 2.6
export const LESSON_FOCUS_FILL_OPACITY = 0.1
/** Strong enough to read on Central Powers blue fills under borders. */
export const LESSON_SOURCE_FILL_OPACITY = 0.28
export const LESSON_PULSE_MS = 1600
export const LESSON_SOURCE_DASH: [number, number] = [3.2, 1.6]

type LessonIdFilter = ["in", ["get", "id"], ["literal", string[]]]

/** Apply target/source filters to installed lesson layers (safe no-op if missing). */
export function applyLessonFocusLayers(
  map: {
    getLayer: (id: string) => unknown
    setFilter: (id: string, filter: LessonIdFilter) => unknown
    setPaintProperty: (id: string, name: string, value: number) => unknown
  },
  focus: LessonFocus | undefined,
): void {
  const targets = focus?.targets ?? []
  const sources = focus?.sources ?? []
  const none = ["__none__"]
  const sourceFilter: LessonIdFilter = [
    "in",
    ["get", "id"],
    ["literal", sources.length ? sources : none],
  ]
  const targetFilter: LessonIdFilter = [
    "in",
    ["get", "id"],
    ["literal", targets.length ? targets : none],
  ]

  if (map.getLayer(LESSON_FOCUS_FILL_LAYER)) {
    // Wash sources only — target relies on the solid pulsing outline.
    map.setFilter(LESSON_FOCUS_FILL_LAYER, sourceFilter)
    map.setPaintProperty(
      LESSON_FOCUS_FILL_LAYER,
      "fill-opacity",
      sources.length ? LESSON_SOURCE_FILL_OPACITY : 0,
    )
  }
  if (map.getLayer(LESSON_SOURCE_OUTLINE_LAYER)) {
    map.setFilter(LESSON_SOURCE_OUTLINE_LAYER, sourceFilter)
    map.setPaintProperty(
      LESSON_SOURCE_OUTLINE_LAYER,
      "line-opacity",
      sources.length ? 1 : 0,
    )
  }
  if (map.getLayer(LESSON_TARGET_OUTLINE_LAYER)) {
    map.setFilter(LESSON_TARGET_OUTLINE_LAYER, targetFilter)
    if (!targets.length) {
      map.setPaintProperty(LESSON_TARGET_OUTLINE_LAYER, "line-opacity", 0)
    }
  }
}

export type LessonFocus = {
  targets: string[]
  sources: string[]
}

export function lessonFocusActive(focus: LessonFocus | undefined): boolean {
  return Boolean(focus && (focus.targets.length > 0 || focus.sources.length > 0))
}

/** Compact attribute for demo-check / QA (`target:a,b;source:c,d`). */
export function lessonFocusAttribute(focus: LessonFocus | undefined): string | undefined {
  if (!lessonFocusActive(focus) || !focus) return undefined
  return `target:${focus.targets.join(",")};source:${focus.sources.join(",")}`
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Pulse target outline opacity. When reduced-motion is preferred, holds a
 * steady readable opacity instead of animating.
 */
export function startLessonTargetPulse(
  setOpacity: (opacity: number) => void,
  reducedMotion = prefersReducedMotion(),
): () => void {
  if (reducedMotion) {
    setOpacity(0.95)
    return () => {}
  }
  let frame = 0
  const tick = (now: number) => {
    const t = (now % LESSON_PULSE_MS) / LESSON_PULSE_MS
    // Soft pulse between ~0.55 and 1.0 — visible but not strobing.
    const opacity = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2))
    setOpacity(opacity)
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}
