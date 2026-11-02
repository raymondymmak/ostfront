import { describe, expect, it } from "vitest"
import {
  assertCardLabelMatchesOrders,
  assertQueueReflectsAdvisorAction,
} from "../scripts/demo-check-queue.mjs"

function snap(partial: Record<string, unknown>) {
  return {
    kind: "attack",
    from: "a",
    fromName: "A",
    to: "b",
    toName: "B",
    unitIds: [],
    ...partial,
  }
}

describe("demo-check queue assertions", () => {
  it("accepts a newly filed card when unrelated queue rows stay intact", () => {
    const before = [snap({ kind: "fortify", from: "krakow", fromName: "Kraków", to: undefined, toName: undefined, unitIds: [] })]
    const cardOrders = [
      snap({
        from: "konigsberg",
        fromName: "Königsberg",
        to: "bialystok",
        toName: "Białystok",
        unitIds: ["u1"],
      }),
    ]
    const after = [...before, ...cardOrders.map((order) => ({ ...order, unitIds: [...order.unitIds] }))]
    expect(
      assertQueueReflectsAdvisorAction({
        before,
        after,
        cardOrders,
        cardLabel: "Attack Białystok from Königsberg",
        mode: "accept",
      }).ok,
    ).toBe(true)
  })

  it("accepts override that re-files an existing line and adds more origins", () => {
    const before = [
      snap({
        from: "krakow",
        fromName: "Kraków",
        to: "lemberg",
        toName: "Lemberg",
        unitIds: ["u1"],
      }),
    ]
    const cardOrders = [
      snap({
        from: "krakow",
        fromName: "Kraków",
        to: "lemberg",
        toName: "Lemberg",
        unitIds: ["u1"],
      }),
      snap({
        from: "stanislav",
        fromName: "Stanislav",
        to: "lemberg",
        toName: "Lemberg",
        unitIds: ["u2"],
      }),
      snap({
        from: "bukovina",
        fromName: "Bukovina",
        to: "lemberg",
        toName: "Lemberg",
        unitIds: ["u3"],
      }),
    ]
    const after = [...before, ...cardOrders.slice(1)]
    expect(
      assertQueueReflectsAdvisorAction({
        before,
        after,
        cardOrders,
        cardLabel: "Attack Lemberg from Kraków, Stanislav and Bukovina",
        mode: "override",
      }).ok,
    ).toBe(true)
  })

  it("accepts override that adds units to an existing arrow without growing line count", () => {
    const before = [
      snap({
        from: "krakow",
        fromName: "Kraków",
        to: "lemberg",
        toName: "Lemberg",
        unitIds: ["u1"],
      }),
    ]
    const cardOrders = [
      snap({
        from: "krakow",
        fromName: "Kraków",
        to: "lemberg",
        toName: "Lemberg",
        unitIds: ["u1", "u2"],
      }),
    ]
    const after = [
      snap({
        from: "krakow",
        fromName: "Kraków",
        to: "lemberg",
        toName: "Lemberg",
        unitIds: ["u1", "u2"],
      }),
    ]
    expect(
      assertQueueReflectsAdvisorAction({
        before,
        after,
        cardOrders,
        cardLabel: "Attack Lemberg from Kraków",
        mode: "override",
      }).ok,
    ).toBe(true)
  })

  it("fails when an unrelated queue entry is removed", () => {
    const fortify = snap({
      kind: "fortify",
      from: "krakow",
      fromName: "Kraków",
      to: undefined,
      toName: undefined,
      unitIds: [],
    })
    const before = [
      fortify,
      snap({
        from: "krakow",
        fromName: "Kraków",
        to: "lemberg",
        toName: "Lemberg",
        unitIds: ["u1"],
      }),
    ]
    const cardOrders = [
      snap({
        from: "krakow",
        fromName: "Kraków",
        to: "lemberg",
        toName: "Lemberg",
        unitIds: ["u1", "u2"],
      }),
    ]
    const after = [cardOrders[0]]
    expect(
      assertQueueReflectsAdvisorAction({
        before,
        after,
        cardOrders,
        cardLabel: "Attack Lemberg from Kraków",
        mode: "override",
      }).ok,
    ).toBe(false)
  })

  it("fails a mislabelled attack card before queue diffing", () => {
    const cardOrders = [
      snap({
        from: "krakow",
        fromName: "Kraków",
        to: "lemberg",
        toName: "Lemberg",
        unitIds: ["u1"],
      }),
    ]
    expect(
      assertCardLabelMatchesOrders("Attack Kraków from Kraków", cardOrders).ok,
    ).toBe(false)
  })

  it("accepts a multi-province attack card when every prong is filed", () => {
    const before = [snap({ kind: "fortify", from: "krakow", fromName: "Kraków", to: undefined, toName: undefined, unitIds: [] })]
    const cardOrders = [
      snap({
        from: "konigsberg",
        fromName: "Königsberg",
        to: "bialystok",
        toName: "Białystok",
        unitIds: ["u1"],
      }),
      snap({
        from: "ermland_masuren",
        fromName: "Ermland-Masuren",
        to: "bialystok",
        toName: "Białystok",
        unitIds: ["u2"],
      }),
    ]
    const after = [...before, ...cardOrders]
    expect(
      assertQueueReflectsAdvisorAction({
        before,
        after,
        cardOrders,
        cardLabel: "Attack Białystok from Königsberg and Ermland-Masuren",
        mode: "accept",
      }).ok,
    ).toBe(true)
  })
})
