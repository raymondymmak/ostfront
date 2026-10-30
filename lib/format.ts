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

/**
 * Letters that do not decompose under NFD. Polish ł is the one that made
 * Płock, Białystok, Suwałki and Łódź miss their own cards. ą ć ę ń ó ś ź ż
 * already split into a base letter plus a mark; the map below is the rest
 * of the Latin letters that show up in province names and in the Latin
 * transliterations stored as aliases (Lwów/Lviv, Chełm, Mława, Königsberg).
 */
const LETTER_FOLDS: Record<string, string> = {
  ł: "l",
  Ł: "l",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ð: "d",
  Ð: "d",
  þ: "th",
  Þ: "th",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ß: "ss",
  ı: "i",
  ŋ: "n",
  Ŋ: "n",
}

export function normalizeName(value: string): string {
  const folded = value.replace(/[łŁøØđĐðÐþÞæÆœŒßıŋŊ]/g, (letter) => LETTER_FOLDS[letter] ?? letter)
  return folded
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
