/** One-off helper to print HOI4 province ids nearest Ostfront seeds (pixel Voronoi). */
import { loadBmp24 } from "./load-bmp"
import { loadHoi4Definitions, rgbKey } from "./definition"
import { fitAffine, geoToPixel } from "./georef"
import { HOI4_GAME_ANCHORS } from "./anchors"
import { PROVINCE_DEFS } from "../../lib/data/definitions"

const { rgbToId, byId } = loadHoi4Definitions("./scripts/cache/hoi4/definition.csv")
const img = loadBmp24("./scripts/cache/hoi4/provinces.bmp")
const sums = new Map<number, { sx: number; sy: number; n: number }>()
for (let y = 0; y < img.height; y++) {
  const row = img.height - 1 - y
  const base = row * img.rowBytes
  for (let x = 0; x < img.width; x++) {
    const i = base + x * 3
    const pid = rgbToId.get(rgbKey([img.rows[i + 2], img.rows[i + 1], img.rows[i]]))
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
const centroids = new Map<number, { x: number; y: number }>()
for (const [pid, s] of sums) centroids.set(pid, { x: s.sx / s.n, y: s.sy / s.n })

const stable = HOI4_GAME_ANCHORS.filter((a) =>
  ["lutsk", "rovno", "przemysl", "lemberg", "minsk"].includes(a.gameId) ? false : true,
)
const aff = fitAffine(
  stable.map((a) => {
    const c = centroids.get(a.hoi4Id)!
    return { x: c.x, y: c.y, lon: a.lon, lat: a.lat }
  }),
)

for (const def of PROVINCE_DEFS) {
  const [tx, ty] = geoToPixel(aff, def.lon, def.lat)
  let best = -1
  let bd = Infinity
  for (const [pid, c] of centroids) {
    const meta = byId.get(pid)
    if (meta?.isSea || meta?.isLake) continue
    const d = (c.x - tx) ** 2 + (c.y - ty) ** 2
    if (d < bd) {
      bd = d
      best = pid
    }
  }
  console.log(`{ hoi4Id: ${best}, gameId: "${def.id}", lon: ${def.lon}, lat: ${def.lat} },`)
}
