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

export const FORTIFY_IP_COST = 2

export const HEAL_POINTS = 8
export const POINTS_PER_MP = 4
export const HEAL_SUPPLY = 50
/** Below this, a province yields no manpower or industry. */
export const INCOME_SUPPLY_FLOOR = 30
/** Applied to summed Central Powers industry, then rounded once with manpower. */
export const CENTRAL_INDUSTRY_MULTIPLIER = 1.3
const MORALE_GAIN = 5
const MORALE_TARGET = 80

export const INCOME_FORMULA =
  "Base yield × (1 − unrest/100), halved if occupied, and 0 if supply is under 30."

export const REFIT_FORMULA =
  "Refit costs 1 manpower per 4 strength, up to 8 points, for a formation in supply of at least 50 that is not attacking."

/** Scales Russian income only. Easy is short of shells and men; Hard is not. */
export const DIFFICULTY_INCOME: Record<Difficulty, number> = {
  easy: 0.62,
  normal: 0.82,
  hard: 1.18,
}

/** Russia has the men. The Central Powers have the guns. Both are milder than a raw headcount. */
export const RUSSIAN_MP_SCALE = 1.12
export const RUSSIAN_IP_SCALE = 0.55

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
  const detail = provinceIncomeDetail(province)
  return { mp: detail.mp, ip: detail.ip }
}

export type ProvinceIncomeDetail = {
  id: string
  name: string
  baseMp: number
  baseIp: number
  supply: number
  unrest: number
  occupied: boolean
  starved: boolean
  /** 0 when supply is under 30; otherwise (1 − unrest/100) × (occupied ? 0.5 : 1). */
  factor: number
  mp: number
  ip: number
}

/** Local yield before national multipliers. Same arithmetic as `provinceIncome`. */
export function provinceIncomeDetail(province: Province): ProvinceIncomeDetail {
  const base = YIELD_BY_ID[province.id] ?? { mp: 0, ip: 0 }
  const occupied = province.controller !== province.owner
  const starved = !YIELD_BY_ID[province.id] || province.supply < INCOME_SUPPLY_FLOOR
  const factor = starved ? 0 : (1 - province.unrest / 100) * (occupied ? 0.5 : 1)
  return {
    id: province.id,
    name: province.name,
    baseMp: base.mp,
    baseIp: base.ip,
    supply: province.supply,
    unrest: province.unrest,
    occupied,
    starved,
    factor,
    mp: base.mp * factor,
    ip: base.ip * factor,
  }
}

/** Effective manpower + industry on one province. National multipliers are not included. */
export function provinceResourceYield(province: Province): number {
  const income = provinceIncomeDetail(province)
  return income.mp + income.ip
}

/** Richest base yield on the map (manpower + industry), before supply and unrest. */
export function maxBaseResourceYield(): number {
  let max = 0
  for (const yieldOf of Object.values(YIELD_BY_ID)) {
    max = Math.max(max, yieldOf.mp + yieldOf.ip)
  }
  return max
}

/** 0–100 shade for the Resources lens. 100 is `maxBaseResourceYield()`. */
export function resourceYieldShade(yieldSum: number, max = maxBaseResourceYield()): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (yieldSum / max) * 100))
}

export type FactionIncomeExplanation = {
  faction: Faction
  /** Held provinces, in map order (same addition order as `projectIncome`). */
  provinces: ProvinceIncomeDetail[]
  rawMp: number
  rawIp: number
  manpowerMultiplier: number
  industryMultiplier: number
  difficultyMultiplier: number
  income: Purse
}

/** How `projectIncome` reaches its rounded purse for one faction. */
export function explainIncome(state: GameState, faction: Faction): FactionIncomeExplanation {
  const provinces: ProvinceIncomeDetail[] = []
  let rawMp = 0
  let rawIp = 0
  for (const province of state.provinces) {
    if (province.controller !== faction) continue
    const detail = provinceIncomeDetail(province)
    provinces.push(detail)
    rawMp += detail.mp
    rawIp += detail.ip
  }
  const central = faction === "central"
  return {
    faction,
    provinces,
    rawMp,
    rawIp,
    manpowerMultiplier: central ? 1 : RUSSIAN_MP_SCALE,
    industryMultiplier: central ? CENTRAL_INDUSTRY_MULTIPLIER : RUSSIAN_IP_SCALE,
    difficultyMultiplier: central ? 1 : DIFFICULTY_INCOME[state.difficulty ?? "normal"],
    income: projectIncome(state, faction),
  }
}

export function formatEconomyNumber(value: number): string {
  if (!Number.isFinite(value)) return "0"
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

export function describeProvinceIncome(detail: ProvinceIncomeDetail): string {
  const base = `base ${formatEconomyNumber(detail.baseMp)} manpower and ${formatEconomyNumber(detail.baseIp)} industry`
  if (detail.starved) {
    return `${detail.name}: supply ${formatEconomyNumber(detail.supply)} is under ${INCOME_SUPPLY_FLOOR}, so the yield is 0 (${base}).`
  }
  const half = detail.occupied ? ", halved because it is occupied" : ""
  return `${detail.name}: ${base} × (1 − ${formatEconomyNumber(detail.unrest)}/100)${half} = ${formatEconomyNumber(detail.mp)} manpower and ${formatEconomyNumber(detail.ip)} industry.`
}

export function describeIncomeTotals(explanation: FactionIncomeExplanation): string {
  const raw = `Held provinces sum to ${formatEconomyNumber(explanation.rawMp)} manpower and ${formatEconomyNumber(explanation.rawIp)} industry.`
  if (explanation.faction === "central") {
    return `${raw} Industry × ${CENTRAL_INDUSTRY_MULTIPLIER} rounds to ${explanation.income.ip}. Manpower rounds to ${explanation.income.mp}.`
  }
  return `${raw} Russian manpower × ${explanation.manpowerMultiplier} and industry × ${explanation.industryMultiplier}, then × ${explanation.difficultyMultiplier} for difficulty, round to ${explanation.income.mp} manpower and ${explanation.income.ip} industry.`
}

export type RefitLine = {
  unitId: string
  name: string
  provinceId: string
  provinceName: string
  need: number
  mp: number
}

export type RefitBill = {
  mp: number
  lines: RefitLine[]
}

/** Formations the treasury will refit, at 1 manpower per `POINTS_PER_MP` strength. */
export function explainRefit(
  state: GameState,
  faction: Faction,
  skip: ReadonlySet<string>,
): RefitBill {
  const lines: RefitLine[] = []
  const provinces = [...state.provinces].sort((a, b) => a.id.localeCompare(b.id))
  for (const province of provinces) {
    if (province.controller !== faction || province.supply < HEAL_SUPPLY) continue
    const units = fightingUnits(province.units).sort((a, b) => a.id.localeCompare(b.id))
    for (const unit of units) {
      if (unit.faction !== faction || skip.has(unit.id)) continue
      const max = unit.maxStrength ?? unit.strength
      const need = Math.max(0, Math.min(HEAL_POINTS, max - unit.strength))
      if (need <= 0) continue
      lines.push({
        unitId: unit.id,
        name: unit.name,
        provinceId: province.id,
        provinceName: province.name,
        need,
        mp: Math.ceil(need / POINTS_PER_MP),
      })
    }
  }
  return { mp: lines.reduce((sum, line) => sum + line.mp, 0), lines }
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
  if (faction === "central") ip *= CENTRAL_INDUSTRY_MULTIPLIER
  else {
    mp *= RUSSIAN_MP_SCALE
    ip *= RUSSIAN_IP_SCALE
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
  return explainRefit(state, faction, skip).mp
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
