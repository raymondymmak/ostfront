/** The bits of a marker the game owns. MapLibre's own classes stay put. */
export type MarkerFace = {
  className: string
  innerHTML: string
  provinceId: string
  lng: number
  lat: number
}

type ClassListLike = {
  add: (...names: string[]) => void
  remove: (...names: string[]) => void
  contains: (name: string) => boolean
  [Symbol.iterator](): IterableIterator<string>
}

/** Enough of an element to retint a marker without taking it out of the map. */
export type MarkerFaceTarget = {
  classList: ClassListLike
  style: { position: string; top: string; left: string; pointerEvents: string }
  innerHTML: string
  dataset: { province?: string; lng?: string; lat?: string }
}

/**
 * Refresh the label and the strength counter.
 *
 * Assigning `className` would drop `maplibregl-marker`. That class is what
 * keeps the element absolutely positioned; without it the labels fall back
 * into normal flow and stack down the map.
 */
export function applyMarkerFace(target: MarkerFaceTarget, face: MarkerFace) {
  const next = new Set(face.className.split(/\s+/).filter(Boolean))
  for (const name of [...target.classList]) {
    if (name.startsWith("maplibregl-")) continue
    if (!next.has(name)) target.classList.remove(name)
  }
  for (const name of next) target.classList.add(name)
  if (!target.classList.contains("maplibregl-marker")) target.classList.add("maplibregl-marker")
  target.style.position = "absolute"
  target.style.top = "0"
  target.style.left = "0"
  target.style.pointerEvents = "none"
  target.innerHTML = face.innerHTML
  target.dataset.province = face.provinceId
  target.dataset.lng = String(face.lng)
  target.dataset.lat = String(face.lat)
}
