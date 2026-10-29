import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { createInitialState, linksOf } from "@/lib/data/scenario"
import {
  RAIL_FULL_ZOOM,
  RAIL_HIDDEN_ZOOM,
  railLineOpacity,
  railLines,
  type RailEnd,
} from "@/lib/map/rail-lines"
import { PROVINCE_LABEL_FULL_ZOOM, PROVINCE_LABEL_HIDDEN_ZOOM } from "@/lib/map/province-label-zoom"

const OPENING_ZOOM = 6.833576
const EUROPE_ZOOM = 5.3172

function endsFrom(state = createInitialState()): RailEnd[] {
  return state.provinces.map((province) => ({
    id: province.id,
    neighbors: province.neighbors,
    rail: province.rail,
    controller: province.controller,
    anchor: CATALOG_BY_ID[province.id]?.centroid,
    polygon: CATALOG_BY_ID[province.id]?.polygon,
  }))
}

function pair(lines: ReturnType<typeof railLines>, a: string, b: string) {
  return lines.find((line) => (line.a === a && line.b === b) || (line.a === b && line.b === a))
}

describe("rail lines", () => {
  it("draws exactly the rail edges linksOf gives the supply engine", () => {
    const state = createInitialState()
    const drawn = railLines(endsFrom(state))
    const engine = linksOf(state).filter((link) => link.rail)
    expect(drawn).toHaveLength(engine.length)
    expect(drawn.length).toBeGreaterThan(10)
    for (const link of engine) {
      expect(pair(drawn, link.a, link.b)).toBeDefined()
    }
  })

  it("keeps a line when both ends share a faction, and breaks it when they do not", () => {
    const lines = railLines(endsFrom())
    expect(pair(lines, "krakow", "stanislawow")?.side).toBe("central")
    expect(pair(lines, "warszawa", "lublin")?.side).toBe("russia")
    expect(pair(lines, "krakow", "lwow")?.side).toBe("cut")
    expect(pair(lines, "lwow", "stanislawow")?.side).toBe("cut")
  })

  it("follows control, so a captured city restores the line", () => {
    const provinces = endsFrom()
    const lemberg = provinces.find((province) => province.id === "lwow")
    expect(lemberg).toBeDefined()
    lemberg!.controller = "central"
    const lines = railLines(provinces)
    expect(pair(lines, "krakow", "lwow")?.side).toBe("central")
    expect(pair(lines, "lwow", "wolyn")?.side).toBe("cut")
  })

  it("joins label anchors, and falls back to an interior point", () => {
    const lines = railLines(endsFrom())
    const flank = pair(lines, "krakow", "stanislawow")
    expect(flank?.coordinates[0]).toEqual(CATALOG_BY_ID.krakow.centroid)
    expect(flank?.coordinates[1]).toEqual(CATALOG_BY_ID.stanislawow.centroid)

    const provinces = endsFrom().map((province) =>
      province.id === "krakow" ? { ...province, anchor: null } : province,
    )
    const fallback = pair(railLines(provinces), "krakow", "stanislawow")
    expect(fallback?.coordinates[0]).not.toEqual(CATALOG_BY_ID.krakow.centroid)
    const [lon, lat] = fallback!.coordinates[0]
    const ring = CATALOG_BY_ID.krakow.polygon.type === "Polygon"
      ? CATALOG_BY_ID.krakow.polygon.coordinates[0]
      : CATALOG_BY_ID.krakow.polygon.coordinates[0][0]
    const xs = ring.map((coord) => coord[0])
    const ys = ring.map((coord) => coord[1])
    expect(lon).toBeGreaterThan(Math.min(...xs))
    expect(lon).toBeLessThan(Math.max(...xs))
    expect(lat).toBeGreaterThan(Math.min(...ys))
    expect(lat).toBeLessThan(Math.max(...ys))
  })

  it("highlights only the rails that touch the selected province", () => {
    const lines = railLines(endsFrom(), "krakow")
    expect(pair(lines, "krakow", "lwow")?.hot).toBe(true)
    expect(pair(lines, "krakow", "stanislawow")?.hot).toBe(true)
    expect(pair(lines, "warszawa", "lublin")?.hot).toBe(false)
    expect(railLines(endsFrom(), null).every((line) => !line.hot)).toBe(true)
  })

  it("fades with the province labels so a zoomed-out map stays readable", () => {
    expect(RAIL_FULL_ZOOM).toBe(PROVINCE_LABEL_FULL_ZOOM)
    expect(RAIL_HIDDEN_ZOOM).toBe(PROVINCE_LABEL_HIDDEN_ZOOM)
    expect(railLineOpacity(OPENING_ZOOM)).toBe(1)
    expect(railLineOpacity(EUROPE_ZOOM)).toBe(0)
    expect(railLineOpacity(OPENING_ZOOM, "cut")).toBeCloseTo(0.45)
    expect(railLineOpacity(EUROPE_ZOOM, "cut")).toBe(0)
    const mid = (RAIL_FULL_ZOOM + RAIL_HIDDEN_ZOOM) / 2
    expect(railLineOpacity(mid)).toBeGreaterThan(0.4)
    expect(railLineOpacity(mid)).toBeLessThan(0.6)
    expect(railLineOpacity(mid, "cut")).toBeCloseTo(railLineOpacity(mid) * 0.45)
  })

  it("feeds the map from the supply links, under the counters", () => {
    const source = readFileSync("components/war-map.tsx", "utf8")
    const lines = readFileSync("lib/map/rail-lines.ts", "utf8")
    const legend = readFileSync("components/map-legend.tsx", "utf8")
    expect(lines).toContain("linksOf")
    expect(source).toContain("railFeatureCollection")
    expect(source).toContain("useState(true)")
    expect(source).toContain('id: "rail-ties"')
    expect(source).toContain('id: "rail-track"')
    expect(source).toContain('id: "rail-cut"')
    const ties = source.indexOf('id: "rail-ties"')
    const markers = source.indexOf("new maplibregl.Marker")
    expect(ties).toBeGreaterThan(0)
    expect(markers).toBeGreaterThan(ties)
    const openAt = legend.indexOf("{open &&")
    const toggleAt = legend.indexOf('data-testid="rail-toggle"')
    expect(openAt).toBeGreaterThan(0)
    expect(toggleAt).toBeGreaterThan(openAt)
    expect(legend.slice(0, openAt)).not.toContain("rail-toggle")
    expect(legend.slice(openAt, toggleAt)).toContain("Rails")
    expect(legend).toContain("aria-pressed={showRails}")
    expect(legend).toContain("cannot advance")
    expect(legend).toContain("overlay === \"supply\"")
    expect(legend).toContain("overlay === \"unrest\"")
  })
})