import { attackerPower, defenderPower } from "@/lib/engine/combat"
import { fightingUnits, formationStrength, independentFormations } from "@/lib/engine/echelon"
import { canAfford, RECRUIT, recruitmentYard, spendable } from "@/lib/engine/economy"
import { findProvince } from "@/lib/engine/turn"
import { scenarioSpec } from "@/lib/data/objectives"
import type {
  Difficulty,
  GameState,
  GMTurn,
  PlayerOrder,
  Proposal,
  Province,
  Unit,
  UnitKind,
} from "@/lib/types"

const THRESHOLD: Record<Difficulty, number> = {
  easy: 1.4,
  normal: 1.2,
  hard: 1.05,
}

const ATTACK_CAP: Record<Difficulty, number> = {
  easy: 1,
  normal: 2,
  hard: 3,
}

const DIPLOMACY = [
  "Stavka will not trade a fortress for a field. Garrisons stay on the victory cities.",
  "Ivanov asks for shells. The yards at Warsaw and Rovno answer with men before guns.",
  "The Grand Duke wants the line held until the Central Powers outrun their depots.",
  "Falkenhayn still refuses a corps from the west. This fortnight is fought with what the rails already carry.",
  "Bucharest stays neutral. The southern flank is the 8th Army's problem, not a new front.",
  "Alekseev would rather lose ground than a corps. Empty provinces are a gift he intends to take.",
]

export function stavkaTurn(state: GameState, orders: PlayerOrder[]): GMTurn {
  const difficulty = state.difficulty ?? "normal"
  const proposals: Proposal[] = []
  const used = new Set<string>()
  const attacks = planAttacks(state, difficulty, used)
  proposals.push(...attacks)
  if (difficulty !== "easy" || state.turn % 2 === 0) {
    proposals.push(...planReserveMoves(state, difficulty, used))
  }
  const fortify = planFortify(state)
  if (fortify) proposals.push(fortify)
  const attacking = new Set(
    attacks.flatMap((proposal) => (proposal.type === "attack" ? proposal.units : [])),
  )
  const recruit = planRecruit(state, attacking)
  if (recruit) proposals.push(recruit)

  return {
    narration: narrate(state, orders, proposals),
    proposals,
    events: reactiveEvents(state),
    diplomacy: [DIPLOMACY[state.turn % DIPLOMACY.length]],
  }
}

function planAttacks(
  state: GameState,
  difficulty: Difficulty,
  used: Set<string>,
): Proposal[] {
  const threshold = THRESHOLD[difficulty]
  const candidates: { score: number; from: string; target: string; units: string[] }[] = []
  for (const province of russianProvinces(state)) {
    if (province.supply < 30) continue
    const units = garrisonUnits(province).filter((unit) => !used.has(unit.id))
    const spare = spareUnits(state, province, units)
    if (!spare.length) continue
    for (const neighborId of [...province.neighbors].sort()) {
      const target = findProvince(state, neighborId)
      if (!target || target.controller !== "central") continue
      const chosen = enoughToAttack(spare, province, target, threshold)
      if (!chosen.length) continue
      candidates.push({
        score: targetScore(state, target, chosen, province),
        from: province.id,
        target: target.id,
        units: chosen.map((unit) => unit.id),
      })
    }
  }
  candidates.sort(
    (a, b) => b.score - a.score || a.target.localeCompare(b.target) || a.from.localeCompare(b.from),
  )
  const takenTargets = new Set<string>()
  const attacks: Proposal[] = []
  for (const candidate of candidates) {
    if (attacks.length >= ATTACK_CAP[difficulty]) break
    if (takenTargets.has(candidate.target)) continue
    if (candidate.units.some((id) => used.has(id))) continue
    attacks.push({
      type: "attack",
      from: candidate.from,
      target: candidate.target,
      units: candidate.units,
    })
    takenTargets.add(candidate.target)
    for (const id of candidate.units) used.add(id)
  }
  return attacks
}

function enoughToAttack(
  spare: Unit[],
  from: Province,
  target: Province,
  threshold: number,
): Unit[] {
  const sorted = [...spare].sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
  const chosen: Unit[] = []
  for (const unit of sorted) {
    chosen.push(unit)
    if (odds(chosen, from, target) >= threshold) return chosen
  }
  return []
}

function planReserveMoves(
  state: GameState,
  difficulty: Difficulty,
  used: Set<string>,
): Proposal[] {
  const goal = mostThreatened(state)
  if (!goal) return []
  const cap = difficulty === "easy" ? 1 : 2
  const movers: { id: string; from: string; step: string; distance: number }[] = []
  for (const province of russianProvinces(state)) {
    if (province.supply < 30 || province.id === goal.id) continue
    const step = stepToward(state, province.id, goal.id)
    if (!step) continue
    const units = garrisonUnits(province).filter((unit) => !used.has(unit.id))
    const spare = spareUnits(state, province, units)
    if (!spare.length) continue
    const unit = [...spare].sort((a, b) => a.strength - b.strength || a.id.localeCompare(b.id))[0]
    movers.push({
      id: unit.id,
      from: province.id,
      step,
      distance: distance(state, province.id, goal.id),
    })
  }
  movers.sort((a, b) => a.distance - b.distance || a.from.localeCompare(b.from))
  const moves: Proposal[] = []
  for (const mover of movers) {
    if (moves.length >= cap) break
    if (used.has(mover.id)) continue
    moves.push({ type: "move", unit: mover.id, to: mover.step })
    used.add(mover.id)
  }
  return moves
}

function planFortify(state: GameState): Proposal | null {
  const threatened = [...russianProvinces(state)]
    .filter((province) => isVictoryCity(state, province.id) || province.depot === "russia")
    .filter((province) => province.fort < 3 && province.supply >= 40)
    .filter((province) => garrisonUnits(province).length > 0)
    .sort((a, b) => threatRatio(state, b) - threatRatio(state, a) || a.id.localeCompare(b.id))
  const province = threatened[0]
  if (!province || threatRatio(state, province) <= 0) return null
  return { type: "fortify", province: province.id }
}

function planRecruit(state: GameState, attacking: Set<string>): Proposal | null {
  const purse = spendable(state, "russia", attacking)
  const kind: UnitKind = purse.ip >= RECRUIT.artillery.ip && purse.mp >= RECRUIT.artillery.mp && (state.difficulty === "hard")
    ? "artillery"
    : "infantry"
  if (!canAfford(purse, kind)) return null
  const goal = mostThreatened(state)
  const yards = state.provinces
    .filter((province) => recruitmentYard(province, "russia"))
    .filter((province) => !state.queue.some((job) => job.provinceId === province.id && job.faction === "russia"))
    .sort((a, b) => {
      const da = goal ? distance(state, a.id, goal.id) : 0
      const db = goal ? distance(state, b.id, goal.id) : 0
      return da - db || a.id.localeCompare(b.id)
    })
  const yard = yards[0]
  if (!yard) return null
  return { type: "recruit", faction: "russia", province: yard.id, kind }
}

function narrate(state: GameState, orders: PlayerOrder[], proposals: Proposal[]): string {
  const directive = orders
    .filter((order) => order.type === "text")
    .map((order) => order.text.trim())
    .filter(Boolean)
    .join(" ")
  const opening = directive
    ? `On ${state.date} the Central Powers directive reaches the staff: “${directive.slice(0, 320)}” Arrows and named orders are plotted; prose that names no province stays a wish.`
    : `On ${state.date} the Central Powers issue no written directive. Formations without an arrow hold their trenches.`
  const attacks = proposals.filter((proposal) => proposal.type === "attack")
  const names = attacks
    .map((proposal) => (proposal.type === "attack" ? findProvince(state, proposal.target)?.name : undefined))
    .filter((name): name is string => !!name)
  const recruit = proposals.find((proposal) => proposal.type === "recruit")
  const raising =
    recruit && recruit.type === "recruit"
      ? ` The yards at ${findProvince(state, recruit.province)?.name ?? "the depot"} start another formation.`
      : ""
  const second = names.length
    ? `Stavka commits ${names.length === 1 ? "an attack" : "attacks"} at ${list(names)}. Garrisons stay behind, and the dice still belong to the engine.${raising}`
    : `Stavka declines a general offensive and shifts reserves toward the threatened fortresses.${raising}`
  return `${opening}\n\n${second}`
}

function reactiveEvents(state: GameState): GMTurn["events"] {
  const restless = [...state.provinces]
    .filter((province) => province.controller !== province.owner && province.unrest >= 55)
    .sort((a, b) => b.unrest - a.unrest || a.id.localeCompare(b.id))[0]
  if (!restless) return []
  return [{ type: "partisans", province: restless.id, note: "The occupation is not quiet." }]
}

function russianProvinces(state: GameState): Province[] {
  return state.provinces
    .filter((province) => province.controller === "russia")
    .sort((a, b) => a.id.localeCompare(b.id))
}

function garrisonUnits(province: Province): Unit[] {
  return independentFormations(province.units.filter((unit) => unit.faction === "russia"))
}

function spareUnits(state: GameState, province: Province, units: Unit[]): Unit[] {
  if (!mustKeepGarrison(state, province) || units.length <= 1) {
    return mustKeepGarrison(state, province) ? [] : units
  }
  const sorted = [...units].sort(
    (a, b) => formationStrength(province.units, b) - formationStrength(province.units, a) || a.id.localeCompare(b.id),
  )
  return sorted.slice(0, -1)
}

function mustKeepGarrison(state: GameState, province: Province): boolean {
  if (province.depot === "russia") return true
  if (isVictoryCity(state, province.id)) return true
  return province.neighbors.some((id) => findProvince(state, id)?.controller === "central")
}

function isVictoryCity(state: GameState, id: string): boolean {
  return scenarioSpec(state.scenario).objectives.some((objective) => objective.id === id)
}

function odds(attackers: Unit[], from: Province, target: Province): number {
  const attackBodies = fightingUnits(from.units, attackers)
  const defenseBodies = fightingUnits(target.units.filter((unit) => unit.faction === target.controller))
  if (!defenseBodies.length) return Number.POSITIVE_INFINITY
  const attack = attackerPower(attackBodies, from.supply, target.terrain)
  const defense = defenderPower(defenseBodies, target.supply, target.terrain, target.fort)
  return attack / Math.max(8, defense)
}

function targetScore(state: GameState, target: Province, attackers: Unit[], from: Province): number {
  const spec = scenarioSpec(state.scenario)
  const home = spec.objectives.find((item) => item.id === target.id && item.side === "home")
  let score = Math.min(odds(attackers, from, target), 4) * 5
  if (home) score += 40 + home.vp * 20
  if (target.depot === "central") score += 35
  if (!target.units.some((unit) => unit.faction === "central")) score += 24
  return score
}

function threatRatio(state: GameState, province: Province): number {
  let threat = 0
  for (const neighborId of province.neighbors) {
    const neighbor = findProvince(state, neighborId)
    if (!neighbor || neighbor.controller !== "central") continue
    const enemy = neighbor.units.filter((unit) => unit.faction === "central")
    threat = Math.max(threat, attackerPower(enemy, neighbor.supply, province.terrain))
  }
  const defense = defenderPower(
    garrisonUnits(province),
    province.supply,
    province.terrain,
    province.fort,
  )
  if (threat <= 0) return 0
  return threat / Math.max(8, defense)
}

function mostThreatened(state: GameState): Province | null {
  const cities = state.provinces
    .filter((province) => province.controller === "russia" && isVictoryCity(state, province.id))
    .sort((a, b) => threatRatio(state, b) - threatRatio(state, a) || a.id.localeCompare(b.id))
  if (cities.length && threatRatio(state, cities[0]) > 0) return cities[0]
  const depots = state.provinces
    .filter((province) => province.controller === "russia" && province.depot === "russia")
    .sort((a, b) => a.id.localeCompare(b.id))
  return cities[0] ?? depots[0] ?? null
}

function stepToward(state: GameState, fromId: string, goalId: string): string | null {
  const next = new Map<string, string | null>()
  const queue = [goalId]
  next.set(goalId, null)
  while (queue.length) {
    const id = queue.shift()!
    const province = findProvince(state, id)
    if (!province) continue
    for (const neighborId of [...province.neighbors].sort()) {
      if (next.has(neighborId)) continue
      const neighbor = findProvince(state, neighborId)
      if (!neighbor || neighbor.controller !== "russia") continue
      next.set(neighborId, id)
      queue.push(neighborId)
    }
  }
  return next.get(fromId) ?? null
}

function distance(state: GameState, fromId: string, goalId: string): number {
  if (fromId === goalId) return 0
  const seen = new Set<string>([fromId])
  let edge = [fromId]
  let steps = 0
  while (edge.length) {
    steps += 1
    const next: string[] = []
    for (const id of edge) {
      const province = findProvince(state, id)
      if (!province) continue
      for (const neighborId of province.neighbors) {
        if (seen.has(neighborId)) continue
        if (neighborId === goalId) return steps
        const neighbor = findProvince(state, neighborId)
        if (!neighbor || neighbor.controller !== "russia") continue
        seen.add(neighborId)
        next.push(neighborId)
      }
    }
    edge = next
  }
  return 99
}

function list(names: string[]): string {
  const unique = [...new Set(names)]
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`
}
