import { blankCampaign } from "@/lib/data/campaign"
import { CATALOG, blankProvince } from "@/lib/data/catalog"
import { computeSupply } from "@/lib/engine/supply"
import { scenarioDate } from "@/lib/format"
import type { Difficulty, Echelon, Faction, GameState, ScenarioId, Unit, UnitKind } from "@/lib/types"

/** Opening day of Gorlice–Tarnów, 2 May 1915. Combat dice derive from this seed. */
const START_SEED = 19150502

type Placement = {
  id: string
  name: string
  faction: Faction
  kind: UnitKind
  strength: number
  morale: number
  province: string
  echelon?: Echelon
  parentId?: string
}

/**
 * 2 May 1915, at the scale of these provinces.
 *
 * Kraków is the Dunajec concentration: Gorlice, Tarnów, Rzeszów and, inside the
 * same state, Przemyśl. The fortress was Russian until 3 June, but the polygon
 * cannot be split, so Kraków stays the Central Powers base. Mackensen's 11th
 * Army (the army counter stands for X Corps, XLI Reserve Corps, the Combined
 * Corps and Arz's Austro-Hungarian VI Corps) is there with the Guard and the
 * heavy guns. Archduke Joseph Ferdinand's 4th Army is the northern wing.
 *
 * Lemberg is Russian, as it had been since 3 September 1914. The 3rd Army
 * stands in the city because the map has no province between the Dunajec and
 * Lemberg. The old Lemberg garrison is Borojević's 3rd Army, in the Carpathians.
 * Katowice stays German. Stanislav and Bukovina stay Austro-Hungarian.
 */
const PLACEMENTS: Placement[] = [
  { id: "g-kra-11", name: "German 11th Army (Mackensen)", faction: "central", kind: "infantry", strength: 64, morale: 80, province: "krakow", echelon: "army" },
  { id: "g-kra-x", name: "Austro-Hungarian 4th Army (Joseph Ferdinand)", faction: "central", kind: "infantry", strength: 58, morale: 78, province: "krakow" },
  { id: "g-kra-grd", name: "Guard Corps (von Plettenberg)", faction: "central", kind: "infantry", strength: 44, morale: 84, province: "krakow" },
  { id: "g-kra-art", name: "Mackensen's Heavy Artillery", faction: "central", kind: "artillery", strength: 34, morale: 82, province: "krakow" },
  { id: "g-lwow-inf", name: "Austro-Hungarian 3rd Army (Borojević)", faction: "central", kind: "infantry", strength: 36, morale: 70, province: "podkarpatska_rus" },
  { id: "g-lwow-art", name: "Carpathian Artillery", faction: "central", kind: "artillery", strength: 18, morale: 72, province: "podkarpatska_rus" },
  { id: "g-kon-inf", name: "8th Army (von Below)", faction: "central", kind: "infantry", strength: 40, morale: 72, province: "konigsberg" },
  { id: "g-erm-inf", name: "XX Corps", faction: "central", kind: "infantry", strength: 28, morale: 70, province: "ermland_masuren" },
  { id: "g-pos-inf", name: "9th Army (Prince Leopold)", faction: "central", kind: "infantry", strength: 36, morale: 70, province: "poznan" },
  { id: "g-obs-inf", name: "Landwehr Corps Woyrsch", faction: "central", kind: "infantry", strength: 32, morale: 66, province: "oberschlesien" },
  { id: "g-kat-inf", name: "Silesian Landwehr", faction: "central", kind: "infantry", strength: 30, morale: 72, province: "katowice" },
  { id: "g-dan-inf", name: "Danzig Garrison", faction: "central", kind: "infantry", strength: 22, morale: 64, province: "danzig" },
  { id: "g-gdy-inf", name: "Thorn Fortress Brigade", faction: "central", kind: "infantry", strength: 26, morale: 66, province: "gdynia" },
  { id: "g-sta-cav", name: "Cavalry Corps Hauer", faction: "central", kind: "cavalry", strength: 24, morale: 74, province: "stanislawow" },
  { id: "g-buc-inf", name: "Group Pflanzer-Baltin", faction: "central", kind: "infantry", strength: 20, morale: 66, province: "bucovina" },
  { id: "g-kie-inf", name: "X Corps", faction: "russia", kind: "infantry", strength: 36, morale: 64, province: "kielce" },
  { id: "g-lub-inf", name: "3rd Army (Radko Dimitriev)", faction: "russia", kind: "infantry", strength: 62, morale: 64, province: "lwow" },
  { id: "g-lub-art", name: "3rd Army Artillery", faction: "russia", kind: "artillery", strength: 20, morale: 60, province: "lwow" },
  { id: "g-pol-inf", name: "XXI Corps", faction: "russia", kind: "infantry", strength: 44, morale: 62, province: "lwow" },
  { id: "g-min-inf", name: "XXIV Corps", faction: "russia", kind: "infantry", strength: 58, morale: 66, province: "lublin" },
  { id: "g-wol-inf", name: "III Caucasian Corps", faction: "russia", kind: "infantry", strength: 96, morale: 70, province: "wolyn" },
  { id: "g-war-inf", name: "Grenadier Corps", faction: "russia", kind: "infantry", strength: 36, morale: 70, province: "warszawa" },
  { id: "g-war-art", name: "Warsaw Fortress Artillery", faction: "russia", kind: "artillery", strength: 18, morale: 72, province: "warszawa" },
  { id: "g-lod-inf", name: "2nd Army", faction: "russia", kind: "infantry", strength: 34, morale: 68, province: "lodz" },
  { id: "g-plo-inf", name: "1st Army", faction: "russia", kind: "infantry", strength: 30, morale: 66, province: "plock" },
  { id: "g-bia-inf", name: "10th Army", faction: "russia", kind: "infantry", strength: 28, morale: 64, province: "bialystok" },
  { id: "g-sud-inf", name: "Kovno Garrison", faction: "russia", kind: "infantry", strength: 26, morale: 64, province: "suduva" },
  { id: "g-wil-cav", name: "1st Cavalry Corps", faction: "russia", kind: "cavalry", strength: 20, morale: 74, province: "wilno" },
  { id: "g-pro-inf", name: "8th Army (Brusilov)", faction: "russia", kind: "infantry", strength: 56, morale: 70, province: "proskuriv" },
]

export const BRIEFING = [
  "2 May 1915. Generaloberst August von Mackensen's German 11th Army and Archduke Joseph Ferdinand's Austro-Hungarian 4th Army are concentrated in the Kraków province, on the Dunajec. Gorlice and Tarnów are in that state. Przemyśl is too: the fortress was Russian from 22 March until 3 June, but the map cannot split it from Kraków, so the province stays your base. The Guard Corps is in the line, and the heavy artillery Falkenhayn assembled for the blow is with them. The 11th Army counter also stands for X Corps, XLI Reserve Corps, the Combined Corps and Arz's VI Corps.",
  "Radko Dimitriev's Russian 3rd Army holds Lemberg, Russian since 3 September 1914. XXI Corps and the army's guns are in the city with him. X Corps holds Kielce. XXIV Corps stands at Lublin, and the III Caucasian Corps is in reserve at Rovno. Ivanov has refused a withdrawal to the San. The yards are short of shells. Brusilov's 8th Army is on Podolia.",
  "Lemberg is Austrian soil. Its depot does not feed the Russians, and it is yours again when the city falls. Katowice is German. Bukovina is Austro-Hungarian, under Pflanzer-Baltin, as it had been since 17 February. Stanislav is left Austro-Hungarian on this map as well; historically the Russians still held it, until 8 June. Borojević's 3rd Army is in Carpathian Ruthenia, off the Dunajec. The 8th and 9th Armies with Woyrsch hold East Prussia and the Polish salient. They are not the offensive.",
  "You have six fortnights, through 11 July. Take Lemberg by the fortnight of 13 June. The pursuit is Lublin, and Rovno by the fortnight of 27 June if the breakthrough stays on time. Rovno did not fall in 1915. Do not lose Kraków. Depots and cities raise troops; they arrive when the fortnight closes.",
].join(" ")

/**
 * Normal uses the placements as written. Easy trims Russian corps; Hard fills them out.
 * The map and who owns each province at the start do not change.
 */
function toUnit(placement: Placement, difficulty: Difficulty): Unit {
  let strength = placement.strength
  let morale = placement.morale
  if (placement.faction === "russia" && difficulty !== "normal") {
    const factor = difficulty === "easy" ? 0.84 : 1.28
    const moraleShift = difficulty === "easy" ? -4 : 3
    // The turn schema caps a formation at 100. Hard's 1.28 fill would put the
    // III Caucasian Corps at 123, and the browser would reject the whole state.
    strength = Math.min(100, Math.max(10, Math.round(placement.strength * factor)))
    morale = Math.min(94, Math.max(42, placement.morale + moraleShift))
  }
  return {
    id: placement.id,
    name: placement.name,
    faction: placement.faction,
    strength,
    maxStrength: strength,
    morale,
    kind: placement.kind,
    echelon: placement.echelon ?? "army",
    ...(placement.parentId ? { parentId: placement.parentId } : {}),
  }
}

export function createInitialState(difficulty: Difficulty = "normal"): GameState {
  return assemble(difficulty)
}

export function createScenario(id: ScenarioId = "gorlice", difficulty: Difficulty = "normal"): GameState {
  const state = createInitialState(difficulty)
  state.scenario = id
  return state
}

function assemble(difficulty: Difficulty): GameState {
  const provinces = CATALOG.map((entry) => {
    const province = blankProvince(entry)
    province.units = PLACEMENTS.filter((unit) => unit.province === entry.id).map((unit) => toUnit(unit, difficulty))
    return province
  })
  const state: GameState = {
    version: 1,
    turn: 0,
    date: scenarioDate("gorlice", 0),
    seed: START_SEED,
    provinces,
    ...blankCampaign(difficulty),
    scenario: "gorlice",
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
  const rebound = createInitialState(state.difficulty ?? "normal")
  rebound.turn = state.turn
  rebound.date = scenarioDate("gorlice", state.turn)
  rebound.seed = state.seed || START_SEED
  rebound.treasury = {
    central: { ...(state.treasury?.central ?? rebound.treasury.central) },
    russia: { ...(state.treasury?.russia ?? rebound.treasury.russia) },
  }
  rebound.queue = (state.queue ?? []).map((job) => ({ ...job }))
  rebound.result = state.result ?? null
  rebound.capturedOn = { ...(state.capturedOn ?? {}) }
  rebound.homeLost = state.homeLost ?? false
  rebound.cpStrengthLost = state.cpStrengthLost ?? 0
  for (const province of rebound.provinces) {
    const current = live.get(province.id)
    if (!current) continue
    province.controller = current.controller
    province.unrest = current.unrest
    province.fort = current.fort
    province.supplyModifier = current.supplyModifier ?? 0
    province.units = current.units.map((unit) => ({
      ...unit,
      echelon: unit.echelon ?? "army",
      maxStrength: unit.maxStrength ?? unit.strength,
    }))
    province.supply = current.supply
  }
  applySupply(rebound)
  return rebound
}
