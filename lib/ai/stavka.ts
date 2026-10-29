import { attackerPower, defenderPower } from "@/lib/engine/combat"
import { fightingUnits, formationStrength, independentFormations } from "@/lib/engine/echelon"
import { canAfford, RECRUIT, recruitmentYard, spendable } from "@/lib/engine/economy"
import { combinedEngagementOdds, findProvince } from "@/lib/engine/turn"
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

/** Odds before the d6. Quiet-front attacks into Central Powers soil use these. */
export const STAVKA_THRESHOLD: Record<Difficulty, number> = {
  easy: 1.55,
  normal: 1.28,
  hard: 1.08,
}

const ATTACK_CAP: Record<Difficulty, number> = {
  easy: 1,
  normal: 2,
  hard: 3,
}

/**
 * Once the Central Powers own a Russian province, Stavka seals that breach
 * instead of opening a second front into Galicia or Silesia.
 * Hard still raids home soil, but only at a higher bar than a field battle.
 */
const HOME_WHILE_BREACH: Record<Difficulty, number> = {
  easy: Number.POSITIVE_INFINITY,
  normal: 2.35,
  hard: 2.15,
}

const DIPLOMACY = [
  "Dimitriev asked to fall back to the San. Ivanov refused. The 3rd Army will stand at Lemberg.",
  "Ivanov asks for shells. The yards at Warsaw and Rovno answer with men before guns.",
  "The Grand Duke will not uncover Warsaw to feed the breakthrough. Garrisons stay on the fortresses.",
  "Falkenhayn has sent Mackensen and will send no more from the west. This fortnight is fought with the rails already in Galicia.",
  "Bucharest stays neutral. Brusilov's 8th Army keeps the Dniester without a new front.",
  "Alekseev would rather lose a field than a corps. Empty ground is a gift he means to take back.",
]

/**
 * Russian orders are locked from the map as the fortnight opens.
 * `orders` is accepted so callers can pass the player's list, and ignored:
 * Stavka must not read it.
 */
export function stavkaTurn(state: GameState, orders: PlayerOrder[] = []): GMTurn {
  void orders
  const difficulty = state.difficulty ?? "normal"
  const proposals: Proposal[] = []
  const used = new Set<string>()
  const opening = state.turn === 0 && difficulty !== "hard"
  const attacks = opening ? [] : planAttacks(state, difficulty, used)
  proposals.push(...attacks)
  if (!opening && (difficulty !== "easy" || state.turn % 2 === 0)) {
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
    narration: narrate(state, proposals),
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
  const breach = centralHoldsRussianSoil(state)
  const candidates: { score: number; from: string; target: string; units: string[] }[] = []
  for (const province of russianProvinces(state)) {
    if (province.supply < 30) continue
    const units = garrisonUnits(province).filter((unit) => !used.has(unit.id))
    const spare = spareUnits(state, province, units)
    if (!spare.length) continue
    for (const neighborId of [...province.neighbors].sort()) {
      const target = findProvince(state, neighborId)
      if (!target || target.controller !== "central") continue
      const threshold = attackThreshold(difficulty, breach, target)
      if (!Number.isFinite(threshold)) continue
      const chosen = committedProng(spare, province, target, threshold)
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
  const takenFrom = new Set<string>()
  const attacks: Proposal[] = []
  const cap = ATTACK_CAP[difficulty]
  const maxProngs = difficulty === "hard" ? 3 : difficulty === "easy" ? 1 : 2

  const free = () =>
    candidates.filter(
      (candidate) => !takenFrom.has(candidate.from) && candidate.units.every((id) => !used.has(id)),
    )

  const operation = (allowPartner: boolean) => {
    const pool = free()
    for (const primary of pool) {
      const target = findProvince(state, primary.target)
      if (!target) continue
      const threshold = attackThreshold(difficulty, breach, target)
      const alone = prongRatio(state, [primary])
      if (!allowPartner) {
        if (alone >= threshold) return [primary]
        continue
      }
      if (alone >= threshold) continue
      const prongs = [primary]
      const mayPinch = target.owner === "russia" || difficulty === "hard"
      while (mayPinch && prongs.length < maxProngs && attacks.length + prongs.length < cap) {
        if (prongRatio(state, prongs) >= threshold) break
        const current = prongRatio(state, prongs)
        const partner = pool
          .filter(
            (candidate) =>
              candidate.target === primary.target &&
              !prongs.some((prong) => prong.from === candidate.from),
          )
          .map((candidate) => ({
            candidate,
            ratio: prongRatio(state, [...prongs, candidate]),
          }))
          .filter((item) => item.ratio > current)
          .sort((a, b) => b.ratio - a.ratio || a.candidate.from.localeCompare(b.candidate.from))[0]
        if (!partner) break
        prongs.push(partner.candidate)
      }
      const pinchBar = difficulty === "hard" ? threshold : Math.max(threshold, 1.45)
      if (prongs.length > 1 && prongRatio(state, prongs) >= pinchBar) return prongs
    }
    return null
  }

  while (attacks.length < cap) {
    const picked = operation(false) ?? operation(true)
    if (!picked) break
    for (const prong of picked) {
      attacks.push({
        type: "attack",
        from: prong.from,
        target: prong.target,
        units: prong.units,
      })
      takenFrom.add(prong.from)
      for (const id of prong.units) used.add(id)
    }
  }
  return attacks
}

function prongRatio(
  state: GameState,
  prongs: { from: string; target: string; units: string[] }[],
): number {
  const preview = combinedEngagementOdds(
    state,
    prongs[0].target,
    prongs.map((prong) => ({ fromId: prong.from, unitIds: prong.units })),
  )
  if (!preview) return 0
  return preview.ratio
}

/** Every spare formation, so a weak neighbor can still join a concentric attack. */
function committedProng(spare: Unit[], from: Province, target: Province, threshold: number): Unit[] {
  const enough = enoughToAttack(spare, from, target, threshold)
  if (enough.length) return enough
  return [...spare].sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
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

function attackThreshold(difficulty: Difficulty, breach: boolean, target: Province): number {
  if (target.owner === "central") {
    return breach ? HOME_WHILE_BREACH[difficulty] : STAVKA_THRESHOLD[difficulty]
  }
  return Math.max(1, STAVKA_THRESHOLD[difficulty] - 0.12)
}

function centralHoldsRussianSoil(state: GameState): boolean {
  return state.provinces.some(
    (province) => province.owner === "russia" && province.controller === "central",
  )
}

function planReserveMoves(
  state: GameState,
  difficulty: Difficulty,
  used: Set<string>,
): Proposal[] {
  const goal = mostThreatened(state)
  if (!goal) return []
  const cap = difficulty === "easy" ? 1 : difficulty === "hard" ? 3 : 2
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
  if (!province || threatRatio(state, province) < 0.95) return null
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
      // A corps is not stood up in a city the enemy is already touching.
      const exposed = Number(bordersEnemy(state, a)) - Number(bordersEnemy(state, b))
      if (exposed) return exposed
      const da = goal ? distance(state, a.id, goal.id) : 0
      const db = goal ? distance(state, b.id, goal.id) : 0
      return da - db || a.id.localeCompare(b.id)
    })
  const yard = yards[0]
  if (!yard) return null
  return { type: "recruit", faction: "russia", province: yard.id, kind }
}

function narrate(state: GameState, proposals: Proposal[]): string {
  const opening = `On ${state.date} Stavka locks its orders from the map as the fortnight opens. The Central Powers' arrows are not on that map.`
  const attacks = proposals.filter((proposal) => proposal.type === "attack")
  const prongsByTarget = new Map<string, number>()
  for (const proposal of attacks) {
    if (proposal.type !== "attack") continue
    prongsByTarget.set(proposal.target, (prongsByTarget.get(proposal.target) ?? 0) + 1)
  }
  const names = [...prongsByTarget.entries()]
    .map(([id, count]) => {
      const name = findProvince(state, id)?.name
      if (!name) return undefined
      if (count === 2) return `a two-pronged attack at ${name}`
      if (count > 2) return `a concentric attack at ${name}`
      return name
    })
    .filter((name): name is string => !!name)
  const recruit = proposals.find((proposal) => proposal.type === "recruit")
  const raising =
    recruit && recruit.type === "recruit"
      ? ` The yards at ${findProvince(state, recruit.province)?.name ?? "the depot"} start another formation.`
      : ""
  const second = !names.length
    ? `Stavka declines a general offensive and shifts reserves toward the threatened fortresses.${raising}`
    : `${
        names.length === 1 && names[0].startsWith("a ")
          ? `Stavka commits ${names[0]}`
          : names.length === 1
            ? `Stavka commits an attack at ${names[0]}`
            : `Stavka commits attacks at ${list(names)}`
      }. Garrisons stay behind, and the dice still belong to the engine.${raising}`
  return `${opening}\n\n${second}`
}

function reactiveEvents(state: GameState): GMTurn["events"] {
  const restless = [...state.provinces]
    .filter((province) => province.controller !== province.owner && province.unrest >= 55)
    .sort((a, b) => b.unrest - a.unrest || a.id.localeCompare(b.id))[0]
  if (!restless) return []
  return [{ type: "partisans", province: restless.id, note: "The occupation is not quiet." }]
}

function bordersEnemy(state: GameState, province: Province): boolean {
  return province.neighbors.some((id) => findProvince(state, id)?.controller === "central")
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
  const keep =
    mustKeepGarrison(state, province)
      ? province.depot === "russia" && state.difficulty === "hard"
        ? 2
        : 1
      : 0
  if (units.length <= keep) return []
  const sorted = [...units].sort(
    (a, b) => formationStrength(province.units, b) - formationStrength(province.units, a) || a.id.localeCompare(b.id),
  )
  return sorted.slice(0, units.length - keep)
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
  const attack = attackerPower(attackBodies, from.supply, target.terrain, target.fort)
  const defense = defenderPower(defenseBodies, target.supply, target.terrain, target.fort)
  return attack / Math.max(8, defense)
}

function targetScore(state: GameState, target: Province, attackers: Unit[], from: Province): number {
  const spec = scenarioSpec(state.scenario)
  const breach = centralHoldsRussianSoil(state)
  const home = spec.objectives.find((item) => item.id === target.id && item.side === "home")
  const retake = target.owner === "russia"
  let score = Math.min(odds(attackers, from, target), 4) * 5
  if (retake) score += 80
  if (home && !breach) score += 40 + home.vp * 20
  else if (home) score += 8
  if (target.depot === "central" && !breach) score += 30
  if (!target.units.some((unit) => unit.faction === "central")) score += retake ? 30 : 8
  const objective = spec.objectives.find((item) => item.id === target.id && item.side === "eastern")
  if (objective && retake) score += objective.vp * 12
  return score
}

function threatRatio(state: GameState, province: Province): number {
  let threat = 0
  for (const neighborId of province.neighbors) {
    const neighbor = findProvince(state, neighborId)
    if (!neighbor || neighbor.controller !== "central") continue
    const enemy = neighbor.units.filter((unit) => unit.faction === "central")
    threat = Math.max(threat, attackerPower(enemy, neighbor.supply, province.terrain, province.fort))
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
