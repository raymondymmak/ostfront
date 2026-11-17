import type { NewsImage, NewsKind } from "@/lib/news/types"

export type PhotoAsset = {
  file: string
  credit: string
}

/** Wikimedia Commons assets in `public/news/` (see CREDITS.md). */
export const NEWS_PHOTOS: Record<string, PhotoAsset> = {
  "gorlice-column": {
    file: "/news/gorlice-column.jpg",
    credit: "IWM Q 55044 — German troops near Gorlice, May 1915 (UK Crown copyright expired).",
  },
  "gorlice-artillery": {
    file: "/news/gorlice-artillery.jpg",
    credit: "Schwere deutsche Morser, Eastern Front 1915 (pre-1927 publication).",
  },
  "san-line": {
    file: "/news/san-line.jpg",
    credit: "Aus der Schlacht am San, 1915 (pre-1927 publication).",
  },
  "eastern-rail": {
    file: "/news/eastern-rail.jpg",
    credit: "Jaroslau–Rzeszów line, Galicia 1915 (pre-1927 publication).",
  },
  "galicia-1914": {
    file: "/news/galicia-1914.jpg",
    credit: "P. Tomac & R. Đurašinović, Battle of Galicia sketch, 1914 (PD).",
  },
  "gorlice-battle": {
    file: "/news/gorlice-battle.jpg",
    credit: "Ilustrowany Kurier Wojenny, 20 June 1915 (PD US).",
  },
  "russian-prisoners": {
    file: "/news/russian-prisoners.jpg",
    credit: "Russian prisoners after the Gorlice breakthrough (pre-1927 publication).",
  },
}

const PHOTO_KEYS = Object.keys(NEWS_PHOTOS)

function imageSeed(turn: number, provinceId: string, kind: NewsKind): number {
  let h = (turn + 1) * 2654435761
  for (const ch of `${kind}:${provinceId}`) {
    h = Math.imul(h ^ ch.charCodeAt(0), 2246822519) >>> 0
  }
  return h
}

/** Map vignettes for battlefield headlines; photos for diplomacy-style beats. */
export function newsImage(
  kind: NewsKind,
  provinceId: string,
  turn: number,
  arrowFrom: string[] | undefined,
  tone: "victory" | "defeat",
): NewsImage {
  const useMap =
    kind === "encirclement" ||
    kind === "cityTaken" ||
    kind === "cityLost" ||
    (kind === "objectiveTaken" && imageSeed(turn, provinceId, kind) % 3 === 0)
  if (useMap) {
    return { type: "map", provinceId, arrowFrom, tone }
  }
  const key = PHOTO_KEYS[imageSeed(turn, provinceId, kind) % PHOTO_KEYS.length]!
  const asset = NEWS_PHOTOS[key]!
  return { type: "photo", key, credit: asset.credit }
}

export function photoSrc(key: string): string {
  return NEWS_PHOTOS[key]?.file ?? NEWS_PHOTOS["gorlice-column"]!.file
}