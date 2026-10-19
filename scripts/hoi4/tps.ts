import { applyAffine, fitAffine } from "./georef"

export type Gcp = { px: number; py: number; lon: number; lat: number }

const THEATER_LON_LAT: [number, number, number, number] = [15.8, 48.35, 28.8, 56.35]

function u(r: number): number {
  if (r < 1e-12) return 0
  const r2 = r * r
  return r2 * Math.log(r)
}

/** Thin-plate spline: fit lon/lat from pixel (x,y). */
export function buildTps(gcps: Gcp[]) {
  const n = gcps.length
  if (n < 4) throw new Error("TPS needs at least 4 GCPs")
  const size = n + 3
  const m = Array.from({ length: size }, () => new Array(size).fill(0))
  const bx = new Array(size).fill(0)
  const by = new Array(size).fill(0)

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = gcps[i].px - gcps[j].px
      const dy = gcps[i].py - gcps[j].py
      m[i][j] = u(Math.hypot(dx, dy))
    }
    m[i][n] = 1
    m[i][n + 1] = gcps[i].px
    m[i][n + 2] = gcps[i].py
    m[n][i] = 1
    m[n + 1][i] = gcps[i].px
    m[n + 2][i] = gcps[i].py
    bx[i] = gcps[i].lon
    by[i] = gcps[i].lat
  }

  const wx = solveLinear(m, bx)
  const wy = solveLinear(m, by)

  return (x: number, y: number): [number, number] => {
    let lon = wx[n] + wx[n + 1] * x + wx[n + 2] * y
    let lat = wy[n] + wy[n + 1] * x + wy[n + 2] * y
    for (let i = 0; i < n; i++) {
      const dx = x - gcps[i].px
      const dy = y - gcps[i].py
      const k = u(Math.hypot(dx, dy))
      lon += wx[i] * k
      lat += wy[i] * k
    }
    return [lon, lat]
  }
}

function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length
  const aug = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row
    }
    if (Math.abs(aug[pivot][col]) < 1e-14) throw new Error("singular TPS matrix")
    ;[aug[col], aug[pivot]] = [aug[pivot], aug[col]]
    for (let row = col + 1; row < n; row++) {
      const f = aug[row][col] / aug[col][col]
      for (let j = col; j <= n; j++) aug[row][j] -= f * aug[col][j]
    }
  }
  const x = new Array(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = aug[row][n]
    for (let j = row + 1; j < n; j++) sum -= aug[row][j] * x[j]
    x[row] = sum / aug[row][row]
  }
  return x
}

export function warpCoords(
  transform: (x: number, y: number) => [number, number],
  coords: number[][],
): number[][] {
  return coords.map((c) => {
    const [lon, lat] = transform(c[0], c[1])
    return [lon, lat]
  })
}

/** TPS near GCPs; affine fallback for extrapolation and rejected samples. */
export function buildHybridWarp(gcps: Gcp[], padPx = 140) {
  const aff = fitAffine(gcps.map((g) => ({ x: g.px, y: g.py, lon: g.lon, lat: g.lat })))
  let tps: ((x: number, y: number) => [number, number]) | null = null
  try {
    tps = buildTps(gcps)
  } catch {
    tps = null
  }
  let minPx = Infinity
  let maxPx = -Infinity
  let minPy = Infinity
  let maxPy = -Infinity
  for (const g of gcps) {
    minPx = Math.min(minPx, g.px)
    maxPx = Math.max(maxPx, g.px)
    minPy = Math.min(minPy, g.py)
    maxPy = Math.max(maxPy, g.py)
  }
  const [lon0, lat0, lon1, lat1] = THEATER_LON_LAT
  const lonPad = 3
  const latPad = 3

  const sane = (lon: number, lat: number) =>
    Math.abs(lon) <= 90 &&
    Math.abs(lat) <= 90 &&
    lon >= lon0 - lonPad &&
    lon <= lon1 + lonPad &&
    lat >= lat0 - latPad &&
    lat <= lat1 + latPad

  return (x: number, y: number): [number, number] => {
    const [lonA, latA] = applyAffine(aff, x, y)
    const inHull =
      x >= minPx - padPx && x <= maxPx + padPx && y >= minPy - padPx && y <= maxPy + padPx
    if (tps && inHull) {
      const [lonT, latT] = tps(x, y)
      if (sane(lonT, latT)) return [lonT, latT]
    }
    if (sane(lonA, latA)) return [lonA, latA]
    return [lonA, latA]
  }
}
