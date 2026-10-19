/** Kaiserreich state files → allowed Ostfront game province ids for HOI4 provinces in that state. */
export const KR_STATE_FILES: { file: string; gameIds: string[] }[] = [
  { file: "188 - Memel.txt", gameIds: ["memel", "shavli", "tilsit"] },
  { file: "5 - East Prussia.txt", gameIds: ["tilsit", "konigsberg", "insterburg", "allenstein", "suwalki"] },
  { file: "776 - West Prussia.txt", gameIds: ["danzig", "graudenz", "thorn", "mlawa", "bromberg", "plock"] },
  { file: "86 - Posen.txt", gameIds: ["posen", "bromberg", "kalisz", "thorn", "graudenz"] },
  {
    file: "10 - Warsaw.txt",
    gameIds: ["warsaw", "plock", "mlawa", "lodz", "radom", "siedlce", "bialystok", "brest"],
  },
  { file: "11 - Kaunas.txt", gameIds: ["kovno", "vilna", "shavli", "suwalki", "grodno"] },
  { file: "1088 - Chelm.txt", gameIds: ["chelm", "lublin", "siedlce", "brest", "kovel"] },
  { file: "88 - Krakow.txt", gameIds: ["krakow", "kielce", "tarnow", "rzeszow", "radom"] },
  { file: "171 - Galicia.txt", gameIds: ["krakow", "tarnow", "rzeszow", "przemysl", "lemberg", "tarnopol", "stanislav"] },
  {
    file: "206 - Minsk.txt",
    gameIds: ["minsk", "vilna", "kovno", "grodno", "bialystok", "brest", "pinsk"],
  },
  {
    file: "792 - Volhynia.txt",
    gameIds: ["lutsk", "rovno", "kovel", "brest", "pinsk", "kamenets", "chelm", "lublin"],
  },
]

const BASE =
  "https://raw.githubusercontent.com/Kaiserreich/Kaiserreich-HOI4/master/history/states/"

export async function loadKrProvinceStates(cacheDir: string): Promise<Map<number, string[]>> {
  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import("node:fs")
  const { join } = await import("node:path")
  mkdirSync(cacheDir, { recursive: true })
  const pidToPools = new Map<number, string[]>()

  for (const entry of KR_STATE_FILES) {
    const safe = entry.file.replace(/ /g, "%20")
    const dest = join(cacheDir, entry.file)
    if (!existsSync(dest)) {
      const res = await fetch(BASE + safe)
      if (!res.ok) throw new Error(`state fetch failed ${entry.file}: ${res.status}`)
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    }
    const text = readFileSync(dest, "utf8")
    const block = text.match(/provinces\s*=\s*\{([^}]+)\}/)
    if (!block) continue
    const ids = block[1].match(/\d+/g)?.map(Number) ?? []
    for (const pid of ids) {
      const prev = pidToPools.get(pid) ?? []
      pidToPools.set(pid, [...new Set([...prev, ...entry.gameIds])])
    }
  }
  return pidToPools
}
