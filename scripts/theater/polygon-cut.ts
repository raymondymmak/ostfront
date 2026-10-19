import * as turf from "@turf/turf"
import type { Feature, LineString, MultiPolygon, Polygon, Position } from "geojson"

type Poly = Polygon | MultiPolygon
type PolyFeature = Feature<Poly>

const MIN_PIECE_M2 = 500_000

function asCoord(position: Position): [number, number] {
  return [position[0], position[1]]
}

function extrapolate(from: [number, number], through: [number, number], distance: number): [number, number] {
  const dx = through[0] - from[0]
  const dy = through[1] - from[1]
  const length = Math.hypot(dx, dy) || 1
  return [through[0] + (dx / length) * distance, through[1] + (dy / length) * distance]
}

function extendLine(line: [number, number][], box: [number, number, number, number]): [number, number][] {
  if (line.length < 2) throw new Error("cut line needs two points")
  const span = Math.max(box[2] - box[0], box[3] - box[1], 1)
  const distance = span * 4
  const coords = line.map((point) => [point[0], point[1]] as [number, number])
  coords[0] = extrapolate(coords[1], coords[0], distance)
  coords[coords.length - 1] = extrapolate(coords[coords.length - 2], coords[coords.length - 1], distance)
  return coords
}

type Hit = { point: [number, number]; edge: number; fraction: number; lineT: number }

function fractionBetween(start: [number, number], end: [number, number], point: [number, number]) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length2 = dx * dx + dy * dy || 1
  return Math.min(1, Math.max(0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2))
}

/** Planar slice so a constant-latitude cut stays straight instead of bowing on a geodesic. */
function planarSlice(line: [number, number][], entry: [number, number], exit: [number, number]): [number, number][] {
  const cumulative = [0]
  for (let index = 1; index < line.length; index++) {
    cumulative.push(
      cumulative[index - 1] + Math.hypot(line[index][0] - line[index - 1][0], line[index][1] - line[index - 1][1]),
    )
  }
  const project = (point: [number, number]) => {
    let best = 0
    let bestDistance = Infinity
    for (let index = 1; index < line.length; index++) {
      const t = fractionBetween(line[index - 1], line[index], point)
      const x = line[index - 1][0] + t * (line[index][0] - line[index - 1][0])
      const y = line[index - 1][1] + t * (line[index][1] - line[index - 1][1])
      const distance = Math.hypot(x - point[0], y - point[1])
      if (distance < bestDistance) {
        bestDistance = distance
        best = cumulative[index - 1] + t * (cumulative[index] - cumulative[index - 1])
      }
    }
    return best
  }
  const start = project(entry)
  const end = project(exit)
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const ordered = start <= end ? [entry] : [exit]
  for (let index = 0; index < line.length; index++) {
    if (cumulative[index] > lo + 1e-9 && cumulative[index] < hi - 1e-9) ordered.push(line[index])
  }
  ordered.push(start <= end ? exit : entry)
  return ordered
}

/**
 * Two polygons that tile `box` and share `line`. The line is extended until it
 * crosses the box; each side is the cut plus one walk around the box boundary.
 */
function splitBox(box: [number, number, number, number], line: [number, number][]): [Feature<Polygon>, Feature<Polygon>] {
  const [minX, minY, maxX, maxY] = box
  const corners: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ]
  const extended = extendLine(line, box)
  const cutter = turf.lineString(extended)
  const alongLine = (point: [number, number]) => {
    const nearest = turf.nearestPointOnLine(cutter, point)
    return nearest.properties?.location ?? 0
  }
  const hits: Hit[] = []
  corners.forEach((start, edge) => {
    const end = corners[(edge + 1) % 4]
    const edgeLine = turf.lineString([start, end])
    const intersections = turf.lineIntersect(cutter, edgeLine)
    for (const hit of intersections.features) {
      const point = asCoord(hit.geometry.coordinates)
      hits.push({
        point,
        edge,
        fraction: fractionBetween(start, end, point),
        lineT: alongLine(point),
      })
    }
  })
  hits.sort((a, b) => a.lineT - b.lineT)
  const unique: Hit[] = []
  for (const hit of hits) {
    if (unique.some((kept) => Math.hypot(kept.point[0] - hit.point[0], kept.point[1] - hit.point[1]) < 1e-7)) continue
    unique.push(hit)
  }
  if (process.env.CUT_DEBUG) {
    console.log(
      "hits",
      unique.map((hit) => ({ e: hit.edge, f: hit.fraction.toFixed(3), t: hit.lineT.toFixed(1), p: hit.point.map((n) => n.toFixed(3)) })),
    )
  }
  if (unique.length < 2) throw new Error(`cut crosses the frame ${unique.length} time(s)`)
  const entry = unique[0]
  const exit = unique[unique.length - 1]
  const slice = planarSlice(extended, entry.point, exit.point)
  if (slice.length < 2) throw new Error("cut slice is empty")

  const param = (hit: Hit) => hit.edge + hit.fraction
  const walk = (from: number, to: number, direction: 1 | -1): [number, number][] => {
    const points: [number, number][] = []
    let cursor = from
    let target = to
    if (direction === 1 && target <= cursor) target += 4
    if (direction === -1 && target >= cursor) target -= 4
    let guard = 0
    while (guard++ < 6) {
      const nextCorner = direction === 1 ? Math.floor(cursor) + 1 : Math.ceil(cursor) - 1
      const cornerParam = direction === 1 ? nextCorner : nextCorner
      const reached =
        direction === 1 ? cornerParam >= target - 1e-9 : cornerParam <= target + 1e-9
      if (reached) break
      const index = ((cornerParam % 4) + 4) % 4
      points.push(corners[index])
      cursor = cornerParam
    }
    return points
  }

  const close = (boundary: [number, number][]) => {
    const ring = [...slice, ...boundary]
    if (ring.length < 3) throw new Error("cut did not close a polygon")
    ring.push(ring[0])
    const polygon = turf.polygon([ring])
    return turf.rewind(polygon, { reverse: false }) as Feature<Polygon>
  }
  const exitParam = param(exit)
  const entryParam = param(entry)
  return [close(walk(exitParam, entryParam, 1)), close(walk(exitParam, entryParam, -1))]
}

export function cutContaining(
  feature: PolyFeature,
  line: [number, number][],
  seed: [number, number],
): { inside: PolyFeature; outside: PolyFeature } {
  const bbox = turf.bbox(feature)
  const pad = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1], 0.3) * 0.2 + 0.2
  const box: [number, number, number, number] = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad]
  const [sideA, sideB] = splitBox(box, line)
  if (process.env.CUT_DEBUG) {
    console.log("sides", turf.area(sideA) / 1e6, turf.area(sideB) / 1e6, "box", box, "line", line)
    console.log("ringA", sideA.geometry.coordinates[0].slice(0, 8), "n", sideA.geometry.coordinates[0].length)
    console.log("ringB", sideB.geometry.coordinates[0].slice(0, 8), "n", sideB.geometry.coordinates[0].length)
  }
  const partA = turf.intersect(turf.featureCollection([feature, sideA]))
  const partB = turf.intersect(turf.featureCollection([feature, sideB]))
  if (!partA || !partB || turf.area(partA) < MIN_PIECE_M2 || turf.area(partB) < MIN_PIECE_M2) {
    console.log("cut debug", {
      sideA: Math.round(turf.area(sideA) / 1e6),
      sideB: Math.round(turf.area(sideB) / 1e6),
      partA: partA ? Math.round(turf.area(partA) / 1e6) : null,
      partB: partB ? Math.round(turf.area(partB) / 1e6) : null,
      kinksA: turf.kinks(sideA).features.length,
      kinksB: turf.kinks(sideB).features.length,
    })
  }
  const pieces = [partA, partB].filter((piece): piece is PolyFeature => !!piece && turf.area(piece) >= MIN_PIECE_M2)
  if (pieces.length < 2) throw new Error("cut did not divide the polygon into two pieces")
  const seedPoint = turf.point(seed)
  const inside = pieces.find((piece) => turf.booleanPointInPolygon(seedPoint, piece))
  const outside = pieces.find((piece) => piece !== inside)
  if (!inside || !outside) throw new Error("seed is not inside either side of the cut")
  return { inside, outside }
}

export function outerRings(feature: PolyFeature): [number, number][][] {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates
  const rings: [number, number][][] = []
  for (const polygon of polygons) {
    const ring = polygon[0]
    if (!ring || ring.length < 4) continue
    rings.push(ring.map((position) => asCoord(position)))
  }
  rings.sort((a, b) => turf.area(turf.polygon([b])) - turf.area(turf.polygon([a])))
  return rings
}
