export type Affine2D = {
  /** lon = a*x + b*y + c */
  a: number
  b: number
  c: number
  /** lat = d*x + e*y + f */
  d: number
  e: number
  f: number
}

export function applyAffine(aff: Affine2D, x: number, y: number): [number, number] {
  return [aff.a * x + aff.b * y + aff.c, aff.d * x + aff.e * y + aff.f]
}

/** Least-squares fit lon/lat from pixel points (x,y). */
export function fitAffine(pairs: { x: number; y: number; lon: number; lat: number }[]): Affine2D {
  if (pairs.length < 3) throw new Error("need at least 3 control points for affine fit")
  const [a, b, c] = fitPlane(pairs.map((p) => [p.x, p.y, p.lon]))
  const [d, e, f] = fitPlane(pairs.map((p) => [p.x, p.y, p.lat]))
  return { a, b, c, d, e, f }
}

/** w ≈ p*x + q*y + r */
function fitPlane(samples: [number, number, number][]): [number, number, number] {
  let sxx = 0
  let sxy = 0
  let syy = 0
  let sx = 0
  let sy = 0
  let sw = 0
  let sxw = 0
  let syw = 0
  const n = samples.length
  for (const [x, y, w] of samples) {
    sxx += x * x
    sxy += x * y
    syy += y * y
    sx += x
    sy += y
    sw += w
    sxw += x * w
    syw += y * w
  }
  const m = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ]
  const v = [sxw, syw, sw]
  const sol = solve3(m, v)
  if (!sol) throw new Error("degenerate affine fit")
  return sol
}

function solve3(m: number[][], v: number[]): [number, number, number] | null {
  const a = m.map((row, i) => [...row, v[i]])
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    for (let row = col + 1; row < 3; row++) {
      const f = a[row][col] / a[col][col]
      for (let j = col; j < 4; j++) a[row][j] -= f * a[col][j]
    }
  }
  const out = [0, 0, 0]
  for (let row = 2; row >= 0; row--) {
    let sum = a[row][3]
    for (let j = row + 1; j < 3; j++) sum -= a[row][j] * out[j]
    out[row] = sum / a[row][row]
  }
  return [out[0], out[1], out[2]]
}

export function roughPixel(mapW: number, mapH: number, lon: number, lat: number): [number, number] {
  return [(lon + 180) / 360 * mapW, ((90 - lat) / 180) * mapH]
}

/** Map lon/lat → pixel (inverse of {@link applyAffine}). */
export function geoToPixel(aff: Affine2D, lon: number, lat: number): [number, number] {
  const det = aff.a * aff.e - aff.b * aff.d
  if (Math.abs(det) < 1e-12) throw new Error("singular affine")
  const rl = lon - aff.c
  const rt = lat - aff.f
  const x = (aff.e * rl - aff.b * rt) / det
  const y = (-aff.d * rl + aff.a * rt) / det
  return [x, y]
}
