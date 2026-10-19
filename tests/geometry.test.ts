import { describe, expect, it } from "vitest"
import { CATALOG, PROVINCE_COUNT } from "@/lib/data/catalog"
import {
  ALL_NEIGHBORS,
  BACKDROP_REGIONS,
  GEOMETRY_SOURCE,
  OWNER_AUDIT,
  STATE_OWNERS,
  VIEW_BBOX,
  WORLD_STATES,
  backdropColor,
  buildTheater,
  geometryValid,
  neighborsFromPolygons,
  sharedBorderKm,
} from "@/lib/data/geometry"
import { createInitialState } from "@/lib/data/scenario"
import type { Feature, MultiPolygon, Polygon } from "geojson"
import * as turf from "@turf/turf"

const OVERLAP_M2 = 1_000_000

function featureOf(geometry: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry }
}

describe("theater geometry", () => {
  const theater = buildTheater()

  it("gives every province a valid polygon", () => {
    expect(Object.keys(theater.polygons)).toHaveLength(PROVINCE_COUNT)
    expect(GEOMETRY_SOURCE).toContain("MapChart.net")
    for (const province of CATALOG) {
      expect(geometryValid(theater.polygons[province.id])).toBe(true)
      expect(geometryValid(province.polygon)).toBe(true)
    }
  })

  it("places each centroid inside its province polygon", () => {
    for (const province of CATALOG) {
      const centroid = theater.centroids[province.id]
      const inside = turf.booleanPointInPolygon(
        turf.point(centroid),
        featureOf(theater.polygons[province.id]) as Feature<Polygon>,
      )
      expect(inside).toBe(true)
    }
  })

  it("keeps adjacency symmetric", () => {
    for (const province of CATALOG) {
      expect(theater.neighbors[province.id].length).toBeGreaterThan(0)
      for (const other of theater.neighbors[province.id]) {
        expect(theater.neighbors[other]).toContain(province.id)
      }
    }
  })

  it("has no neighbour gaps or overlaps above a tiny tolerance", () => {
    const features = CATALOG.map((province) =>
      turf.feature(theater.polygons[province.id], { id: province.id }),
    )
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        const overlap = turf.intersect(turf.featureCollection([features[i], features[j]]))
        if (overlap) expect(turf.area(overlap)).toBeLessThan(OVERLAP_M2)
      }
    }
    for (const province of CATALOG) {
      for (const other of theater.neighbors[province.id]) {
        const a = featureOf(theater.polygons[province.id])
        const b = featureOf(theater.polygons[other])
        expect(sharedBorderKm(a, b)).toBeGreaterThan(0.25)
      }
    }
  })

  it("matches polygon-derived adjacency from stored neighbors", () => {
    const derived = neighborsFromPolygons(theater.polygons)
    for (const province of CATALOG) {
      expect(derived[province.id]).toEqual(theater.neighbors[province.id])
    }
  })

  it("keeps the playable front in one connected piece", () => {
    const seen = new Set<string>()
    const stack = [CATALOG[0].id]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      stack.push(...theater.neighbors[id])
    }
    expect(seen.size).toBe(PROVINCE_COUNT)
  })

  it("frames the theater from the Baltic to the Black Sea", () => {
    expect(VIEW_BBOX).toEqual([-3.0286, -3.248, 3.5801, 3.105])
    const owners = new Set(BACKDROP_REGIONS.map((region) => region.owner))
    expect(owners.has("romania")).toBe(true)
    expect(owners.has("sweden") || owners.has("russia")).toBe(true)
    for (const region of BACKDROP_REGIONS) {
      expect(CATALOG.some((province) => province.id === region.id)).toBe(false)
      expect(region.owner.length).toBeGreaterThan(0)
      expect(geometryValid(region.geometry)).toBe(true)
    }
  })

  it("gives every backdrop state an owner", () => {
    expect(OWNER_AUDIT).toBeTruthy()
    expect(OWNER_AUDIT!.nameMatched + OWNER_AUDIT!.fallback).toBe(OWNER_AUDIT!.states)
    expect(OWNER_AUDIT!.nameMatched).toBeGreaterThan(400)
    expect(OWNER_AUDIT!.states).toBe(Object.keys(STATE_OWNERS).length)
    for (const [id, owner] of Object.entries(STATE_OWNERS)) {
      expect(owner, id).toBeTruthy()
      expect(owner).not.toBe("unclaimed")
    }
  })

  it("paints the backdrop in neutral greys", () => {
    const owners = new Set<string>([
      ...BACKDROP_REGIONS.map((region) => region.owner),
      ...Object.values(STATE_OWNERS),
    ])
    for (const owner of owners) {
      const color = backdropColor(owner)
      expect(color, owner).toMatch(/^#[0-9a-f]{6}$/)
      expect(hsvSaturation(color), owner).toBeLessThan(0.08)
    }
    expect(backdropColor("german_empire")).not.toBe("#9aa3ad")
    expect(backdropColor("german_empire")).not.toBe("#4a6d90")
  })

  it("keeps the July 1914 de jure owners", () => {
    expect(STATE_OWNERS.Bosnia).toBe("austro_hungarian_empire")
    expect(STATE_OWNERS.Thrace).toBe("bulgaria")
    expect(STATE_OWNERS.Central_Macedonia).toBe("greece")
    expect(STATE_OWNERS.Nicaragua).toBe("nicaragua")
    expect(STATE_OWNERS.Casablanca).toBe("france")
    expect(STATE_OWNERS.Marrakech).toBe("france")
    expect(STATE_OWNERS.Spanish_Africa).toBe("spain")
    expect(STATE_OWNERS.Labrador).toBe("newfoundland")
    expect(STATE_OWNERS.Newfoundland).toBe("newfoundland")
    expect(STATE_OWNERS.Johor).toBe("united_kingdom")
    expect(STATE_OWNERS.Kelantan).toBe("united_kingdom")
    expect(STATE_OWNERS.Brunei).toBe("united_kingdom")
    expect(STATE_OWNERS.Kuwait).toBe("united_kingdom")
    expect(STATE_OWNERS.Sikkim).toBe("united_kingdom")
    expect(STATE_OWNERS.Khuzestan).toBe("persia")
    expect(STATE_OWNERS.Maldives).toBe("united_kingdom")
    expect(STATE_OWNERS.Cairo).toBe("egypt")
    expect(STATE_OWNERS.Tunisia).toBe("france")
    expect(STATE_OWNERS.Albania).toBe("albania")
    expect(STATE_OWNERS.Northern_Epirus).toBe("albania")
    expect(STATE_OWNERS.Tehran).toBe("persia")
    expect(STATE_OWNERS.Isfahan).toBe("persia")
    expect(STATE_OWNERS.Gangwon).toBe("empire_of_japan")
    expect(STATE_OWNERS.Hulunbuir).toBe("mongolia")
    expect(STATE_OWNERS.Ulaanbaatar).toBe("mongolia")
    expect(STATE_OWNERS.East_Timor).toBe("portugal")
    expect(STATE_OWNERS.Portuguese_Guinea).toBe("portugal")
    expect(STATE_OWNERS.Equatorial_Guinea).toBe("spain")
    expect(STATE_OWNERS.Gilbert_Islands).toBe("united_kingdom")
    expect(STATE_OWNERS.Leeward_Islands).toBe("united_kingdom")
    expect(STATE_OWNERS.North_Darfur).toBe("darfur")
    expect(STATE_OWNERS.South_Darfur).toBe("darfur")
    expect(STATE_OWNERS.Bhutan).toBe("bhutan")
    expect(STATE_OWNERS.Nepal).toBe("nepal")
    expect(STATE_OWNERS.Oman).toBe("oman")
  })

  it("keeps every source state, including the tiny ones, at full detail", () => {
    expect(WORLD_STATES).toHaveLength(OWNER_AUDIT!.states)
    expect(WORLD_STATES).toHaveLength(1081)
    const playable = WORLD_STATES.filter((state) => state.playable).map((state) => state.id).sort()
    expect(playable).toEqual(CATALOG.map((province) => province.id).sort())
    const byId = new Map(WORLD_STATES.map((state) => [state.id, state]))
    const tiny = [
      "hong_kong",
      "macau",
      "gibraltar",
      "singapore",
      "luxembourg",
      "malta",
      "bahrain",
      "danzig",
    ]
    for (const id of tiny) {
      const state = byId.get(id)
      expect(state, id).toBeTruthy()
      expect(geometryValid(state!.geometry), id).toBe(true)
      expect(turf.area(featureOf(state!.geometry)), id).toBeGreaterThan(0)
    }
    for (const state of WORLD_STATES) {
      expect(geometryValid(state.geometry), state.id).toBe(true)
      expect(turf.area(featureOf(state.geometry)), state.id).toBeGreaterThan(0)
      expect(["name", "fallback", "override"], state.id).toContain(state.source)
      expect(state.owner.length, state.id).toBeGreaterThan(0)
      expect(STATE_OWNERS[state.stateId], state.stateId).toBe(state.owner)
    }
    expect(byId.get("hong_kong")!.owner).toBe("united_kingdom")
    expect(byId.get("macau")!.owner).toBe("portugal")
    expect(byId.get("danzig")!.playable).toBe(true)
  })

  it("stores adjacency for every state and only plays the playable subgraph", () => {
    expect(Object.keys(ALL_NEIGHBORS)).toHaveLength(WORLD_STATES.length)
    const playable = new Set(CATALOG.map((province) => province.id))
    for (const [id, list] of Object.entries(ALL_NEIGHBORS)) {
      for (const other of list) {
        expect(ALL_NEIGHBORS[other], `${id}-${other}`).toContain(id)
        expect(other).not.toBe(id)
      }
    }
    for (const province of CATALOG) {
      expect(theater.neighbors[province.id].length).toBeGreaterThan(0)
      for (const other of theater.neighbors[province.id]) {
        expect(playable.has(other), other).toBe(true)
        expect(ALL_NEIGHBORS[province.id]).toContain(other)
      }
    }
    expect(BACKDROP_REGIONS.every((region) => !playable.has(region.id))).toBe(true)
  })
})

function hsvSaturation(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  const red = ((value >> 16) & 255) / 255
  const green = ((value >> 8) & 255) / 255
  const blue = (value & 255) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  if (max === 0) return 0
  return (max - min) / max
}

describe("opening map counters", () => {
  it("places every unit and every depot in a valid province", () => {
    const state = createInitialState()
    const ids = new Set(state.provinces.map((province) => province.id))
    const theater = buildTheater()
    let units = 0
    let depots = 0
    for (const province of state.provinces) {
      expect(ids.has(province.id)).toBe(true)
      expect(geometryValid(theater.polygons[province.id])).toBe(true)
      if (province.depot) {
        depots += 1
        expect(province.depot === "central" || province.depot === "russia").toBe(true)
      }
      for (const unit of province.units) {
        units += 1
        expect(unit.strength).toBeGreaterThan(0)
      }
    }
    expect(units).toBe(51)
    expect(depots).toBe(5)
    const unitIds = state.provinces.flatMap((province) => province.units.map((unit) => unit.id))
    expect(new Set(unitIds).size).toBe(unitIds.length)
  })
})
