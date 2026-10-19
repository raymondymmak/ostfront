import { PROVINCE_DEFS } from "@/lib/data/definitions"
import { buildTheater } from "@/lib/data/geometry"
import { railsFromNeighbors } from "@/lib/data/rails"
import type { Faction, Province, Terrain } from "@/lib/types"

export type CatalogProvince = {
  id: string
  name: string
  terrain: Terrain
  neighbors: string[]
  rail: string[]
  owner: Faction
  controller: Faction
  fort: number
  depot?: Faction
  unrest: number
  aliases: string[]
  centroid: [number, number]
  polygon: [number, number][]
}

export const PROVINCE_COUNT = PROVINCE_DEFS.length

const theater = buildTheater(PROVINCE_DEFS)
const { rails, missing } = railsFromNeighbors(theater.neighbors)

export const RAIL_GAPS: [string, string][] = missing

export const CATALOG: CatalogProvince[] = PROVINCE_DEFS.map((def) => ({
  id: def.id,
  name: def.name,
  terrain: def.terrain,
  neighbors: theater.neighbors[def.id] ?? [],
  rail: rails[def.id] ?? [],
  owner: def.owner,
  controller: def.controller,
  fort: def.fort,
  depot: def.depot,
  unrest: def.unrest ?? 0,
  aliases: def.aliases ?? [],
  centroid: theater.centroids[def.id],
  polygon: theater.polygons[def.id] ?? [],
}))

export const CATALOG_BY_ID: Record<string, CatalogProvince> = Object.fromEntries(
  CATALOG.map((province) => [province.id, province]),
)

export function blankProvince(entry: CatalogProvince): Province {
  return {
    id: entry.id,
    name: entry.name,
    terrain: entry.terrain,
    neighbors: entry.neighbors.slice(),
    rail: entry.rail.slice(),
    owner: entry.owner,
    controller: entry.controller,
    supply: 0,
    unrest: entry.unrest,
    fort: entry.fort,
    units: [],
    depot: entry.depot,
    supplyModifier: 0,
  }
}
