import { describe, expect, it } from "vitest"
import {
  assertQueueReflectsAdvisorAction,
  lineNewlyPresentInQueue,
  queueOrderLinesChanged,
} from "../scripts/demo-check-queue.mjs"

describe("demo-check queue assertions", () => {
  it("accepts a multi-province attack card when each prong line is newly queued", () => {
    const before = ["Fortify Kraków"]
    const after = [
      "Fortify Kraków",
      "Attack Białystok from Königsberg",
      "Attack Białystok from Ermland-Masuren",
    ]
    const expected = [
      "Attack Białystok from Königsberg",
      "Attack Białystok from Ermland-Masuren",
    ]
    expect(queueOrderLinesChanged(before, after)).toBe(true)
    expect(assertQueueReflectsAdvisorAction(before, after, expected).ok).toBe(true)
  })

  it("rejects a mislabelled card when expected lines were not newly filed", () => {
    const before = ["Fortify Kraków"]
    const after = ["Fortify Kraków", "Fortify Königsberg"]
    const expected = ["Fortify Kraków"]
    expect(assertQueueReflectsAdvisorAction(before, after, expected).ok).toBe(false)
  })

  it("detects a full override replacement when the queue length stays the same", () => {
    const before = ["Move to Katowice from Kraków"]
    const after = ["Attack Kielce from Kraków"]
    const expected = ["Attack Kielce from Kraków"]
    expect(queueOrderLinesChanged(before, after)).toBe(true)
    expect(assertQueueReflectsAdvisorAction(before, after, expected).ok).toBe(true)
  })

  it("does not treat an already-queued line as proof the card filed", () => {
    const before = ["Fortify Kraków"]
    const after = ["Fortify Kraków", "Fortify Königsberg"]
    const expected = ["Fortify Kraków", "Fortify Königsberg"]
    expect(lineNewlyPresentInQueue(before, after, "Fortify Kraków")).toBe(false)
    expect(assertQueueReflectsAdvisorAction(before, after, expected).ok).toBe(false)
  })

  it("accepts a newly added order when the queue grows", () => {
    const before = ["Fortify Kraków"]
    const after = ["Fortify Kraków", "Raise Infantry at Kraków"]
    expect(assertQueueReflectsAdvisorAction(before, after, ["Raise Infantry at Kraków"]).ok).toBe(
      true,
    )
  })

  it("fails when the queue text is unchanged", () => {
    const lines = ["Move to Katowice from Kraków"]
    expect(
      assertQueueReflectsAdvisorAction(lines, lines, ["Attack Kielce from Kraków"]).ok,
    ).toBe(false)
  })
})
