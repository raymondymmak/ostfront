import type { Faction } from "@/lib/types"

export type NewsKind =
  | "cityTaken"
  | "cityLost"
  | "depotLost"
  | "objectiveTaken"
  | "objectiveMissed"

export type NewsImage =
  | { type: "photo"; key: string; credit: string }
  | {
      type: "map"
      provinceId: string
      arrowFrom?: string[]
      tone: "victory" | "defeat"
    }

export type NewsEvent = {
  id: string
  kind: NewsKind
  provinceId: string
  provinceName: string
  faction: Faction
  headline: string
  lore: string
  image: NewsImage
  turn: number
}