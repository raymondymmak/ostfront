import type { MapProvince } from "@/components/war-map"
import { listedStrength } from "@/lib/engine/echelon"

export function provinceHoverBase(province: MapProvince | Pick<MapProvince, "name" | "units" | "controller">): string {
  const strength = listedStrength(province.units)
  const controller = province.controller === "central" ? "Central Powers" : "Russia"
  const lines = [
    province.name,
    strength > 0
      ? `Total unit strength: ${strength} (${controller})`
      : "No formations present",
  ]
  return lines.join("\n")
}

/** Same copy MapLibre uses, including blocked-target notes from legalTargets. */
export function provinceHoverNote(
  province: MapProvince | Pick<MapProvince, "id" | "name" | "units" | "controller">,
  targetHoverNote?: (provinceId: string, base: string) => string,
): string {
  const base = provinceHoverBase(province)
  return targetHoverNote?.(province.id, base) ?? base
}