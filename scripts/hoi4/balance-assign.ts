import { PROVINCE_DEFS } from "../../lib/data/definitions"
import { HOI4_GAME_ANCHORS, HOI4_GAME_OVERRIDES } from "./anchors"
import { applyAffine } from "./georef"

type Centroid = { x: number; y: number; count: number }

export function balanceAssignHoi4ToGame(
  theaterLand: Set<number>,
  centroids: Map<number, Centroid>,
  adj: Map<number, Set<number>>,
  aff: ReturnType<typeof import("./georef").fitAffine>,
  statePools: Map<number, string[]>,
): Map<number, string> {
  const map = new Map<number, string>()
  const area = new Map<string, number>()
  for (const def of PROVINCE_DEFS) area.set(def.id, 0)

  for (const pid of theaterLand) {
    const override = HOI4_GAME_OVERRIDES[pid]
    if (override) {
      map.set(pid, override)
      area.set(override, (area.get(override) ?? 0) + (centroids.get(pid)?.count ?? 0))
    }
  }

  for (const anchor of HOI4_GAME_ANCHORS) {
    if (!theaterLand.has(anchor.hoi4Id) || map.has(anchor.hoi4Id)) continue
    map.set(anchor.hoi4Id, anchor.gameId)
    area.set(
      anchor.gameId,
      (area.get(anchor.gameId) ?? 0) + (centroids.get(anchor.hoi4Id)?.count ?? 0),
    )
  }

  for (const def of PROVINCE_DEFS) {
    if ([...map.values()].includes(def.id)) continue
    let bestPid: number | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    for (const pid of theaterLand) {
      if (map.has(pid)) continue
      const pool = statePools.get(pid)
      if (pool?.length && !pool.includes(def.id)) continue
      const c = centroids.get(pid)!
      const [lon, lat] = applyAffine(aff, c.x, c.y)
      const d2 = (def.lon - lon) ** 2 + (def.lat - lat) ** 2
      const score = c.count / (1 + d2)
      if (score > bestScore) {
        bestScore = score
        bestPid = pid
      }
    }
    if (bestPid !== null) {
      map.set(bestPid, def.id)
      area.set(def.id, (area.get(def.id) ?? 0) + (centroids.get(bestPid)?.count ?? 0))
    }
  }

  const totalPx = [...theaterLand].reduce((s, pid) => s + (centroids.get(pid)?.count ?? 0), 0)
  const targetPx = totalPx / PROVINCE_DEFS.length
  const maxPx = targetPx * 1.22
  const unassigned = () => [...theaterLand].filter((pid) => !map.has(pid))

  let guard = 0
  while (unassigned().length && guard++ < theaterLand.size * 4) {
    const open = unassigned().filter((pid) => {
      for (const nb of adj.get(pid) ?? []) {
        if (map.has(nb)) return true
      }
      return false
    })
    if (!open.length) break
    open.sort((a, b) => (centroids.get(a)?.count ?? 0) - (centroids.get(b)?.count ?? 0))
    for (const pid of open) {
      if (map.has(pid)) continue
      const neighborGames = new Map<string, number>()
      for (const nb of adj.get(pid) ?? []) {
        const g = map.get(nb)
        if (!g) continue
        neighborGames.set(g, (neighborGames.get(g) ?? 0) + 1)
      }
      if (!neighborGames.size) continue
      const pool = statePools.get(pid)
      let pickFrom = [...neighborGames.keys()].filter((g) => !pool?.length || pool.includes(g))
      if (!pickFrom.length) pickFrom = [...neighborGames.keys()]
      const underCap = pickFrom.filter((g) => (area.get(g) ?? 0) < maxPx)
      const pickPool = underCap.length ? underCap : pickFrom
      let pickGame = pickPool[0]
      let pickArea = area.get(pickGame) ?? 0
      for (const g of pickPool) {
        const a = area.get(g) ?? 0
        if (a < pickArea) {
          pickArea = a
          pickGame = g
        }
      }
      map.set(pid, pickGame)
      area.set(pickGame, pickArea + (centroids.get(pid)?.count ?? 0))
    }
  }

  for (const pid of unassigned()) {
    const c = centroids.get(pid)!
    const [lon, lat] = applyAffine(aff, c.x, c.y)
    let best = PROVINCE_DEFS[0].id
    let bestD = Number.POSITIVE_INFINITY
    for (const def of PROVINCE_DEFS) {
      const pool = statePools.get(pid)
      if (pool?.length && !pool.includes(def.id)) continue
      const d = (def.lon - lon) ** 2 + (def.lat - lat) ** 2
      if (d < bestD) {
        bestD = d
        best = def.id
      }
    }
    map.set(pid, best)
    area.set(best, (area.get(best) ?? 0) + (centroids.get(pid)?.count ?? 0))
  }

  return map
}
