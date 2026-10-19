import { applyAffine, type Affine2D, geoToPixel } from "./georef"
import { HOI4_FIT_ANCHORS, HOI4_GAME_ANCHORS } from "./anchors"
import type { Gcp } from "./tps"

/** Geographic anchors spread across the HOI4 crop (edges + off-map hints for stable polynomial). */
export const HOI4_EXTENT_GEO: { label: string; lon: number; lat: number }[] = [
  { label: "stettin", lon: 14.55, lat: 53.43 },
  { label: "breslau", lon: 17.03, lat: 51.11 },
  { label: "posen", lon: 16.93, lat: 52.41 },
  { label: "budapest", lon: 19.04, lat: 47.5 },
  { label: "bucharest", lon: 26.1, lat: 44.43 },
  { label: "odessa", lon: 30.72, lat: 46.48 },
  { label: "kiev", lon: 30.52, lat: 50.45 },
  { label: "smolensk", lon: 32.05, lat: 54.78 },
  { label: "pskov", lon: 28.33, lat: 57.82 },
  { label: "riga", lon: 24.1, lat: 56.95 },
  { label: "memel", lon: 21.15, lat: 55.58 },
  { label: "stockholm_coast", lon: 18.75, lat: 59.35 },
  { label: "copenhagen", lon: 12.57, lat: 55.68 },
  { label: "lublin", lon: 22.57, lat: 51.25 },
  { label: "minsk", lon: 26.35, lat: 53.55 },
]

type Centroid = { x: number; y: number }

/** GCPs used for warping (consistent pixel ↔ geo pairs). */
export function buildWarpGcps(centroids: Map<number, Centroid>): { gcps: Gcp[]; labels: string[] } {
  const seen = new Set<number>()
  const gcps: Gcp[] = []
  const labels: string[] = []
  const add = (label: string, px: number, py: number, lon: number, lat: number) => {
    gcps.push({ px, py, lon, lat })
    labels.push(label)
  }
  const gameHoi4Ids = new Set(HOI4_GAME_ANCHORS.map((a) => a.hoi4Id))
  for (const anchor of HOI4_GAME_ANCHORS) {
    if (seen.has(anchor.hoi4Id)) continue
    const c = centroids.get(anchor.hoi4Id)
    if (!c) continue
    seen.add(anchor.hoi4Id)
    add(`game:${anchor.gameId}`, c.x, c.y, anchor.lon, anchor.lat)
  }
  for (const anchor of HOI4_FIT_ANCHORS) {
    if (gameHoi4Ids.has(anchor.hoi4Id) || seen.has(anchor.hoi4Id)) continue
    const c = centroids.get(anchor.hoi4Id)
    if (!c) continue
    seen.add(anchor.hoi4Id)
    add(`fit:${anchor.hoi4Id}`, c.x, c.y, anchor.lon, anchor.lat)
  }
  return { gcps, labels }
}

/** Extra geographic labels for QA reporting (not mixed into the warp fit). */
export function buildGeorefGcps(
  centroids: Map<number, Centroid>,
  aff: Affine2D,
  _landPids: Set<number>,
  crop: { x0: number; y0: number; x1: number; y1: number },
): { gcps: Gcp[]; labels: string[] } {
  const { gcps, labels } = buildWarpGcps(centroids)
  const seen = new Set(gcps.map((g) => `${Math.round(g.px)}:${Math.round(g.py)}`))

  const add = (label: string, px: number, py: number, lon: number, lat: number) => {
    const key = `${Math.round(px)}:${Math.round(py)}`
    if (seen.has(key)) return
    seen.add(key)
    gcps.push({ px, py, lon, lat })
    labels.push(label)
  }

  for (const geo of HOI4_EXTENT_GEO) {
    const [px, py] = geoToPixel(aff, geo.lon, geo.lat)
    const key = `${Math.round(px)}:${Math.round(py)}`
    if (seen.has(key)) continue
    let tooClose = false
    for (const g of gcps) {
      const d2 = (g.px - px) ** 2 + (g.py - py) ** 2
      if (d2 < 55 * 55) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue
    add(`extent:${geo.label}`, px, py, geo.lon, geo.lat)
  }

  const corners = [
    { label: "crop-nw", px: crop.x0, py: crop.y0 },
    { label: "crop-ne", px: crop.x1, py: crop.y0 },
    { label: "crop-se", px: crop.x1, py: crop.y1 },
    { label: "crop-sw", px: crop.x0, py: crop.y1 },
    { label: "crop-n", px: (crop.x0 + crop.x1) / 2, py: crop.y0 },
    { label: "crop-s", px: (crop.x0 + crop.x1) / 2, py: crop.y1 },
    { label: "crop-w", px: crop.x0, py: (crop.y0 + crop.y1) / 2 },
    { label: "crop-e", px: crop.x1, py: (crop.y0 + crop.y1) / 2 },
  ]
  for (const corner of corners) {
    let tooClose = false
    for (const g of gcps) {
      const d2 = (g.px - corner.px) ** 2 + (g.py - corner.py) ** 2
      if (d2 < 90 * 90) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue
    const [lon, lat] = applyAffine(aff, corner.px, corner.py)
    add(corner.label, corner.px, corner.py, lon, lat)
  }

  return { gcps, labels }
}
