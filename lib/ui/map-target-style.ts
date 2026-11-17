import type { Faction } from "@/lib/types"

/** Base province control fills (MapLibre + SVG). Highlights use lighter tints of these. */
export const MAP_FACTION_FILL = {
  central: "#4a6d90",
  russia: "#a85b49",
} as const

/** Shared move/attack highlight styling for MapLibre and SVG fallback. */
export const MAP_TARGET_STYLE = {
  move: {
    fill: "#7eb0d4",
    fillOpacity: 0.62,
    outline: "#c5dff0",
    outlineWidth: 2.5,
  },
  attack: {
    fill: "#cc8f7a",
    fillOpacity: 0.62,
    outline: "#ebc9bb",
    outlineWidth: 2.5,
  },
  dim: {
    fill: "#0c0a12",
    opacity: 0.42,
  },
  /** Non-target provinces while a source with legal targets is selected. */
  mutedProvinceOpacity: 0.48,
} as const

/** Target province fill on news-card map vignettes (new controller). */
export function newsVignetteTargetFill(faction: Faction): string {
  return MAP_FACTION_FILL[faction]
}

/** Glow / outline tint for vignette target highlight. */
export function newsVignetteTargetGlow(faction: Faction): string {
  return faction === "central" ? MAP_TARGET_STYLE.move.outline : MAP_TARGET_STYLE.attack.outline
}

export function mapTargetsActive(targetIds?: { move: string[]; attack: string[] }): boolean {
  return Boolean(targetIds && (targetIds.move.length > 0 || targetIds.attack.length > 0))
}