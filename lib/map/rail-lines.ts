import type { ProvinceGeometry } from "@/lib/data/geometry"
import { linksOf } from "@/lib/data/scenario"
import { provinceLabelOpacity } from "@/lib/map/province-label-zoom"
import { outerRing, routeBetweenProvinces } from "@/lib/map/shared-border"
import type { Faction, GameState } from "@/lib/types"

/**
 * Rails fade with the province labels. Full at the opening zoom, gone on the
 * Europe frame, so the network does not pile up when the map is pulled back.
 */
export const RAIL_FULL_ZOOM = 6.35
export const RAIL_HIDDEN_ZOOM = 5.45

/** Mild width bump for rails touching the selected province. */
export const RAIL_HOT_WIDTH_SCALE = 1.12

export type RailSide = "central" | "russia" | "cut"

export type RailEnd = {
  id: string
  neighbors: string[]
  rail: string[]
  controller: Faction
  /** Label and strength-counter anchor, when the map already has one. */
  anchor?: [number, number] | null
  polygon?: ProvinceGeometry | null
}

export type RailLine = {
  a: string
  b: string
  coordinates: [number, number][]
  side: RailSide
  hot: boolean
  /** Apply when `hot` to widen rail strokes in the renderer. */
  hotWidthScale: number
}

/** Thin staff-map rail strokes, tinted by the side that can use them. */
export const RAIL_STYLE = {
  /** Kept for legend / SVG fallbacks; sleepers are no longer drawn on the map. */
  sleeper: "#241c14",
  tie: "#241c14",
  central: "#10283c",
  russia: "#4a1c16",
  cut: "#6d675f",
  hot: "#f3e2a8",
} as const

/** Same pairs the supply engine walks. Only the rail edges are drawn. */
export function railLines(provinces: RailEnd[], selectedId: string | null = null): RailLine[] {
  const byId = new Map(provinces.map((province) => [province.id, province]))
  const lines: RailLine[] = []
  for (const link of linksOf({ provinces } as GameState)) {
    if (!link.rail) continue
    const from = byId.get(link.a)
    const to = byId.get(link.b)
    if (!from || !to) continue
    const start = anchorOf(from)
    const end = anchorOf(to)
    if (!start || !end) continue
    const fromPoly = from.polygon
    const toPoly = to.polygon
    const coordinates =
      fromPoly && toPoly
        ? routeBetweenProvinces(fromPoly, toPoly, start, end)
        : ([start, end] as [number, number][])
    const hot = selectedId !== null && (from.id === selectedId || to.id === selectedId)
    lines.push({
      a: link.a,
      b: link.b,
      coordinates,
      side: from.controller === to.controller ? from.controller : "cut",
      hot,
      hotWidthScale: hot ? RAIL_HOT_WIDTH_SCALE : 1,
    })
  }
  return lines
}

export function railFeatureCollection(provinces: RailEnd[], selectedId: string | null = null) {
  return {
    type: "FeatureCollection" as const,
    features: railLines(provinces, selectedId).map((line) => ({
      type: "Feature" as const,
      properties: {
        side: line.side,
        hot: line.hot,
        hotWidthScale: line.hotWidthScale,
        a: line.a,
        b: line.b,
      },
      geometry: { type: "LineString" as const, coordinates: line.coordinates },
    })),
  }
}

export function railLineOpacity(zoom: number, side: RailSide = "central"): number {
  const fade = provinceLabelOpacity(zoom)
  return side === "cut" ? fade * 0.45 : fade
}

function anchorOf(province: RailEnd): [number, number] | null {
  const anchor = province.anchor
  if (anchor && Number.isFinite(anchor[0]) && Number.isFinite(anchor[1])) return [anchor[0], anchor[1]]
  return interiorPoint(province.polygon)
}

/** Average of the outer ring. Used only when a province has no label anchor. */
function interiorPoint(polygon: ProvinceGeometry | null | undefined): [number, number] | null {
  const ring = outerRing(polygon)
  if (!ring || ring.length === 0) return null
  let x = 0
  let y = 0
  let count = 0
  for (const [lon, lat] of ring) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    x += lon
    y += lat
    count += 1
  }
  if (count === 0) return null
  return [x / count, y / count]
}