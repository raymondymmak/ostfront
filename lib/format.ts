const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

/** Fortnight starting 4 June 1915. Turn 0 is the opening date. */
export function formatDate(turn: number): string {
  const ms = Date.UTC(1915, 5, 4) + turn * 14 * 24 * 60 * 60 * 1000
  const date = new Date(ms)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

export function signed(n: number): string {
  const rounded = Math.round(n)
  return rounded > 0 ? `+${rounded}` : `${rounded}`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export const FACTION_LABEL: Record<"central" | "russia", string> = {
  central: "Central Powers",
  russia: "Russia",
}

export const TERRAIN_LABEL: Record<
  "plains" | "forest" | "marsh" | "mountain" | "urban",
  string
> = {
  plains: "Plains",
  forest: "Forest",
  marsh: "Marsh",
  mountain: "Mountain",
  urban: "Urban",
}

export const KIND_LABEL: Record<"infantry" | "cavalry" | "artillery", string> = {
  infantry: "Infantry",
  cavalry: "Cavalry",
  artillery: "Artillery",
}
