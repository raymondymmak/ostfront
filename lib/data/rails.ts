/** Desired rail pairs. A pair is kept only when the two provinces share a border. */
export const RAIL_PAIRS: [string, string][] = [
  ["konigsberg", "insterburg"],
  ["insterburg", "tilsit"],
  ["tilsit", "memel"],
  ["konigsberg", "danzig"],
  ["konigsberg", "allenstein"],
  ["danzig", "graudenz"],
  ["graudenz", "thorn"],
  ["allenstein", "mlawa"],
  ["thorn", "bromberg"],
  ["bromberg", "posen"],
  ["thorn", "plock"],
  ["mlawa", "warsaw"],
  ["plock", "warsaw"],
  ["posen", "kalisz"],
  ["kalisz", "lodz"],
  ["lodz", "warsaw"],
  ["warsaw", "siedlce"],
  ["siedlce", "brest"],
  ["siedlce", "bialystok"],
  ["bialystok", "grodno"],
  ["grodno", "vilna"],
  ["vilna", "kovno"],
  ["kovno", "shavli"],
  ["vilna", "minsk"],
  ["grodno", "minsk"],
  ["brest", "pinsk"],
  ["warsaw", "radom"],
  ["radom", "kielce"],
  ["kielce", "krakow"],
  ["radom", "lublin"],
  ["lublin", "chelm"],
  ["chelm", "kovel"],
  ["krakow", "tarnow"],
  ["tarnow", "rzeszow"],
  ["tarnow", "przemysl"],
  ["rzeszow", "przemysl"],
  ["przemysl", "lemberg"],
  ["lemberg", "tarnopol"],
  ["lemberg", "stanislav"],
  ["tarnopol", "kamenets"],
  ["stanislav", "kamenets"],
  ["kovel", "lutsk"],
  ["lutsk", "rovno"],
  ["rovno", "tarnopol"],
  ["brest", "kovel"],
  ["pinsk", "rovno"],
  ["suwalki", "grodno"],
  ["suwalki", "insterburg"],
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
