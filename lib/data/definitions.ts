import type { Faction, Terrain } from "@/lib/types"

export type ProvinceDef = {
  id: string
  name: string
  lon: number
  lat: number
  terrain: Terrain
  owner: Faction
  controller: Faction
  fort: number
  depot?: Faction
  unrest?: number
  aliases?: string[]
}

/**
 * Hand-placed centers for a June 1915 Eastern Front.
 * Polygons and neighbors are the Voronoi diagram of these points.
 */
export const PROVINCE_DEFS: ProvinceDef[] = [
  { id: "memel", name: "Memel", lon: 21.15, lat: 55.58, terrain: "plains", owner: "central", controller: "central", fort: 0 },
  { id: "shavli", name: "Shavli", lon: 23.35, lat: 55.85, terrain: "plains", owner: "russia", controller: "russia", fort: 0, aliases: ["siauliai"] },
  { id: "tilsit", name: "Tilsit", lon: 21.85, lat: 55.05, terrain: "plains", owner: "central", controller: "central", fort: 0 },
  { id: "kovno", name: "Kovno", lon: 23.9, lat: 54.9, terrain: "urban", owner: "russia", controller: "russia", fort: 1, aliases: ["kaunas"] },
  { id: "konigsberg", name: "Königsberg", lon: 20.5, lat: 54.71, terrain: "urban", owner: "central", controller: "central", fort: 2, depot: "central", aliases: ["koenigsberg"] },
  { id: "insterburg", name: "Insterburg", lon: 21.85, lat: 54.55, terrain: "forest", owner: "central", controller: "central", fort: 0 },
  { id: "vilna", name: "Vilna", lon: 25.28, lat: 54.68, terrain: "urban", owner: "russia", controller: "russia", fort: 1, aliases: ["vilnius"] },
  { id: "danzig", name: "Danzig", lon: 18.65, lat: 54.35, terrain: "urban", owner: "central", controller: "central", fort: 1, aliases: ["gdansk"] },
  { id: "allenstein", name: "Allenstein", lon: 20.48, lat: 53.78, terrain: "forest", owner: "central", controller: "central", fort: 0 },
  { id: "suwalki", name: "Suwałki", lon: 22.93, lat: 54.1, terrain: "forest", owner: "russia", controller: "russia", fort: 0, aliases: ["suvalki"] },
  { id: "grodno", name: "Grodno", lon: 23.83, lat: 53.68, terrain: "plains", owner: "russia", controller: "russia", fort: 1 },
  { id: "minsk", name: "Minsk", lon: 26.35, lat: 53.55, terrain: "urban", owner: "russia", controller: "russia", fort: 1 },
  { id: "graudenz", name: "Graudenz", lon: 18.75, lat: 53.48, terrain: "plains", owner: "central", controller: "central", fort: 0 },
  { id: "thorn", name: "Thorn", lon: 18.6, lat: 53.01, terrain: "urban", owner: "central", controller: "central", fort: 2, aliases: ["torun"] },
  { id: "mlawa", name: "Mława", lon: 20.38, lat: 53.12, terrain: "plains", owner: "russia", controller: "russia", fort: 0 },
  { id: "bialystok", name: "Białystok", lon: 23.16, lat: 53.13, terrain: "forest", owner: "russia", controller: "russia", fort: 0 },
  { id: "bromberg", name: "Bromberg", lon: 17.97, lat: 53.12, terrain: "plains", owner: "central", controller: "central", fort: 0 },
  { id: "plock", name: "Płock", lon: 19.7, lat: 52.55, terrain: "plains", owner: "russia", controller: "russia", fort: 0 },
  { id: "warsaw", name: "Warsaw", lon: 21.01, lat: 52.23, terrain: "urban", owner: "russia", controller: "russia", fort: 3, depot: "russia", aliases: ["warszawa"] },
  { id: "siedlce", name: "Siedlce", lon: 22.28, lat: 52.17, terrain: "plains", owner: "russia", controller: "russia", fort: 0 },
  { id: "brest", name: "Brest-Litovsk", lon: 23.7, lat: 52.09, terrain: "urban", owner: "russia", controller: "russia", fort: 2, aliases: ["brest litovsk"] },
  { id: "pinsk", name: "Pinsk", lon: 26.08, lat: 52.12, terrain: "marsh", owner: "russia", controller: "russia", fort: 0 },
  { id: "posen", name: "Posen", lon: 16.93, lat: 52.41, terrain: "urban", owner: "central", controller: "central", fort: 1, aliases: ["poznan"] },
  { id: "kalisz", name: "Kalisz", lon: 18.08, lat: 51.76, terrain: "plains", owner: "russia", controller: "russia", fort: 0 },
  { id: "lodz", name: "Łódź", lon: 19.46, lat: 51.77, terrain: "urban", owner: "russia", controller: "russia", fort: 0, aliases: ["lodz"] },
  { id: "radom", name: "Radom", lon: 21.15, lat: 51.4, terrain: "plains", owner: "russia", controller: "russia", fort: 0 },
  { id: "lublin", name: "Lublin", lon: 22.57, lat: 51.25, terrain: "plains", owner: "russia", controller: "russia", fort: 0 },
  { id: "kovel", name: "Kovel", lon: 24.71, lat: 51.21, terrain: "marsh", owner: "russia", controller: "russia", fort: 0 },
  { id: "lutsk", name: "Lutsk", lon: 25.34, lat: 50.75, terrain: "plains", owner: "russia", controller: "russia", fort: 0 },
  { id: "kielce", name: "Kielce", lon: 20.63, lat: 50.87, terrain: "forest", owner: "russia", controller: "russia", fort: 0 },
  { id: "rzeszow", name: "Rzeszów", lon: 22.0, lat: 50.04, terrain: "plains", owner: "central", controller: "central", fort: 0 },
  { id: "chelm", name: "Chełm", lon: 23.5, lat: 51.13, terrain: "plains", owner: "russia", controller: "russia", fort: 0 },
  { id: "rovno", name: "Rovno", lon: 26.25, lat: 50.62, terrain: "forest", owner: "russia", controller: "russia", fort: 0, depot: "russia", aliases: ["rivne"] },
  { id: "krakow", name: "Kraków", lon: 19.94, lat: 50.06, terrain: "urban", owner: "central", controller: "central", fort: 2, depot: "central", aliases: ["cracow", "krakau"] },
  { id: "tarnow", name: "Tarnów", lon: 21.0, lat: 50.01, terrain: "plains", owner: "central", controller: "central", fort: 0 },
  { id: "przemysl", name: "Przemyśl", lon: 22.78, lat: 49.78, terrain: "mountain", owner: "central", controller: "central", fort: 2, unrest: 12 },
  { id: "lemberg", name: "Lemberg", lon: 24.03, lat: 49.84, terrain: "urban", owner: "central", controller: "russia", fort: 1, unrest: 22, aliases: ["lviv", "lwow", "lwów"] },
  { id: "tarnopol", name: "Tarnopol", lon: 25.6, lat: 49.55, terrain: "plains", owner: "central", controller: "russia", fort: 0, unrest: 10 },
  { id: "stanislav", name: "Stanislav", lon: 24.71, lat: 48.92, terrain: "mountain", owner: "central", controller: "russia", fort: 0, unrest: 14, aliases: ["stanislau"] },
  { id: "kamenets", name: "Kamenets-Podolsk", lon: 26.58, lat: 48.68, terrain: "plains", owner: "russia", controller: "russia", fort: 0, aliases: ["kamenets", "podolia"] },
]
