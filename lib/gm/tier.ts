import type { GameState, PlayerOrder } from "@/lib/types"

export type TurnTier = "routine" | "important" | "critical"

/** Tune classification without changing call sites. */
export const TIER_WEIGHTS = {
  depotInvolved: 4,
  fortressBattle: 3,
  largeAttack: 3,
  manyAttacks: 3,
  moderateAttacks: 2,
  manyOrders: 2,
  someOrders: 1,
} as const

export const TIER_THRESHOLDS = {
  critical: 6,
  important: 3,
} as const

const FORTRESS_LEVEL = 2
const LARGE_ATTACK_UNITS = 4
const MANY_ORDERS = 8
const SOME_ORDERS = 4
const MANY_ATTACKS = 3

export type TierScore = {
  tier: TurnTier
  score: number
  signals: string[]
}

export function tier(state: GameState, orders: PlayerOrder[]): TurnTier {
  return scoreTurn(state, orders).tier
}

export function scoreTurn(state: GameState, orders: PlayerOrder[]): TierScore {
  const depotIds = new Set(
    state.provinces.filter((province) => province.depot).map((province) => province.id),
  )
  const provinceById = new Map(state.provinces.map((province) => [province.id, province]))

  let score = 0
  const signals: string[] = []

  const attacks = orders.filter((order) => order.type === "attack")
  if (attacks.length >= MANY_ATTACKS) {
    score += TIER_WEIGHTS.manyAttacks
    signals.push(`${attacks.length} attacks`)
  } else if (attacks.length > 0) {
    score += TIER_WEIGHTS.moderateAttacks
    signals.push(`${attacks.length} attack(s)`)
  }

  if (orders.length >= MANY_ORDERS) {
    score += TIER_WEIGHTS.manyOrders
    signals.push(`${orders.length} orders`)
  } else if (orders.length >= SOME_ORDERS) {
    score += TIER_WEIGHTS.someOrders
    signals.push(`${orders.length} orders`)
  }

  for (const order of orders) {
    if (order.type === "attack") {
      if (depotIds.has(order.target) || depotIds.has(order.from)) {
        score += TIER_WEIGHTS.depotInvolved
        signals.push("depot at stake")
      }
      const target = provinceById.get(order.target)
      if (target && target.fort >= FORTRESS_LEVEL) {
        score += TIER_WEIGHTS.fortressBattle
        signals.push(`fort ${target.fort} at ${target.id}`)
      }
      if (order.unitIds.length >= LARGE_ATTACK_UNITS) {
        score += TIER_WEIGHTS.largeAttack
        signals.push(`large attack (${order.unitIds.length} units)`)
      }
    }
    if (order.type === "move" && depotIds.has(order.to)) {
      score += TIER_WEIGHTS.depotInvolved
      signals.push("move toward depot")
    }
    if (order.type === "fortify") {
      const province = provinceById.get(order.provinceId)
      if (province?.depot || (province && province.fort >= FORTRESS_LEVEL)) {
        score += TIER_WEIGHTS.fortressBattle
        signals.push(`fortify ${order.provinceId}`)
      }
    }
  }

  const uniqueSignals = [...new Set(signals)]
  if (score >= TIER_THRESHOLDS.critical) {
    return { tier: "critical", score, signals: uniqueSignals }
  }
  if (score >= TIER_THRESHOLDS.important) {
    return { tier: "important", score, signals: uniqueSignals }
  }
  return { tier: "routine", score, signals: uniqueSignals }
}
