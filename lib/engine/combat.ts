import type { Terrain, Unit, UnitKind } from "@/lib/types"

export const TERRAIN_DEFENSE: Record<Terrain, number> = {
  plains: 1,
  forest: 1.2,
  urban: 1.18,
  marsh: 1.35,
  mountain: 1.48,
}

/** Each fort level the defender already has. Guns, not rifles, crack that. */
export const ARTILLERY_FORT_BONUS = 0.1

/**
 * Extra attack power when several provinces strike one target together.
 * Two directions is a flank. Three is a concentric attack. Four or more
 * does not grow past the cap.
 */
export function flankMultiplier(prongs: number): number {
  if (prongs <= 1) return 1
  if (prongs === 2) return 1.12
  if (prongs === 3) return 1.22
  return 1.3
}

/** Added to the defender's loss fraction when a multi-prong attack leaves no exit. */
export const ENCIRCLEMENT_DEFENDER_LOSS = 0.18

export function attackKindMod(kind: UnitKind, terrain: Terrain, fort = 0): number {
  if (kind === "artillery") return 1.16 + Math.max(0, fort) * ARTILLERY_FORT_BONUS
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
  fort = 0,
): number {
  const supplyFactor = Math.max(0.15, supply / 100)
  const base = units.reduce(
    (sum, unit) =>
      sum +
      unit.strength * (unit.morale / 100) * attackKindMod(unit.kind, terrain, fort),
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
  const supplyFactor = Math.max(0.3, supply / 100)
  const base = units.reduce(
    (sum, unit) =>
      sum + unit.strength * (unit.morale / 100) * defendKindMod(unit.kind),
    0,
  )
  return base * TERRAIN_DEFENSE[terrain] * (1 + fort * 0.14) * supplyFactor
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
    const defenderLoss = clampFraction(0.4 + (ratio - 1) * 0.28, 0.4, 0.82)
    const attackerLoss = clampFraction(0.16 / ratio, 0.04, 0.18)
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
    attackerLossFraction: clampFraction(0.22 + (1 - ratio) * 0.28, 0.16, 0.55),
    defenderLossFraction: clampFraction(0.14 * ratio, 0.06, 0.24),
    attackerMoraleDelta: -12,
    defenderMoraleDelta: 4,
  }
}

function clampFraction(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
