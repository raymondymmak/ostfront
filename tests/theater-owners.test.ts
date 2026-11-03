import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import * as turf from "@turf/turf"
import { COUNTRY_LABELS, STATE_OWNERS, WORLD_STATES } from "@/lib/data/geometry"
import fixes from "../scripts/theater-owner-fixes.json"

type ArcRef = number | ArcRef[]

type TopologyGeometry = {
  type: string
  arcs?: ArcRef[]
  geometries?: TopologyGeometry[]
  properties?: { owner_1914?: string }
}

const geometryPath = resolve(dirname(fileURLToPath(import.meta.url)), "../lib/data/theater-geometry.json")
const theater = JSON.parse(readFileSync(geometryPath, "utf8")) as {
  ownerColors: Record<string, string>
  topology: {
    objects: {
      states: { geometries: Array<TopologyGeometry & { properties: { owner_1914: string } }> }
      countryBorders: { type: string; geometries: TopologyGeometry[] }
    }
  }
}

function eachArcIndex(arcs: ArcRef[] | undefined, visit: (index: number) => void) {
  if (!arcs || arcs.length === 0) return
  if (typeof arcs[0] === "number") {
    for (const index of arcs) {
      if (typeof index === "number") visit(index < 0 ? ~index : index)
    }
    return
  }
  for (const child of arcs) {
    if (typeof child !== "number") eachArcIndex(child, visit)
  }
}

/** Same arc rule as scripts/patch-theater-owners.mjs: one LineString per shared arc of two different owners. */
function countryBorderGeometries(data: typeof theater) {
  const states = data.topology.objects.states.geometries
  const users = new Map<number, typeof states>()
  for (const state of states) {
    const seen = new Set<number>()
    eachArcIndex(state.arcs, (index) => seen.add(index))
    for (const index of seen) {
      const list = users.get(index)
      if (list) list.push(state)
      else users.set(index, [state])
    }
  }
  const kept: number[] = []
  for (const [index, list] of users) {
    if (list.length !== 2) continue
    if (list[0].properties.owner_1914 !== list[1].properties.owner_1914) kept.push(index)
  }
  kept.sort((left, right) => left - right)
  return kept.map((index) => ({ type: "LineString", arcs: [index] }))
}

describe("theater owner fixes", () => {
  const byStateId = new Map(WORLD_STATES.map((state) => [state.stateId, state]))

  it("applies every row in the fixes file", () => {
    expect(fixes).toHaveLength(28)
    expect(new Set(fixes.map((row) => row.stateId)).size).toBe(28)
    for (const row of fixes) {
      const state = byStateId.get(row.stateId)
      expect(state, row.stateId).toBeTruthy()
      expect(state!.playable, row.stateId).toBe(false)
      expect(STATE_OWNERS[row.stateId], row.stateId).toBe(row.owner)
      expect(state!.owner, row.stateId).toBe(row.owner)
      expect(state!.source, row.stateId).toBe("override")
    }
  })

  it("pins the states Raymond left unchanged", () => {
    expect(STATE_OWNERS.North_Darfur).toBe("darfur")
    expect(STATE_OWNERS.South_Darfur).toBe("darfur")
    expect(STATE_OWNERS.Tacna_Moquegua).toBe("chile")
    expect(STATE_OWNERS.Tierra_del_Fuego).toBe("argentina")
    expect(STATE_OWNERS.Azerbaijan).toBe("russia")
    expect(STATE_OWNERS.Bessarabia).toBe("russia")
    expect(STATE_OWNERS.Moldova).toBe("romania")
    expect(STATE_OWNERS.Navarra).toBe("spain")
    expect(STATE_OWNERS["País_Vasco"]).toBe("spain")
    expect(STATE_OWNERS.Casablanca).toBe("france")
    expect(STATE_OWNERS.Marrakech).toBe("france")
    expect(STATE_OWNERS.Spanish_Africa).toBe("spain")
  })

  it("keeps the playable 1914 owners that this issue must not touch", () => {
    expect(STATE_OWNERS.Katowice).toBe("german_empire")
    expect(STATE_OWNERS["Lwów"]).toBe("austro_hungarian_empire")
    expect(STATE_OWNERS["Stanisławów"]).toBe("austro_hungarian_empire")
    expect(STATE_OWNERS.Bucovina).toBe("austro_hungarian_empire")
    for (const stateId of ["Katowice", "Lwów", "Stanisławów", "Bucovina"]) {
      expect(byStateId.get(stateId)!.playable, stateId).toBe(true)
    }
  })

  it("stores country borders that match the owners", () => {
    expect(theater.topology.objects.countryBorders).toEqual({
      type: "GeometryCollection",
      geometries: countryBorderGeometries(theater),
    })
  })

  it("drops the Egypt label once those states are British", () => {
    expect(COUNTRY_LABELS.some((label) => label.owner === "egypt")).toBe(false)
    expect(WORLD_STATES.some((state) => state.owner === "egypt")).toBe(false)
    expect(theater.ownerColors.egypt).toBeUndefined()
  })

  it("places each changed owner's label inside that owner's states", () => {
    const changed = [...new Set(fixes.map((row) => row.owner))]
    for (const owner of changed) {
      const label = COUNTRY_LABELS.find((entry) => entry.owner === owner)
      expect(label, owner).toBeTruthy()
      const states = WORLD_STATES.filter((state) => state.owner === owner)
      expect(states.length, owner).toBeGreaterThan(0)
      const inside = states.some((state) => turf.booleanPointInPolygon(label!.label, state.geometry))
      expect(inside, owner).toBe(true)
    }
  })
})
