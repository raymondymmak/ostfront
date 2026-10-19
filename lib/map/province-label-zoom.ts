/**
 * Playable province names and strength counters.
 *
 * The opening camera is zoom 6.833576. Labels there stay fully drawn.
 * They fade out below that and are gone by 5.45, about 1.4 levels under
 * the opening zoom. The Europe frame lands at 5.32, where the 39 labels
 * would otherwise sit on top of each other.
 */
export const PROVINCE_LABEL_FULL_ZOOM = 6.35
export const PROVINCE_LABEL_HIDDEN_ZOOM = 5.45

export function provinceLabelOpacity(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom >= PROVINCE_LABEL_FULL_ZOOM) return 1
  if (zoom <= PROVINCE_LABEL_HIDDEN_ZOOM) return 0
  return (zoom - PROVINCE_LABEL_HIDDEN_ZOOM) / (PROVINCE_LABEL_FULL_ZOOM - PROVINCE_LABEL_HIDDEN_ZOOM)
}

type LabelOpacityTarget = {
  style?: { opacity: string }
  setOpacity?: (opacity: number) => void
}

/**
 * MapLibre resets `element.style.opacity` from the marker's own opacity on
 * every move, so the map path goes through `setOpacity`. A bare style is
 * enough for tests.
 */
export function applyProvinceLabelOpacity(target: LabelOpacityTarget, zoom: number) {
  const opacity = provinceLabelOpacity(zoom)
  if (target.setOpacity) {
    target.setOpacity(opacity)
    return
  }
  if (!target.style) return
  target.style.opacity = opacity >= 1 ? "" : opacity <= 0 ? "0" : opacity.toFixed(3)
}
