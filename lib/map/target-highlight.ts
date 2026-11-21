import { roleFor, type TargetPaintInput } from "@/lib/map/province-paint"
import type * as maplibregl from "maplibre-gl"

/** Layer opacity fade for neighbour lift fills (manual rAF; style transitions skip switches). */
export const TARGET_HIGHLIGHT_FADE_MS = 280
export const TARGET_HIGHLIGHT_OPACITY = 0.88
export const TARGET_HIGHLIGHT_LAYER = "target-fill"

/** Cancels an in-flight fade when selection changes again. */
let pulseSeq = 0

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

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/**
 * Fade neighbour highlights in. Snaps opacity to 0, waits one painted frame so
 * the new feature-state roles show at zero opacity, then lerps opacity up on
 * rAF. Style `fill-opacity-transition` alone fades first select (layer starts
 * at 0) but skips province→province switches when the last painted value is
 * already 0.88 and the snap/fade land before a paint.
 */
export function pulseTargetHighlight(
  map: maplibregl.Map,
  hasTargets: boolean,
  fadeMs: number = TARGET_HIGHLIGHT_FADE_MS,
) {
  if (!map.getLayer(TARGET_HIGHLIGHT_LAYER)) return
  const seq = ++pulseSeq
  // Disable style interpolation so our rAF samples are not delayed/batched.
  map.setPaintProperty(TARGET_HIGHLIGHT_LAYER, "fill-opacity-transition", { duration: 0, delay: 0 })
  map.setPaintProperty(TARGET_HIGHLIGHT_LAYER, "fill-opacity", 0)
  if (!hasTargets) return

  requestAnimationFrame(() => {
    requestAnimationFrame((start) => {
      if (seq !== pulseSeq) return
      if (!map.getLayer(TARGET_HIGHLIGHT_LAYER)) return

      const tick = (now: number) => {
        if (seq !== pulseSeq) return
        if (!map.getLayer(TARGET_HIGHLIGHT_LAYER)) return
        const t = fadeMs <= 0 ? 1 : Math.min(1, (now - start) / fadeMs)
        map.setPaintProperty(
          TARGET_HIGHLIGHT_LAYER,
          "fill-opacity",
          TARGET_HIGHLIGHT_OPACITY * easeOutQuad(t),
        )
        if (t < 1) requestAnimationFrame(tick)
      }
      tick(start)
    })
  })
}

export function targetsActive(
  targetIds: { move: string[]; attack: string[] } | undefined,
): boolean {
  return Boolean(targetIds && (targetIds.move.length > 0 || targetIds.attack.length > 0))
}
