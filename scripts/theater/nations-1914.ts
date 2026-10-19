import * as turf from "@turf/turf"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"

export type Nation1914 = {
  id: string
  label: string
  feature: Feature<Polygon | MultiPolygon>
}

const DISPLAY: Record<string, string> = {
  "German Empire": "German Empire",
  Germany: "German Empire",
  Russia: "Russian Empire",
  "Austro-Hungarian Empire": "Austria-Hungary",
  "Austria-Hungary": "Austria-Hungary",
  Sweden: "Sweden",
  Denmark: "Denmark",
  Romania: "Romania",
  Switzerland: "Switzerland",
  Italy: "Italy",
  "United Kingdom of Great Britain and Ireland": "United Kingdom",
  Netherlands: "Netherlands",
  Norway: "Norway",
  Bulgaria: "Bulgaria",
  Serbia: "Serbia",
  Montenegro: "Montenegro",
  Greece: "Greece",
  Turkey: "Ottoman Empire",
  "Ottoman Empire": "Ottoman Empire",
}

export const PLAYABLE_EMPIRES = new Set([
  "German Empire",
  "Russian Empire",
  "Austria-Hungary",
])

function canonical(raw: string): string {
  const trimmed = raw.trim()
  if (DISPLAY[trimmed]) return DISPLAY[trimmed]
  const lower = trimmed.toLowerCase()
  if (lower.includes("german")) return "German Empire"
  if (lower.includes("russia")) return "Russian Empire"
  if (lower.includes("austro") || lower.includes("austria-hung")) return "Austria-Hungary"
  return trimmed
}

export function loadNations1914(
  fc: FeatureCollection,
  viewBbox: [number, number, number, number],
): Nation1914[] {
  const view = turf.bboxPolygon(viewBbox)
  const byId = new Map<string, Feature<Polygon | MultiPolygon>[]>()

  for (const feature of fc.features) {
    if (!feature.geometry) continue
    const raw = String(feature.properties?.SUBJECTO ?? feature.properties?.NAME ?? "Unknown")
    const label = canonical(raw)
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    const box = turf.bbox(feature as Feature<Polygon | MultiPolygon>)
    if (box[2] < viewBbox[0] || box[0] > viewBbox[2] || box[3] < viewBbox[1] || box[1] > viewBbox[3]) {
      continue
    }
    const clipped = turf.intersect(
      turf.featureCollection([feature as Feature<Polygon | MultiPolygon>, view]),
    )
    if (!clipped || turf.area(clipped) < 50_000) continue
    const list = byId.get(id) ?? []
    list.push(clipped as Feature<Polygon | MultiPolygon>)
    byId.set(id, list)
  }

  const nations: Nation1914[] = []
  for (const [id, parts] of byId) {
    let merged: Feature<Polygon | MultiPolygon> | null = null
    for (const part of parts) {
      if (!merged) {
        merged = part
        continue
      }
      const next = turf.union(turf.featureCollection([merged, part]))
      if (next) merged = next as Feature<Polygon | MultiPolygon>
    }
    if (!merged) continue
    const sample = parts[0]?.properties
    const label = canonical(String(sample?.SUBJECTO ?? sample?.NAME ?? id))
    nations.push({ id, label, feature: merged })
  }
  return nations
}

export function nationAtPoint(
  nations: Nation1914[],
  lon: number,
  lat: number,
): Nation1914 | null {
  const pt = turf.point([lon, lat])
  for (const nation of nations) {
    if (turf.booleanPointInPolygon(pt, nation.feature)) return nation
  }
  return null
}

export type AdminPiece = {
  geometry: Polygon | MultiPolygon
  nationLabel: string
  admin: string
  name: string
  sourceId: string
}

export function splitAdminBy1914(
  unit: Feature<Polygon | MultiPolygon>,
  nations: Nation1914[],
  minAreaM2 = 800_000,
): AdminPiece[] {
  const admin = String(unit.properties?.admin ?? "")
  const name = String(unit.properties?.name ?? "")
  const sourceId = `${admin}/${name}`
  const centroid = turf.centroid(unit)
  const [lon, lat] = centroid.geometry.coordinates
  const primary = nationAtPoint(nations, lon, lat)

  const candidates = primary
    ? [primary, ...nations.filter((n) => n.id !== primary.id)]
    : nations

  const pieces: AdminPiece[] = []
  const seenArea = new Set<string>()

  const pushPiece = (geometry: Polygon | MultiPolygon, nationLabel: string) => {
    const poly = geometry.type === "Polygon" ? turf.polygon(geometry.coordinates) : turf.polygon(geometry.coordinates[0])
    const area = Math.round(turf.area(poly))
    const key = `${nationLabel}:${area}`
    if (seenArea.has(key) || area < minAreaM2) return
    seenArea.add(key)
    pieces.push({ geometry, nationLabel, admin, name, sourceId })
  }

  for (const nation of candidates) {
    const turfPiece = turf.intersect(turf.featureCollection([unit, nation.feature]))
    if (!turfPiece || turf.area(turfPiece) < minAreaM2) continue
    pushPiece(turfPiece.geometry as Polygon | MultiPolygon, nation.label)
  }

  if (!pieces.length) {
    const fallback = primary ?? nationAtPoint(nations, lon, lat)
    if (fallback) {
      pushPiece(unit.geometry, fallback.label)
    }
  }
  return pieces
}
