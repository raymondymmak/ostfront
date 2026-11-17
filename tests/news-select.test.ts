import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { headlineFor, loreLine } from "@/lib/news/lore"
import { routineLog, selectNewsEvents } from "@/lib/news/select"
import type { TurnRecord } from "@/lib/types"

function clone<T>(value: T): T {
  return structuredClone(value)
}

function baseRecord(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    turn: 0,
    date: "2 May 1915",
    narration: "The line holds.",
    diplomacy: [],
    resolutions: [],
    events: [],
    controlChanges: [],
    logistics: [
      "Central Powers collect 4 manpower and 2 industry.",
      "Russia collect 3 manpower and 1 industry.",
    ],
    notes: [],
    gmSource: "mock",
    ...overrides,
  }
}

describe("selectNewsEvents", () => {
  it("shows one card when a victory city is taken", () => {
    const prev = createInitialState()
    const next = clone(prev)
    const lwow = next.provinces.find((p) => p.id === "lwow")!
    lwow.controller = "central"
    const record = baseRecord({
      controlChanges: [{ provinceId: "lwow", name: "Lemberg", from: "russia", to: "central" }],
    })
    const events = selectNewsEvents(prev, next, record)
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe("cityTaken")
    expect(events[0]?.provinceId).toBe("lwow")
  })

  it("shows no cards on a quiet fortnight", () => {
    const prev = createInitialState()
    const next = clone(prev)
    const events = selectNewsEvents(prev, next, baseRecord())
    expect(events).toHaveLength(0)
  })

  it("caps at four cards with objective priority", () => {
    const prev = createInitialState()
    const next = clone(prev)
    next.capturedOn = { lwow: 3, lublin: 5, wolyn: 4 }
    for (const id of ["lwow", "lublin", "wolyn"] as const) {
      const province = next.provinces.find((p) => p.id === id)!
      province.controller = "central"
    }
    for (const id of ["warszawa", "lodz"] as const) {
      const province = next.provinces.find((p) => p.id === id)!
      province.controller = "central"
    }
    const record = baseRecord({
      turn: 3,
      controlChanges: [
        { provinceId: "lwow", name: "Lemberg", from: "russia", to: "central" },
        { provinceId: "lublin", name: "Lublin", from: "russia", to: "central" },
        { provinceId: "wolyn", name: "Rovno", from: "russia", to: "central" },
        { provinceId: "warszawa", name: "Warsaw", from: "russia", to: "central" },
        { provinceId: "lodz", name: "Łódź", from: "russia", to: "central" },
      ],
    })
    prev.capturedOn = {}
    const events = selectNewsEvents(prev, next, record)
    expect(events.length).toBeLessThanOrEqual(4)
    const kinds = new Set(events.map((e) => e.kind))
    expect(kinds.has("objectiveTaken")).toBe(true)
    expect(events[0]?.kind).toBe("objectiveTaken")
  })
})

describe("lore determinism", () => {
  it("returns the same headline and lore for the same inputs", () => {
    const a = loreLine("cityTaken", "lwow", "Lemberg", "central", 2)
    const b = loreLine("cityTaken", "lwow", "Lemberg", "central", 2)
    const h1 = headlineFor("cityTaken", "lwow", "Lemberg", 2)
    const h2 = headlineFor("cityTaken", "lwow", "Lemberg", 2)
    expect(a).toBe(b)
    expect(h1).toBe(h2)
  })
})

describe("routineLog", () => {
  it("pulls short income and supply rows", () => {
    const rows = routineLog(
      baseRecord({
        logistics: [
          "Central Powers collect 2 manpower and 1 industry.",
          "X Corps marches toward Lemberg.",
          "Kraków drops below supply 30. Its formations cannot advance next fortnight.",
        ],
      }),
    )
    expect(rows.some((line) => /collect \d+ manpower/i.test(line))).toBe(true)
    expect(rows.some((line) => /supply 30/i.test(line))).toBe(true)
    expect(rows.some((line) => /marches toward/i.test(line))).toBe(false)
  })
})