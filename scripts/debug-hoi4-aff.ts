import { loadBmp24 } from "./hoi4/load-bmp"
import { loadHoi4Definitions, rgbKey } from "./hoi4/definition"
import { applyAffine, fitAffine, geoToPixel, roughPixel } from "./hoi4/georef"
import { PROVINCE_DEFS } from "../lib/data/definitions"

const { rgbToId } = loadHoi4Definitions("./scripts/cache/hoi4/definition.csv")
const img = loadBmp24("./scripts/cache/hoi4/provinces.bmp")
const sums = new Map<number, { sx: number; sy: number; n: number }>()
const { width, height, rows, rowBytes } = img
for (let y = 0; y < height; y++) {
  const row = height - 1 - y
  const base = row * rowBytes
  for (let x = 0; x < width; x++) {
    const i = base + x * 3
    const r = rows[i + 2]
    const g = rows[i + 1]
    const b = rows[i]
    const pid = rgbToId.get(rgbKey([r, g, b]))
    if (!pid) continue
    let s = sums.get(pid)
    if (!s) {
      s = { sx: 0, sy: 0, n: 0 }
      sums.set(pid, s)
    }
    s.sx += x
    s.sy += y
    s.n++
  }
}
console.log("centroids", sums.size)
const centroids = new Map<number, { x: number; y: number }>()
for (const [pid, s] of sums) centroids.set(pid, { x: s.sx / s.n, y: s.sy / s.n })

const pairs: { x: number; y: number; lon: number; lat: number }[] = []
const used = new Set<number>()
for (const def of PROVINCE_DEFS) {
  const [px, py] = roughPixel(width, height, def.lon, def.lat)
  let best = -1
  let bd = Infinity
  for (const [pid, c] of centroids) {
    const d = (c.x - px) ** 2 + (c.y - py) ** 2
    if (d < bd) {
      bd = d
      best = pid
    }
  }
  if (best >= 0 && !used.has(best)) {
    used.add(best)
    const c = centroids.get(best)!
    pairs.push({ x: c.x, y: c.y, lon: def.lon, lat: def.lat })
  }
}
console.log("pairs", pairs.length)
const aff = fitAffine(pairs)
console.log("aff", aff)
const c = pairs[0]
console.log("sample apply", applyAffine(aff, c.x, c.y), "expected", c.lon, c.lat)
const [px, py] = geoToPixel(aff, c.lon, c.lat)
console.log("roundtrip px", px, py, "orig", c.x, c.y)
const BBOX = [15.8, 48.35, 28.8, 56.35]
let inB = 0
for (const [, cent] of centroids) {
  const ll = applyAffine(aff, cent.x, cent.y)
  if (ll[0] >= BBOX[0] - 1 && ll[0] <= BBOX[2] + 1 && ll[1] >= BBOX[1] - 1 && ll[1] <= BBOX[3] + 1)
    inB++
}
console.log("in bbox", inB)

const hoi4Seed = new Map<number, string>()
for (const def of PROVINCE_DEFS) {
  const [px, py] = roughPixel(width, height, def.lon, def.lat)
  let best = -1
  let bd = Infinity
  for (const [pid, c] of centroids) {
    const d = (c.x - px) ** 2 + (c.y - py) ** 2
    if (d < bd) {
      bd = d
      best = pid
    }
  }
  hoi4Seed.set(best, def.id)
}
import { HOI4_GAME_ANCHORS } from "./hoi4/anchors"
import { loadHoi4Definitions } from "./hoi4/definition"

const { byId } = loadHoi4Definitions("./scripts/cache/hoi4/definition.csv")
const anchorPairs = HOI4_GAME_ANCHORS.map((a) => {
  const c = centroids.get(a.hoi4Id)!
  return { x: c.x, y: c.y, lon: a.lon, lat: a.lat }
})
const aff2 = fitAffine(anchorPairs)
const BBOX = [15.8, 48.35, 28.8, 56.35]
const counts = new Map<string, number>()
for (const [pid, c] of centroids) {
  const meta = byId.get(pid)
  if (!meta || meta.isSea || meta.isLake) continue
  const ll = applyAffine(aff2, c.x, c.y)
  if (ll[0] < BBOX[0] - 1.5 || ll[0] > BBOX[2] + 1.5 || ll[1] < BBOX[1] - 1.5 || ll[1] > BBOX[3] + 1.5) continue
  let best = PROVINCE_DEFS[0].id
  let bd = Infinity
  for (const def of PROVINCE_DEFS) {
    const d = (def.lon - ll[0]) ** 2 + (def.lat - ll[1]) ** 2
    if (d < bd) {
      bd = d
      best = def.id
    }
  }
  counts.set(best, (counts.get(best) ?? 0) + 1)
}
for (const id of ["insterburg", "suwalki", "bialystok", "siedlce", "brest", "chelm", "konigsberg", "graudenz"]) {
  console.log(id, "hoi4 count", counts.get(id) ?? 0)
}

for (const id of ["graudenz", "thorn", "bromberg", "mlawa", "posen"]) {
  const def = PROVINCE_DEFS.find((d) => d.id === id)!
  const [px, py] = roughPixel(width, height, def.lon, def.lat)
  let best = -1
  let bd = Infinity
  for (const [pid, c] of centroids) {
    const d = (c.x - px) ** 2 + (c.y - py) ** 2
    if (d < bd) {
      bd = d
      best = pid
    }
  }
  const c = centroids.get(best)!
  const ll = applyAffine(aff, c.x, c.y)
  console.log(id, "hoi4", best, "px", c, "geo", ll, "seed owner", hoi4Seed.get(best))
}
