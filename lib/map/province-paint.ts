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

/** Controller fill or supply/unrest heat — same ramps as svg-map provinceFill and war-map heatColor. */
export function baseFill(province: ProvincePaintFields, mode: PaintOverlayMode): string {
  if (mode === "supply") return ramp(province.supply, "#7a2e2a", "#c6a15a", "#2d6a45", 45)
  if (mode === "unrest") return ramp(province.unrest, "#3e5348", "#d4a24c", "#8e2430", 50)
  return MAP_FACTION_FILL[province.controller]
}

/** Lighten a `#rrggbb` color toward white; amount is 0 (unchanged) to 1 (white). */
export function liftFill(hex: string, amount: number): string {
  const t = Math.min(1, Math.max(0, amount))
  const [r, g, b] = parseHex(hex)
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
  return liftFill(MAP_FACTION_FILL[province.controller], 0.28)
}

/** Paint properties written onto each province GeoJSON feature before `provinces.setData`. */
export function provincePaintProperties(
  province: ProvincePaintFields,
  overlay: PaintOverlayMode,
): { fill: string; lift: string; liftSoft: string } {
  const fill = baseFill(province, overlay)
  return {
    fill,
    lift: liftFill(fill, 0.24),
    liftSoft: liftFill(fill, 0.14),
  }
}

function ramp(value: number, low: string, mid: string, high: string, pivot: number): string {
  if (value <= pivot) return mix(low, mid, pivot === 0 ? 1 : value / pivot)
  return mix(mid, high, (value - pivot) / (100 - pivot))
}

function mix(from: string, to: string, t: number): string {
  const amount = Math.min(1, Math.max(0, t))
  const a = parseHex(from)
  const b = parseHex(to)
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * amount)
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`
}

function parseHex(hex: string): [number, number, number] {
  const normalized = hex.startsWith("#") ? hex : `#${hex}`
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ]
}

function rgbHex(r: number, g: number, b: number): string {
  const byte = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")
  return `#${byte(r)}${byte(g)}${byte(b)}`
}