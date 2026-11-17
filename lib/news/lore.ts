import type { Faction } from "@/lib/types"
import type { NewsKind } from "@/lib/news/types"
import { FACTION_LABEL } from "@/lib/format"

const CITY_HEADLINES: Record<string, Partial<Record<NewsKind, string[]>>> = {
  krakow: {
    cityTaken: ["Kraków holds", "The Dunajec base stands"],
    cityLost: ["Kraków falls", "Disaster on the Dunajec"],
    depotLost: ["Depot lost at Kraków", "Kraków supply cut"],
    objectiveTaken: ["Kraków secured", "Home city held"],
  },
  lwow: {
    cityTaken: ["Lemberg taken", "Galicia's capital ours"],
    cityLost: ["Lemberg lost", "Russians retake Lemberg"],
    depotLost: ["Lemberg depot gone", "Supply hub at Lemberg lost"],
    objectiveTaken: ["Lemberg in our hands", "Objective: Lemberg"],
    objectiveMissed: ["Lemberg deadline missed", "No Lemberg by orders"],
  },
  lublin: {
    cityTaken: ["Lublin captured", "Bug pursuit opens"],
    cityLost: ["Lublin recaptured", "Russians hold Lublin"],
    objectiveTaken: ["Lublin secured", "Objective: Lublin"],
    objectiveMissed: ["Lublin still distant", "Pursuit behind schedule"],
  },
  warszawa: {
    cityTaken: ["Warsaw falls", "Vistula shock"],
    cityLost: ["Warsaw recovered", "Russians back in Warsaw"],
  },
  wolyn: {
    cityTaken: ["Rovno taken", "Volhynia advance"],
    objectiveTaken: ["Rovno secured", "Objective: Rovno"],
    objectiveMissed: ["Rovno deadline missed", "No Rovno by orders"],
  },
}

const GENERIC_HEADLINES: Record<NewsKind, string[]> = {
  cityTaken: ["City taken", "Provincial capital falls"],
  cityLost: ["City lost", "Frontline city recaptured"],
  depotLost: ["Depot overrun", "Supply base lost"],
  objectiveTaken: ["Objective reached", "Victory point secured"],
  objectiveMissed: ["Objective missed", "Staff deadline passed"],
  encirclement: ["Garrison encircled", "Ring closed on the defenders"],
}

const GENERIC_LORE: Record<NewsKind, string[]> = {
  encirclement: [
    "No friendly province remains open; remnants cannot slip the ring.",
    "Staff wires describe columns closing from every road at once.",
    "The pocket shrinks before the chronicle clerk finishes the page.",
  ],
  cityTaken: [
    "Garrison remnants fall back along the rail net.",
    "Censors file a brief communiqué; details reach Stavka later.",
    "Town bells go silent as new orders are posted.",
  ],
  cityLost: [
    "Staff wires demand a counter-attack before the fortnight ends.",
    "Refugee columns clog the roads behind the new line.",
    "Reserve corps are earmarked for an immediate riposte.",
  ],
  depotLost: [
    "Rolling stock is sent east before the junction is closed.",
    "Quartermasters count what can still be rationed this fortnight.",
    "Empty warehouses smoke as the last wagons leave.",
  ],
  objectiveTaken: [
    "The general staff counts another star on the campaign map.",
    "A pursuit order is drafted while resistance still crumbles.",
    "Telegrams celebrate; the next deadline is already marked.",
  ],
  objectiveMissed: [
    "Brilliant victory slips away — the calendar will not wait.",
    "Headquarters falls silent; the next fortnight must make up ground.",
    "Stavka notes the delay; Central Powers staff burn the old timetable.",
  ],
}

const CITY_LORE: Record<string, Partial<Record<NewsKind, string[]>>> = {
  krakow: {
    cityLost: ["The Dunajec concentration is undone; Mackensen's railhead is threatened."],
    cityTaken: ["Przemyśl's shadow still lies inside the province — the base endures."],
  },
  lwow: {
    cityTaken: ["Lemberg is Austrian soil again; the III Army's line is broken."],
    objectiveTaken: ["Dimitriev's army staggers west; Galicia turns toward pursuit."],
    objectiveMissed: ["13 June passes without Lemberg — the Brilliant victory is out of reach."],
  },
  lublin: {
    objectiveTaken: ["The Bug pursuit is open; Warsaw lies on the horizon."],
    objectiveMissed: ["Lublin still ahead — the summer offensive loses its rhythm."],
  },
  wolyn: {
    objectiveTaken: ["The III Caucasian Corps yields the Rovno rail knot."],
    objectiveMissed: ["27 June finds Rovno still Russian-held."],
  },
}

function loreSeed(turn: number, provinceId: string, kind: NewsKind): number {
  let h = turn * 1597334677
  for (const ch of provinceId) h = (Math.imul(31, h) + ch.charCodeAt(0)) >>> 0
  return (h + kind.length * 997) >>> 0
}

function pick<T>(items: T[], seed: number): T {
  return items[seed % items.length]!
}

export function headlineFor(kind: NewsKind, provinceId: string, provinceName: string, turn: number): string {
  const city = CITY_HEADLINES[provinceId]?.[kind]
  if (city?.length) return pick(city, loreSeed(turn, provinceId, kind))
  const generic = GENERIC_HEADLINES[kind]
  const base = pick(generic, loreSeed(turn, provinceId, kind))
  if (kind === "cityTaken" || kind === "cityLost" || kind === "depotLost" || kind === "encirclement") {
    return `${provinceName}: ${base}`
  }
  return `${base}: ${provinceName}`
}

export function loreLine(
  kind: NewsKind,
  provinceId: string,
  provinceName: string,
  faction: Faction,
  turn: number,
): string {
  const city = CITY_LORE[provinceId]?.[kind]
  const generic = GENERIC_LORE[kind]
  const line = city?.length ? pick(city, loreSeed(turn, provinceId, kind) + 1) : pick(generic, loreSeed(turn, provinceId, kind))
  const who = FACTION_LABEL[faction]
  if (line.includes(provinceName)) return line
  return `${who}: ${line}`
}