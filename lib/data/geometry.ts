import * as turf from "@turf/turf"
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson"
import theaterData from "@/lib/data/theater-geometry.json"
import { PROVINCE_DEFS } from "@/lib/data/definitions"

export type ProvinceRings = [number, number][][]

export type TheaterGraph = {
  neighbors: Record<string, string[]>
  polygons: Record<string, ProvinceRings>
  centroids: Record<string, [number, number]>
}

export type BackdropRegion = {
  id: string
  name: string
  polygon: [number, number][]
}

export type RiverLine = {
  id: string
  name: string
  coordinates: [number, number][]
}

export const THEATER_BBOX = theaterData.bbox as [number, number, number, number]
const theaterMeta = theaterData as unknown as {
  viewBbox?: [number, number, number, number]
  landPolygons?: [number, number][][]
  seaPolygons?: [number, number][][]
}
export const VIEW_BBOX = theaterMeta.viewBbox ?? THEATER_BBOX
export const LAND_POLYGONS = theaterMeta.landPolygons ?? []
export const SEA_POLYGONS = theaterMeta.seaPolygons ?? []
export const GEOMETRY_SOURCE = theaterData.source as string
export const BACKDROP_REGIONS = theaterData.backdrop as BackdropRegion[]
export const RIVER_LINES = theaterData.rivers as RiverLine[]

export function provinceHasGeometry(rings: ProvinceRings): boolean {
  return (rings[0]?.length ?? 0) >= 4
}

export function forEachProvinceCoord(rings: ProvinceRings, visit: (coord: [number, number]) => void) {
  for (const ring of rings) {
    for (const coord of ring) visit(coord)
  }
}

type TheaterFile = {
  polygons: Record<string, ProvinceRings>
  centroids: Record<string, [number, number]>
  neighbors: Record<string, string[]>
  backdrop: BackdropRegion[]
  rivers: RiverLine[]
}

const loaded = theaterData as unknown as TheaterFile

/** Playable province polygons and adjacency from theater-geometry.json. */
export function buildTheater(
  defs: { id: string; lon: number; lat: number }[] = PROVINCE_DEFS,
): TheaterGraph {
  const polygons: Record<string, ProvinceRings> = {}
  const centroids: Record<string, [number, number]> = {}

  for (const def of defs) {
    const raw = loaded.polygons[def.id] as ProvinceRings | [number, number][] | undefined
    polygons[def.id] =
      raw && Array.isArray(raw[0]?.[0]) ? (raw as ProvinceRings) : raw?.length ? [raw as [number, number][]] : []
    centroids[def.id] = loaded.centroids[def.id] ?? [def.lon, def.lat]
  }
  const neighbors: Record<string, string[]> = {}
  for (const def of defs) {
    neighbors[def.id] = [...(loaded.neighbors[def.id] ?? [])]
  }
  return { neighbors, polygons, centroids }
}

/** Recompute adjacency from polygon rings (shared borders). */
function asProvinceFeature(id: string, rings: ProvinceRings) {
  if (rings.length <= 1) return turf.polygon(rings, { id })
  return turf.multiPolygon(
    rings.map((ring) => [ring]),
    { id },
  )
}

function boundaryLine(feature: Feature<Polygon | MultiPolygon>): Feature<LineString | MultiLineString> {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates
  const coordinates: number[][][] = []
  for (const rings of polygons) {
    const line = turf.polygonToLine(turf.polygon(rings))
    if (line.type !== "Feature") continue
    if (line.geometry.type === "LineString") coordinates.push(line.geometry.coordinates as number[][])
    else coordinates.push(...(line.geometry.coordinates as number[][][]))
  }
  return turf.multiLineString(coordinates)
}

/** Shared-border length in kilometers. Corner touches are not a border. */
export function sharedBorderKm(a: Feature<Polygon | MultiPolygon>, b: Feature<Polygon | MultiPolygon>) {
  try {
    const overlap = turf.lineOverlap(boundaryLine(a), boundaryLine(b), { tolerance: 0.002 })
    return turf.length(overlap, { units: "kilometers" })
  } catch {
    return 0
  }
}

export function neighborsFromPolygons(polygons: Record<string, ProvinceRings>): Record<string, string[]> {
  const features = Object.entries(polygons).map(([id, rings]) => asProvinceFeature(id, rings))
  const neighbors: Record<string, string[]> = {}
  for (const id of Object.keys(polygons)) neighbors[id] = []

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      if (sharedBorderKm(features[i], features[j]) < 0.25) continue
      const idA = features[i].properties?.id as string
      const idB = features[j].properties?.id as string
      if (!neighbors[idA].includes(idB)) neighbors[idA].push(idB)
      if (!neighbors[idB].includes(idA)) neighbors[idB].push(idA)
    }
  }
  for (const id of Object.keys(neighbors)) neighbors[id].sort()
  return neighbors
}
