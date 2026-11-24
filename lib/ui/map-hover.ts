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

/** Full note, including the name and strength the map already paints. */
export function provinceHoverNote(
  province: MapProvince | Pick<MapProvince, "id" | "name" | "units" | "controller">,
  targetHoverNote?: (provinceId: string, base: string) => string,
): string {
  const base = provinceHoverBase(province)
  return targetHoverNote?.(province.id, base) ?? base
}

/**
 * Text for the cursor tooltip: only the part that is not already on the map
 * (a blocked target or a depot warning). Name and total strength stay off the tip.
 */
export function cursorHoverText(
  province: MapProvince | Pick<MapProvince, "id" | "name" | "units" | "controller">,
  targetHoverNote?: (provinceId: string, base: string) => string,
): string | null {
  const base = provinceHoverBase(province)
  const full = targetHoverNote?.(province.id, base) ?? base
  return hoverBeyondBase(full, base)
}

export function hoverBeyondBase(full: string, base: string): string | null {
  if (full === base) return null
  const prefix = `${base}\n`
  const extra = (full.startsWith(prefix) ? full.slice(prefix.length) : full).trim()
  if (!extra || extra === base) return null
  return extra
}

/** Keep a small tip near the pointer and inside the map frame. */
export function cursorTipPosition(
  pointerX: number,
  pointerY: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } {
  const tipWidth = 176
  const tipHeight = 52
  const pad = 8
  const rawX = pointerX + 14
  const rawY = pointerY + 16
  const maxX = Math.max(pad, frameWidth - tipWidth - pad)
  const maxY = Math.max(pad, frameHeight - tipHeight - pad)
  return {
    x: Math.min(Math.max(pad, rawX), maxX),
    y: Math.min(Math.max(pad, rawY), maxY),
  }
}
