import type { MapProvince } from "@/components/war-map"

/** 0 = always show; higher = hide sooner when zoomed out. */
export function labelRank(province: MapProvince): number {
  if (province.depot || province.fort >= 2) return 0
  if (province.terrain === "urban") return 0
  if (province.units.length > 0) return 1
  if (province.terrain === "mountain" || province.terrain === "marsh") return 2
  return 2
}

export function shortProvinceName(name: string): string {
  return name
    .replace("Carpathian Ruthenia", "Ruthenia")
    .replace("Eastern Slovakia", "E. Slovakia")
    .replace("Austrian Silesia", "Aus. Silesia")
    .replace("Ermland-Masuren", "Ermland")
}

/** Nudge strength counter away from the city label in tight clusters. */
export function strengthLabelOffset(id: string): [number, number] {
  switch (id) {
    case "konigsberg":
      return [0.4, 1.1]
    case "krakow":
      return [0, 1.2]
    case "lwow":
      return [0.3, 1.1]
    case "warszawa":
      return [0, 1.15]
    default:
      return [0, 1.05]
  }
}
