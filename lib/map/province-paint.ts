import { MAP_FACTION_FILL } from "@/lib/ui/map-target-style"
import type { Faction } from "@/lib/types"

export type ProvincePaintFields = {
  controller: Faction
  supply: number
  unrest: number
}

export type PaintOverlayMode = "none" | "supply" | "unrest"

export type TargetPaintRole = "none" | "move" | "attack" | "reach" | "dim"

export type TargetPaintInput = {
  move: string[]
  attack: string[]
  canOrder: boolean
}

/** Lift toward white for orderable move/attack targets — strong enough to read on Control fills. */
export const LIFT_TARGET = 0.45
/** Softer lift for reach-only previews (cannot order). */
export const LIFT_REACH = 0.28

/** Controller fill or supply/unrest heat — always `#rrggbb` so `liftFill` stays valid. */
export function baseFill(province: ProvincePaintFields, mode: PaintOverlayMode): string {
  if (mode === "supply") return rampHex(province.supply, "#7a2e2a", "#c6a15a", "#2d6a45", 45)
  if (mode === "unrest") return rampHex(province.unrest, "#3e5348", "#d4a24c", "#8e2430", 50)
  return MAP_FACTION_FILL[province.controller]
}

/** Lighten a `#rrggbb` or `rgb(r g b)` color toward white; amount is 0–1. */
export function liftFill(color: string, amount: number): string {
  const t = Math.min(1, Math.max(0, amount))
  const [r, g, b] = parseColor(color)
  const channel = (value: number) => Math.round(value + (255 - value) * t)
  return rgbHex(channel(r), channel(g), channel(b))
}

/**
 * Province highlight role while a source is selected.
 * When `canOrder` is false, `move` / `attack` hold reach previews (neighbor factions).
 */
export function roleFor(
  id: string,
  targets: TargetPaintInput | undefined,
  selectedId: string | null,
): TargetPaintRole {
  if (!targets) return "none"
  if (id === selectedId) return "none"
  const inMove = targets.move.includes(id)
  const inAttack = targets.attack.includes(id)
  if (targets.canOrder) {
    if (inMove) return "move"
    if (inAttack) return "attack"
  } else if (inMove || inAttack) {
    return "reach"
  }
  const active = targets.move.length > 0 || targets.attack.length > 0
  return active ? "dim" : "none"
}

/** Reach highlight: a lifted tint of the province's own control color. */
export function reachFill(province: ProvincePaintFields): string {
  return liftFill(MAP_FACTION_FILL[province.controller], LIFT_REACH)
}

/**
 * Paint properties written onto each province GeoJSON feature before `provinces.setData`.
 * `role` is a data property (not feature-state) so fill updates atomically with `setData`.
 */
export function provincePaintProperties(
  province: ProvincePaintFields,
  overlay: PaintOverlayMode,
  role: TargetPaintRole = "none",
): { fill: string; lift: string; liftSoft: string; role: TargetPaintRole } {
  const fill = baseFill(province, overlay)
  return {
    fill,
    lift: liftFill(fill, LIFT_TARGET),
    liftSoft: liftFill(fill, LIFT_REACH),
    role,
  }
}

/** Resolved fill for a painted province (shared by MapLibre expressions and SVG). */
export function resolvedFill(
  paint: { fill: string; lift: string; liftSoft: string },
  role: TargetPaintRole,
): string {
  if (role === "move" || role === "attack") return paint.lift
  if (role === "reach") return paint.liftSoft
  if (role === "dim") return "#0c0a12"
  return paint.fill
}

function rampHex(value: number, low: string, mid: string, high: string, pivot: number): string {
  if (value <= pivot) return mixHex(low, mid, pivot === 0 ? 1 : value / pivot)
  return mixHex(mid, high, (value - pivot) / (100 - pivot))
}

function mixHex(from: string, to: string, t: number): string {
  const amount = Math.min(1, Math.max(0, t))
  const a = parseColor(from)
  const b = parseColor(to)
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * amount)
  return rgbHex(channel(0), channel(1), channel(2))
}

function parseColor(color: string): [number, number, number] {
  const trimmed = color.trim()
  if (trimmed.startsWith("#") || /^[0-9a-f]{6}$/i.test(trimmed)) {
    const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`
    return [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ]
  }
  const rgb = trimmed.match(/rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)/i)
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  }
  return [0, 0, 0]
}

function rgbHex(r: number, g: number, b: number): string {
  const byte = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")
  return `#${byte(r)}${byte(g)}${byte(b)}`
}