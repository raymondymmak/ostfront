import { describe, expect, it } from "vitest"
import {
  assertQueueReflectsAdvisorAction,
  queueIncludesAcceptedLabel,
  queueOrderLinesChanged,
} from "../scripts/demo-check-queue.mjs"

describe("demo-check queue assertions", () => {
  it("detects a full override replacement when the queue length stays the same", () => {
    const before = ["Move to Katowice from Kraków"]
    const after = ["Attack Kielce from Kraków"]
    expect(queueOrderLinesChanged(before, after)).toBe(true)
    const result = assertQueueReflectsAdvisorAction(
      before,
      after,
      "Attack Kielce from Kraków",
    )
    expect(result.ok).toBe(true)
  })

  it("accepts a newly added order when the queue grows", () => {
    const before = ["Fortify Kraków"]
    const after = ["Fortify Kraków", "Raise infantry at Kraków"]
    expect(
      assertQueueReflectsAdvisorAction(before, after, "Raise infantry at Kraków").ok,
    ).toBe(true)
  })

  it("fails when the queue text is unchanged", () => {
    const lines = ["Move to Katowice from Kraków"]
    expect(assertQueueReflectsAdvisorAction(lines, lines, "Attack Kielce from Kraków").ok).toBe(
      false,
    )
  })

  it("matches accepted labels case-insensitively", () => {
    expect(
      queueIncludesAcceptedLabel(["Raise Infantry at Kraków"], "Raise infantry at Kraków"),
    ).toBe(true)
  })
})
