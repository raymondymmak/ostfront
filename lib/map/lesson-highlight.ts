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

export const LESSON_TARGET_LINE_WIDTH = 3.2
export const LESSON_SOURCE_LINE_WIDTH = 2.2
export const LESSON_FOCUS_FILL_OPACITY = 0.18
export const LESSON_PULSE_MS = 1600

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
