import { attackerPower, flankMultiplier } from "@/lib/engine/combat"
import { fightingUnits, independentFormations, partyOf } from "@/lib/engine/echelon"
import {
  attackerSupplyFromProvince,
  CONVERGING_FLANK_MIN_SUPPLY,
  convergingAttackerSupply,
} from "@/lib/engine/supply"
import type { Province, Unit } from "@/lib/types"

export type AssaultProng = {
  from: Province
  bodies: Unit[]
}

export function prongsFromIds(
  getProvince: (id: string) => Province | undefined,
  prongs: { fromId: string; unitIds: string[] }[],
): AssaultProng[] | null {
  const out: AssaultProng[] = []
  for (const prong of prongs) {
    const from = getProvince(prong.fromId)
    if (!from) return null
    const attackers = fightingUnits(from.units, independentFormations(partyOf(from.units, prong.unitIds)))
    if (!attackers.length) continue
    out.push({ from, bodies: attackers })
  }
  return out.length ? out : null
}

export function assaultAttackPower(
  target: Province,
  prongs: AssaultProng[],
): { attack: number; multiplier: number; origins: number; pooledSupply: number | null } {
  const origins = [...new Set(prongs.map((prong) => prong.from.id))]
  const starvedConvergence =
    origins.length > 1 &&
    prongs.some((prong) => attackerSupplyFromProvince(prong.from) < CONVERGING_FLANK_MIN_SUPPLY)

  let attack = 0
  let pooledSupply: number | null = null
  let multiplier = 1

  if (starvedConvergence) {
    const allBodies = prongs.flatMap((prong) => prong.bodies)
    const supplyInputs = prongs.map((prong) => ({
      from: prong.from,
      attackerStrength: prong.bodies.reduce((sum, unit) => sum + unit.strength, 0),
    }))
    pooledSupply = convergingAttackerSupply(target, supplyInputs)
    attack = attackerPower(allBodies, pooledSupply, target.terrain, target.fort)
    multiplier = 1
  } else if (origins.length > 1) {
    for (const prong of prongs) {
      attack += attackerPower(
        prong.bodies,
        attackerSupplyFromProvince(prong.from),
        target.terrain,
        target.fort,
      )
    }
    multiplier = flankMultiplier(origins.length)
  } else {
    attack = attackerPower(
      prongs[0].bodies,
      attackerSupplyFromProvince(prongs[0].from),
      target.terrain,
      target.fort,
    )
  }

  attack *= multiplier
  return { attack, multiplier, origins: origins.length, pooledSupply }
}
