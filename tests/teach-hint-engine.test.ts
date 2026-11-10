import { describe, expect, it } from "vitest"
import { coachHints } from "@/lib/teach/coach"
import {
  authoritativeLessonState,
  CONVERGING_LUBLIN_ID,
  lessonMeta,
  SUPPLY_TRADEOFF_ID,
  TEACH_LESSON_IDS,
  type TeachLessonId,
} from "@/lib/teach/lessons"
import {
  lessonEngagementPreview,
  lessonSingleProngPreviews,
} from "@/lib/teach/preview"
function decimalsIn(text: string): string[] {
  return [...text.matchAll(/\b\d+\.\d+\b/g)].map((match) => match[0])
}

describe("guided coach hints match engine previews", () => {
  it.each(TEACH_LESSON_IDS.map((id) => [id]))(
    "hint numbers for %s align with assault preview",
    (lessonId: TeachLessonId) => {
      const state = authoritativeLessonState(lessonId, "guided")
      const meta = lessonMeta(lessonId, "guided")
      const hints = coachHints(meta, state, "guided")
      const level3 = hints.find((hint) => hint.level === 3)
      expect(level3).toBeDefined()

      if (lessonId === CONVERGING_LUBLIN_ID) {
        const previews = lessonSingleProngPreviews(state, meta.targetProvinceId, meta.prongProvinceIds)
        expect(previews.every(Boolean)).toBe(true)
        const combined = lessonEngagementPreview(state, meta.targetProvinceId, meta.prongProvinceIds)
        expect(combined).not.toBeNull()
        const bestSingle = Math.max(...previews.map((preview) => preview!.ratio))
        const text = level3!.text
        expect(text).toContain(bestSingle.toFixed(2))
        expect(text).toContain(combined!.ratio.toFixed(2))
        expect(text).toContain(combined!.multiplier.toFixed(2))
        expect(decimalsIn(text)).toEqual([
          bestSingle.toFixed(2),
          combined!.ratio.toFixed(2),
          combined!.multiplier.toFixed(2),
        ])
        return
      }

      if (lessonId === SUPPLY_TRADEOFF_ID) {
        const [heavyId, fedId] = meta.prongProvinceIds
        const heavyPreview = lessonEngagementPreview(state, meta.targetProvinceId, [heavyId])!
        const fedPreview = lessonEngagementPreview(state, meta.targetProvinceId, [fedId])!
        const text = level3!.text
        expect(text).toContain(heavyPreview.attack.toFixed(1))
        expect(text).toContain(heavyPreview.ratio.toFixed(2))
        expect(text).toContain(fedPreview.attack.toFixed(1))
        expect(text).toContain(fedPreview.ratio.toFixed(2))
        const combatDecimals = decimalsIn(text).filter((value) => value !== "0.15")
        expect(combatDecimals).toEqual([
          heavyPreview.attack.toFixed(1),
          heavyPreview.ratio.toFixed(2),
          fedPreview.attack.toFixed(1),
          fedPreview.ratio.toFixed(2),
        ])
      }
    },
  )

  it("Lublin L3 matches current engine (not legacy all-units preview)", () => {
    const state = authoritativeLessonState("converging-lublin", "guided")
    const meta = lessonMeta("converging-lublin", "guided")
    const combined = lessonEngagementPreview(state, meta.targetProvinceId, meta.prongProvinceIds)!
    const previews = lessonSingleProngPreviews(state, meta.targetProvinceId, meta.prongProvinceIds)
    const bestSingle = Math.max(...previews.map((preview) => preview!.ratio))
    const l3 = coachHints(meta, state, "guided").find((hint) => hint.level === 3)!.text
    expect(bestSingle).toBeCloseTo(0.52, 2)
    expect(combined.ratio).toBeCloseTo(1.11, 2)
    expect(l3).toBe(
      `Engine preview: one prong peaks around ${bestSingle.toFixed(2)} before the die; combined from ${combined.origins} directions is ${combined.ratio.toFixed(2)} with a ×${combined.multiplier.toFixed(2)} flank bonus. Same fortnight, same target — one battle.`,
    )
  })
})
