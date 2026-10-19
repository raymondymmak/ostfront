import * as turf from "@turf/turf"
import { buildTps, type Gcp } from "./tps"

export type GeorefWarp = {
  transform: (x: number, y: number) => [number, number]
  residualsKm: { label: string; km: number }[]
  maxResidualKm: number
  degree: number
}

function polyTerms(x: number, y: number, degree: 2 | 3): number[] {
  const t2 = [1, x, y, x * x, x * y, y * y]
  if (degree === 2) return t2
  return [...t2, x * x * x, x * x * y, x * y * y, y * y * y]
}

function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length
  const aug = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row
    }
    if (Math.abs(aug[pivot][col]) < 1e-14) throw new Error("singular polynomial fit")
    ;[aug[col], aug[pivot]] = [aug[pivot], aug[col]]
    for (let row = col + 1; row < n; row++) {
      const f = aug[row][col] / aug[col][col]
      for (let j = col; j <= n; j++) aug[row][j] -= f * aug[col][j]
    }
  }
  const out = new Array(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = aug[row][n]
    for (let j = row + 1; j < n; j++) sum -= aug[row][j] * out[j]
    out[row] = sum / aug[row][row]
  }
  return out
}

function fitPoly(
  samples: { x: number; y: number; w: number }[],
  degree: 2 | 3,
): number[] {
  const terms = degree === 2 ? 6 : 10
  if (samples.length < terms) {
    throw new Error(`need at least ${terms} samples for degree ${degree} polynomial`)
  }
  const m = Array.from({ length: terms }, () => new Array(terms).fill(0))
  const v = new Array(terms).fill(0)
  for (const { x, y, w } of samples) {
    const t = polyTerms(x, y, degree)
    for (let i = 0; i < terms; i++) {
      v[i] += t[i] * w
      for (let j = 0; j < terms; j++) m[i][j] += t[i] * t[j]
    }
  }
  return solveLinear(m, v)
}

function evalPoly(coeff: number[], x: number, y: number, degree: 2 | 3): number {
  const t = polyTerms(x, y, degree)
  let s = 0
  for (let i = 0; i < coeff.length; i++) s += coeff[i] * t[i]
  return s
}

/** Normalize pixel coords to ~[-1,1] for a stable cubic fit on the theater crop. */
function normalizeGcps(gcps: Gcp[]) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const g of gcps) {
    minX = Math.min(minX, g.px)
    maxX = Math.max(maxX, g.px)
    minY = Math.min(minY, g.py)
    maxY = Math.max(maxY, g.py)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const sx = Math.max(maxX - minX, 1) / 2
  const sy = Math.max(maxY - minY, 1) / 2
  return {
    cx,
    cy,
    sx,
    sy,
    norm: gcps.map((g) => ({
      ...g,
      nx: (g.px - cx) / sx,
      ny: (g.py - cy) / sy,
    })),
  }
}

const THEATER_GEO: [number, number, number, number] = [9.0, 46.5, 33.0, 58.0]

function saneGeo(lon: number, lat: number): boolean {
  return (
    lon >= THEATER_GEO[0] &&
    lon <= THEATER_GEO[2] &&
    lat >= THEATER_GEO[1] &&
    lat <= THEATER_GEO[3]
  )
}

/** TPS inside the theater raster crop; cubic polynomial outside (no wild extrapolation). */
export function buildHullClampedGeoref(
  gcps: Gcp[],
  labels?: string[],
  degree: 2 | 3 = 3,
  cropPx?: { x0: number; y0: number; x1: number; y1: number },
): GeorefWarp {
  if (gcps.length < 30) {
    throw new Error(`need at least 30 GCPs for hull-clamped georef, got ${gcps.length}`)
  }
  const poly = buildPolynomialGeoref(gcps, degree, labels)
  const tps = buildTps(gcps)
  const hull = convexHullPx(gcps)
  const pad = 24
  const inCrop = (px: number, py: number) =>
    cropPx
      ? px >= cropPx.x0 - pad &&
        px <= cropPx.x1 + pad &&
        py >= cropPx.y0 - pad &&
        py <= cropPx.y1 + pad
      : pointInConvexHull(px, py, hull)
  const transform = (px: number, py: number): [number, number] => {
    let lon: number
    let lat: number
    if (inCrop(px, py)) {
      ;[lon, lat] = tps(px, py)
      if (!saneGeo(lon, lat)) {
        ;[lon, lat] = poly.transform(px, py)
      }
    } else {
      ;[lon, lat] = poly.transform(px, py)
    }
    if (!saneGeo(lon, lat)) {
      ;[lon, lat] = poly.transform(px, py)
    }
    return [lon, lat]
  }
  const residualsKm: { label: string; km: number }[] = []
  let maxResidualKm = 0
  gcps.forEach((g, i) => {
    const [lon, lat] = transform(g.px, g.py)
    const km = turf.distance([g.lon, g.lat], [lon, lat], { units: "kilometers" })
    const label = labels?.[i] ?? `gcp-${i}`
    residualsKm.push({ label, km })
    maxResidualKm = Math.max(maxResidualKm, km)
  })
  return { transform, residualsKm, maxResidualKm, degree }
}

export function buildPolynomialGeoref(
  gcps: Gcp[],
  degree: 2 | 3 = 3,
  labels?: string[],
): GeorefWarp {
  const { norm, cx, cy, sx, sy } = normalizeGcps(gcps)
  const lonCoeff = fitPoly(
    norm.map((g) => ({ x: g.nx, y: g.ny, w: g.lon })),
    degree,
  )
  const latCoeff = fitPoly(
    norm.map((g) => ({ x: g.nx, y: g.ny, w: g.lat })),
    degree,
  )
  const transform = (px: number, py: number): [number, number] => {
    const nx = (px - cx) / sx
    const ny = (py - cy) / sy
    return [evalPoly(lonCoeff, nx, ny, degree), evalPoly(latCoeff, nx, ny, degree)]
  }
  const residualsKm: { label: string; km: number }[] = []
  let maxResidualKm = 0
  gcps.forEach((g, i) => {
    const [lon, lat] = transform(g.px, g.py)
    const km = turf.distance([g.lon, g.lat], [lon, lat], { units: "kilometers" })
    const label = labels?.[i] ?? `gcp-${i}`
    residualsKm.push({ label, km })
    maxResidualKm = Math.max(maxResidualKm, km)
  })
  return { transform, residualsKm, maxResidualKm, degree }
}

/** Convex hull test (CCW hull edges). */
export function pointInConvexHull(px: number, py: number, hull: { x: number; y: number }[]): boolean {
  if (hull.length < 3) return true
  let sign = 0
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)
    if (Math.abs(cross) < 1e-9) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

export function convexHullPx(gcps: Gcp[]): { x: number; y: number }[] {
  const pts = gcps.map((g) => ({ x: g.px, y: g.py })).sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length <= 1) return pts
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: { x: number; y: number }[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: { x: number; y: number }[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}
