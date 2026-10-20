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
  /** Manpower yielded each fortnight before unrest, occupation, and national modifiers. */
  mp: number
  /** Industry yielded each fortnight before unrest, occupation, and national modifiers. */
  ip: number
  depot?: Faction
  unrest?: number
  aliases?: string[]
}

/**
 * June 1915 Eastern Front, one Hearts of Iron IV state per province.
 * `lon`/`lat` are the label point in the flat pixel projection, not geographic degrees.
 * `owner` is the 1914 sovereign that holds most of the state. `controller` is the June front.
 * Katowice, Lemberg, Stanislav and Bukovina are forced in OWNER_OVERRIDES
 * (scripts/build-hoi4-theater.py): German or Austrian in 1914, Central Powers in June.
 */
export const PROVINCE_DEFS: ProvinceDef[] = [
  { id: "konigsberg", name: "Königsberg", mp: 2, ip: 2, lon: 0.073, lat: 0.638, terrain: "urban", owner: "central", controller: "central", fort: 2, depot: "central", aliases: ["koenigsberg", "tilsit", "insterburg"] },
  { id: "ermland_masuren", name: "Ermland-Masuren", mp: 1, ip: 0, lon: -0.048, lat: 0.392, terrain: "forest", owner: "central", controller: "central", fort: 0, aliases: ["ermland", "masuria", "allenstein"] },
  { id: "danzig", name: "Danzig", mp: 1, ip: 2, lon: -0.433, lat: 0.506, terrain: "urban", owner: "central", controller: "central", fort: 1, aliases: ["gdansk"] },
  { id: "hinterpommern", name: "Hinterpommern", mp: 1, ip: 1, lon: -1.008, lat: 0.399, terrain: "plains", owner: "central", controller: "central", fort: 0, aliases: ["farther pomerania"] },
  { id: "ostmark", name: "Ostmark", mp: 1, ip: 1, lon: -1.132, lat: 0.018, terrain: "plains", owner: "central", controller: "central", fort: 0 },
  { id: "niederschlesien", name: "Lower Silesia", mp: 2, ip: 2, lon: -0.887, lat: -0.307, terrain: "plains", owner: "central", controller: "central", fort: 0, aliases: ["niederschlesien", "breslau"] },
  { id: "oberschlesien", name: "Upper Silesia", mp: 2, ip: 4, lon: -0.601, lat: -0.441, terrain: "plains", owner: "central", controller: "central", fort: 0, aliases: ["oberschlesien"] },
  { id: "gdynia", name: "Pomorze", mp: 1, ip: 1, lon: -0.554, lat: 0.356, terrain: "plains", owner: "central", controller: "central", fort: 1, aliases: ["gdynia", "west prussia", "graudenz", "thorn", "torun", "bromberg"] },
  { id: "poznan", name: "Posen", mp: 2, ip: 2, lon: -0.82, lat: -0.026, terrain: "urban", owner: "central", controller: "central", fort: 1, aliases: ["poznan", "posen", "kalisz"] },
  { id: "klaipeda", name: "Memel", mp: 1, ip: 0, lon: 0.082, lat: 0.81, terrain: "plains", owner: "russia", controller: "russia", fort: 0, aliases: ["klaipeda", "memel"] },
  { id: "plock", name: "Płock", mp: 1, ip: 1, lon: -0.148, lat: 0.109, terrain: "plains", owner: "russia", controller: "russia", fort: 0, aliases: ["plock", "mlawa", "mława"] },
  { id: "warszawa", name: "Warsaw", mp: 3, ip: 3, lon: -0.044, lat: -0.104, terrain: "urban", owner: "russia", controller: "russia", fort: 3, depot: "russia", aliases: ["warsaw", "warszawa", "radom", "siedlce"] },
  { id: "lodz", name: "Łódź", mp: 2, ip: 3, lon: -0.409, lat: -0.157, terrain: "urban", owner: "russia", controller: "russia", fort: 0, aliases: ["lodz"] },
  { id: "kielce", name: "Kielce", mp: 1, ip: 1, lon: -0.113, lat: -0.385, terrain: "plains", owner: "russia", controller: "russia", fort: 0 },
  { id: "krakow", name: "Kraków", mp: 2, ip: 2, lon: -0.022, lat: -0.632, terrain: "urban", owner: "central", controller: "central", fort: 2, depot: "central", aliases: ["cracow", "krakau", "krakow", "tarnow", "tarnów", "rzeszow", "rzeszów", "przemysl", "przemyśl"] },
  { id: "katowice", name: "Katowice", mp: 1, ip: 3, lon: -0.375, lat: -0.48, terrain: "plains", owner: "central", controller: "central", fort: 0 },
  { id: "lublin", name: "Lublin", mp: 2, ip: 1, lon: 0.344, lat: -0.282, terrain: "plains", owner: "russia", controller: "russia", fort: 2, aliases: ["chelm", "chełm", "brest", "brest litovsk"] },
  { id: "bialystok", name: "Białystok", mp: 1, ip: 0, lon: 0.35, lat: 0.237, terrain: "forest", owner: "russia", controller: "russia", fort: 1, aliases: ["bialystok", "grodno"] },
  { id: "lwow", name: "Lemberg", mp: 2, ip: 2, lon: 0.809, lat: -0.728, terrain: "urban", owner: "central", controller: "central", fort: 1, depot: "central", aliases: ["lviv", "lwow", "lwów", "lemberg", "tarnopol"] },
  { id: "stanislawow", name: "Stanislav", mp: 1, ip: 0, lon: 0.714, lat: -0.955, terrain: "mountain", owner: "central", controller: "central", fort: 0, aliases: ["stanislawow", "stanisławów", "stanislau", "stanislav"] },
  { id: "wolyn", name: "Volhynia", mp: 2, ip: 1, lon: 0.896, lat: -0.441, terrain: "plains", owner: "russia", controller: "russia", fort: 0, depot: "russia", aliases: ["wolyn", "volhynia", "rovno", "rivne", "lutsk", "kovel"] },
  { id: "polesie", name: "Polesie", mp: 1, ip: 0, lon: 0.869, lat: -0.061, terrain: "marsh", owner: "russia", controller: "russia", fort: 0, aliases: ["pinsk"] },
  { id: "nowogrodek", name: "Nowogródek", mp: 1, ip: 0, lon: 0.834, lat: 0.28, terrain: "forest", owner: "russia", controller: "russia", fort: 0, aliases: ["nowogrodek", "navahrudak"] },
  { id: "wilno", name: "Vilna", mp: 2, ip: 1, lon: 0.844, lat: 0.623, terrain: "urban", owner: "russia", controller: "russia", fort: 1, aliases: ["wilno", "vilnius", "vilna"] },
  { id: "wilejka", name: "Wilejka", mp: 1, ip: 0, lon: 1.147, lat: 0.66, terrain: "forest", owner: "russia", controller: "russia", fort: 0, aliases: ["vileyka"] },
  { id: "zemaitija", name: "Samogitia", mp: 1, ip: 0, lon: 0.225, lat: 0.892, terrain: "plains", owner: "russia", controller: "russia", fort: 0, aliases: ["zemaitija", "samogitia"] },
  { id: "kaunas", name: "Kaunas", mp: 2, ip: 1, lon: 0.646, lat: 0.677, terrain: "urban", owner: "russia", controller: "russia", fort: 0, aliases: ["kaunas"] },
  { id: "suduva", name: "Suwałki", mp: 1, ip: 0, lon: 0.456, lat: 0.561, terrain: "plains", owner: "russia", controller: "russia", fort: 1, aliases: ["suduva", "suwalki", "suwałki", "kovno"] },
  { id: "aukstaitija", name: "Aukštaitija", mp: 1, ip: 0, lon: 0.674, lat: 0.901, terrain: "plains", owner: "russia", controller: "russia", fort: 0, aliases: ["aukstaitija", "shavli", "siauliai"] },
  { id: "kurzeme", name: "Courland", mp: 1, ip: 0, lon: 0.203, lat: 1.232, terrain: "forest", owner: "russia", controller: "russia", fort: 0, aliases: ["kurzeme", "courland"] },
  { id: "zemgale", name: "Zemgale", mp: 1, ip: 0, lon: 0.642, lat: 1.108, terrain: "forest", owner: "russia", controller: "russia", fort: 0, aliases: ["semigallia"] },
  { id: "minsk", name: "Minsk", mp: 2, ip: 1, lon: 1.511, lat: 0.421, terrain: "urban", owner: "russia", controller: "russia", fort: 1 },
  { id: "mozyr", name: "Mozyr", mp: 1, ip: 0, lon: 1.588, lat: -0.125, terrain: "marsh", owner: "russia", controller: "russia", fort: 0, aliases: ["mazyr"] },
  { id: "proskuriv", name: "Podolia", mp: 2, ip: 1, lon: 1.17, lat: -0.748, terrain: "plains", owner: "russia", controller: "russia", fort: 0, aliases: ["proskuriv", "kamenets", "podolia"] },
  { id: "bucovina", name: "Bukovina", mp: 1, ip: 0, lon: 0.909, lat: -1.081, terrain: "mountain", owner: "central", controller: "central", fort: 0, aliases: ["bucovina", "bukovina", "czernowitz"] },
  { id: "eastern_slovakia", name: "Eastern Slovakia", mp: 1, ip: 0, lon: -0.024, lat: -0.876, terrain: "mountain", owner: "central", controller: "central", fort: 0, aliases: ["presov"] },
  { id: "tesinsko", name: "Teschen", mp: 1, ip: 1, lon: -0.489, lat: -0.702, terrain: "mountain", owner: "central", controller: "central", fort: 0, aliases: ["tesinsko", "cieszyn", "teschen"] },
  { id: "podkarpatska_rus", name: "Carpathian Ruthenia", mp: 1, ip: 0, lon: 0.407, lat: -0.995, terrain: "mountain", owner: "central", controller: "central", fort: 0, aliases: ["podkarpatska", "ruthenia", "uzhhorod"] },
  { id: "czeske_slezsko", name: "Austrian Silesia", mp: 1, ip: 1, lon: -0.717, lat: -0.577, terrain: "plains", owner: "central", controller: "central", fort: 0, aliases: ["czeske slezsko"] },
]
