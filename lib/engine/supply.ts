import { listedStrength } from "@/lib/engine/echelon"
import { clamp } from "@/lib/format"
import type { Faction, Province, Terrain } from "@/lib/types"

export const TERRAIN_ENTER_COST: Record<Terrain, number> = {
  plains: 3,
  urban: 2,
  forest: 4,
  marsh: 6,
  mountain: 5,
}

export const RAIL_EDGE_COST = 1
export const SUPPLY_FALLOFF = 11

/** Maximum fighting strength a province can feed at full network supply. */
export const TERRAIN_SUPPLY_CAPACITY: Record<Terrain, number> = {
  plains: 44,
  urban: 62,
  forest: 40,
  marsh: 36,
  mountain: 32,
}

export const DEPOT_CAPACITY_BONUS = 34
export const RAIL_CAPACITY_BONUS = 6

export type SupplyCapacityNote = {
  provinceId: string
  name: string
  baseSupply: number
  effectiveSupply: number
  capacity: number
  garrisonStrength: number
}

export function provinceSupplyCapacity(
  province: Pick<Province, "terrain" | "depot" | "controller" | "rail">,
  garrisonStrength = 0,
): number {
  let capacity = TERRAIN_SUPPLY_CAPACITY[province.terrain]
  if (province.depot === province.controller) capacity += DEPOT_CAPACITY_BONUS
  capacity += province.rail.length * RAIL_CAPACITY_BONUS
  if (province.depot === province.controller && garrisonStrength > 0) {
    capacity = Math.max(capacity, Math.round(garrisonStrength * 0.62))
  }
  return capacity
}

export function garrisonStrengthInProvince(province: Province): number {
  return listedStrength(province.units.filter((unit) => unit.faction === province.controller))
}

/** When garrison strength exceeds capacity, every formation there fights at scaled supply. */
export function effectiveSupplyFromBase(baseSupply: number, capacity: number, garrisonStrength: number): number {
  if (garrisonStrength <= 0 || garrisonStrength <= capacity) {
    return clamp(Math.round(baseSupply), 0, 100)
  }
  const scaled = baseSupply * (capacity / garrisonStrength)
  return clamp(Math.round(scaled), 0, 100)
}

/** Supply factor for defenders holding a province (network line, not capacity-scaled). */
export function defenderSupplyInProvince(province: Pick<Province, "supply" | "networkSupply">): number {
  return province.networkSupply ?? province.supply
}

/** Attack power uses capacity-scaled supply; friendly depots keep at least 72% of network supply for marching out. */
export function attackerSupplyFromProvince(province: Province): number {
  const network = province.networkSupply ?? province.supply
  if (province.depot === province.controller) {
    return Math.max(province.supply, Math.round(network * 0.72))
  }
  return province.supply
}

export function applyProvinceSupplyCapacity(province: Province, baseSupply: number): SupplyCapacityNote | null {
  const garrisonStrength = garrisonStrengthInProvince(province)
  const capacity = provinceSupplyCapacity(province, garrisonStrength)
  const effectiveSupply = effectiveSupplyFromBase(baseSupply, capacity, garrisonStrength)
  province.networkSupply = clamp(Math.round(baseSupply), 0, 100)
  province.supply = effectiveSupply
  if (garrisonStrength <= capacity) return null
  return {
    provinceId: province.id,
    name: province.name,
    baseSupply: clamp(Math.round(baseSupply), 0, 100),
    effectiveSupply,
    capacity,
    garrisonStrength,
  }
}

export type SupplyNode = {
  id: string
  controller: Faction
  terrain: Terrain
  depot: Faction | null
  supplyModifier: number
}

export type SupplyLink = {
  a: string
  b: string
  rail: boolean
}

/**
 * Multi-source Dijkstra per faction. Depots are sources only when controlled
 * by the faction they belong to. Enemy provinces are not traversed. Rail edges
 * cost 1; a road costs the terrain of the province being entered.
 * Supply is 100 − path cost × 11, plus the province modifier, clamped 0–100.
 */
export function computeSupply(
  nodes: SupplyNode[],
  links: SupplyLink[],
): Record<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const result: Record<string, number> = {}

  for (const faction of ["central", "russia"] as const) {
    const owned = nodes.filter((node) => node.controller === faction)
    const ownedIds = new Set(owned.map((node) => node.id))
    const adj = new Map<string, { to: string; cost: number }[]>()
    for (const id of ownedIds) adj.set(id, [])

    for (const link of links) {
      const a = byId.get(link.a)
      const b = byId.get(link.b)
      if (!a || !b) continue
      if (!ownedIds.has(a.id) || !ownedIds.has(b.id)) continue
      const costAB = link.rail ? RAIL_EDGE_COST : TERRAIN_ENTER_COST[b.terrain]
      const costBA = link.rail ? RAIL_EDGE_COST : TERRAIN_ENTER_COST[a.terrain]
      adj.get(a.id)?.push({ to: b.id, cost: costAB })
      adj.get(b.id)?.push({ to: a.id, cost: costBA })
    }

    const sources = owned
      .filter((node) => node.depot === faction)
      .map((node) => node.id)
    const dist = dijkstra(
      sources,
      adj,
      owned.map((node) => node.id),
    )

    for (const node of owned) {
      const base =
        dist[node.id] === Infinity ? 0 : 100 - dist[node.id] * SUPPLY_FALLOFF
      result[node.id] = clamp(Math.round(base + node.supplyModifier), 0, 100)
    }
  }

  return result
}

export function dijkstra(
  sources: string[],
  adj: Map<string, { to: string; cost: number }[]>,
  nodeIds: string[],
): Record<string, number> {
  const dist: Record<string, number> = {}
  for (const id of nodeIds) dist[id] = Infinity
  for (const id of sources) {
    if (id in dist) dist[id] = 0
  }

  const used = new Set<string>()
  for (;;) {
    let current: string | null = null
    let best = Infinity
    for (const id of nodeIds) {
      if (!used.has(id) && dist[id] < best) {
        best = dist[id]
        current = id
      }
    }
    if (current === null || best === Infinity) break
    used.add(current)
    for (const edge of adj.get(current) ?? []) {
      const next = dist[current] + edge.cost
      if (next < dist[edge.to]) dist[edge.to] = next
    }
  }
  return dist
}

export function decaySupplyModifier(modifier: number): number {
  if (modifier > 0) return Math.max(0, modifier - 10)
  if (modifier < 0) return Math.min(0, modifier + 10)
  return 0
}
