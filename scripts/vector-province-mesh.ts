/**
 * Vector dissolve: assign whole admin units → union per province → gap fill → simplify.
 */
import * as turf from "@turf/turf"
import polygonClipping from "polygon-clipping"
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon } from "geojson"
import { PROVINCE_DEFS } from "../lib/data/definitions"

export type ProvinceRings = [number, number][][]

type ClipPoly = polygonClipping.Polygon
type ClipMulti = polygonClipping.MultiPolygon

const POLAND_BBOX: [number, number, number, number] = [16.2, 50.0, 24.8, 54.6]

const NAME_TO_PROVINCE: [RegExp, string][] = [
  [/stadtkreis k.nigsberg|kreis samland|^samland$/i, "konigsberg"],
  [/regierungsbezirk k.nigsberg/i, "konigsberg"],
  [/regierungsbezirk gumbinnen|^gumbinnen$/i, "insterburg"],
  [/regierungsbezirk allenstein|stadtkreis allenstein|^ostersode|^osterode/i, "allenstein"],
  [/regierungsbezirk danzig|stadt danzig|danzi(g|ger)/i, "danzig"],
  [/regierungsbezirk marienwerder|marienwerder/i, "graudenz"],
  [/regierungsbezirk bromberg|^bromberg$/i, "bromberg"],
  [/regierungsbezirk posen|posen/i, "posen"],
  [/^thorn$|regierungsbezirk thorn/i, "thorn"],
  [/tarnówer|tarnówer kreis/i, "tarnow"],
  [/krakauer kreis|bezirk krakau/i, "krakow"],
  [/przemysl|przemy.l/i, "przemysl"],
  [/lemberg|lviv|lwow/i, "lemberg"],
  [/warsaw|warszawa|warschau/i, "warsaw"],
  [/bialystok/i, "bialystok"],
  [/suwalk|suwał/i, "suwalki"],
  [/grodno/i, "grodno"],
  [/vilna|vilnius|wilno/i, "vilna"],
  [/kovno|kaunas/i, "kovno"],
  [/memel|klaip/i, "memel"],
  [/tilsit|sovetsk/i, "tilsit"],
  [/minsk/i, "minsk"],
  [/pinsk/i, "pinsk"],
  [/brest/i, "brest"],
  [/lublin/i, "lublin"],
  [/radom/i, "radom"],
  [/[łl]odz/i, "lodz"],
  [/kalisz/i, "kalisz"],
  [/kielce/i, "kielce"],
  [/rzeszówer kreis/i, "rzeszow"],
  [/chelm|chełm/i, "chelm"],
  [/kovel|kowel/i, "kovel"],
  [/lutsk|luck/i, "lutsk"],
  [/rovno|rivne/i, "rovno"],
  [/tarnopol/i, "tarnopol"],
  [/stanislav|stanisław/i, "stanislav"],
  [/kamenets|kamianets/i, "kamenets"],
  [/plock/i, "plock"],
  [/mlawa|mława/i, "mlawa"],
]

function roundCoord([lon, lat]: [number, number]): [number, number] {
  return [Math.round(lon * 10000) / 10000, Math.round(lat * 10000) / 10000]
}

export function snapRing(ring: [number, number][]): [number, number][] {
  const out = ring.map(roundCoord)
  if (out.length >= 3 && (out[0][0] !== out.at(-1)![0] || out[0][1] !== out.at(-1)![1])) {
    out.push(out[0])
  }
  return out
}

function provinceFromName(name: string, unit?: Feature<Polygon | MultiPolygon>): string | null {
  if (unit && inWestGalicia(unit) && /bezirk|kreis/i.test(name)) {
    return null
  }
  for (const [pattern, id] of NAME_TO_PROVINCE) {
    if (pattern.test(name)) return id
  }
  return null
}

const WEST_GALICIA_BBOX: [number, number, number, number] = [19.15, 49.32, 23.05, 50.52]

function inWestGalicia(feature: Feature<Polygon | MultiPolygon>): boolean {
  const [minLon, minLat, maxLon, maxLat] = turf.bbox(feature)
  return (
    maxLon >= WEST_GALICIA_BBOX[0] &&
    minLon <= WEST_GALICIA_BBOX[2] &&
    maxLat >= WEST_GALICIA_BBOX[1] &&
    minLat <= WEST_GALICIA_BBOX[3]
  )
}

function assignProvince(unit: Feature<Polygon | MultiPolygon>): string {
  const name = String(unit.properties?.name ?? "")
  const byName = provinceFromName(name, unit)
  if (byName) return byName

  const centroid = turf.centroid(unit)
  let bestId = PROVINCE_DEFS[0].id
  let bestScore = Number.POSITIVE_INFINITY
  for (const def of PROVINCE_DEFS) {
    const seed = turf.point([def.lon, def.lat])
    const dist = turf.distance(centroid, seed, { units: "kilometers" })
    const catchment = turf.buffer(seed, 55, { units: "kilometers" })
    const overlap = catchment
      ? turf.intersect(turf.featureCollection([unit, catchment as Feature<Polygon | MultiPolygon>]))
      : null
    const overlapKm2 = overlap ? turf.area(overlap) / 1_000_000 : 0
    const score = dist - overlapKm2 * 0.4
    if (score < bestScore) {
      bestScore = score
      bestId = def.id
    }
  }
  return bestId
}

export function toClip(feature: Feature<Polygon | MultiPolygon>): ClipPoly | ClipMulti | null {
  const geom = feature.geometry
  if (geom.type === "Polygon") {
    return geom.coordinates.map((ring) =>
      ring.map((c) => [c[0], c[1]] as polygonClipping.Pair),
    ) as ClipPoly
  }
  return geom.coordinates.map(
    (poly) => poly.map((ring) => ring.map((c) => [c[0], c[1]] as polygonClipping.Pair)) as ClipPoly[0],
  ) as ClipMulti
}

export function clipToRings(geom: ClipPoly | ClipMulti | null): ProvinceRings {
  if (!geom) return []
  const polys: ClipPoly[] = Array.isArray(geom[0]?.[0]?.[0])
    ? (geom as ClipMulti)
    : [geom as ClipPoly]
  const rings: ProvinceRings = []
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length >= 4) {
        rings.push(snapRing(ring.map((c) => [c[0], c[1]] as [number, number])))
      }
    }
  }
  return rings
}

export function unionFeatures(features: Feature<Polygon | MultiPolygon>[]): Feature<Polygon | MultiPolygon> | null {
  if (!features.length) return null
  let merged: Feature<Polygon | MultiPolygon> | null = null
  for (const feature of features) {
    if (!feature?.geometry) continue
    try {
      if (!merged) {
        merged = feature
        continue
      }
      const next = turf.union(turf.featureCollection([merged, feature]))
      if (next) merged = next as Feature<Polygon | MultiPolygon>
    } catch {
      try {
        const a = toClip(merged)
        const b = toClip(feature)
        if (!a || !b) continue
        const u = polygonClipping.union(a, b)
        const rings = clipToRings(u)
        if (rings[0]?.length) merged = turf.polygon(rings)
      } catch {
        continue
      }
    }
  }
  return merged
}

function featureParts(geometry: Polygon | MultiPolygon): Feature<Polygon>[] {
  if (geometry.type === "Polygon") return [turf.polygon(geometry.coordinates)]
  return geometry.coordinates.map((coords) => turf.polygon(coords))
}

function subtractCovered(
  unit: Feature<Polygon | MultiPolygon>,
  covered: Feature<Polygon | MultiPolygon> | null,
): Feature<Polygon | MultiPolygon>[] {
  if (!covered) return [unit]
  const diff = turf.difference(turf.featureCollection([unit, covered]))
  if (!diff) return []
  if (diff.geometry.type === "Polygon") return [diff as Feature<Polygon>]
  return featureParts(diff.geometry as MultiPolygon)
}

function buildSeedVoronoi(bbox: [number, number, number, number]): FeatureCollection<Polygon> {
  const points = turf.featureCollection(
    PROVINCE_DEFS.map((def) => turf.point([def.lon, def.lat], { id: def.id })),
  )
  const vor = turf.voronoi(points, { bbox })
  return vor
}

function shouldSplitUnit(
  unit: Feature<Polygon | MultiPolygon>,
  voronoi: FeatureCollection<Polygon>,
): boolean {
  let hits = 0
  for (const cell of voronoi.features) {
    const piece = turf.intersect(turf.featureCollection([unit, cell]))
    if (piece && turf.area(piece) > 12_000_000) hits++
  }
  return hits > 1
}

function splitUnitByVoronoi(
  unit: Feature<Polygon | MultiPolygon>,
  voronoi: FeatureCollection<Polygon>,
): Array<{ provinceId: string; feature: Feature<Polygon | MultiPolygon> }> {
  const out: Array<{ provinceId: string; feature: Feature<Polygon | MultiPolygon> }> = []
  for (const cell of voronoi.features) {
    const provinceId = String(cell.properties?.id ?? "")
    if (!provinceId) continue
    const piece = turf.intersect(turf.featureCollection([unit, cell]))
    if (!piece || turf.area(piece) < 8_000_000) continue
    out.push({ provinceId, feature: piece as Feature<Polygon | MultiPolygon> })
  }
  if (!out.length) {
    out.push({ provinceId: assignProvince(unit), feature: unit })
  }
  return out
}

function provinceForGapPoint(
  point: Feature<Point>,
  voronoi: FeatureCollection<Polygon>,
  riverLines: Feature<LineString>[],
): string {
  const [lon, lat] = point.geometry.coordinates
  const inPoland =
    lon >= POLAND_BBOX[0] &&
    lon <= POLAND_BBOX[2] &&
    lat >= POLAND_BBOX[1] &&
    lat <= POLAND_BBOX[3]

  if (inPoland) {
    for (const river of riverLines) {
      const nearest = turf.nearestPointOnLine(river, point)
      const distKm = turf.distance(point, nearest, { units: "kilometers" })
      if (distKm > 18) continue
      const idx = nearest.properties?.index ?? 0
      const coords = river.geometry.coordinates
      const a = coords[Math.max(0, idx - 1)] as [number, number]
      const b = coords[Math.min(coords.length - 1, idx + 1)] as [number, number]
      const cross = (b[0] - a[0]) * (lat - a[1]) - (b[1] - a[1]) * (lon - a[0])
      const name = String(river.properties?.name ?? "").toLowerCase()
      if (/vistula|wisła|weichsel/i.test(name)) {
        return cross > 0 ? "warsaw" : "plock"
      }
      if (/bug/i.test(name)) {
        return cross > 0 ? "siedlce" : "lublin"
      }
      if (/narew/i.test(name)) {
        return cross > 0 ? "bialystok" : "warsaw"
      }
      if (/pilica/i.test(name)) {
        return cross > 0 ? "radom" : "lodz"
      }
      if (/wieprz/i.test(name)) {
        return cross > 0 ? "lublin" : "siedlce"
      }
    }
  }

  for (const cell of voronoi.features) {
    if (turf.booleanPointInPolygon(point, cell)) {
      return String(cell.properties?.id ?? assignProvince(turf.buffer(point, 1, { units: "kilometers" })!))
    }
  }
  return assignProvince(turf.buffer(point, 5, { units: "kilometers" })!)
}

function piecesFromGap(
  gap: Feature<Polygon | MultiPolygon>,
  voronoi: FeatureCollection<Polygon>,
  riverLines: Feature<LineString>[],
): Array<{ provinceId: string; feature: Feature<Polygon | MultiPolygon> }> {
  const parts = gap.geometry.type === "Polygon" ? [gap] : featureParts(gap.geometry as MultiPolygon)
  const out: Array<{ provinceId: string; feature: Feature<Polygon | MultiPolygon> }> = []
  for (const part of parts) {
    const provinceId = provinceForGapPoint(turf.centroid(part), voronoi, riverLines)
    out.push({ provinceId, feature: part as Feature<Polygon | MultiPolygon> })
  }
  return out
}

export function buildVectorProvinceMesh(
  units: Feature<Polygon | MultiPolygon>[],
  theaterLand: Feature<Polygon | MultiPolygon>,
  riverLines: Feature<LineString>[],
): Record<string, ProvinceRings> {
  const bbox = turf.bbox(theaterLand) as [number, number, number, number]
  const voronoi = buildSeedVoronoi(bbox)
  const piecesByProvince = new Map<string, Feature<Polygon | MultiPolygon>[]>()
  for (const def of PROVINCE_DEFS) piecesByProvince.set(def.id, [])

  const ranked = [...units].sort((a, b) => turf.area(a) - turf.area(b))
  let covered: Feature<Polygon | MultiPolygon> | null = null

  for (const unit of ranked) {
    const fragments = subtractCovered(unit, covered)
    for (const fragment of fragments) {
      if (turf.area(fragment) < 5_000_000) continue
      const named = provinceFromName(String(fragment.properties?.name ?? ""), fragment)
      const splits = named
        ? [{ provinceId: named, feature: fragment }]
        : shouldSplitUnit(fragment, voronoi)
          ? splitUnitByVoronoi(fragment, voronoi)
          : [{ provinceId: assignProvince(fragment), feature: fragment }]
      for (const { provinceId, feature } of splits) {
        if (turf.area(feature) < 4_000_000) continue
        piecesByProvince.get(provinceId)?.push(feature)
        covered = covered ? unionFeatures([covered, feature]) : feature
      }
    }
  }

  let playableUnion = covered
  const gap = playableUnion
    ? turf.difference(turf.featureCollection([theaterLand, playableUnion]))
    : theaterLand
  if (gap && turf.area(gap) > 50_000_000) {
    const gapParts =
      gap.geometry.type === "Polygon"
        ? [gap as Feature<Polygon | MultiPolygon>]
        : (gap.geometry as MultiPolygon).coordinates.map((c) => turf.polygon(c))
    for (const gapPart of gapParts) {
      if (turf.area(gapPart) < 20_000_000) continue
      for (const { provinceId, feature } of piecesFromGap(gapPart, voronoi, riverLines)) {
        piecesByProvince.get(provinceId)?.push(feature)
        playableUnion = playableUnion ? unionFeatures([playableUnion, feature]) : feature
      }
    }
  }

  const polygons: Record<string, ProvinceRings> = {}
  for (const def of PROVINCE_DEFS) {
    const pieces = piecesByProvince.get(def.id) ?? []
    const merged = unionFeatures(pieces)
    if (merged) {
      const clipped = turf.intersect(turf.featureCollection([merged, theaterLand]))
      polygons[def.id] = clipped
        ? clipToRings(toClip(clipped as Feature<Polygon | MultiPolygon>))
        : clipToRings(toClip(merged))
    } else {
      polygons[def.id] = []
    }
  }

  return polygons
}

export function snapMeshVertices(polygons: Record<string, ProvinceRings>, precision = 4): void {
  const factor = 10 ** precision
  for (const id of Object.keys(polygons)) {
    polygons[id] = polygons[id].map((ring) =>
      snapRing(
        ring.map(([lon, lat]) => [Math.round(lon * factor) / factor, Math.round(lat * factor) / factor]),
      ),
    )
  }
}

export function simplifyProvinceRings(
  polygons: Record<string, ProvinceRings>,
  toleranceKm = 2.5,
): Record<string, ProvinceRings> {
  const out: Record<string, ProvinceRings> = {}
  for (const def of PROVINCE_DEFS) {
    const rings = polygons[def.id]
    if (!rings?.[0]?.length) {
      out[def.id] = []
      continue
    }
    try {
      const simplified = turf.simplify(turf.polygon(rings), {
        tolerance: toleranceKm / 111,
        highQuality: true,
        mutate: false,
      })
      out[def.id] =
        simplified.geometry.type === "Polygon"
          ? (simplified.geometry.coordinates.map((r) => snapRing(r as [number, number][])) as ProvinceRings)
          : rings
    } catch {
      out[def.id] = rings
    }
  }
  return out
}
