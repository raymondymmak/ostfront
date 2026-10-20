import { PROVINCE_DEFS } from "@/lib/data/definitions"
import { fightingUnits } from "@/lib/engine/echelon"
import type { Difficulty, Faction, GameState, Province, Purse, UnitKind } from "@/lib/types"

export const YIELD_BY_ID: Record<string, { mp: number; ip: number }> = Object.fromEntries(
  PROVINCE_DEFS.map((province) => [province.id, { mp: province.mp, ip: province.ip }]),
)

export const RECRUIT: Record<
  UnitKind,
  { mp: number; ip: number; turns: number; strength: number; morale: number; label: string }
> = {
  infantry: { mp: 6, ip: 3, turns: 1, strength: 40, morale: 72, label: "Infantry corps" },
  cavalry: { mp: 4, ip: 2, turns: 1, strength: 25, morale: 76, label: "Cavalry division" },
  artillery: { mp: 2, ip: 7, turns: 2, strength: 25, morale: 74, label: "Heavy artillery" },
}

export const HEAL_POINTS = 8
export const POINTS_PER_MP = 4
export const HEAL_SUPPLY = 50
const MORALE_GAIN = 5
const MORALE_TARGET = 80

const DIFFICULTY_INCOME: Record<Difficulty, number> = {
  easy: 0.8,
  normal: 1,
  hard: 1.25,
}

export function canAfford(purse: Purse, kind: UnitKind): boolean {
  const cost = RECRUIT[kind]
  return purse.mp >= cost.mp && purse.ip >= cost.ip
}

export function pay(purse: Purse, kind: UnitKind): Purse {
  const cost = RECRUIT[kind]
  return { mp: purse.mp - cost.mp, ip: purse.ip - cost.ip }
}

export function refund(purse: Purse, kind: UnitKind): Purse {
  const cost = RECRUIT[kind]
  return { mp: purse.mp + cost.mp, ip: purse.ip + cost.ip }
}

/** A depot of your own side, or one of your own cities, with supply enough to raise troops. */
export function recruitmentYard(province: Province, faction: Faction): boolean {
  if (province.controller !== faction || province.supply < 60) return false
  if (province.depot === faction) return true
  return province.terrain === "urban" && province.owner === faction
}

export function provinceIncome(province: Province): { mp: number; ip: number } {
  const base = YIELD_BY_ID[province.id]
  if (!base || province.supply < 30) return { mp: 0, ip: 0 }
  const scale = (1 - province.unrest / 100) * (province.controller === province.owner ? 1 : 0.5)
  return { mp: base.mp * scale, ip: base.ip * scale }
}

/** National multipliers, then the Russian difficulty modifier. Rounded once. */
export function projectIncome(state: GameState, faction: Faction): Purse {
  let mp = 0
  let ip = 0
  for (const province of state.provinces) {
    if (province.controller !== faction) continue
    const yieldOf = provinceIncome(province)
    mp += yieldOf.mp
    ip += yieldOf.ip
  }
  if (faction === "central") ip *= 1.3
  else {
    mp *= 1.4
    ip *= 0.6
    const modifier = DIFFICULTY_INCOME[state.difficulty ?? "normal"]
    mp *= modifier
    ip *= modifier
  }
  return { mp: Math.max(0, Math.round(mp)), ip: Math.max(0, Math.round(ip)) }
}

export function addPurse(purse: Purse, income: Purse): Purse {
  return { mp: purse.mp + income.mp, ip: purse.ip + income.ip }
}

export function reinforcementCost(
  state: GameState,
  faction: Faction,
  skip: ReadonlySet<string>,
): number {
  let mp = 0
  for (const province of state.provinces) {
    if (province.controller !== faction || province.supply < HEAL_SUPPLY) continue
    for (const unit of fightingUnits(province.units)) {
      if (unit.faction !== faction || skip.has(unit.id)) continue
      const max = unit.maxStrength ?? unit.strength
      const need = Math.max(0, Math.min(HEAL_POINTS, max - unit.strength))
      if (need > 0) mp += Math.ceil(need / POINTS_PER_MP)
    }
  }
  return mp
}

/**
 * What the faction can spend on recruits this fortnight: treasury plus this
 * turn's income, after automatic refit of formations that are not attacking.
 */
export function spendable(
  state: GameState,
  faction: Faction,
  skipAttacks: ReadonlySet<string>,
): Purse {
  const income = projectIncome(state, faction)
  const purse = addPurse(state.treasury[faction], income)
  return {
    mp: Math.max(0, purse.mp - reinforcementCost(state, faction, skipAttacks)),
    ip: purse.ip,
  }
}

export function reinforceFaction(
  state: GameState,
  faction: Faction,
  attacked: ReadonlySet<string>,
): string[] {
  const notes: string[] = []
  const purse = state.treasury[faction]
  const healed: string[] = []
  const provinces = [...state.provinces].sort((a, b) => a.id.localeCompare(b.id))
  for (const province of provinces) {
    if (province.controller !== faction || province.supply < HEAL_SUPPLY) continue
    const units = fightingUnits(province.units).sort((a, b) => a.id.localeCompare(b.id))
    for (const unit of units) {
      if (unit.faction !== faction) continue
      const max = unit.maxStrength ?? unit.strength
      if (!attacked.has(unit.id)) {
        const need = Math.max(0, Math.min(HEAL_POINTS, max - unit.strength))
        let gain = 0
        while (gain < need && purse.mp > 0) {
          gain += Math.min(POINTS_PER_MP, need - gain)
          purse.mp -= 1
        }
        if (gain > 0) {
          unit.strength += gain
          healed.push(unit.name)
        }
      }
      if (unit.morale < MORALE_TARGET) {
        unit.morale = Math.min(MORALE_TARGET, unit.morale + MORALE_GAIN)
      }
    }
  }
  if (healed.length) {
    notes.push(
      `${healed.length} ${faction === "central" ? "Central Powers" : "Russian"} formation${healed.length === 1 ? "" : "s"} refit in supply.`,
    )
  }
  return notes
}
