import { beforeEach, describe, expect, it } from "vitest"
import { RAIL_GAPS } from "@/lib/data/catalog"
import { createInitialState } from "@/lib/data/scenario"
import { playTurn } from "@/lib/gm"
import { interpretOrders } from "@/lib/gm/interpret"
import { TurnRequestSchema } from "@/lib/schema"

describe("June 1915 scenario", () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY
  })
  it("builds forty provinces, connected rails, and a Russian-held Warsaw", () => {
    const state = createInitialState()
    expect(state.provinces).toHaveLength(40)
    expect(state.date).toBe("4 June 1915")
    expect(RAIL_GAPS).toEqual([])

    const warsaw = state.provinces.find((province) => province.id === "warsaw")!
    const konigsberg = state.provinces.find((province) => province.id === "konigsberg")!
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const rovno = state.provinces.find((province) => province.id === "rovno")!
    const lemberg = state.provinces.find((province) => province.id === "lemberg")!
    const przemysl = state.provinces.find((province) => province.id === "przemysl")!

    expect(warsaw.controller).toBe("russia")
    expect(warsaw.depot).toBe("russia")
    expect(warsaw.supply).toBe(100)
    expect(konigsberg.depot).toBe("central")
    expect(konigsberg.supply).toBe(100)
    expect(krakow.depot).toBe("central")
    expect(rovno.depot).toBe("russia")
    expect(lemberg.controller).toBe("russia")
    expect(lemberg.owner).toBe("central")
    expect(przemysl.controller).toBe("central")
    expect(przemysl.neighbors).toContain("lemberg")
    expect(przemysl.supply).toBeGreaterThanOrEqual(60)
    expect(lemberg.supply).toBeGreaterThanOrEqual(50)

    const ids = state.provinces.flatMap((province) =>
      province.units.map((unit) => unit.id),
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(TurnRequestSchema.safeParse({ state, orders: [] }).success).toBe(true)
  })

  it("reads an attack on Lemberg and resolves a mock fortnight", async () => {
    const state = createInitialState()
    const interpreted = interpretOrders(state, [
      { type: "text", text: "Attack Lemberg." },
    ])
    const attack = interpreted.proposals.find((proposal) => proposal.type === "attack")
    expect(attack).toMatchObject({ type: "attack", target: "lemberg" })

    const played = await playTurn(state, [
      { type: "text", text: "Attack Lemberg." },
    ])
    expect(played.record.gmSource).toBe("mock")
    expect(played.record.narration.length).toBeGreaterThan(40)
    expect(played.state.turn).toBe(1)
    expect(played.state.date).toBe("18 June 1915")
    expect(
      played.record.resolutions.some(
        (item) => item.proposal.type === "attack" && item.status === "applied",
      ),
    ).toBe(true)
    for (const province of played.state.provinces) {
      expect(province.supply).toBeGreaterThanOrEqual(0)
      expect(province.supply).toBeLessThanOrEqual(100)
      expect(province.unrest).toBeGreaterThanOrEqual(0)
      expect(province.unrest).toBeLessThanOrEqual(100)
    }
  })
})
