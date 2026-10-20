import { beforeEach, describe, expect, it } from "vitest"
import { RAIL_GAPS } from "@/lib/data/catalog"
import { createInitialState } from "@/lib/data/scenario"
import { playTurn } from "@/lib/gm"
import { interpretOrders } from "@/lib/gm/interpret"
import { TurnRequestSchema } from "@/lib/schema"

describe("Gorlice–Tarnów, 2 May 1915", () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY
  })
  it("builds the Dunajec front, connected rails, and a Russian-held Kielce", () => {
    const state = createInitialState()
    expect(state.provinces).toHaveLength(39)
    expect(state.scenario).toBe("gorlice")
    expect(state.date).toBe("2 May 1915")
    expect(RAIL_GAPS).toEqual([])

    const warsaw = state.provinces.find((province) => province.id === "warszawa")!
    const konigsberg = state.provinces.find((province) => province.id === "konigsberg")!
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const rovno = state.provinces.find((province) => province.id === "wolyn")!
    const lemberg = state.provinces.find((province) => province.id === "lwow")!

    expect(warsaw.controller).toBe("russia")
    expect(warsaw.depot).toBe("russia")
    expect(warsaw.supply).toBe(100)
    expect(konigsberg.depot).toBe("central")
    expect(konigsberg.supply).toBe(100)
    expect(krakow.controller).toBe("central")
    expect(krakow.depot).toBe("central")
    expect(krakow.supply).toBe(100)
    expect(rovno.depot).toBe("russia")
    expect(rovno.supply).toBe(100)
    expect(lemberg.owner).toBe("central")
    expect(lemberg.controller).toBe("central")
    expect(lemberg.depot).toBe("central")
    expect(lemberg.supply).toBe(100)
    expect(lemberg.unrest).toBe(0)
    expect(krakow.neighbors).toContain("lwow")

    for (const id of ["katowice", "stanislawow", "bucovina"] as const) {
      const province = state.provinces.find((item) => item.id === id)!
      expect(province.owner).toBe("central")
      expect(province.controller).toBe("central")
      expect(province.unrest).toBe(0)
      expect(province.units.every((unit) => unit.faction === "central")).toBe(true)
    }
    expect(lemberg.units.every((unit) => unit.faction === "central")).toBe(true)
    expect(lemberg.units.length).toBeGreaterThan(0)
    const stanislav = state.provinces.find((province) => province.id === "stanislawow")!
    const bukovina = state.provinces.find((province) => province.id === "bucovina")!
    expect(stanislav.supply).toBeGreaterThanOrEqual(50)
    expect(bukovina.supply).toBeGreaterThanOrEqual(50)

    const ids = state.provinces.flatMap((province) =>
      province.units.map((unit) => unit.id),
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(TurnRequestSchema.safeParse({ state, orders: [] }).success).toBe(true)
  })

  it("reads an attack on Lublin and resolves a mock fortnight", async () => {
    const state = createInitialState()
    const interpreted = interpretOrders(state, [
      { type: "text", text: "Attack Lublin." },
    ])
    const attack = interpreted.proposals.find((proposal) => proposal.type === "attack")
    expect(attack).toMatchObject({ type: "attack", target: "lublin" })

    const played = await playTurn(state, [
      { type: "text", text: "Attack Lublin." },
    ])
    expect(played.record.gmSource).toBe("mock")
    expect(played.record.narration.length).toBeGreaterThan(40)
    expect(played.state.turn).toBe(1)
    expect(played.state.date).toBe("16 May 1915")
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
