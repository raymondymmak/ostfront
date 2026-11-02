import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import type { AdvisorOrder } from "@/lib/gm/advisor-types"
import { advisorOrdersQueueLineTexts } from "@/lib/orders"

describe("advisorOrdersQueueLineTexts", () => {
  it("emits one queue line per attack prong on a multi-province card", () => {
    const state = createInitialState("normal")
    const orders: AdvisorOrder[] = [
      { type: "attack", from: "konigsberg", target: "bialystok", unitIds: ["g-kon-inf"] },
      { type: "attack", from: "ermland_masuren", target: "bialystok", unitIds: ["g-erm-inf"] },
    ]
    expect(advisorOrdersQueueLineTexts(state, orders)).toEqual([
      "Attack Białystok from Königsberg",
      "Attack Białystok from Ermland-Masuren",
    ])
  })
})
