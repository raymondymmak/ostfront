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

/** Fortnight of Gorlice–Tarnów. Turn 0 is 2 May 1915. */
export function formatDate(turn: number): string {
  return scenarioDate("gorlice", turn)
}

/** Gorlice–Tarnów opens on 2 May 1915. Each turn is fourteen days. */
export function scenarioDate(_scenario: "gorlice" | undefined, turn: number): string {
  const start = Date.UTC(1915, 4, 2)
  const date = new Date(start + turn * 14 * 24 * 60 * 60 * 1000)
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
