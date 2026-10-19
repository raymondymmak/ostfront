import { existsSync, readFileSync } from "node:fs"
import * as turf from "@turf/turf"
import type { Feature, MultiPolygon, Polygon, Position } from "geojson"

const WANTED = new Set([
  "Vistula",
  "Narew",
  "Bug",
  "San",
  "Dniester",
  "Pilica",
  "Wieprz",
  "Dunajec",
  "Neman",
  "Bzura",
])

export type RiverIndex = Map<string, [number, number][][]>

export function loadRivers(paths: string[]): RiverIndex {
  const index: RiverIndex = new Map()
  for (const path of paths) {
    if (!existsSync(path)) continue
    const collection = JSON.parse(readFileSync(path, "utf8")) as { features: Feature[] }
    for (const feature of collection.features) {
      const name = String(feature.properties?.name ?? "")
      if (!WANTED.has(name) || !feature.geometry) continue
      const lines =
        feature.geometry.type === "LineString"
          ? [feature.geometry.coordinates]
          : feature.geometry.type === "MultiLineString"
            ? feature.geometry.coordinates
            : []
      const bucket = index.get(name) ?? []
      for (const line of lines) {
        if (line.length >= 2) bucket.push(line.map((position) => [position[0], position[1]] as [number, number]))
      }
      index.set(name, bucket)
    }
  }
  return index
}

/** Longest stretch of a named river that meets `feature`, clipped to its bbox. */
export function riverThrough(
  index: RiverIndex,
  name: string,
  feature: Feature<Polygon | MultiPolygon>,
): [number, number][] | null {
  const lines = index.get(name) ?? []
  const bbox = turf.bbox(feature)
  const pad = 0.15
  const box: [number, number, number, number] = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad]
  let best: [number, number][] | null = null
  let bestLength = 0
  for (const line of lines) {
    const clipped = turf.bboxClip(turf.lineString(line), box)
    if (clipped.geometry.coordinates.length < 2) continue
    if (!turf.booleanIntersects(clipped, feature)) continue
    const length = turf.length(clipped, { units: "kilometers" })
    if (length > bestLength) {
      bestLength = length
      const coords = clipped.geometry.coordinates as Position[]
      best = coords.map((position) => [position[0], position[1]] as [number, number])
    }
  }
  return bestLength >= 20 ? best : null
}

export function displayRivers(
  index: RiverIndex,
  bbox: [number, number, number, number],
): { id: string; name: string; coordinates: [number, number][] }[] {
  const names = ["Vistula", "Narew", "Bug", "San", "Dniester", "Pilica"]
  const out: { id: string; name: string; coordinates: [number, number][] }[] = []
  for (const name of names) {
    for (const line of index.get(name) ?? []) {
      const clipped = turf.bboxClip(turf.lineString(line), bbox)
      if (turf.length(clipped, { units: "kilometers" }) < 30) continue
      out.push({
        id: `${name.toLowerCase()}-${out.length}`,
        name,
        coordinates: (clipped.geometry.coordinates as [number, number][]).map(roundCoord),
      })
    }
  }
  return out
}

function roundCoord([lon, lat]: [number, number]): [number, number] {
  return [Math.round(lon * 10000) / 10000, Math.round(lat * 10000) / 10000]
}
