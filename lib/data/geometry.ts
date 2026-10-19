import * as turf from "@turf/turf"
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson"
import theaterData from "@/lib/data/theater-geometry.json"
import { PROVINCE_DEFS } from "@/lib/data/definitions"

/**
 * Every HOI4 state lives in one TopoJSON topology with a playable flag.
 * To make another state playable later, add its MapChart id to PLAYABLE in
 * scripts/build-hoi4-theater.py and a ProvinceDef in lib/data/definitions.ts,
 * then rebuild. The polygon, owner_1914, and neighbors are already stored.
 * buildTheater hands the game only the playable subgraph.
 */

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

export type StateSource = "name" | "fallback" | "override"

export type WorldState = {
  id: string
  stateId: string
  name: string
  owner: string
  playable: boolean
  source: StateSource
  geometry: ProvinceGeometry
  centroid: [number, number]
}

export type CountryLabel = {
  owner: string
  name: string
  label: [number, number]
  labels: [number, number][]
}

export const THEATER_BBOX = theaterData.bbox as [number, number, number, number]
type TopologyGeometry = {
  type: string
  arcs?: number[] | number[][] | number[][][]
  geometries?: TopologyGeometry[]
  properties?: {
    id?: string
    stateId?: string
    name?: string
    owner_1914?: string
    playable?: boolean
    source?: StateSource
  }
}

type Topology = {
  type: "Topology"
  transform?: { scale: [number, number]; translate: [number, number] }
  arcs: number[][][]
  objects: {
    states: { type: string; geometries: TopologyGeometry[] }
    countryBorders: { type: string; geometries?: TopologyGeometry[]; arcs?: number[] | number[][] }
  }
}

type TheaterFile = {
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
  topology: Topology
  centroids: Record<string, [number, number]>
  neighbors: Record<string, string[]>
  countryLabels: CountryLabel[]
  rivers: RiverLine[]
  source: string
}

const theaterFile = theaterData as unknown as TheaterFile

function decodeArcs(topology: Topology): number[][][] {
  const scale = topology.transform?.scale ?? [1, 1]
  const translate = topology.transform?.translate ?? [0, 0]
  return topology.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map((delta) => {
      x += delta[0]
      y += delta[1]
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]]
    })
  })
}

function lineCoordinates(arcs: number[][][], indexes: number[]): number[][] {
  const coordinates: number[][] = []
  for (const index of indexes) {
    const reversed = index < 0
    const arc = arcs[reversed ? ~index : index]
    const points = reversed ? arc.slice().reverse() : arc
    if (coordinates.length > 0) coordinates.pop()
    for (const point of points) coordinates.push([point[0], point[1]])
  }
  return coordinates
}

function geometryFromObject(arcs: number[][][], object: TopologyGeometry): ProvinceGeometry | null {
  if (object.type === "Polygon") {
    const rings = (object.arcs as number[][]).map((ring) => lineCoordinates(arcs, ring))
    return { type: "Polygon", coordinates: rings }
  }
  if (object.type === "MultiPolygon") {
    const polygons = (object.arcs as number[][][]).map((rings) =>
      rings.map((ring) => lineCoordinates(arcs, ring)),
    )
    return { type: "MultiPolygon", coordinates: polygons }
  }
  return null
}

function collectLines(arcs: number[][][], object: TopologyGeometry): number[][][] {
  if (object.type === "LineString") return [lineCoordinates(arcs, object.arcs as number[])]
  if (object.type === "MultiLineString") {
    return (object.arcs as number[][]).map((line) => lineCoordinates(arcs, line))
  }
  if (object.type === "GeometryCollection") {
    return (object.geometries ?? []).flatMap((geometry) => collectLines(arcs, geometry))
  }
  return []
}

const decodedArcs = decodeArcs(theaterFile.topology)
const stateSources = new Set<StateSource>(["name", "fallback", "override"])

export const WORLD_STATES: WorldState[] = theaterFile.topology.objects.states.geometries.flatMap((object) => {
  const geometry = geometryFromObject(decodedArcs, object)
  const props = object.properties
  if (!geometry || !props?.id) return []
  const source = stateSources.has(props.source as StateSource) ? (props.source as StateSource) : "fallback"
  return [
    {
      id: props.id,
      stateId: props.stateId ?? props.id,
      name: props.name ?? props.id,
      owner: props.owner_1914 ?? "",
      playable: props.playable === true,
      source,
      geometry,
      centroid: theaterFile.centroids[props.id] ?? [0, 0],
    },
  ]
})

const worldById = new Map(WORLD_STATES.map((state) => [state.id, state]))

export const VIEW_BBOX = theaterFile.viewBbox ?? THEATER_BBOX
export const WORLD_BBOX = theaterFile.worldBbox ?? VIEW_BBOX
export const SEA_GEOMETRY = theaterFile.sea
export const GEOMETRY_SOURCE = theaterFile.source
export const ALL_NEIGHBORS = theaterFile.neighbors
export const COUNTRY_LABELS = theaterFile.countryLabels
export const COUNTRY_BORDERS: MultiLineString = {
  type: "MultiLineString",
  coordinates: collectLines(decodedArcs, theaterFile.topology.objects.countryBorders),
}
/** Non-playable states, one feature each. Fills use these. Country names are COUNTRY_LABELS. */
export const BACKDROP_REGIONS: BackdropRegion[] = WORLD_STATES.filter((state) => !state.playable).map((state) => ({
  id: state.id,
  name: state.name,
  owner: state.owner,
  label: state.centroid,
  geometry: state.geometry,
}))
export const RIVER_LINES = theaterFile.rivers
export const STATE_OWNERS = theaterFile.stateOwners ?? {}
export const OWNER_AUDIT = theaterFile.ownerAudit

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

/** Playable province polygons and the playable-only adjacency subgraph. */
export function buildTheater(
  defs: { id: string; lon: number; lat: number }[] = PROVINCE_DEFS,
): TheaterGraph {
  const playable = new Set(defs.map((def) => def.id))
  const polygons: Record<string, ProvinceGeometry> = {}
  const centroids: Record<string, [number, number]> = {}
  const neighbors: Record<string, string[]> = {}

  for (const def of defs) {
    const state = worldById.get(def.id)
    polygons[def.id] = state?.geometry ?? { type: "Polygon", coordinates: [] }
    centroids[def.id] = state?.centroid ?? [def.lon, def.lat]
    neighbors[def.id] = (ALL_NEIGHBORS[def.id] ?? []).filter((id) => playable.has(id)).sort()
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
