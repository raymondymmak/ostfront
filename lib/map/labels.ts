import type { MapProvince } from "@/components/war-map"

const ALWAYS_MAJOR = new Set([
  "warsaw",
  "vilna",
  "minsk",
  "krakow",
  "lemberg",
  "konigsberg",
  "danzig",
  "brest",
  "kovno",
  "lodz",
])

const HIDE_UNTIL_MID = new Set([
  "graudenz",
  "bromberg",
  "thorn",
  "mlawa",
  "plock",
  "posen",
  "kalisz",
  "tilsit",
  "insterburg",
  "memel",
  "shavli",
  "allenstein",
  "suwalki",
  "tarnow",
  "rzeszow",
  "kielce",
  "radom",
  "siedlce",
  "przemysl",
  "chelm",
  "kovel",
  "lutsk",
  "rovno",
  "tarnopol",
  "stanislav",
  "kamenets",
])

const HIDE_UNTIL_CLOSE = new Set([
  "bialystok",
  "grodno",
  "pinsk",
])

/** 0 = always show; higher = hide sooner when zoomed out. */
export function labelRank(province: MapProvince): number {
  if (province.depot) return 0
  if (ALWAYS_MAJOR.has(province.id)) return 0
  if (HIDE_UNTIL_CLOSE.has(province.id)) return 3
  if (HIDE_UNTIL_MID.has(province.id)) return 2
  if (province.fort >= 2 || province.terrain === "urban") return 1
  if (province.terrain === "plains" || province.terrain === "forest") return 2
  return 3
}

export function shortProvinceName(name: string): string {
  return name
    .replace("Brest-Litovsk", "Brest")
    .replace("Kamenets-Podolsk", "Kamenets")
}

/** Nudge strength counter away from the city label in tight clusters. */
export function strengthLabelOffset(id: string): [number, number] {
  switch (id) {
    case "konigsberg":
      return [0.85, 1.1]
    case "tilsit":
      return [-0.75, 1.05]
    case "thorn":
      return [0.7, 1.05]
    case "graudenz":
      return [-0.65, 1.05]
    case "krakow":
      return [0, 1.25]
    case "brest":
      return [0.55, 1.1]
    default:
      return [0, 1.05]
  }
}
