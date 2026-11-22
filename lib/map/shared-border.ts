import type { ProvinceGeometry } from "@/lib/data/geometry"

export const BORDER_VERTEX_EPS = 1e-4
const LABEL_TRIM_DEG = 0.08

export function outerRing(polygon: ProvinceGeometry | null | undefined): [number, number][] | null {
  if (!polygon) return null
  if (polygon.type === "Polygon") return polygon.coordinates[0] as [number, number][]
  const rings = polygon.coordinates
  if (!rings?.length) return null
  let best = rings[0][0] as [number, number][]
  let bestArea = Math.abs(ringArea(best))
  for (const polygonRings of rings) {
    const ring = polygonRings[0] as [number, number][]
    const area = Math.abs(ringArea(ring))
    if (area > bestArea) {
      best = ring
      bestArea = area
    }
  }
  return best
}

/**
 * Rail / march routing between two label anchors via the shared land border.
 * Uses a single border gate (median shared-edge midpoint). Walking every shared
 * edge produced zigzag "barbed wire" polylines across province interiors.
 * Ends are trimmed short of the anchor so labels stay readable.
 */
export function routeBetweenProvinces(
  from: ProvinceGeometry,
  to: ProvinceGeometry,
  start: [number, number],
  end: [number, number],
): [number, number][] {
  const ringA = outerRing(from)
  const ringB = outerRing(to)
  if (!ringA || !ringB) return [start, end]

  const shared = sharedEdgeMidpoints(ringA, ringB)
  if (!shared.length) return [start, end]

  const ordered = orderAlongAxis(shared, start, end)
  const gate = ordered[Math.floor((ordered.length - 1) / 2)] ?? midpoint(start, end)
  const trimmedStart = trimToward(start, gate, LABEL_TRIM_DEG)
  const trimmedEnd = trimToward(end, gate, LABEL_TRIM_DEG)
  return [trimmedStart, gate, trimmedEnd]
}

function sharedEdgeMidpoints(a: [number, number][], b: [number, number][]): [number, number][] {
  const edgesB = edgeSet(b)
  const midpoints: [number, number][] = []
  for (let index = 0; index < a.length; index += 1) {
    const p1 = a[index]
    const p2 = a[(index + 1) % a.length]
    if (!p1 || !p2) continue
    const key = edgeKey(p1, p2)
    if (edgesB.has(key)) midpoints.push(midpoint(p1, p2))
  }
  return midpoints
}

function edgeSet(ring: [number, number][]): Set<string> {
  const set = new Set<string>()
  for (let index = 0; index < ring.length; index += 1) {
    const p1 = ring[index]
    const p2 = ring[(index + 1) % ring.length]
    if (!p1 || !p2) continue
    set.add(edgeKey(p1, p2))
  }
  return set
}

function edgeKey(a: [number, number], b: [number, number]): string {
  const aKey = vertexKey(a)
  const bKey = vertexKey(b)
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
}

function vertexKey(point: [number, number]): string {
  const lon = Math.round(point[0] / BORDER_VERTEX_EPS) * BORDER_VERTEX_EPS
  const lat = Math.round(point[1] / BORDER_VERTEX_EPS) * BORDER_VERTEX_EPS
  return `${lon.toFixed(4)},${lat.toFixed(4)}`
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

function orderAlongAxis(points: [number, number][], start: [number, number], end: [number, number]): [number, number][] {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lenSq = dx * dx + dy * dy
  const score = (point: [number, number]) => {
    if (lenSq < 1e-12) return Math.hypot(point[0] - start[0], point[1] - start[1])
    return ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / Math.sqrt(lenSq)
  }
  return [...points].sort((left, right) => score(left) - score(right))
}

function trimToward(from: [number, number], toward: [number, number], distance: number): [number, number] {
  const dx = toward[0] - from[0]
  const dy = toward[1] - from[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-9 || len <= distance) return toward
  const t = distance / len
  return [from[0] + dx * t, from[1] + dy * t]
}

function ringArea(ring: [number, number][]): number {
  let sum = 0
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]
    const [x2, y2] = ring[(index + 1) % ring.length]
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

// Exported for tests that assert vertex matching on real theater polygons.
export function ringsShareBorder(a: ProvinceGeometry, b: ProvinceGeometry): boolean {
  const ringA = outerRing(a)
  const ringB = outerRing(b)
  if (!ringA || !ringB) return false
  return sharedEdgeMidpoints(ringA, ringB).length > 0
}