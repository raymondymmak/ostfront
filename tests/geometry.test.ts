import { describe, expect, it } from "vitest"
import { CATALOG, PROVINCE_COUNT } from "@/lib/data/catalog"
import {
  BACKDROP_REGIONS,
  GEOMETRY_SOURCE,
  VIEW_BBOX,
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
    expect(VIEW_BBOX[3] - VIEW_BBOX[1]).toBeGreaterThan(4)
    const owners = new Set(BACKDROP_REGIONS.map((region) => region.owner))
    expect(owners.has("romania")).toBe(true)
    expect(owners.has("sweden") || owners.has("russia")).toBe(true)
    for (const region of BACKDROP_REGIONS) {
      expect(CATALOG.some((province) => province.id === region.id)).toBe(false)
      expect(geometryValid(region.geometry)).toBe(true)
    }
  })
})

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
