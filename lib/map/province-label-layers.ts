import type { MapProvince } from "@/components/war-map"
import { listedStrength } from "@/lib/engine/echelon"
import { shortProvinceName } from "@/lib/map/labels"
import {
  PROVINCE_LABEL_FULL_ZOOM,
  PROVINCE_LABEL_HIDDEN_ZOOM,
} from "@/lib/map/province-label-zoom"
import type * as maplibregl from "maplibre-gl"

/** Self-hosted glyph folders under `public/fonts/`. */
export const MAP_GLYPHS_URL = "/fonts/{fontstack}/{range}.pbf"

/** Noto Serif for names; Symbols2 covers ★ / ◆ (U+2605 / U+25C6) glyph ranges. */
export const PROVINCE_LABEL_FONT = ["Noto Serif Regular", "Noto Sans Symbols2 Regular"]
export const BACKDROP_LABEL_FONT = ["Open Sans Regular"]

export function provinceLabelOpacityExpression(): maplibregl.ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    PROVINCE_LABEL_HIDDEN_ZOOM,
    0,
    PROVINCE_LABEL_FULL_ZOOM,
    1,
  ]
}

export function provinceLabelCollection(
  provinces: MapProvince[],
  selectedId: string | null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: provinces.map((province) => {
      const strength = listedStrength(province.units)
      const prefix = [province.vp ? "★" : "", province.depot ? "◆" : ""].filter(Boolean).join(" ")
      const name = prefix ? `${prefix} ${shortProvinceName(province.name)}` : shortProvinceName(province.name)
      return {
        type: "Feature",
        id: province.id,
        properties: {
          id: province.id,
          name,
          selected: province.id === selectedId,
          hasCounter: strength > 0,
        },
        geometry: { type: "Point", coordinates: province.centroid },
      }
    }),
  }
}

export function provinceCounterCollection(provinces: MapProvince[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: provinces
      .map((province) => {
        const strength = listedStrength(province.units)
        if (strength <= 0) return null
        return {
          type: "Feature",
          id: `${province.id}-counter`,
          properties: {
            id: province.id,
            strength: String(strength),
            controller: province.controller,
          },
          geometry: { type: "Point", coordinates: province.centroid },
        }
      })
      .filter(Boolean) as GeoJSON.Feature[],
  }
}

/** Creates the stretchable pill used behind strength counters (`icon-text-fit`). */
export function createCounterPillImage(): {
  width: number
  height: number
  data: Uint8Array
  stretchX: [[number, number]]
  stretchY: [[number, number]]
  content: [number, number, number, number]
  pixelRatio: number
} {
  const width = 24
  const height = 14
  const radius = 7
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const insideX = x >= radius && x < width - radius
      const insideY = y >= 1 && y < height - 1
      const leftCap =
        x < radius && Math.hypot(radius - x - 0.5, Math.abs(y - height / 2 + 0.5)) <= radius
      const rightCap =
        x >= width - radius && Math.hypot(x - (width - radius) + 0.5, Math.abs(y - height / 2 + 0.5)) <= radius
      const on = insideX && insideY ? true : leftCap || rightCap
      const offset = (y * width + x) * 4
      data[offset] = 246
      data[offset + 1] = 241
      data[offset + 2] = 228
      data[offset + 3] = on ? 235 : 0
    }
  }
  return {
    width,
    height,
    data,
    stretchX: [[radius, width - radius]],
    stretchY: [[2, height - 2]],
    content: [radius, 2, width - radius, height - 2],
    pixelRatio: 1,
  }
}