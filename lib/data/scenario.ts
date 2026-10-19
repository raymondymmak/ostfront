import { CATALOG, blankProvince } from "@/lib/data/catalog"
import { computeSupply } from "@/lib/engine/supply"
import { formatDate } from "@/lib/format"
import type { Faction, GameState, Unit, UnitKind } from "@/lib/types"

const START_SEED = 19150604

type Placement = {
  id: string
  name: string
  faction: Faction
  kind: UnitKind
  strength: number
  morale: number
  province: string
}

const PLACEMENTS: Placement[] = [
  { id: "cp-kon-inf", name: "I Reserve Corps", faction: "central", kind: "infantry", strength: 52, morale: 78, province: "konigsberg" },
  { id: "cp-kon-art", name: "Königsberg Foot Artillery", faction: "central", kind: "artillery", strength: 30, morale: 74, province: "konigsberg" },
  { id: "cp-all-inf", name: "XX Corps", faction: "central", kind: "infantry", strength: 44, morale: 72, province: "ermland_masuren" },
  { id: "cp-ins-cav", name: "1st Cavalry Division", faction: "central", kind: "cavalry", strength: 24, morale: 80, province: "ermland_masuren" },
  { id: "cp-til-inf", name: "Tilsit Landwehr", faction: "central", kind: "infantry", strength: 20, morale: 62, province: "ermland_masuren" },
  { id: "cp-dan-inf", name: "Danzig Garrison", faction: "central", kind: "infantry", strength: 40, morale: 64, province: "danzig" },
  { id: "cp-hin-inf", name: "Pomeranian Landwehr", faction: "central", kind: "infantry", strength: 36, morale: 60, province: "hinterpommern" },
  { id: "cp-gra-inf", name: "Graudenz Brigade", faction: "central", kind: "infantry", strength: 34, morale: 64, province: "gdynia" },
  { id: "cp-tho-inf", name: "Thorn Fortress Brigade", faction: "central", kind: "infantry", strength: 36, morale: 68, province: "gdynia" },
  { id: "cp-tho-art", name: "Thorn Heavy Batteries", faction: "central", kind: "artillery", strength: 18, morale: 70, province: "gdynia" },
  { id: "cp-pos-inf", name: "V Corps", faction: "central", kind: "infantry", strength: 54, morale: 70, province: "poznan" },
  { id: "cp-bro-cav", name: "Posen Cavalry", faction: "central", kind: "cavalry", strength: 28, morale: 62, province: "poznan" },
  { id: "cp-obs-inf", name: "Upper Silesia Landwehr", faction: "central", kind: "infantry", strength: 96, morale: 66, province: "oberschlesien" },
  { id: "cp-kat-inf", name: "Silesian Corps", faction: "central", kind: "infantry", strength: 62, morale: 74, province: "katowice" },
  { id: "cp-kat-art", name: "Katowice Batteries", faction: "central", kind: "artillery", strength: 28, morale: 72, province: "katowice" },
  { id: "cp-kra-inf", name: "Kraków Garrison", faction: "central", kind: "infantry", strength: 36, morale: 68, province: "krakow" },
  { id: "cp-rze-inf", name: "Beskiden Corps", faction: "central", kind: "infantry", strength: 36, morale: 74, province: "krakow" },
  { id: "cp-prz-inf", name: "Przemyśl Assault Group", faction: "central", kind: "infantry", strength: 26, morale: 72, province: "krakow" },
  { id: "cp-tar-inf", name: "Guard Corps", faction: "central", kind: "infantry", strength: 36, morale: 86, province: "lwow" },
  { id: "cp-tar-res", name: "XLI Reserve Corps", faction: "central", kind: "infantry", strength: 28, morale: 76, province: "lwow" },
  { id: "cp-tar-art", name: "Mackensen's Heavy Artillery", faction: "central", kind: "artillery", strength: 26, morale: 82, province: "lwow" },
  { id: "cp-rze-cav", name: "Austrian Cavalry Corps", faction: "central", kind: "cavalry", strength: 60, morale: 76, province: "stanislawow" },
  { id: "cp-buc-inf", name: "Bukovina Brigade", faction: "central", kind: "infantry", strength: 48, morale: 68, province: "bucovina" },
  { id: "ru-war-inf", name: "Grenadier Corps", faction: "russia", kind: "infantry", strength: 34, morale: 76, province: "warszawa" },
  { id: "ru-war-gar", name: "Warsaw Garrison", faction: "russia", kind: "infantry", strength: 22, morale: 66, province: "warszawa" },
  { id: "ru-war-art", name: "Warsaw Fortress Artillery", faction: "russia", kind: "artillery", strength: 19, morale: 74, province: "warszawa" },
  { id: "ru-lod-inf", name: "II Corps", faction: "russia", kind: "infantry", strength: 58, morale: 70, province: "lodz" },
  { id: "ru-sie-inf", name: "IV Corps", faction: "russia", kind: "infantry", strength: 32, morale: 68, province: "lodz" },
  { id: "ru-mla-inf", name: "1st Army", faction: "russia", kind: "infantry", strength: 46, morale: 68, province: "plock" },
  { id: "ru-mla-cav", name: "Narew Cossacks", faction: "russia", kind: "cavalry", strength: 26, morale: 74, province: "plock" },
  { id: "ru-plo-inf", name: "Novogeorgievsk Screen", faction: "russia", kind: "infantry", strength: 18, morale: 64, province: "plock" },
  { id: "ru-kie-inf", name: "Kielce Screen", faction: "russia", kind: "infantry", strength: 52, morale: 60, province: "kielce" },
  { id: "ru-rad-inf", name: "Radom Detachment", faction: "russia", kind: "infantry", strength: 54, morale: 62, province: "kielce" },
  { id: "ru-lub-inf", name: "3rd Army", faction: "russia", kind: "infantry", strength: 42, morale: 68, province: "lublin" },
  { id: "ru-lub-art", name: "3rd Army Artillery", faction: "russia", kind: "artillery", strength: 24, morale: 66, province: "lublin" },
  { id: "ru-bre-inf", name: "Brest-Litovsk Garrison", faction: "russia", kind: "infantry", strength: 22, morale: 70, province: "lublin" },
  { id: "ru-che-inf", name: "Chełm Detachment", faction: "russia", kind: "infantry", strength: 17, morale: 62, province: "lublin" },
  { id: "ru-bia-inf", name: "Narew Group", faction: "russia", kind: "infantry", strength: 42, morale: 66, province: "bialystok" },
  { id: "ru-gro-inf", name: "Grodno Fortress Troops", faction: "russia", kind: "infantry", strength: 33, morale: 66, province: "bialystok" },
  { id: "ru-suw-inf", name: "Suwałki Brigade", faction: "russia", kind: "infantry", strength: 48, morale: 62, province: "suduva" },
  { id: "ru-kov-inf", name: "Kovno Garrison", faction: "russia", kind: "infantry", strength: 49, morale: 64, province: "suduva" },
  { id: "ru-tar-inf", name: "XI Corps", faction: "russia", kind: "infantry", strength: 38, morale: 68, province: "wolyn" },
  { id: "ru-lut-cav", name: "South-West Cavalry", faction: "russia", kind: "cavalry", strength: 24, morale: 72, province: "wolyn" },
  { id: "ru-rov-inf", name: "Rovno Railhead Guard", faction: "russia", kind: "infantry", strength: 20, morale: 64, province: "wolyn" },
  { id: "ru-lem-art", name: "South-West Batteries", faction: "russia", kind: "artillery", strength: 18, morale: 70, province: "wolyn" },
  { id: "ru-lem-inf", name: "8th Army", faction: "russia", kind: "infantry", strength: 64, morale: 74, province: "proskuriv" },
  { id: "ru-sta-inf", name: "Dniester Group", faction: "russia", kind: "infantry", strength: 46, morale: 60, province: "proskuriv" },
  { id: "ru-vil-cav", name: "1st Cavalry Corps", faction: "russia", kind: "cavalry", strength: 35, morale: 76, province: "wilno" },
  { id: "ru-pin-inf", name: "Pinsk Guard", faction: "russia", kind: "infantry", strength: 18, morale: 56, province: "polesie" },
  { id: "ru-kvl-inf", name: "Polesie Brigade", faction: "russia", kind: "infantry", strength: 22, morale: 58, province: "polesie" },
  { id: "ru-min-inf", name: "Minsk Reserve", faction: "russia", kind: "infantry", strength: 30, morale: 62, province: "minsk" },
]

export const BRIEFING = [
  "4 June 1915. Galicia is already Central Powers ground. Przemyśl sits in the Kraków state, and Lemberg is the Austrian forward depot, with Stanislav and Bukovina held behind it.",
  "The Russian line is Lublin, Volhynia and Podolia. Warsaw is Stavka's depot. Your depots are Königsberg, Kraków and Lemberg. Rovno, in Volhynia, is the Russian forward railhead.",
  "A depot feeds only its own side, and only while they hold it. Rails are cheap. Below supply 30 a formation cannot advance. Stavka spends this first fortnight digging; after that, local superiority is enough for them to strike.",
].join(" ")

function toUnit(placement: Placement): Unit {
  return {
    id: placement.id,
    name: placement.name,
    faction: placement.faction,
    strength: placement.strength,
    morale: placement.morale,
    kind: placement.kind,
  }
}

export function createInitialState(): GameState {
  const provinces = CATALOG.map((entry) => {
    const province = blankProvince(entry)
    province.units = PLACEMENTS.filter((unit) => unit.province === entry.id).map(
      toUnit,
    )
    return province
  })
  const state: GameState = {
    version: 1,
    turn: 0,
    date: formatDate(0),
    seed: START_SEED,
    provinces,
  }
  applySupply(state)
  return state
}

export function applySupply(state: GameState): void {
  const supply = computeSupply(
    state.provinces.map((province) => ({
      id: province.id,
      controller: province.controller,
      terrain: province.terrain,
      depot: province.depot ?? null,
      supplyModifier: province.supplyModifier,
    })),
    linksOf(state),
  )
  for (const province of state.provinces) {
    province.supply = supply[province.id] ?? 0
  }
}

export function linksOf(
  state: GameState,
): { a: string; b: string; rail: boolean }[] {
  const links: { a: string; b: string; rail: boolean }[] = []
  const seen = new Set<string>()
  for (const province of state.provinces) {
    for (const neighbor of province.neighbors) {
      const key = [province.id, neighbor].sort().join("|")
      if (seen.has(key)) continue
      seen.add(key)
      const other = state.provinces.find((item) => item.id === neighbor)
      const rail =
        province.rail.includes(neighbor) || !!other?.rail.includes(province.id)
      links.push({ a: province.id, b: neighbor, rail })
    }
  }
  return links
}

export function rebindState(state: GameState): GameState {
  const live = new Map(state.provinces.map((province) => [province.id, province]))
  const rebound = createInitialState()
  rebound.turn = state.turn
  rebound.date = formatDate(state.turn)
  rebound.seed = state.seed || START_SEED
  for (const province of rebound.provinces) {
    const current = live.get(province.id)
    if (!current) continue
    province.controller = current.controller
    province.unrest = current.unrest
    province.fort = current.fort
    province.supplyModifier = current.supplyModifier ?? 0
    province.units = current.units.map((unit) => ({ ...unit }))
    province.supply = current.supply
  }
  applySupply(rebound)
  return rebound
}
