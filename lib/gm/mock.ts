import { attackerPower, defenderPower } from "@/lib/engine/combat"
import { findProvince } from "@/lib/engine/turn"
import { FACTION_LABEL } from "@/lib/format"
import type {
  GameEvent,
  GameState,
  GMTurn,
  PlayerOrder,
  Proposal,
  Province,
} from "@/lib/types"

const FORTRESS = new Set([
  "warsaw",
  "brest",
  "lemberg",
  "kovno",
  "krakow",
  "konigsberg",
])

const DIPLOMACY = [
  "Berlin tells Vienna that the Kraków—Przemyśl railway is the campaign. Lemberg before everything.",
  "Stavka warns the Warsaw depot that Galicia can be thinned if the Narew starts to bend.",
  "Conrad wants another push east of Przemyśl before the Russians dig in front of Lemberg.",
  "Falkenhayn will send no fresh corps from the west. This fortnight is fought with the rails already in hand.",
  "Bucharest stays noncommittal. The Bukovina is watched, not entered.",
  "The heavy artillery asks for ammunition trains through Tarnów before the next assault.",
]

export function mockAiTurn(state: GameState, orders: PlayerOrder[]): GMTurn {
  const proposals: Proposal[] = []
  const used = new Set<string>()

  // The first fortnight is the player's: Stavka digs in and watches.
  // After that, Russia attacks only with a clear local advantage.
  const attackThreshold = state.turn === 0 ? 99 : 1.25
  for (const province of russianProvinces(state)) {
    if (province.supply < 30) continue
    const units = province.units.filter(
      (unit) => unit.faction === "russia" && !used.has(unit.id),
    )
    if (!units.length) continue
    let best: { id: string; name: string; score: number } | null = null
    for (const neighborId of province.neighbors) {
      const target = findProvince(state, neighborId)
      if (!target || target.controller === "russia") continue
      const defenders = target.units.filter(
        (unit) => unit.faction === target.controller,
      )
      const attack = attackerPower(units, province.supply, target.terrain)
      const defense = defenderPower(
        defenders,
        target.supply,
        target.terrain,
        target.fort,
      )
      const score = defenders.length === 0 ? 2.2 : attack / Math.max(8, defense)
      if (!best || score > best.score) {
        best = { id: target.id, name: target.name, score }
      }
    }
    if (best && best.score >= attackThreshold) {
      proposals.push({
        type: "attack",
        from: province.id,
        target: best.id,
        units: units.map((unit) => unit.id),
      })
      for (const unit of units) used.add(unit.id)
    }
  }

  for (const province of russianProvinces(state)) {
    const units = province.units.filter(
      (unit) => unit.faction === "russia" && !used.has(unit.id),
    )
    if (state.turn === 0) continue
    if (!units.length || province.supply < 30) continue
    const bordersEnemy = province.neighbors.some((id) => {
      const neighbor = findProvince(state, id)
      return neighbor?.controller === "central"
    })
    if (bordersEnemy && units.length <= 1) continue
    if (FORTRESS.has(province.id) && units.length <= 1) continue
    let threat = 0
    for (const neighborId of province.neighbors) {
      const neighbor = findProvince(state, neighborId)
      if (!neighbor || neighbor.controller !== "central") continue
      const enemy = neighbor.units.filter((unit) => unit.faction === "central")
      threat = Math.max(
        threat,
        attackerPower(enemy, neighbor.supply, province.terrain),
      )
    }
    const defense = defenderPower(
      units,
      province.supply,
      province.terrain,
      province.fort,
    )
    if (threat <= defense * 1.25) continue
    const rear = province.neighbors
      .map((id) => findProvince(state, id))
      .filter(
        (item): item is Province =>
          !!item && item.controller === "russia" && item.supply > province.supply,
      )
      .sort((a, b) => b.supply - a.supply)[0]
    if (!rear) continue
    const unit = [...units].sort((a, b) => a.strength - b.strength)[0]
    proposals.push({ type: "move", unit: unit.id, to: rear.id })
    used.add(unit.id)
  }

  if (state.turn % 2 === 0) {
    for (const id of ["warsaw", "brest", "lemberg"]) {
      const province = findProvince(state, id)
      if (
        province &&
        province.controller === "russia" &&
        province.fort < 3 &&
        province.supply >= 40 &&
        province.units.some((unit) => unit.faction === "russia")
      ) {
        proposals.push({ type: "fortify", province: id })
        break
      }
    }
  }

  return {
    narration: narrate(state, orders, proposals),
    proposals,
    events: pickEvents(state),
    diplomacy: [DIPLOMACY[state.turn % DIPLOMACY.length]],
  }
}

function russianProvinces(state: GameState): Province[] {
  return state.provinces.filter(
    (province) =>
      province.controller === "russia" &&
      province.units.some((unit) => unit.faction === "russia"),
  )
}

function pickEvents(state: GameState): GameEvent[] {
  const events: GameEvent[] = []
  const restless = state.provinces
    .filter((province) => province.controller !== province.owner)
    .sort((a, b) => b.unrest - a.unrest)[0]
  if (restless && restless.unrest >= 40) {
    events.push({
      type: "partisans",
      province: restless.id,
      note: "The occupation is not quiet.",
    })
  }
  if (state.turn % 4 === 1) {
    const marsh = state.provinces.find(
      (province) => province.terrain === "marsh" && province.units.length > 0,
    )
    if (marsh) {
      events.push({
        type: "epidemic",
        province: marsh.id,
        note: "Fever in the wetlands.",
      })
    }
  }
  if (state.turn % 5 === 4) {
    const hub = findProvince(state, "warsaw")
    if (hub) {
      events.push({
        type: "strike",
        province: hub.id,
        note: "Work gangs walk off the Warsaw yards.",
      })
    }
  }
  return events.slice(0, 2)
}

function narrate(
  state: GameState,
  orders: PlayerOrder[],
  proposals: Proposal[],
): string {
  const directive = orders
    .filter((order) => order.type === "text")
    .map((order) => order.text.trim())
    .filter(Boolean)
    .join(" ")
  const opening = directive
    ? `On ${state.date} the Central Powers directive reaches the staff: “${directive.slice(0, 320)}” Arrows and named orders are plotted; prose that names no province stays a wish.`
    : `On ${state.date} the Central Powers issue no written directive. Formations without an arrow hold their trenches.`

  const attacks = proposals.filter((proposal) => proposal.type === "attack")
  const russian = attacks
    .map((proposal) => findProvince(state, proposal.target)?.name)
    .filter((name): name is string => !!name)
  const second = russian.length
    ? `Stavka's orders point at ${list(russian)}. ${FACTION_LABEL.russia} can march only where the rails still feed them, and the dice still belong to the engine.`
    : "Stavka declines a general offensive. Fortress garrisons dig, and the depots at Warsaw and Rovno keep feeding whatever the railways can reach."

  return `${opening}\n\n${second}`
}

function list(names: string[]): string {
  const unique = [...new Set(names)]
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`
}
