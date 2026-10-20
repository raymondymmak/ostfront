import { createScenario } from "@/lib/data/scenario"
import { projectIncome, spendable, RECRUIT } from "@/lib/engine/economy"
import { combinedEngagementOdds, engagementOdds } from "@/lib/engine/turn"
import { playTurn } from "@/lib/gm"
import { scenarioSpec } from "@/lib/data/objectives"
import type { Difficulty, GameState, PlayerOrder, UnitKind } from "@/lib/types"

delete process.env.LLM_API_KEY

const SEEDS = [19150604, 19150605, 19150606, 19150607, 19150608, 19150609]
const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"]

const WINS = new Set(["marginal", "victory", "decisive", "brilliant"])

function province(state: GameState, id: string) {
  return state.provinces.find((item) => item.id === id)!
}

function spareIds(state: GameState, provinceId: string, used: Set<string>, depotKeep = 1): string[] {
  const source = province(state, provinceId)
  const units = source.units.filter((unit) => unit.faction === "central" && !used.has(unit.id))
  const stay = source.depot === "central" ? depotKeep : 0
  if (units.length <= stay) return []
  const weakestFirst = [...units].sort((a, b) => a.strength - b.strength || a.id.localeCompare(b.id))
  return weakestFirst.slice(stay).map((unit) => unit.id)
}

export function greedy(state: GameState): PlayerOrder[] {
  const orders: PlayerOrder[] = []
  let best: { from: string; to: string; ids: string[]; ratio: number } | null = null
  for (const source of state.provinces) {
    if (source.controller !== "central" || source.supply < 30) continue
    const ids = spareIds(state, source.id, new Set())
    if (!ids.length) continue
    for (const neighbor of source.neighbors) {
      const target = province(state, neighbor)
      if (target.controller === "central") continue
      const odds = engagementOdds(state, source.id, target.id, ids)
      if (!odds || odds.ratio < 1.15) continue
      if (!best || odds.ratio > best.ratio) best = { from: source.id, to: target.id, ids, ratio: odds.ratio }
    }
  }
  if (best) orders.push({ type: "attack", from: best.from, target: best.to, unitIds: best.ids })
  recruit(state, orders, new Set(best?.ids ?? []))
  return orders
}

const AXIS = ["lwow", "lublin", "wolyn"]

/**
 * Simple attacker: each stack fights the best defended neighbor at 1.15 or
 * better. An objective within a small odds gap wins the tie. Depots are not
 * emptied, and empty marsh is not preferred to a battle.
 */
export function frontier(): (state: GameState) => PlayerOrder[] {
  const axis = new Set(AXIS)
  return (state) => {
    const orders: PlayerOrder[] = []
    const used = new Set<string>()
    const options: { from: string; to: string; ids: string[]; ratio: number }[] = []
    for (const source of state.provinces) {
      if (source.controller !== "central" || source.supply < 30) continue
      const ids = spareIds(state, source.id, used)
      const garrison = source.units.filter((unit) => unit.faction === "central")
      if (!ids.length || (source.depot === "central" && ids.length >= garrison.length)) continue
      const choices: { to: string; ratio: number }[] = []
      for (const neighbor of source.neighbors) {
        const target = province(state, neighbor)
        if (target.controller === "central") continue
        const odds = engagementOdds(state, source.id, target.id, ids)
        if (!odds || odds.empty || odds.ratio < 1.15) continue
        choices.push({ to: target.id, ratio: odds.ratio })
      }
      if (!choices.length) continue
      choices.sort((a, b) => b.ratio - a.ratio)
      const along = choices
        .filter((choice) => axis.has(choice.to) && choice.ratio >= 1.35)
        .sort((a, b) => AXIS.indexOf(a.to) - AXIS.indexOf(b.to))
      const pick = along[0] ?? choices[0]
      options.push({ from: source.id, to: pick.to, ids, ratio: pick.ratio })
    }
    options.sort((a, b) => b.ratio - a.ratio)
    const taken = new Set<string>()
    for (const option of options) {
      if (orders.length >= 3 || taken.has(option.to)) continue
      orders.push({ type: "attack", from: option.from, target: option.to, unitIds: option.ids })
      taken.add(option.to)
      for (const id of option.ids) used.add(id)
    }
    recruit(state, orders, used)
    return orders
  }
}

/** Stack on the historical axis, leave depots held, then attack. */
export function sensible(): (state: GameState) => PlayerOrder[] {
  const axis = AXIS
  return (state) => {
    const orders: PlayerOrder[] = []
    const used = new Set<string>()
    const goal = axis.map((id) => province(state, id)).find((item) => item.controller !== "central")
    if (goal) {
      for (const source of state.provinces) {
        if (source.controller !== "central" || source.supply < 30) continue
        if (source.depot === "central") continue
        if (source.neighbors.includes(goal.id)) continue
        const bordersRussia = source.neighbors.some((id) => province(state, id).controller === "russia")
        const units = source.units.filter((unit) => unit.faction === "central" && !used.has(unit.id))
        // The East Prussian and Galician screens stay put. Only surplus behind the front marches.
        if (bordersRussia && units.length <= 2) continue
        const ordered = [...units].sort((a, b) => b.strength - a.strength)
        const mover = bordersRussia ? ordered[2] : ordered[0]
        if (!mover) continue
        const step = stepToward(state, source.id, goal.id)
        if (!step) continue
        orders.push({ type: "move", unitId: mover.id, to: step })
        used.add(mover.id)
      }
    }
    const attacks: { from: string; to: string; ids: string[]; priority: number; ratio: number }[] = []
    for (const source of state.provinces) {
      if (source.controller !== "central" || source.supply < 30) continue
      const depotKeep = source.id === "krakow" || source.id === "lwow" ? 1 : 2
      let ids = spareIds(state, source.id, used, depotKeep)
      if (!ids.length) continue
      if (axis.includes(source.id) && source.depot !== "central" && ids.length > 1) {
        const bodies = source.units.filter((unit) => ids.includes(unit.id))
        const weakest = [...bodies].sort((a, b) => a.strength - b.strength || a.id.localeCompare(b.id))[0]
        const screened = ids.filter((id) => id !== weakest.id)
        const canScreen = source.neighbors.some((neighbor) => {
          const target = province(state, neighbor)
          if (target.controller === "central" || !axis.includes(target.id)) return false
          const odds = engagementOdds(state, source.id, target.id, screened)
          return !!odds && (odds.empty || odds.ratio >= 1.2)
        })
        if (canScreen) ids = screened
      }
      for (const neighbor of source.neighbors) {
        const target = province(state, neighbor)
        if (target.controller === "central") continue
        const odds = engagementOdds(state, source.id, target.id, ids)
        if (!odds) continue
        const priority = axis.indexOf(target.id)
        const onAxis = priority !== -1
        if (!onAxis && (odds.empty || odds.ratio < 2.2)) continue
        if (onAxis && Number.isFinite(odds.ratio) && odds.ratio < 1.05) continue
        attacks.push({
          from: source.id,
          to: target.id,
          ids,
          priority: onAxis ? priority : 50,
          ratio: odds.ratio,
        })
      }
    }
    attacks.sort((a, b) => a.priority - b.priority || b.ratio - a.ratio)
    const takenFrom = new Set<string>()
    const chosen: typeof attacks = []
    for (const attack of attacks) {
      if (chosen.length >= 2 || takenFrom.has(attack.from)) continue
      if (attack.ids.some((id) => used.has(id))) continue
      const lead = chosen.find((item) => item.to === attack.to)
      if (lead && lead.ratio >= 1.25) continue
      if (lead) {
        const support = supportingProng(state, lead, attack)
        if (!support) continue
        chosen.push({ ...attack, ids: support })
      } else {
        chosen.push(attack)
      }
      takenFrom.add(attack.from)
    }
    for (const attack of chosen) {
      orders.push({ type: "attack", from: attack.from, target: attack.to, unitIds: attack.ids })
      for (const id of attack.ids) used.add(id)
    }
    recruit(state, orders, used, state.turn % 4 === 2 ? "artillery" : "infantry")
    return orders
  }
}

/** The fewest extra formations that turn a short attack into a real two-pronged blow. */
function supportingProng(
  state: GameState,
  lead: { from: string; to: string; ids: string[] },
  partner: { from: string; to: string; ids: string[] },
): string[] | null {
  const source = province(state, partner.from)
  const bodies = source.units.filter((unit) => partner.ids.includes(unit.id))
  const strongest = [...bodies].sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
  const sendable = strongest.length > 1 ? strongest.slice(0, strongest.length - 1) : strongest
  const chosen: string[] = []
  for (const unit of sendable) {
    chosen.push(unit.id)
    const preview = combinedEngagementOdds(state, lead.to, [
      { fromId: lead.from, unitIds: lead.ids },
      { fromId: partner.from, unitIds: chosen },
    ])
    if (preview && (preview.empty || preview.ratio >= 1.5)) return chosen
  }
  return null
}

function recruit(state: GameState, orders: PlayerOrder[], used: Set<string>, prefer: UnitKind = "infantry") {
  const budget = spendable(state, "central", used)
  const kind: UnitKind =
    prefer === "artillery" && budget.mp >= RECRUIT.artillery.mp && budget.ip >= RECRUIT.artillery.ip
      ? "artillery"
      : "infantry"
  if (budget.mp < RECRUIT[kind].mp || budget.ip < RECRUIT[kind].ip) return
  const yard = ["krakow", "lwow", "konigsberg", "poznan", "danzig"]
    .map((id) => province(state, id))
    .find((item) => item.controller === "central" && item.supply >= 60 && (item.depot === "central" || item.owner === "central"))
  if (!yard) return
  orders.push({ type: "recruit", provinceId: yard.id, unitKind: kind })
}

function stepToward(state: GameState, fromId: string, goalId: string): string | null {
  const next = new Map<string, string | null>()
  const queue = [goalId]
  next.set(goalId, null)
  while (queue.length) {
    const id = queue.shift()!
    for (const neighborId of [...province(state, id).neighbors].sort()) {
      if (next.has(neighborId)) continue
      const neighbor = province(state, neighborId)
      if (neighbor.controller !== "central" && neighborId !== goalId) continue
      next.set(neighborId, id)
      queue.push(neighborId)
    }
  }
  return next.get(fromId) ?? null
}

async function play(
  difficulty: Difficulty,
  strategy: (state: GameState) => PlayerOrder[],
  seed: number,
  trace = false,
) {
  let state = createScenario("gorlice", difficulty)
  state.seed = seed
  while (!state.result) {
    const orders = strategy(state)
    const played = await playTurn(state, orders)
    if (trace) {
      const flips = played.record.controlChanges.map((change) => `${change.name}:${change.to}`).join(",")
      const attacks = played.record.resolutions
        .filter((item) => item.proposal.type === "attack" && item.status === "applied")
        .map((item) => item.summary.replace(/\s+/g, " ").slice(0, 140))
      console.log(`  t${state.turn} ${flips || "-"}`)
      for (const line of attacks) console.log("   ", line)
    }
    state = played.state
  }
  const held = scenarioSpec("gorlice")
    .objectives.filter((item) => item.side === "eastern" && province(state, item.id).controller === "central")
    .map((item) => item.id)
  const homes = scenarioSpec("gorlice")
    .objectives.filter((item) => item.side === "home" && province(state, item.id).controller === "russia")
    .map((item) => item.id)
  return {
    grade: state.result?.grade ?? "open",
    vp: state.result?.captured ?? 0,
    turn: state.turn,
    held,
    homes,
  }
}

async function main() {
  const state = createScenario("gorlice", "normal")
  console.log(
    "gorlice",
    "income",
    JSON.stringify(projectIncome(state, "central")),
    JSON.stringify(projectIncome(state, "russia")),
  )
  const strategies: { name: string; fn: () => (state: GameState) => PlayerOrder[] }[] = [
    { name: "greedy", fn: () => greedy },
    { name: "frontier", fn: () => frontier() },
    { name: "sensible", fn: () => sensible() },
  ]
  for (const strategy of strategies) {
    console.log(`\n## gorlice ${strategy.name}`)
    for (const difficulty of DIFFICULTIES) {
      const rows = []
      for (const seed of SEEDS) rows.push(await play(difficulty, strategy.fn(), seed))
      const grades = rows.map((row) => row.grade)
      const wins = grades.filter((grade) => WINS.has(grade)).length
      const vp = rows.map((row) => row.vp).join(",")
      const held = rows.map((row) => (row.held.length ? row.held.join("+") : "-")).join(" | ")
      const homes = rows.map((row) => (row.homes.length ? row.homes.join("+") : "-")).join(",")
      console.log(`${difficulty.padEnd(7)} ${wins}/6  ${grades.join(" ")}  vp ${vp}  held ${held}  lost ${homes}`)
      if (difficulty === "normal" && strategy.name === "sensible") {
        console.log("  sample", JSON.stringify({ held: rows[0].held, homes: rows[0].homes, turn: rows[0].turn }))
      }
    }
  }
}

const isDirect = process.argv[1]?.endsWith("balance-sim.ts")
if (isDirect) main()
