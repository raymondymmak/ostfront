import { PROVINCE_DEFS } from "../../lib/data/definitions"

/** Raster band values (uint16). */
export const SEA_GID = 900
export const NATION_GID_START = 1000

export const GAME_INDEX = new Map(PROVINCE_DEFS.map((d, i) => [d.id, i + 1]))
export const INDEX_TO_GAME = new Map(PROVINCE_DEFS.map((d, i) => [i + 1, d.id]))

export function isPlayableGid(gid: number): boolean {
  return gid >= 1 && gid <= PROVINCE_DEFS.length
}

export function isNationGid(gid: number): boolean {
  return gid >= NATION_GID_START
}
