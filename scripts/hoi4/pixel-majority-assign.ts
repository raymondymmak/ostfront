import { PROVINCE_DEFS } from "../../lib/data/definitions"
import { HOI4_GAME_ANCHORS, HOI4_GAME_OVERRIDES } from "./anchors"
import { geoToPixel } from "./georef"
import type { loadBmp24 } from "./load-bmp"

function nearestGamePixel(
  x: number,
  y: number,
  seeds: { id: string; x: number; y: number }[],
  pool?: string[],
) {
  let best = pool?.[0] ?? seeds[0].id
  let bestD = Number.POSITIVE_INFINITY
  for (const seed of seeds) {
    if (pool && !pool.includes(seed.id)) continue
    const d = (seed.x - x) ** 2 + (seed.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = seed.id
    }
  }
  return best
}

/** One game id per HOI4 province: nearest catalog seed in fitted pixel space. */
export function assignHoi4ByPixelMajority(
  _img: ReturnType<typeof loadBmp24>,
  _rgbToId: Map<number, number>,
  _byId: Map<number, { isSea: boolean; isLake: boolean }>,
  aff: ReturnType<typeof import("./georef").fitAffine>,
  statePools: Map<number, string[]>,
  _x0: number,
  _y0: number,
  _x1: number,
  _y1: number,
  _inTheaterGeo: (lon: number, lat: number) => boolean,
  centroids: Map<number, { x: number; y: number }>,
  theaterLand: Set<number>,
): Map<number, string> {
  const seeds = PROVINCE_DEFS.map((def) => {
    const [x, y] = geoToPixel(aff, def.lon, def.lat)
    return { id: def.id, x, y }
  })

  const map = new Map<number, string>()
  for (const pid of theaterLand) {
    const override = HOI4_GAME_OVERRIDES[pid]
    if (override) {
      map.set(pid, override)
      continue
    }
    const c = centroids.get(pid)
    if (!c) continue
    const pool = statePools.get(pid)
    map.set(pid, nearestGamePixel(c.x, c.y, seeds, pool?.length ? pool : undefined))
  }

  for (const anchor of HOI4_GAME_ANCHORS) {
    if (theaterLand.has(anchor.hoi4Id)) map.set(anchor.hoi4Id, anchor.gameId)
  }

  for (const def of PROVINCE_DEFS) {
    if ([...map.values()].includes(def.id)) continue
    let bestPid: number | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const pid of theaterLand) {
      const pool = statePools.get(pid)
      if (pool?.length && !pool.includes(def.id)) continue
      const c = centroids.get(pid)!
      const d = (seeds.find((s) => s.id === def.id)!.x - c.x) ** 2 + (seeds.find((s) => s.id === def.id)!.y - c.y) ** 2
      if (d < bestD) {
        bestD = d
        bestPid = pid
      }
    }
    if (bestPid !== null) map.set(bestPid, def.id)
  }

  return map
}
