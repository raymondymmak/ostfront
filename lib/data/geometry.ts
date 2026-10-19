import * as turf from "@turf/turf"
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson"
import theaterData from "@/lib/data/theater-geometry.json"
import { PROVINCE_DEFS } from "@/lib/data/definitions"

/** A province or backdrop shape, holes included. Extra rings are lakes, not extra land. */
export type ProvinceGeometry = Polygon | MultiPolygon

export type TheaterGraph = {
  neighbors: Record<string, string[]>
  polygons: Record<string, ProvinceGeometry>
  centroids: Record<string, [number, number]>
}

export type BackdropRegion = {
  id: string
  name: string
  owner: string
  label: [number, number]
  labels?: [number, number][]
  geometry: ProvinceGeometry
}

export type RiverLine = {
  id: string
  name: string
  coordinates: [number, number][]
}

export const THEATER_BBOX = theaterData.bbox as [number, number, number, number]
const theaterMeta = theaterData as unknown as {
  viewBbox?: [number, number, number, number]
  worldBbox?: [number, number, number, number]
  sea?: ProvinceGeometry
  stateOwners?: Record<string, string>
  ownerColors?: Record<string, string>
  ownerAudit?: {
    states: number
    nameMatched: number
    fallback: number
    disagreements: unknown[]
    unsure: unknown[]
  }
}
export const VIEW_BBOX = theaterMeta.viewBbox ?? THEATER_BBOX
export const WORLD_BBOX = theaterMeta.worldBbox ?? VIEW_BBOX
export const SEA_GEOMETRY = theaterMeta.sea
export const GEOMETRY_SOURCE = theaterData.source as string
export const BACKDROP_REGIONS = theaterData.backdrop as BackdropRegion[]
export const RIVER_LINES = theaterData.rivers as RiverLine[]
export const STATE_OWNERS = theaterMeta.stateOwners ?? {}
export const OWNER_AUDIT = theaterMeta.ownerAudit

/** Neutral grey. Lightness tells owners apart. The cast is only a hint of warm or cool. */
export function backdropColor(owner: string): string {
  let hash = 2166136261
  for (let i = 0; i < owner.length; i++) {
    hash ^= owner.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  hash >>>= 0
  const lightness = 0.6 + (hash % 18) / 100
  const hue = (hash >>> 8) % 2 === 0 ? 36 : 210
  const saturation = 0.015 + ((hash >>> 16) % 16) / 1000
  return hslToHex(hue, saturation, lightness)
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const channel = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const step = hue / 60
  let red = 0
  let green = 0
  let blue = 0
  if (step < 1) [red, green, blue] = [chroma, channel, 0]
  else if (step < 2) [red, green, blue] = [channel, chroma, 0]
  else if (step < 3) [red, green, blue] = [0, chroma, channel]
  else if (step < 4) [red, green, blue] = [0, channel, chroma]
  else if (step < 5) [red, green, blue] = [channel, 0, chroma]
  else [red, green, blue] = [chroma, 0, channel]
  const match = lightness - chroma / 2
  const byte = (value: number) => Math.round((value + match) * 255).toString(16).padStart(2, "0")
  return `#${byte(red)}${byte(green)}${byte(blue)}`
}

const backdropOwners = new Set<string>([
  ...BACKDROP_REGIONS.map((region) => region.owner),
  ...Object.values(STATE_OWNERS),
])
export const BACKDROP_OWNER_COLOR: Record<string, string> = {}
for (const owner of backdropOwners) {
  if (owner) BACKDROP_OWNER_COLOR[owner] = backdropColor(owner)
}

export function geometryPolygons(geometry: ProvinceGeometry): number[][][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates
}

export function geometryValid(geometry: ProvinceGeometry | undefined): boolean {
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return false
  return geometryPolygons(geometry).some((rings) => (rings[0]?.length ?? 0) >= 4)
}

export function eachCoord(geometry: ProvinceGeometry, visit: (coord: [number, number]) => void) {
  for (const rings of geometryPolygons(geometry)) {
    for (const ring of rings) {
      for (const coord of ring) visit([coord[0], coord[1]])
    }
  }
}

type TheaterFile = {
  polygons: Record<string, ProvinceGeometry>
  centroids: Record<string, [number, number]>
  neighbors: Record<string, string[]>
}

const loaded = theaterData as unknown as TheaterFile

/** Playable province polygons and adjacency from theater-geometry.json. */
export function buildTheater(
  defs: { id: string; lon: number; lat: number }[] = PROVINCE_DEFS,
): TheaterGraph {
  const polygons: Record<string, ProvinceGeometry> = {}
  const centroids: Record<string, [number, number]> = {}

  for (const def of defs) {
    polygons[def.id] = loaded.polygons[def.id]
    centroids[def.id] = loaded.centroids[def.id] ?? [def.lon, def.lat]
  }
  const neighbors: Record<string, string[]> = {}
  for (const def of defs) {
    neighbors[def.id] = [...(loaded.neighbors[def.id] ?? [])]
  }
  return { neighbors, polygons, centroids }
}

function asProvinceFeature(id: string, geometry: ProvinceGeometry): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: { id }, geometry }
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

export function neighborsFromPolygons(polygons: Record<string, ProvinceGeometry>): Record<string, string[]> {
  const features = Object.entries(polygons).map(([id, geometry]) => asProvinceFeature(id, geometry))
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
