import { roleFor, type TargetPaintInput } from "@/lib/map/province-paint"
import type * as maplibregl from "maplibre-gl"

/** Layer opacity fade for neighbour lift fills (MapLibre paint transition). */
export const TARGET_HIGHLIGHT_FADE_MS = 280
export const TARGET_HIGHLIGHT_OPACITY = 0.88
export const TARGET_HIGHLIGHT_LAYER = "target-fill"

/**
 * Write `role` on feature-state only (never during the same tick as a wiping
 * `setData` without a follow-up re-apply). Used so selection switches can fade
 * via layer `fill-opacity` without rewriting GeoJSON.
 */
export function applyProvinceRoleStates(
  map: maplibregl.Map,
  provinces: { id: string }[],
  targets: TargetPaintInput | undefined,
  selectedId: string | null,
) {
  for (const province of provinces) {
    const role = roleFor(province.id, targets, selectedId)
    map.setFeatureState({ source: "provinces", id: province.id }, { role })
  }
}

/**
 * Fade neighbour highlights in. Snaps opacity to 0, waits a painted frame
 * (double rAF), then sets opacity up so MapLibre's `fill-opacity-transition`
 * eases in — same motion for first select and province→province switches.
 */
export function pulseTargetHighlight(
  map: maplibregl.Map,
  hasTargets: boolean,
  fadeMs: number = TARGET_HIGHLIGHT_FADE_MS,
) {
  if (!map.getLayer(TARGET_HIGHLIGHT_LAYER)) return
  map.setPaintProperty(TARGET_HIGHLIGHT_LAYER, "fill-opacity-transition", { duration: 0, delay: 0 })
  map.setPaintProperty(TARGET_HIGHLIGHT_LAYER, "fill-opacity", 0)
  if (!hasTargets) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!map.getLayer(TARGET_HIGHLIGHT_LAYER)) return
      map.setPaintProperty(TARGET_HIGHLIGHT_LAYER, "fill-opacity-transition", {
        duration: fadeMs,
        delay: 0,
      })
      map.setPaintProperty(TARGET_HIGHLIGHT_LAYER, "fill-opacity", TARGET_HIGHLIGHT_OPACITY)
    })
  })
}

export function targetsActive(
  targetIds: { move: string[]; attack: string[] } | undefined,
): boolean {
  return Boolean(targetIds && (targetIds.move.length > 0 || targetIds.attack.length > 0))
}
