import type { Terrain, Unit, UnitKind } from "@/lib/types"

export const TERRAIN_DEFENSE: Record<Terrain, number> = {
  plains: 1,
  forest: 1.25,
  urban: 1.3,
  marsh: 1.4,
  mountain: 1.55,
}

export function attackKindMod(kind: UnitKind, terrain: Terrain): number {
  if (kind === "artillery") return 1.12
  if (kind === "cavalry") {
    if (terrain === "plains") return 1.1
    if (terrain === "forest" || terrain === "marsh" || terrain === "mountain") {
      return 0.85
    }
  }
  return 1
}

export function defendKindMod(kind: UnitKind): number {
  if (kind === "artillery") return 0.9
  if (kind === "cavalry") return 0.95
  return 1
}

export function attackerPower(
  units: Unit[],
  supply: number,
  terrain: Terrain,
): number {
  const supplyFactor = Math.max(0.15, supply / 100)
  const base = units.reduce(
    (sum, unit) =>
      sum +
      unit.strength * (unit.morale / 100) * attackKindMod(unit.kind, terrain),
    0,
  )
  return base * supplyFactor
}

export function defenderPower(
  units: Unit[],
  supply: number,
  terrain: Terrain,
  fort: number,
): number {
  const supplyFactor = Math.max(0.45, supply / 100)
  const base = units.reduce(
    (sum, unit) =>
      sum + unit.strength * (unit.morale / 100) * defendKindMod(unit.kind),
    0,
  )
  return base * TERRAIN_DEFENSE[terrain] * (1 + fort * 0.22) * supplyFactor
}

export type CombatOutcome = {
  roll: number
  attack: number
  defense: number
  ratio: number
  attackerWins: boolean
  attackerLossFraction: number
  defenderLossFraction: number
  attackerMoraleDelta: number
  defenderMoraleDelta: number
}

/**
 * roll is a d6. Variance runs from 0.82 (roll 1) to 1.17 (roll 6).
 * The attacker wins when attack × variance ≥ defense (defense floor 8).
 */
export function resolveCombat(
  attack: number,
  defense: number,
  roll: number,
): CombatOutcome {
  if (defense <= 0) {
    return {
      roll,
      attack,
      defense: 0,
      ratio: attack > 0 ? Infinity : 0,
      attackerWins: attack > 0,
      attackerLossFraction: 0,
      defenderLossFraction: 1,
      attackerMoraleDelta: attack > 0 ? 4 : -8,
      defenderMoraleDelta: -20,
    }
  }

  const variance = 0.82 + (roll - 1) * 0.07
  const ratio = (attack * variance) / Math.max(8, defense)
  const attackerWins = ratio >= 1

  if (attackerWins) {
    const defenderLoss = clampFraction(0.35 + (ratio - 1) * 0.25, 0.35, 0.85)
    const attackerLoss = clampFraction(0.28 / ratio, 0.08, 0.28)
    return {
      roll,
      attack,
      defense,
      ratio,
      attackerWins: true,
      attackerLossFraction: attackerLoss,
      defenderLossFraction: defenderLoss,
      attackerMoraleDelta: 6,
      defenderMoraleDelta: -14,
    }
  }

  return {
    roll,
    attack,
    defense,
    ratio,
    attackerWins: false,
    attackerLossFraction: clampFraction(0.3 + (1 - ratio) * 0.35, 0.25, 0.7),
    defenderLossFraction: clampFraction(0.12 * ratio, 0.05, 0.22),
    attackerMoraleDelta: -12,
    defenderMoraleDelta: 4,
  }
}

function clampFraction(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
