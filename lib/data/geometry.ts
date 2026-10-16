import { Delaunay } from "d3-delaunay"

const COS = Math.cos((52 * Math.PI) / 180)
/** Drop Voronoi artifacts that jump across the map along the bounding box. */
const MAX_NEIGHBOR_DISTANCE = 1.66

export type TheaterGraph = {
  neighbors: Record<string, string[]>
  polygons: Record<string, [number, number][]>
  centroids: Record<string, [number, number]>
}

/**
 * Voronoi in a local projection (longitude scaled by cos 52°) so cells match
 * the Mercator map. Neighbors are Delaunay adjacencies, symmetrized.
 */
export function buildTheater(
  defs: { id: string; lon: number; lat: number }[],
): TheaterGraph {
  const projected = defs.map(
    (def) => [def.lon * COS, def.lat] as [number, number],
  )
  const delaunay = Delaunay.from(projected)
  const xs = projected.map((point) => point[0])
  const ys = projected.map((point) => point[1])
  const pad = 0.42
  const voronoi = delaunay.voronoi([
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ])

  const neighbors: Record<string, string[]> = {}
  const polygons: Record<string, [number, number][]> = {}
  const centroids: Record<string, [number, number]> = {}

  defs.forEach((def, index) => {
    const ring = voronoi.cellPolygon(index) ?? []
    polygons[def.id] = ring.map(([x, y]) => [
      Math.round((x / COS) * 1000) / 1000,
      Math.round(y * 1000) / 1000,
    ])
    centroids[def.id] = [def.lon, def.lat]
    const adjacent = new Set<string>()
    for (const other of delaunay.neighbors(index)) {
      const [ox, oy] = projected[other]
      const [x, y] = projected[index]
      const distance = Math.hypot(ox - x, oy - y)
      if (distance <= MAX_NEIGHBOR_DISTANCE) adjacent.add(defs[other].id)
    }
    neighbors[def.id] = [...adjacent]
  })

  for (const [id, list] of Object.entries(neighbors)) {
    for (const other of list) {
      if (!neighbors[other].includes(id)) neighbors[other].push(id)
    }
  }
  for (const id of Object.keys(neighbors)) neighbors[id].sort()

  return { neighbors, polygons, centroids }
}
