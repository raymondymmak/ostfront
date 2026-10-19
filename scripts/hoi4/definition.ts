import { readFileSync } from "node:fs"

export type Hoi4ProvinceMeta = {
  id: number
  rgb: [number, number, number]
  isSea: boolean
  isLake: boolean
}

export function loadHoi4Definitions(path: string): {
  byId: Map<number, Hoi4ProvinceMeta>
  rgbToId: Map<number, number>
} {
  const byId = new Map<number, Hoi4ProvinceMeta>()
  const rgbToId = new Map<number, number>()
  const text = readFileSync(path, "utf8")
  for (const line of text.split("\n")) {
    const parts = line.trim().split(";")
    if (parts.length < 5 || !/^\d+$/.test(parts[0])) continue
    const id = Number(parts[0])
    const rgb: [number, number, number] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
    const terrainKind = parts[4]?.toLowerCase() ?? ""
    const isSea = terrainKind === "sea"
    const isLake = terrainKind === "lake"
    const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
    rgbToId.set(key, id)
    byId.set(id, { id, rgb, isSea: isSea || terrainKind === "sea", isLake })
  }
  return { byId, rgbToId }
}

export function rgbKey(rgb: [number, number, number]): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
}

import type { BmpImage } from "./load-bmp"
import { pixelRgb } from "./load-bmp"

export function provinceIdAtPixel(
  img: BmpImage,
  rgbToId: Map<number, number>,
  x: number,
  y: number,
): number | null {
  const rgb = pixelRgb(img, x, y)
  return rgbToId.get(rgbKey(rgb)) ?? null
}
