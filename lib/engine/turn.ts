import { applySupply } from "@/lib/data/scenario"
import {
  addPurse,
  projectIncome,
  RECRUIT,
  recruitmentYard,
  refund,
  reinforceFaction,
  pay,
  canAfford,
} from "@/lib/engine/economy"
import { decideFortnight, gradeLabel, noteCaptures } from "@/lib/engine/victory"
import { attackerPower, defenderPower, resolveCombat } from "@/lib/engine/combat"
import {
  fightingUnits,
  independentFormations,
  keptAfterHarm,
  partyOf,
  standingUnits,
} from "@/lib/engine/echelon"
import { decaySupplyModifier } from "@/lib/engine/supply"
import { clamp, FACTION_LABEL, scenarioDate, signed } from "@/lib/format"
import { makeRng, rollD6 } from "@/lib/rng"
import type {
  AttackProposal,
  ControlChange,
  EventResolution,
  Faction,
  FortifyProposal,
  GameEvent,
  GameState,
  GMTurn,
  CancelRecruitProposal,
  ModifyProposal,
  MoveProposal,
  Proposal,
  Province,
  RecruitProposal,
  Resolution,
  TurnRecord,
  Unit,
  UnitKind,
} from "@/lib/types"

export type ResolveOptions = {
  rng?: () => number
  notes?: string[]
  gmSource?: "mock" | "llm"
  warning?: string
}

const MODIFY_LIMIT = 20

export function resolveTurn(
  input: GameState,
  gm: GMTurn,
  options: ResolveOptions = {},
): { state: GameState; record: TurnRecord } {
  if (input.result) {
    return {
      state: structuredClone(input),
      record: decidedRecord(input, "The campaign is already decided."),
    }
  }
  const state = structuredClone(input)
  const beforeControl = new Map(
    state.provinces.map((province) => [province.id, province.controller]),
  )
  const beforeSupply = new Map(
    state.provinces.map((province) => [province.id, province.supply]),
  )

  for (const province of state.provinces) {
    province.supplyModifier = decaySupplyModifier(province.supplyModifier)
  }
  applySupply(state)

  const rng = options.rng ?? makeRng(state.seed + state.turn * 9973)
  const usedUnits = new Set<string>()
  const fortified = new Set<string>()
  const spent = {
    unrest: new Map<string, number>(),
    supply: new Map<string, number>(),
  }
  const resolutions: Resolution[] = []
  const attacked = new Set<string>()

  for (const proposal of gm.proposals) {
    if (proposal.type === "recruit" || proposal.type === "cancelRecruit") continue
    resolutions.push(
      applyProposal(state, proposal, usedUnits, fortified, spent, rng, attacked),
    )
  }

  const events: EventResolution[] = gm.events.map((event) =>
    applyEvent(state, event),
  )

  applySupply(state)

  const logistics: string[] = []
  for (const province of state.provinces) {
    if (province.controller !== province.owner) {
      province.unrest = clamp(province.unrest + 5, 0, 100)
    } else {
      province.unrest = clamp(province.unrest - 3, 0, 100)
    }
    if (province.supply < 25) {
      province.unrest = clamp(province.unrest + 4, 0, 100)
    }
    if (province.unrest >= 85 && province.units.length > 0) {
      for (const unit of fightingUnits(province.units)) {
        const loss = Math.min(4, unit.strength)
        if (unit.faction === "central") state.cpStrengthLost += loss
        unit.strength = Math.max(0, unit.strength - 4)
      }
      logistics.push(
        `${province.name} is near revolt. Formations there lose strength.`,
      )
    }
    const previous = beforeSupply.get(province.id) ?? province.supply
    if (previous >= 30 && province.supply < 30 && province.units.length > 0) {
      logistics.push(
        `${province.name} drops below supply 30. Its formations cannot advance next fortnight.`,
      )
    }
  }

  for (const province of state.provinces) {
    province.units = standingUnits(province.units)
    province.fort = clamp(Math.round(province.fort), 0, 3)
    province.unrest = clamp(Math.round(province.unrest), 0, 100)
    province.supply = clamp(Math.round(province.supply), 0, 100)
  }

  const controlChanges: ControlChange[] = []
  for (const province of state.provinces) {
    const previous = beforeControl.get(province.id)
    if (previous && previous !== province.controller) {
      controlChanges.push({
        provinceId: province.id,
        name: province.name,
        from: previous,
        to: province.controller,
      })
    }
  }

  for (const faction of ["central", "russia"] as const) {
    const income = projectIncome(state, faction)
    state.treasury[faction] = addPurse(state.treasury[faction], income)
    logistics.push(
      `${FACTION_LABEL[faction]} collect ${income.mp} manpower and ${income.ip} industry.`,
    )
  }
  logistics.push(...reinforceFaction(state, "central", attacked))
  logistics.push(...reinforceFaction(state, "russia", attacked))

  for (const proposal of gm.proposals) {
    if (proposal.type !== "recruit" && proposal.type !== "cancelRecruit") continue
    resolutions.push(applyProposal(state, proposal, usedUnits, fortified, spent, rng, attacked))
  }
  logistics.push(...advanceBuilds(state))

  noteCaptures(state)
  const decision = decideFortnight(state)
  if (decision) {
    state.result = decision
    logistics.push(
      `The campaign ends: ${gradeLabel(decision.grade)}. ${decision.reason} Score ${decision.score}.`,
    )
  }

  const record: TurnRecord = {
    turn: state.turn,
    date: state.date,
    narration: gm.narration,
    diplomacy: gm.diplomacy,
    resolutions,
    events,
    controlChanges,
    logistics,
    notes: options.notes ?? [],
    gmSource: options.gmSource ?? "mock",
    warning: options.warning,
  }

  if (!state.result) {
    state.turn += 1
    state.date = scenarioDate(state.scenario, state.turn)
  }
  return { state, record }
}

function decidedRecord(state: GameState, narration: string): TurnRecord {
  return {
    turn: state.turn,
    date: state.date,
    narration,
    diplomacy: [],
    resolutions: [],
    events: [],
    controlChanges: [],
    logistics: [],
    notes: [],
    gmSource: "mock",
  }
}

function applyProposal(
  state: GameState,
  proposal: Proposal,
  usedUnits: Set<string>,
  fortified: Set<string>,
  spent: { unrest: Map<string, number>; supply: Map<string, number> },
  rng: () => number,
  attacked: Set<string>,
): Resolution {
  switch (proposal.type) {
    case "move":
      return applyMove(state, proposal, usedUnits)
    case "attack":
      return applyAttack(state, proposal, usedUnits, rollD6(rng), attacked)
    case "fortify":
      return applyFortify(state, proposal, fortified)
    case "modify":
      return applyModify(state, proposal, spent)
    case "recruit":
      return applyRecruit(state, proposal)
    case "cancelRecruit":
      return applyCancelRecruit(state, proposal)
  }
}

export function applyMove(
  state: GameState,
  proposal: MoveProposal,
  usedUnits: Set<string>,
): Resolution {
  const located = findUnit(state, proposal.unit)
  if (!located) {
    return reject(proposal, "Unknown formation.")
  }
  const { unit, province } = located
  if (usedUnits.has(unit.id)) {
    return reject(proposal, `${unit.name} already has orders this fortnight.`)
  }
  const destination = findProvince(state, proposal.to)
  if (!destination) return reject(proposal, "Unknown destination.")
  if (!province.neighbors.includes(destination.id)) {
    return reject(
      proposal,
      `${province.name} and ${destination.name} do not share a border.`,
    )
  }
  if (destination.controller !== unit.faction) {
    return reject(
      proposal,
      `${unit.name} cannot enter ${destination.name}; it is held by ${FACTION_LABEL[destination.controller]}. Attack instead.`,
    )
  }
  if (province.supply < 30) {
    return reject(
      proposal,
      `${unit.name} cannot advance from ${province.name}: supply is ${province.supply} (need 30).`,
    )
  }

  const party = partyOf(province.units, [unit.id])
  if (party.some((member) => usedUnits.has(member.id))) {
    return reject(proposal, `${unit.name} already has orders this fortnight.`)
  }
  const leaving = new Set(party.map((member) => member.id))
  province.units = province.units.filter((item) => !leaving.has(item.id))
  destination.units.push(...party)
  for (const member of party) usedUnits.add(member.id)
  return {
    proposal,
    status: "applied",
    summary: `${unit.name} moves from ${province.name} to ${destination.name}.`,
  }
}

export function applyAttack(
  state: GameState,
  proposal: AttackProposal,
  usedUnits: Set<string>,
  roll: number,
  attacked: Set<string> = new Set(),
): Resolution {
  const from = findProvince(state, proposal.from)
  const target = findProvince(state, proposal.target)
  if (!from || !target) return reject(proposal, "Unknown province in the attack.")
  if (!proposal.units.length) {
    return reject(proposal, "Attack needs at least one formation.")
  }
  if (!from.neighbors.includes(target.id)) {
    return reject(
      proposal,
      `${from.name} and ${target.name} do not share a border.`,
    )
  }

  const named: Unit[] = []
  for (const id of proposal.units) {
    const unit = from.units.find((item) => item.id === id)
    if (!unit) {
      const elsewhere = findUnit(state, id)
      return reject(
        proposal,
        elsewhere
          ? `${elsewhere.unit.name} is not in ${from.name}.`
          : "Unknown formation in the attack.",
      )
    }
    named.push(unit)
  }
  const attackerParty = partyOf(from.units, named.map((unit) => unit.id))
  const busy = attackerParty.find((unit) => usedUnits.has(unit.id))
  if (busy) {
    return reject(proposal, `${busy.name} already has orders this fortnight.`)
  }

  const faction = named[0].faction
  if (attackerParty.some((unit) => unit.faction !== faction)) {
    return reject(proposal, "Those formations are not all of one side.")
  }
  if (target.controller === faction) {
    return reject(
      proposal,
      `${target.name} is already held by your side. Move instead.`,
    )
  }
  if (from.supply < 30) {
    return reject(
      proposal,
      `The attack from ${from.name} cannot march: supply is ${from.supply} (need 30).`,
    )
  }

  const defenderPool = target.units.filter((unit) => unit.faction === target.controller)
  const attackerBodies = fightingUnits(from.units, independentFormations(attackerParty))
  const defenderBodies = fightingUnits(defenderPool)
  const attack = attackerPower(attackerBodies, from.supply, target.terrain)
  const defense = defenderPower(
    defenderBodies,
    target.supply,
    target.terrain,
    target.fort,
  )
  const outcome = resolveCombat(attack, defense, roll)
  const attackerStrengthBefore = sumStrength(attackerBodies)
  const defenderStrengthBefore = sumStrength(defenderBodies)

  const survivingAttackers = keptAfterHarm(
    attackerParty,
    harm(attackerBodies, outcome.attackerLossFraction, outcome.attackerMoraleDelta),
  )
  const survivingDefenders = keptAfterHarm(
    defenderPool,
    harm(defenderBodies, outcome.defenderLossFraction, outcome.defenderMoraleDelta),
  )
  const attackerLoss = attackerStrengthBefore - sumStrength(fightingUnits(survivingAttackers))
  const defenderLoss = defenderStrengthBefore - sumStrength(fightingUnits(survivingDefenders))
  if (faction === "central") state.cpStrengthLost += attackerLoss
  if (target.controller === "central") state.cpStrengthLost += defenderLoss
  for (const unit of attackerParty) attacked.add(unit.id)

  const attackerIds = new Set(attackerParty.map((unit) => unit.id))
  const defenderIds = new Set(defenderPool.map((unit) => unit.id))
  from.units = from.units.filter((unit) => !attackerIds.has(unit.id))
  target.units = target.units.filter((unit) => !defenderIds.has(unit.id))

  const odds =
    outcome.defense <= 0
      ? "undefended"
      : `odds ${outcome.ratio.toFixed(2)} (roll ${outcome.roll})`

  if (outcome.attackerWins && survivingAttackers.length > 0) {
    const previous = target.controller
    let retreatSummary = "The garrison is destroyed."
    if (survivingDefenders.length > 0) {
      for (const unit of survivingDefenders) {
        if (survivingDefenders.some((other) => other.parentId === unit.id)) continue
        const shaken = Math.max(5, Math.round(unit.strength * 0.6))
        if (unit.faction === "central") state.cpStrengthLost += unit.strength - shaken
        unit.strength = shaken
      }
      const retreatTo = retreatDestination(state, target, previous, from.id)
      if (retreatTo) {
        retreatTo.units.push(...survivingDefenders)
        retreatSummary = `The remnants retreat to ${retreatTo.name}, shaken.`
      } else {
        retreatSummary = "No friendly province is open. The remnants are lost."
      }
    } else if (defenderBodies.length === 0) {
      retreatSummary = "The province was empty."
    }
    target.units.push(...survivingAttackers)
    target.controller = faction
    if (faction !== target.owner) target.unrest = clamp(target.unrest + 12, 0, 100)
    else target.unrest = clamp(target.unrest - 8, 0, 100)
    for (const unit of survivingAttackers) usedUnits.add(unit.id)
    return {
      proposal,
      status: "applied",
      summary: `Attack from ${from.name} into ${target.name} succeeds, ${odds}. ${target.name} passes to ${faction === "central" ? "the Central Powers" : "Russia"}. ${retreatSummary} Losses — attackers ${attackerLoss}, defenders ${defenderLoss}.`,
    }
  }

  from.units.push(...survivingAttackers)
  target.units.push(...survivingDefenders)
  for (const unit of survivingAttackers) usedUnits.add(unit.id)
  if (outcome.attackerWins && survivingAttackers.length === 0) {
    return {
      proposal,
      status: "applied",
      summary: `Attack from ${from.name} into ${target.name} breaks the line and then dies on it, ${odds}. No formation remains to occupy ${target.name}.`,
    }
  }
  return {
    proposal,
    status: "applied",
    summary: `Attack from ${from.name} into ${target.name} fails, ${odds}. ${target.name} holds. Losses — attackers ${attackerLoss}, defenders ${defenderLoss}.`,
  }
}

function harm(units: Unit[], fraction: number, moraleDelta: number): Unit[] {
  const survivors: Unit[] = []
  for (const unit of units) {
    const strength = Math.max(0, Math.round(unit.strength * (1 - fraction)))
    const morale = clamp(Math.round(unit.morale + moraleDelta), 0, 100)
    if (strength < 5 || morale <= 0) continue
    survivors.push({ ...unit, strength, morale })
  }
  return survivors
}

function retreatDestination(
  state: GameState,
  from: Province,
  faction: Faction,
  attackedFrom: string,
): Province | null {
  const options = from.neighbors
    .map((id) => findProvince(state, id))
    .filter(
      (province): province is Province =>
        !!province &&
        province.controller === faction &&
        province.id !== attackedFrom,
    )
  options.sort(
    (a, b) => b.supply - a.supply || a.name.localeCompare(b.name),
  )
  return options[0] ?? null
}

export function applyFortify(
  state: GameState,
  proposal: FortifyProposal,
  fortified: Set<string>,
): Resolution {
  const province = findProvince(state, proposal.province)
  if (!province) return reject(proposal, "Unknown province.")
  if (fortified.has(province.id)) {
    return reject(
      proposal,
      `${province.name} is already digging in this fortnight.`,
    )
  }
  const garrison = province.units.some(
    (unit) => unit.faction === province.controller,
  )
  if (!garrison) {
    return reject(proposal, `No fortifiable garrison in ${province.name}.`)
  }
  if (province.fort >= 3) {
    return reject(proposal, `${province.name} is already fortified to level 3.`)
  }
  if (province.supply < 40) {
    return reject(
      proposal,
      `${province.name} lacks the supply to dig (supply ${province.supply}, need 40).`,
    )
  }
  province.fort += 1
  fortified.add(province.id)
  return {
    proposal,
    status: "applied",
    summary: `${province.name} digs in. Fortification level is now ${province.fort}.`,
  }
}

/**
 * Modify deltas are clamped to ±20 per province per field per turn.
 * Supply changes adjust the stockpile modifier; the rail network still
 * recomputes the base. Unrest and the resulting fields stay inside 0–100.
 */
export function applyModify(
  state: GameState,
  proposal: ModifyProposal,
  spent: { unrest: Map<string, number>; supply: Map<string, number> },
): Resolution {
  const province = findProvince(state, proposal.province)
  if (!province) return reject(proposal, "Unknown province.")
  const bucket = spent[proposal.field]
  const already = bucket.get(province.id) ?? 0
  const next = clamp(already + proposal.delta, -MODIFY_LIMIT, MODIFY_LIMIT)
  const applied = next - already
  if (applied === 0) {
    return reject(
      proposal,
      `${label(proposal.field)} in ${province.name} has already changed by ${signed(already)} this fortnight (±20).`,
    )
  }

  let ceilingNote = ""
  if (proposal.field === "unrest") {
    const updated = clamp(province.unrest + applied, 0, 100)
    if (updated === province.unrest) {
      return reject(
        proposal,
        `Unrest in ${province.name} is already at ${province.unrest}.`,
      )
    }
    province.unrest = updated
  } else {
    const updated = clamp(province.supplyModifier + applied, -40, 40)
    const effective = updated - province.supplyModifier
    if (effective === 0) {
      return reject(
        proposal,
        `Supply stocks at ${province.name} cannot shift further (modifier ${signed(province.supplyModifier)}).`,
      )
    }
    province.supplyModifier = updated
    applySupply(state)
    if (effective !== applied) {
      ceilingNote = ` Stockpile cap held the change to ${signed(effective)}.`
    }
  }

  bucket.set(province.id, already + applied)
  const clampNote =
    applied !== proposal.delta
      ? ` Requested ${signed(proposal.delta)}, clamped to ${signed(applied)} (±20 per turn).`
      : ""
  const fieldLabel = proposal.field === "unrest" ? "Unrest" : "Supply"
  const value =
    proposal.field === "unrest" ? province.unrest : province.supply
  return {
    proposal,
    status: "applied",
    summary: `${fieldLabel} at ${province.name} ${proposal.reason ? `(${proposal.reason}) ` : ""}is now ${value}, change ${signed(applied)}.${clampNote}${ceilingNote}`,
  }
}

function applyEvent(state: GameState, event: GameEvent): EventResolution {
  const province = findProvince(state, event.province)
  if (!province) {
    return {
      event,
      status: "rejected",
      summary: `Event names an unknown province (${event.province}).`,
    }
  }
  const note = event.note ? ` ${event.note}` : ""

  switch (event.type) {
    case "partisans": {
      province.unrest = clamp(province.unrest + 15, 0, 100)
      const target = [...fightingUnits(province.units)].sort((a, b) => b.strength - a.strength)[0]
      if (target) {
        const loss = Math.min(8, target.strength)
        if (target.faction === "central") state.cpStrengthLost += loss
        target.strength = Math.max(0, target.strength - 8)
      }
      const hurt = target ? ` ${target.name} loses 8 strength.` : ""
      return {
        event,
        status: "applied",
        summary: `Partisans in ${province.name}. Unrest is now ${province.unrest}.${hurt}${note}`,
      }
    }
    case "strike": {
      province.supplyModifier = clamp(province.supplyModifier - 15, -40, 40)
      applySupply(state)
      return {
        event,
        status: "applied",
        summary: `A railway strike at ${province.name}. Supply is now ${province.supply}.${note}`,
      }
    }
    case "epidemic": {
      if (!province.units.length) {
        return {
          event,
          status: "rejected",
          summary: `No formations in ${province.name} to fall ill.`,
        }
      }
      for (const unit of province.units) {
        unit.morale = clamp(unit.morale - 12, 0, 100)
      }
      return {
        event,
        status: "applied",
        summary: `Sickness in ${province.name}. Morale falls.${note}`,
      }
    }
    case "breakthrough": {
      if (!province.units.length) {
        return {
          event,
          status: "rejected",
          summary: `No formations in ${province.name} to rally.`,
        }
      }
      for (const unit of province.units) {
        unit.morale = clamp(unit.morale + 8, 0, 100)
      }
      return {
        event,
        status: "applied",
        summary: `A local breakthrough at ${province.name}. The troops there take heart.${note}`,
      }
    }
  }
}

function applyRecruit(state: GameState, proposal: RecruitProposal): Resolution {
  const province = findProvince(state, proposal.province)
  if (!province) return reject(proposal, "Unknown province.")
  if (!recruitmentYard(province, proposal.faction)) {
    return reject(
      proposal,
      `${province.name} cannot raise troops for ${FACTION_LABEL[proposal.faction]}. Depots and home cities need supply 60.`,
    )
  }
  const cost = RECRUIT[proposal.kind]
  const purse = state.treasury[proposal.faction]
  if (!canAfford(purse, proposal.kind)) {
    return reject(
      proposal,
      `${FACTION_LABEL[proposal.faction]} cannot afford ${cost.label} (${cost.mp} manpower, ${cost.ip} industry).`,
    )
  }
  const pending = state.queue.filter(
    (job) => job.faction === proposal.faction && job.provinceId === province.id,
  )
  if (pending.length >= 2) {
    return reject(proposal, `${province.name} already has two formations in the yards.`)
  }
  state.treasury[proposal.faction] = pay(purse, proposal.kind)
  const job = {
    id: `${proposal.faction}-raise-${province.id}-${state.turn}-${proposal.kind}-${state.queue.length}`,
    faction: proposal.faction,
    provinceId: province.id,
    kind: proposal.kind,
    remaining: cost.turns,
    name: raisedName(province.name, proposal.kind, state.queue.length),
  }
  state.queue.push(job)
  const when = cost.turns === 1 ? "this fortnight closes" : "two fortnights"
  return {
    proposal,
    status: "applied",
    summary: `${FACTION_LABEL[proposal.faction]} raise ${job.name} at ${province.name}. It arrives when ${when}.`,
  }
}

function applyCancelRecruit(state: GameState, proposal: CancelRecruitProposal): Resolution {
  const index = state.queue.findIndex((job) => job.id === proposal.id)
  if (index < 0) return reject(proposal, "That formation is not in the yards.")
  const job = state.queue[index]
  state.queue.splice(index, 1)
  state.treasury[job.faction] = refund(state.treasury[job.faction], job.kind)
  return {
    proposal,
    status: "applied",
    summary: `${job.name} is cancelled at the yards. The manpower and industry are returned.`,
  }
}

function advanceBuilds(state: GameState): string[] {
  const notes: string[] = []
  const still = []
  for (const job of state.queue) {
    job.remaining -= 1
    if (job.remaining > 0) {
      still.push(job)
      continue
    }
    const province = findProvince(state, job.provinceId)
    if (!province || province.controller !== job.faction) {
      state.treasury[job.faction] = refund(state.treasury[job.faction], job.kind)
      notes.push(`${job.name} is lost with ${province?.name ?? "its yard"}. The stocks are returned.`)
      continue
    }
    const stats = RECRUIT[job.kind]
    province.units.push({
      id: job.id,
      name: job.name,
      faction: job.faction,
      strength: stats.strength,
      maxStrength: stats.strength,
      morale: stats.morale,
      kind: job.kind,
      echelon: job.echelon ?? "army",
      ...(job.parentId ? { parentId: job.parentId } : {}),
    })
    notes.push(`${job.name} arrives at ${province.name}.`)
  }
  state.queue = still
  return notes
}

function raisedName(province: string, kind: UnitKind, salt: number): string {
  const title =
    kind === "infantry" ? "Reserve Corps" : kind === "cavalry" ? "Reserve Cavalry" : "Heavy Artillery"
  return salt % 2 === 0 ? `${province} ${title}` : `${province} ${title} II`
}

function label(field: "unrest" | "supply"): string {
  return field === "unrest" ? "Unrest" : "Supply"
}

function reject(proposal: Proposal, summary: string): Resolution {
  return { proposal, status: "rejected", summary }
}

export function findProvince(
  state: GameState,
  id: string,
): Province | undefined {
  return state.provinces.find((province) => province.id === id)
}

export function findUnit(
  state: GameState,
  id: string,
): { unit: Unit; province: Province } | undefined {
  for (const province of state.provinces) {
    const unit = province.units.find((item) => item.id === id)
    if (unit) return { unit, province }
  }
  return undefined
}

function sumStrength(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + unit.strength, 0)
}

export function engagementOdds(
  state: GameState,
  fromId: string,
  targetId: string,
  unitIds: string[],
): { attack: number; defense: number; ratio: number; empty: boolean } | null {
  const from = findProvince(state, fromId)
  const target = findProvince(state, targetId)
  if (!from || !target) return null
  const attackers = fightingUnits(from.units, independentFormations(partyOf(from.units, unitIds)))
  const defenders = fightingUnits(
    target.units.filter((unit) => unit.faction === target.controller),
  )
  const attack = attackerPower(attackers, from.supply, target.terrain)
  const defense = defenderPower(
    defenders,
    target.supply,
    target.terrain,
    target.fort,
  )
  return {
    attack,
    defense,
    ratio: defense <= 0 ? Infinity : attack / Math.max(8, defense),
    empty: defenders.length === 0,
  }
}
