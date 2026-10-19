/**
 * West Galician Bezirke → Kraków / Tarnów / Rzeszów with Vistula north & Carpathian south.
 */
import * as turf from "@turf/turf"
import type { Feature, LineString, MultiPolygon, Polygon } from "geojson"
import { clipToRings, snapRing, toClip, type ProvinceRings, unionFeatures } from "./vector-province-mesh"

const WEST_GALICIA_BBOX: [number, number, number, number] = [19.15, 49.32, 23.05, 50.52]

/** Vistula through the Kraków–Sandomierz reach (Galicia / Congress Poland contact). */
const VISTULA_NORTH_EDGE: [number, number][] = [
  [19.35, 50.52],
  [19.55, 50.42],
  [19.75, 50.28],
  [19.95, 50.12],
  [20.15, 50.02],
  [20.45, 49.98],
  [20.75, 49.95],
  [21.05, 49.93],
  [21.45, 49.9],
  [21.85, 49.88],
  [22.25, 49.86],
  [22.65, 49.85],
]

/** Carpathian crest (south limit of the three provinces). */
const CARPATHIAN_SOUTH_EDGE: [number, number][] = [
  [19.25, 49.38],
  [19.85, 49.32],
  [20.45, 49.28],
  [21.05, 49.22],
  [21.65, 49.15],
  [22.25, 49.08],
  [22.85, 49.02],
  [23.05, 48.98],
]

const DUNAJEC_LINE: [number, number][] = [
  [20.05, 50.05],
  [20.15, 49.92],
  [20.22, 49.78],
  [20.28, 49.62],
  [20.32, 49.48],
  [20.38, 49.35],
]

const WISLOKA_LINE: [number, number][] = [
  [21.05, 50.08],
  [21.25, 49.95],
  [21.45, 49.82],
  [21.65, 49.68],
  [21.85, 49.55],
  [22.05, 49.42],
]

const SAN_WEST_LINE: [number, number][] = [
  [22.55, 50.05],
  [22.65, 49.88],
  [22.72, 49.72],
  [22.78, 49.55],
  [22.85, 49.38],
]

const KRAKOW_BEZIRK =
  /bezirk krakau|krakauer kreis|chrzan|wadowice|kalwary|olkusz|oświęcim|oswiecim|myślenice|myslenice|trzebinia|wieliczka|proszowice|skawina|krzeszowice|alwernia/i
const TARNOW_BEZIRK =
  /tarnów|tarnow|tarnówer|tarnopoler|brzesko|bochnia|dąbrowa|dabrowa|cięszkowice|cieszan|gorlice|grybów|grybow|limanowa|nowy sącz|nowy sacz|nowosądeck|biecz|bobowa|stróże|muszyna|miechów|miechow/i
const RZESZOW_BEZIRK =
  /rzeszów|rzeszow|rzeszówer|kolbusz|leżajsk|lezajsk|ni sko|nisko|łańcut|lancut|strzyżów|strzyzow|ropczyce|mielec|tarnobrzeg|przeworsk|jaroslau|jarosław/i

const PRZEMYSL_BEZIRK = /przemyśl|przemysl|przemyśler|mostyska|mościska/i

function inWestGalicia(feature: Feature<Polygon | MultiPolygon>): boolean {
  const [minLon, minLat, maxLon, maxLat] = turf.bbox(feature)
  return (
    maxLon >= WEST_GALICIA_BBOX[0] &&
    minLon <= WEST_GALICIA_BBOX[2] &&
    maxLat >= WEST_GALICIA_BBOX[1] &&
    minLat <= WEST_GALICIA_BBOX[3]
  )
}

function lonOnPolyline(line: [number, number][], lat: number): number {
  let bestLon = line[0][0]
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < line.length - 1; i++) {
    const [lon0, lat0] = line[i]
    const [lon1, lat1] = line[i + 1]
    if (lat < Math.min(lat0, lat1) - 0.08 || lat > Math.max(lat0, lat1) + 0.08) continue
    const t = lat1 === lat0 ? 0.5 : (lat - lat0) / (lat1 - lat0)
    const lon = lon0 + t * (lon1 - lon0)
    const dist = Math.abs(lat - (lat0 + t * (lat1 - lat0)))
    if (dist < bestDist) {
      bestDist = dist
      bestLon = lon
    }
  }
  return bestLon
}

function classifyWestGaliciaPoint(lon: number, lat: number): "krakow" | "tarnow" | "rzeszow" | null {
  if (lat < 49.34 || lat > 50.54 || lon < 19.1 || lon > 23.1) return null
  const lonD = lonOnPolyline(DUNAJEC_LINE, lat)
  const lonW = lonOnPolyline(WISLOKA_LINE, lat)
  const lonS = lonOnPolyline(SAN_WEST_LINE, lat)
  if (lon < lonD - 0.02) return "krakow"
  if (lon < lonW - 0.02) return "tarnow"
  if (lon < lonS - 0.02) return "rzeszow"
  return null
}

function classifyBezirk(
  name: string,
  centroid: [number, number],
): "krakow" | "tarnow" | "rzeszow" | null {
  if (PRZEMYSL_BEZIRK.test(name)) return null
  if (KRAKOW_BEZIRK.test(name)) return "krakow"
  if (TARNOW_BEZIRK.test(name)) return "tarnow"
  if (RZESZOW_BEZIRK.test(name)) return "rzeszow"
  return classifyWestGaliciaPoint(centroid[0], centroid[1])
}

function halfPlaneMask(
  line: [number, number][],
  keepSide: "left" | "right",
  bbox: [number, number, number, number],
): Feature<Polygon> {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const pad = 0.25
  const box = turf.bboxPolygon([minLon - pad, minLat - pad, maxLon + pad, maxLat + pad])
  const mid = line[Math.floor(line.length / 2)]
  const [lon0, lat0] = line[0]
  const [lon1, lat1] = line.at(-1)!
  const nx = lat1 - lat0
  const ny = -(lon1 - lon0)
  const corners: [number, number][] = [
    [minLon - pad, minLat - pad],
    [maxLon + pad, minLat - pad],
    [maxLon + pad, maxLat + pad],
    [minLon - pad, maxLat + pad],
  ]
  const kept = corners.filter(([lon, lat]) => {
    const s = nx * (lon - mid[0]) + ny * (lat - mid[1])
    return keepSide === "left" ? s >= 0 : s <= 0
  })
  if (kept.length < 3) return box
  kept.push(kept[0])
  const wedge = turf.polygon([kept])
  const clipped = turf.intersect(turf.featureCollection([box, wedge]))
  return (clipped ?? wedge) as Feature<Polygon>
}

function buildWestGaliciaClipMask(
  theaterLand: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> {
  const bbox = WEST_GALICIA_BBOX
  const box = turf.bboxPolygon(bbox)
  let mask = turf.intersect(turf.featureCollection([box, theaterLand])) as Feature<Polygon | MultiPolygon>
  const southOfVistula = halfPlaneMask(VISTULA_NORTH_EDGE, "left", bbox)
  const northOfCarpathians = halfPlaneMask(CARPATHIAN_SOUTH_EDGE, "right", bbox)
  mask = turf.intersect(turf.featureCollection([mask, southOfVistula])) as Feature<Polygon | MultiPolygon>
  mask = turf.intersect(turf.featureCollection([mask, northOfCarpathians])) as Feature<Polygon | MultiPolygon>
  return mask
}

function isGalicianBezirk(unit: Feature<Polygon | MultiPolygon>): boolean {
  const name = String(unit.properties?.name ?? "")
  const level = Number(unit.properties?.admin_level ?? 0)
  if (!inWestGalicia(unit)) return false
  if (level < 5 || level > 6) return false
  return /bezirk|kreis/i.test(name)
}

export function buildWestGaliciaProvinces(
  units: Feature<Polygon | MultiPolygon>[],
  theaterLand: Feature<Polygon | MultiPolygon>,
): Partial<Record<"krakow" | "tarnow" | "rzeszow", ProvinceRings>> {
  const mask = buildWestGaliciaClipMask(theaterLand)
  const bezirke = units
    .filter(isGalicianBezirk)
    .map((unit) => {
      const clipped = turf.intersect(turf.featureCollection([unit, mask]))
      return clipped ? { ...unit, geometry: clipped.geometry } : null
    })
    .filter(Boolean) as Feature<Polygon | MultiPolygon>[]

  bezirke.sort((a, b) => turf.area(a) - turf.area(b))
  const byProvince: Record<string, Feature<Polygon | MultiPolygon>[]> = {
    krakow: [],
    tarnow: [],
    rzeszow: [],
  }
  let painted: Feature<Polygon | MultiPolygon> | null = null

  for (const unit of bezirke) {
    const name = String(unit.properties?.name ?? "")
    const centroid = turf.centroid(unit).geometry.coordinates as [number, number]
    const provinceId = classifyBezirk(name, centroid)
    if (!provinceId) continue
    let piece = unit
    if (painted) {
      const diff = turf.difference(turf.featureCollection([unit, painted]))
      if (!diff) continue
      piece = diff as Feature<Polygon | MultiPolygon>
    }
    if (turf.area(piece) < 3_000_000) continue
    byProvince[provinceId].push(piece)
    const u = unionFeatures([painted, piece].filter(Boolean) as Feature<Polygon | MultiPolygon>[])
    if (u) painted = u
  }

  const out: Partial<Record<"krakow" | "tarnow" | "rzeszow", ProvinceRings>> = {}
  for (const id of ["krakow", "tarnow", "rzeszow"] as const) {
    const merged = unionFeatures(byProvince[id])
    if (!merged) continue
    const clipped = turf.intersect(turf.featureCollection([merged, mask]))
    if (!clipped || turf.area(clipped) < 50_000_000) continue
    out[id] = clipToRings(toClip(clipped as Feature<Polygon | MultiPolygon>))
  }
  return out
}

export function applyWestGaliciaProvinces(
  polygons: Record<string, ProvinceRings>,
  units: Feature<Polygon | MultiPolygon>[],
  theaterLand: Feature<Polygon | MultiPolygon>,
): void {
  const west = buildWestGaliciaProvinces(units, theaterLand)
  const targets = ["krakow", "tarnow", "rzeszow"] as const
  for (const id of targets) {
    const rings = west[id]
    if (!rings?.[0]?.length) continue
    polygons[id] = rings
  }
  const westUnion = unionFeatures(
    targets
      .map((id) => (polygons[id]?.[0]?.length ? turf.polygon(polygons[id]) : null))
      .filter(Boolean) as Feature<Polygon | MultiPolygon>[],
  )
  if (!westUnion) return
  const neighbors = ["kielce", "radom", "lodz", "przemysl", "rzeszow", "tarnow", "krakow"] as const
  for (const id of Object.keys(polygons)) {
    if (targets.includes(id as (typeof targets)[number])) continue
    const rings = polygons[id]
    if (!rings?.[0]?.length) continue
    const diff = turf.difference(turf.featureCollection([turf.polygon(rings), westUnion]))
    if (!diff) {
      polygons[id] = []
      continue
    }
    if (diff.geometry.type === "Polygon") {
      polygons[id] = [snapRing(diff.geometry.coordinates[0] as [number, number][])]
    } else {
      const polys = diff.geometry.coordinates
      let best = polys[0]
      let bestA = turf.area(turf.polygon([best[0]]))
      for (const p of polys) {
        const a = turf.area(turf.polygon([p[0]]))
        if (a > bestA) {
          bestA = a
          best = p
        }
      }
      polygons[id] = best.map((r) => snapRing(r as [number, number][])) as ProvinceRings
    }
  }
}
