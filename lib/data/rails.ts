/**
 * Rail pairs contracted from the old city network onto states that still share a border.
 * A city-to-city link whose ends fell in the same state, or in states that do not touch, is omitted.
 * Kraków–Stanislav and Stanislav–Bukovina keep the Carpathian flank supplied once Lemberg,
 * the old rail hub, starts under Russian control.
 */
export const RAIL_PAIRS: [string, string][] = [
  ["konigsberg", "ermland_masuren"],
  ["ermland_masuren", "gdynia"],
  ["bialystok", "suduva"],
  ["wolyn", "proskuriv"],
  ["danzig", "gdynia"],
  ["ermland_masuren", "plock"],
  ["ermland_masuren", "bialystok"],
  ["gdynia", "poznan"],
  ["gdynia", "plock"],
  ["plock", "warszawa"],
  ["poznan", "lodz"],
  ["lodz", "warszawa"],
  ["warszawa", "lublin"],
  ["warszawa", "bialystok"],
  ["warszawa", "kielce"],
  ["wilno", "suduva"],
  ["wilno", "nowogrodek"],
  ["bialystok", "nowogrodek"],
  ["lublin", "polesie"],
  ["lublin", "wolyn"],
  ["kielce", "krakow"],
  ["krakow", "lwow"],
  ["krakow", "stanislawow"],
  ["krakow", "katowice"],
  ["katowice", "oberschlesien"],
  ["poznan", "oberschlesien"],
  ["lwow", "bucovina"],
  ["lwow", "stanislawow"],
  ["stanislawow", "bucovina"],
  ["lwow", "proskuriv"],
  ["wolyn", "lwow"],
  ["polesie", "wolyn"],
]

export function railsFromNeighbors(neighbors: Record<string, string[]>): {
  rails: Record<string, string[]>
  missing: [string, string][]
} {
  const rails: Record<string, string[]> = {}
  for (const id of Object.keys(neighbors)) rails[id] = []
  const missing: [string, string][] = []

  for (const [a, b] of RAIL_PAIRS) {
    if (neighbors[a]?.includes(b)) {
      rails[a].push(b)
      rails[b].push(a)
    } else {
      missing.push([a, b])
    }
  }

  for (const id of Object.keys(rails)) {
    rails[id] = [...new Set(rails[id])].sort()
  }
  return { rails, missing }
}
