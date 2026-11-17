/** Shared move/attack highlight styling for MapLibre and SVG fallback. */
export const MAP_TARGET_STYLE = {
  move: {
    fill: "#4fc3ff",
    fillOpacity: 0.58,
    outline: "#e8fcff",
    outlineWidth: 2.5,
  },
  attack: {
    fill: "#ff5538",
    fillOpacity: 0.58,
    outline: "#ffc9a8",
    outlineWidth: 2.5,
  },
  dim: {
    fill: "#0c0a12",
    opacity: 0.42,
  },
  /** Non-target provinces while a source with legal targets is selected. */
  mutedProvinceOpacity: 0.48,
} as const

export function mapTargetsActive(targetIds?: { move: string[]; attack: string[] }): boolean {
  return Boolean(targetIds && (targetIds.move.length > 0 || targetIds.attack.length > 0))
}