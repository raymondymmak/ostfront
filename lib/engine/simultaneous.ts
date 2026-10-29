import {
  attackerPower,
  defenderPower,
  ENCIRCLEMENT_DEFENDER_LOSS,
  flankMultiplier,
  resolveCombat,
  type CombatOutcome,
} from "@/lib/engine/combat"
import {
  fightingUnits,
  independentFormations,
  keptAfterHarm,
  partyOf,
} from "@/lib/engine/echelon"
import { clamp, FACTION_LABEL } from "@/lib/format"
import { rollD6 } from "@/lib/rng"
import type {
  AttackProposal,
  Faction,
  MoveProposal,
  Proposal,
  Province,
  Resolution,
  Unit,
} from "@/lib/types"

/**
 * A formation that attacks out of a province still leaves a rear guard.
 * The guard fights at half defensive strength. The column itself attacks
 * at full strength. Both losses are taken off the same formation afterwards.
 */
export const REAR_GUARD_FRACTION = 0.5

type Rng = () => number

type ValidMove = {
  ok: true
  kind: "move"
  key: string
  proposal: MoveProposal
  unit: Unit
  party: Unit[]
  from: Province
  to: Province
  faction: Faction
}

type ValidAttack = {
  ok: true
  kind: "attack"
  key: string
  proposal: AttackProposal
  party: Unit[]
  from: Province
  target: Province
  faction: Faction
}

type Prepared = ValidMove | ValidAttack | { ok: false; key: string; resolution: Resolution }

/**
 * Movement and attacks, resolved from one snapshot.
 * Fortify and modify have already been applied. Recruit has not.
 * Dice are drawn in battle-key order, never in proposal-array order.
 */
export function resolveManeuvers(
  state: { provinces: Province[]; cpStrengthLost: number },
  proposals: Proposal[],
  rng: Rng,
  attacked: Set<string>,
): Resolution[] {
  const supplyAtStart = new Map(state.provinces.map((province) => [province.id, province.supply]))
  const controllerAtStart = new Map(state.provinces.map((province) => [province.id, province.controller]))

  const prepared = proposals
    .filter((proposal): proposal is MoveProposal | AttackProposal => proposal.type === "move" || proposal.type === "attack")
    .map((proposal) => validate(state, proposal))

  const claimed = new Set<string>()
  const acceptedMoves: ValidMove[] = []
  const acceptedAttacks: ValidAttack[] = []
  const resolutions: Resolution[] = []

  const ordered = [...prepared].sort((a, b) => a.key.localeCompare(b.key))
  for (const item of ordered) {
    if (!item.ok) {
      resolutions.push(item.resolution)
      continue
    }
    const ids = item.party.map((unit) => unit.id)
    const busy = item.party.find((unit) => claimed.has(unit.id))
    if (busy) {
      resolutions.push(reject(item.proposal, `${busy.name} already has orders this fortnight.`))
      continue
    }
    for (const id of ids) claimed.add(id)
    if (item.kind === "move") acceptedMoves.push(item)
    else acceptedAttacks.push(item)
  }

  const moverIds = new Set(acceptedMoves.flatMap((move) => move.party.map((unit) => unit.id)))
  const attackerIds = new Set(acceptedAttacks.flatMap((attack) => attack.party.map((unit) => unit.id)))

  const meetingPairs = new Set<string>()
  for (const attack of acceptedAttacks) {
    const answered = acceptedAttacks.some(
      (other) => other.from.id === attack.target.id && other.target.id === attack.from.id,
    )
    if (answered) meetingPairs.add(pairKey(attack.from.id, attack.target.id))
  }

  const meetings: Meeting[] = []
  const inMeeting = new Set<ValidAttack>()
  for (const key of [...meetingPairs].sort()) {
    const [leftId, rightId] = key.split("|")
    const left = acceptedAttacks.filter((attack) => attack.from.id === leftId && attack.target.id === rightId)
    const right = acceptedAttacks.filter((attack) => attack.from.id === rightId && attack.target.id === leftId)
    for (const attack of [...left, ...right]) inMeeting.add(attack)
    meetings.push({ key: `meeting|${key}`, leftId, rightId, left, right })
  }

  const assaultGroups = new Map<string, ValidAttack[]>()
  for (const attack of acceptedAttacks) {
    if (inMeeting.has(attack)) continue
    const key = `${attack.faction}|${attack.target.id}`
    const list = assaultGroups.get(key) ?? []
    list.push(attack)
    assaultGroups.set(key, list)
  }

  const assaults: Assault[] = []
  const bounces: Bounce[] = []
  for (const [groupKey, prongs] of assaultGroups) {
    const target = prongs[0].target
    const defense = defenseBodies(target, moverIds, attackerIds)
    const friendlyMoves = acceptedMoves.filter(
      (move) => move.to.id === target.id && move.faction === target.controller,
    )
    if (defense.length === 0 && friendlyMoves.length > 0) {
      bounces.push({
        key: `bounce|${target.id}`,
        target,
        prongs,
        moves: friendlyMoves,
      })
      continue
    }
    assaults.push({
      key: `assault|${target.id}|${groupKey}`,
      target,
      faction: prongs[0].faction,
      prongs,
    })
  }

  const battles = [...meetings, ...assaults].sort((a, b) => a.key.localeCompare(b.key))
  const rolls = new Map<string, number>()
  for (const battle of battles) rolls.set(battle.key, rollD6(rng))

  const originals = new Map<string, { unit: Unit; provinceId: string }>()
  for (const province of state.provinces) {
    for (const unit of province.units) {
      originals.set(unit.id, { unit: structuredClone(unit), provinceId: province.id })
    }
  }

  type Hit = { loss: number; moraleDelta: number }
  const hits = new Map<string, Hit[]>()
  const addHit = (id: string, hit: Hit) => {
    const list = hits.get(id) ?? []
    list.push(hit)
    hits.set(id, list)
  }

  const attackOf = new Map<string, ValidAttack>()
  for (const attack of acceptedAttacks) {
    for (const unit of attack.party) attackOf.set(unit.id, attack)
  }
  const moveOf = new Map<string, ValidMove>()
  for (const move of acceptedMoves) {
    for (const unit of move.party) moveOf.set(unit.id, move)
  }

  const centralBefore = [...originals.values()]
    .filter((item) => item.unit.faction === "central")
    .reduce((sum, item) => sum + item.unit.strength, 0)
  const captures = new Map<string, Faction>()
  const battleLines: { key: string; resolution: Resolution }[] = []

  meetings.sort((a, b) => a.key.localeCompare(b.key))
  for (const meeting of meetings) {
    const roll = rolls.get(meeting.key) ?? 1
    const leftPower = sidePower(meeting.left)
    const rightPower = sidePower(meeting.right)
    const outcome = resolveCombat(leftPower, rightPower, roll)
    const leftBodies = meeting.left.flatMap((attack) => attackBodies(attack))
    const rightBodies = meeting.right.flatMap((attack) => attackBodies(attack))
    const leftHarm = applyHarm(leftBodies, outcome.attackerLossFraction, outcome.attackerMoraleDelta, addHit)
    const rightHarm = applyHarm(rightBodies, outcome.defenderLossFraction, outcome.defenderMoraleDelta, addHit)
    const leftLoss = strengthOf(leftBodies) - leftHarm.remaining
    const rightLoss = strengthOf(rightBodies) - rightHarm.remaining
    for (const attack of [...meeting.left, ...meeting.right]) {
      for (const unit of attack.party) attacked.add(unit.id)
    }
    const leftName = provinceName(state, meeting.leftId)
    const rightName = provinceName(state, meeting.rightId)
    const odds = Number.isFinite(outcome.ratio)
      ? `Odds ${outcome.ratio.toFixed(2)} for ${leftName} (roll ${outcome.roll}).`
      : `One column finds the other already gone (roll ${outcome.roll}).`
    const holder = outcome.attackerWins ? leftName : rightName
    const proposal = [...meeting.left, ...meeting.right].sort((a, b) => a.key.localeCompare(b.key))[0].proposal
    battleLines.push({
      key: meeting.key,
      resolution: {
        proposal,
        status: "applied",
        summary: `Meeting engagement between ${leftName} and ${rightName}. The columns clash in the open and both fall back. ${holder}'s column holds the field. ${odds} Losses — ${leftName} ${leftLoss}, ${rightName} ${rightLoss}.`,
      },
    })
  }

  type AssaultPlan = {
    assault: Assault
    outcome: CombatOutcome
    origins: string[]
    encircled: boolean
    attackerLoss: number
    defenderLoss: number
    stayerBodies: Unit[]
    rearBodies: Unit[]
    stayerParty: Unit[]
    odds: string
    title: string
  }
  const plans: AssaultPlan[] = []
  assaults.sort((a, b) => a.key.localeCompare(b.key))
  for (const assault of assaults) {
    const roll = rolls.get(assault.key) ?? 1
    const origins = [...new Set(assault.prongs.map((prong) => prong.from.id))].sort()
    let attack = 0
    const attackerBodyList: Unit[] = []
    for (const prong of [...assault.prongs].sort((a, b) => a.key.localeCompare(b.key))) {
      const bodies = attackBodies(prong)
      attackerBodyList.push(...bodies)
      attack += attackerPower(bodies, prong.from.supply, assault.target.terrain, assault.target.fort)
    }
    attack *= flankMultiplier(origins.length)
    const defenderPool = assault.target.units.filter((unit) => unit.faction === assault.target.controller)
    const fullBodies = fightingUnits(defenderPool)
    const virtual = defenseBodies(assault.target, moverIds, attackerIds)
    const defense = defenderPower(virtual, assault.target.supply, assault.target.terrain, assault.target.fort)
    const exitAtStart = retreatOptions(
      state,
      assault.target.id,
      assault.target.controller,
      origins,
      controllerAtStart,
      supplyAtStart,
      new Map(),
    )
    const encircled = origins.length > 1 && fullBodies.length > 0 && exitAtStart.length === 0
    let outcome = resolveCombat(attack, defense, roll)
    if (encircled) {
      outcome = {
        ...outcome,
        defenderLossFraction: Math.min(0.95, outcome.defenderLossFraction + ENCIRCLEMENT_DEFENDER_LOSS),
        defenderMoraleDelta: outcome.defenderMoraleDelta - 6,
      }
    }

    const stayerBodies = fullBodies.filter((unit) => !moverIds.has(unit.id) && !attackerIds.has(unit.id))
    const rearBodies = fullBodies.filter((unit) => attackerIds.has(unit.id))
    const attackerHarm = applyHarm(
      attackerBodyList,
      outcome.attackerLossFraction,
      outcome.attackerMoraleDelta,
      addHit,
    )
    const stayerHarm = applyHarm(stayerBodies, outcome.defenderLossFraction, outcome.defenderMoraleDelta, addHit)
    let rearLoss = 0
    for (const unit of rearBodies) {
      const original = originals.get(unit.id)
      if (!original) continue
      const taken = Math.min(
        original.unit.strength,
        Math.round(original.unit.strength * REAR_GUARD_FRACTION * outcome.defenderLossFraction),
      )
      if (taken > 0 || outcome.defenderMoraleDelta !== 0) {
        addHit(unit.id, { loss: taken, moraleDelta: outcome.defenderMoraleDelta })
      }
      rearLoss += taken
    }

    for (const prong of assault.prongs) {
      for (const unit of prong.party) attacked.add(unit.id)
    }
    plans.push({
      assault,
      outcome,
      origins,
      encircled,
      attackerLoss: strengthOf(attackerBodyList) - attackerHarm.remaining,
      defenderLoss: strengthOf(stayerBodies) - stayerHarm.remaining + rearLoss,
      stayerBodies,
      rearBodies,
      stayerParty: defenderPool.filter((unit) => !moverIds.has(unit.id) && !attackerIds.has(unit.id)),
      odds: outcome.defense <= 0 ? "undefended" : `odds ${outcome.ratio.toFixed(2)} (roll ${outcome.roll})`,
      title: attackTitle(assault.prongs),
    })
  }

  for (const plan of plans) {
    const occupying = plan.assault.prongs.some((prong) => survivorsOf(prong.party, originals, hits).length > 0)
    if (plan.outcome.attackerWins && occupying) captures.set(plan.assault.target.id, plan.assault.faction)
  }
  for (const plan of plans) {
    if (captures.get(plan.assault.target.id) !== plan.assault.faction) continue
    const stayerSurvivors = survivorsOf(plan.stayerParty, originals, hits)
    shake(stayerSurvivors, hits)
  }
  for (const plan of plans) {
    const occupying = plan.assault.prongs.some((prong) => survivorsOf(prong.party, originals, hits).length > 0)
    const wins = plan.outcome.attackerWins && captures.get(plan.assault.target.id) === plan.assault.faction
    const stayerSurvivors = survivorsOf(plan.stayerParty, originals, hits)
    const proposal = [...plan.assault.prongs].sort((a, b) => a.key.localeCompare(b.key))[0].proposal
    battleLines.push({
      key: plan.assault.key,
      resolution: {
        proposal,
        status: "applied",
        summary: assaultSummary({
          title: plan.title,
          target: plan.assault.target,
          faction: plan.assault.faction,
          odds: plan.odds,
          outcome: plan.outcome,
          wins,
          occupying,
          attackerLoss: plan.attackerLoss,
          defenderLoss: plan.defenderLoss,
          encircled: plan.encircled,
          stayerBodies: plan.stayerBodies,
          rearBodies: plan.rearBodies,
          stayerSurvivors,
          exitName: exitNameAfter(
            state,
            plan.assault.target.id,
            plan.assault.target.controller,
            plan.origins,
            controllerAtStart,
            supplyAtStart,
            captures,
          ),
        }),
      },
    })
  }

  for (const bounce of bounces) {
    const fromNames = [...new Set(bounce.prongs.map((prong) => prong.from.name))].sort((a, b) => a.localeCompare(b, "en"))
    const moveNames = [...new Set(bounce.moves.map((move) => move.from.name))].sort((a, b) => a.localeCompare(b, "en"))
    const attackers = bounce.prongs[0].faction
    const defender = bounce.target.controller
    const proposal = [...bounce.prongs].sort((a, b) => a.key.localeCompare(b.key))[0].proposal
    battleLines.push({
      key: bounce.key,
      resolution: {
        proposal,
        status: "applied",
        summary: `Bounce at ${bounce.target.name}. ${FACTION_LABEL[attackers]} from ${list(fromNames)} and ${FACTION_LABEL[defender]} from ${list(moveNames)} march on the empty province in the same fortnight. Neither column gets in, and both fall back.`,
      },
    })
    for (const move of bounce.moves) {
      battleLines.push({
        key: `${move.key}|bounce`,
        resolution: {
          proposal: move.proposal,
          status: "applied",
          summary: `${move.unit.name} moves from ${move.from.name} toward ${move.to.name}, but the other side is marching there too. The column falls back to ${move.from.name}.`,
        },
      })
    }
  }

  const bouncedMoves = new Set(bounces.flatMap((bounce) => bounce.moves.map((move) => move.key)))
  const finalUnits = new Map<string, Unit | null>()
  for (const [id, original] of originals) {
    finalUnits.set(id, materialize(original.unit, hits.get(id) ?? []))
  }

  const buckets = new Map<string, Unit[]>(state.provinces.map((province) => [province.id, []]))
  for (const [id, original] of originals) {
    const unit = finalUnits.get(id)
    if (!unit) continue
    const dest = destinationOf({
      id,
      faction: original.unit.faction,
      home: original.provinceId,
      attack: attackOf.get(id),
      move: moveOf.get(id),
      inMeeting: attackOf.get(id) ? inMeeting.has(attackOf.get(id)!) : false,
      bounced:
        (attackOf.get(id) ? bounces.some((bounce) => bounce.prongs.includes(attackOf.get(id)!)) : false) ||
        (moveOf.get(id) ? bounces.some((bounce) => bounce.moves.includes(moveOf.get(id)!)) : false),
      captures,
      controllerAtStart,
      supplyAtStart,
      state,
      partyAlive: (attack) => survivorsOf(attack.party, originals, hits).some((member) => member.id === id),
    })
    if (!dest) continue
    buckets.get(dest)?.push(unit)
  }

  const centralAfter = [...buckets.values()]
    .flat()
    .filter((unit) => unit.faction === "central")
    .reduce((sum, unit) => sum + unit.strength, 0)
  state.cpStrengthLost += Math.max(0, centralBefore - centralAfter)

  for (const province of state.provinces) {
    province.units = buckets.get(province.id) ?? []
    const taken = captures.get(province.id)
    if (!taken) continue
    province.controller = taken
    if (taken !== province.owner) province.unrest = clamp(province.unrest + 12, 0, 100)
    else province.unrest = clamp(province.unrest - 8, 0, 100)
  }

  for (const move of acceptedMoves) {
    if (bouncedMoves.has(move.key)) continue
    const arrived = move.party.some((unit) => buckets.get(move.to.id)?.some((item) => item.id === unit.id))
    const backHome = move.party.some((unit) => buckets.get(move.from.id)?.some((item) => item.id === unit.id))
    const passing = acceptedMoves.find(
      (other) =>
        other.key !== move.key &&
        other.from.id === move.to.id &&
        other.to.id === move.from.id &&
        other.faction === move.faction &&
        !bouncedMoves.has(other.key) &&
        other.party.some((unit) => buckets.get(move.from.id)?.some((item) => item.id === unit.id)),
    )
    let summary: string
    if (arrived) {
      const pass = passing ? `, passing ${passing.unit.name} on the road` : ""
      summary = `${move.unit.name} moves from ${move.from.name} to ${move.to.name}${pass}.`
    } else if (backHome) {
      summary = `${move.unit.name} moves from ${move.from.name} toward ${move.to.name}, but ${move.to.name} falls this fortnight. The column falls back to ${move.from.name}.`
    } else {
      summary = `${move.unit.name} moves from ${move.from.name} toward ${move.to.name}, but the province behind the column is lost as well. No friendly province is open. The column is lost.`
    }
    battleLines.push({
      key: move.key,
      resolution: { proposal: move.proposal, status: "applied", summary },
    })
  }

  battleLines.sort((a, b) => a.key.localeCompare(b.key))
  resolutions.push(...battleLines.map((line) => line.resolution))
  resolutions.sort((a, b) => resolutionKey(a).localeCompare(resolutionKey(b)))
  return resolutions
}

function resolutionKey(resolution: Resolution): string {
  const proposal = resolution.proposal
  if (proposal.type === "move") return `move|${proposal.to}|${proposal.unit}|${resolution.status}`
  if (proposal.type === "attack") {
    return `attack|${proposal.target}|${proposal.from}|${[...proposal.units].sort().join(",")}|${resolution.status}|${resolution.summary.slice(0, 24)}`
  }
  return `${proposal.type}|${resolution.summary}`
}

type Meeting = {
  key: string
  leftId: string
  rightId: string
  left: ValidAttack[]
  right: ValidAttack[]
}

type Assault = {
  key: string
  target: Province
  faction: Faction
  prongs: ValidAttack[]
}

type Bounce = {
  key: string
  target: Province
  prongs: ValidAttack[]
  moves: ValidMove[]
}

function validate(state: { provinces: Province[] }, proposal: MoveProposal | AttackProposal): Prepared {
  if (proposal.type === "move") return validateMove(state, proposal)
  return validateAttack(state, proposal)
}

function validateMove(state: { provinces: Province[] }, proposal: MoveProposal): Prepared {
  const key = `move|${proposal.to}|${proposal.unit}`
  const located = findUnit(state, proposal.unit)
  if (!located) return { ok: false, key, resolution: reject(proposal, "Unknown formation.") }
  const { unit, province } = located
  const destination = findProvince(state, proposal.to)
  if (!destination) return { ok: false, key, resolution: reject(proposal, "Unknown destination.") }
  if (!province.neighbors.includes(destination.id)) {
    return {
      ok: false,
      key,
      resolution: reject(proposal, `${province.name} and ${destination.name} do not share a border.`),
    }
  }
  if (destination.controller !== unit.faction) {
    return {
      ok: false,
      key,
      resolution: reject(
        proposal,
        `${unit.name} cannot enter ${destination.name}; it is held by ${FACTION_LABEL[destination.controller]}. Attack instead.`,
      ),
    }
  }
  if (province.supply < 30) {
    return {
      ok: false,
      key,
      resolution: reject(
        proposal,
        `${unit.name} cannot advance from ${province.name}: supply is ${province.supply} (need 30).`,
      ),
    }
  }
  const party = partyOf(province.units, [unit.id])
  return { ok: true, kind: "move", key, proposal, unit, party, from: province, to: destination, faction: unit.faction }
}

function validateAttack(state: { provinces: Province[] }, proposal: AttackProposal): Prepared {
  const key = `attack|${proposal.target}|${proposal.from}|${[...proposal.units].sort().join(",")}`
  const from = findProvince(state, proposal.from)
  const target = findProvince(state, proposal.target)
  if (!from || !target) return { ok: false, key, resolution: reject(proposal, "Unknown province in the attack.") }
  if (!proposal.units.length) return { ok: false, key, resolution: reject(proposal, "Attack needs at least one formation.") }
  if (!from.neighbors.includes(target.id)) {
    return {
      ok: false,
      key,
      resolution: reject(proposal, `${from.name} and ${target.name} do not share a border.`),
    }
  }
  const named: Unit[] = []
  for (const id of proposal.units) {
    const unit = from.units.find((item) => item.id === id)
    if (!unit) {
      const elsewhere = findUnit(state, id)
      return {
        ok: false,
        key,
        resolution: reject(
          proposal,
          elsewhere ? `${elsewhere.unit.name} is not in ${from.name}.` : "Unknown formation in the attack.",
        ),
      }
    }
    named.push(unit)
  }
  const party = partyOf(from.units, named.map((unit) => unit.id))
  const faction = named[0].faction
  if (party.some((unit) => unit.faction !== faction)) {
    return { ok: false, key, resolution: reject(proposal, "Those formations are not all of one side.") }
  }
  if (target.controller === faction) {
    return {
      ok: false,
      key,
      resolution: reject(proposal, `${target.name} is already held by your side. Move instead.`),
    }
  }
  if (from.supply < 30) {
    return {
      ok: false,
      key,
      resolution: reject(proposal, `The attack from ${from.name} cannot march: supply is ${from.supply} (need 30).`),
    }
  }
  return { ok: true, kind: "attack", key, proposal, party, from, target, faction }
}

function attackBodies(attack: ValidAttack): Unit[] {
  return fightingUnits(attack.from.units, independentFormations(attack.party))
}

function sidePower(attacks: ValidAttack[]): number {
  let power = 0
  for (const attack of attacks) {
    power += attackerPower(attackBodies(attack), attack.from.supply, "plains", 0)
  }
  return power
}

function defenseBodies(province: Province, moverIds: Set<string>, attackerIds: Set<string>): Unit[] {
  const pool = province.units.filter((unit) => unit.faction === province.controller)
  const bodies = fightingUnits(pool)
  const virtual: Unit[] = []
  for (const unit of bodies) {
    if (moverIds.has(unit.id)) continue
    if (attackerIds.has(unit.id)) {
      virtual.push({ ...unit, strength: unit.strength * REAR_GUARD_FRACTION })
      continue
    }
    virtual.push(unit)
  }
  return virtual
}

function applyHarm(
  bodies: Unit[],
  fraction: number,
  moraleDelta: number,
  addHit: (id: string, hit: { loss: number; moraleDelta: number }) => void,
): { remaining: number } {
  let remaining = 0
  for (const unit of bodies) {
    const harmed = harmOne(unit, fraction, moraleDelta)
    if (!harmed) {
      addHit(unit.id, { loss: unit.strength, moraleDelta })
      continue
    }
    addHit(unit.id, { loss: unit.strength - harmed.strength, moraleDelta: harmed.morale - unit.morale })
    remaining += harmed.strength
  }
  return { remaining }
}

function harmOne(unit: Unit, fraction: number, moraleDelta: number): Unit | null {
  const strength = Math.max(0, Math.round(unit.strength * (1 - fraction)))
  const morale = clamp(Math.round(unit.morale + moraleDelta), 0, 100)
  if (strength < 5 || morale <= 0) return null
  return { ...unit, strength, morale }
}

function materialize(original: Unit, hits: { loss: number; moraleDelta: number }[]): Unit | null {
  if (!hits.length) return structuredClone(original)
  let strength = original.strength
  let morale = original.morale
  for (const hit of hits) {
    strength -= hit.loss
    morale = clamp(Math.round(morale + hit.moraleDelta), 0, 100)
    if (strength < 5 || morale <= 0) return null
  }
  return { ...original, strength, morale }
}

function survivorsOf(
  party: readonly Unit[],
  originals: Map<string, { unit: Unit; provinceId: string }>,
  hits: Map<string, { loss: number; moraleDelta: number }[]>,
): Unit[] {
  const harmed: Unit[] = []
  for (const unit of party) {
    const original = originals.get(unit.id)?.unit ?? unit
    const next = materialize(original, hits.get(unit.id) ?? [])
    if (next) harmed.push(next)
  }
  return keptAfterHarm(party, harmed)
}

function shake(survivors: Unit[], hits: Map<string, { loss: number; moraleDelta: number }[]>): void {
  for (const unit of survivors) {
    if (survivors.some((other) => other.parentId === unit.id)) continue
    const shaken = Math.max(5, Math.round(unit.strength * 0.45))
    const loss = unit.strength - shaken
    if (loss <= 0) continue
    const list = hits.get(unit.id) ?? []
    list.push({ loss, moraleDelta: 0 })
    hits.set(unit.id, list)
  }
}

function destinationOf(args: {
  id: string
  faction: Faction
  home: string
  attack: ValidAttack | undefined
  move: ValidMove | undefined
  inMeeting: boolean
  bounced: boolean
  captures: Map<string, Faction>
  controllerAtStart: Map<string, Faction>
  supplyAtStart: Map<string, number>
  state: { provinces: Province[] }
  partyAlive: (attack: ValidAttack) => boolean
}): string | null {
  const friendly = (provinceId: string) => {
    const taken = args.captures.get(provinceId)
    const controller = taken ?? args.controllerAtStart.get(provinceId)
    return controller === args.faction
  }
  const retreat = (fromId: string, blocked: string[]) => {
    const options = retreatOptions(
      args.state,
      fromId,
      args.faction,
      blocked,
      args.controllerAtStart,
      args.supplyAtStart,
      args.captures,
    )
    return options[0]?.id ?? null
  }

  if (args.attack && (args.inMeeting || args.bounced)) {
    if (friendly(args.home)) return args.home
    return retreat(args.home, [args.attack.target.id])
  }
  if (args.move && args.bounced) {
    if (friendly(args.home)) return args.home
    return retreat(args.home, [args.move.to.id])
  }
  if (args.attack && args.captures.get(args.attack.target.id) === args.faction && args.partyAlive(args.attack)) {
    return args.attack.target.id
  }
  if (args.attack) {
    if (friendly(args.home)) return args.home
    return retreat(args.home, [args.attack.target.id])
  }
  if (args.move) {
    if (friendly(args.move.to.id)) return args.move.to.id
    if (friendly(args.home)) return args.home
    return retreat(args.home, [args.move.to.id])
  }
  const capturedBy = args.captures.get(args.home)
  if (!capturedBy || capturedBy === args.faction) return args.home
  return retreat(args.home, [])
}

function retreatOptions(
  state: { provinces: Province[] },
  fromId: string,
  faction: Faction,
  blocked: readonly string[],
  controllerAtStart: Map<string, Faction>,
  supplyAtStart: Map<string, number>,
  captures: Map<string, Faction>,
): Province[] {
  const from = findProvince(state, fromId)
  if (!from) return []
  const closed = new Set(blocked)
  const options = from.neighbors
    .map((id) => findProvince(state, id))
    .filter((province): province is Province => {
      if (!province || closed.has(province.id)) return false
      const controller = captures.get(province.id) ?? controllerAtStart.get(province.id)
      return controller === faction
    })
  options.sort(
    (a, b) =>
      (supplyAtStart.get(b.id) ?? 0) - (supplyAtStart.get(a.id) ?? 0) || a.name.localeCompare(b.name, "en"),
  )
  return options
}

function exitNameAfter(
  state: { provinces: Province[] },
  fromId: string,
  faction: Faction,
  blocked: string[],
  controllerAtStart: Map<string, Faction>,
  supplyAtStart: Map<string, number>,
  captures: Map<string, Faction>,
): string | null {
  return retreatOptions(state, fromId, faction, blocked, controllerAtStart, supplyAtStart, captures)[0]?.name ?? null
}

function assaultSummary(args: {
  title: string
  target: Province
  faction: Faction
  odds: string
  outcome: CombatOutcome
  wins: boolean
  occupying: boolean
  attackerLoss: number
  defenderLoss: number
  encircled: boolean
  stayerBodies: Unit[]
  rearBodies: Unit[]
  stayerSurvivors: Unit[]
  exitName: string | null
}): string {
  const { title, target, faction, odds, outcome, attackerLoss, defenderLoss, encircled } = args
  const holder = faction === "central" ? "the Central Powers" : "Russia"
  if (outcome.attackerWins && args.occupying && args.wins) {
    let retreatSummary = "The garrison is destroyed."
    if (args.stayerBodies.length === 0 && args.rearBodies.length === 0) {
      retreatSummary = "The province was empty."
    } else if (args.stayerBodies.length === 0 && args.rearBodies.length > 0) {
      retreatSummary = "The garrison had already marched. The rear guard could not hold the province."
    } else if (args.stayerSurvivors.length > 0) {
      if (args.exitName) retreatSummary = `The remnants retreat to ${args.exitName}, shaken.`
      else if (encircled) {
        retreatSummary = "The defenders are surrounded. No friendly province is open. The remnants are lost."
      } else retreatSummary = "No friendly province is open. The remnants are lost."
    } else if (encircled) {
      retreatSummary = "The defenders are surrounded. The garrison is destroyed."
    }
    return `${title} into ${target.name} succeeds, ${odds}. ${target.name} passes to ${holder}. ${retreatSummary} Losses — attackers ${attackerLoss}, defenders ${defenderLoss}.`
  }
  if (outcome.attackerWins && !args.wins) {
    return `${title} into ${target.name} breaks the line and then dies on it, ${odds}. No formation remains to occupy ${target.name}.`
  }
  const surrounded = encircled ? " The defenders were surrounded." : ""
  return `${title} into ${target.name} fails, ${odds}. ${target.name} holds.${surrounded} Losses — attackers ${attackerLoss}, defenders ${defenderLoss}.`
}

function attackTitle(prongs: ValidAttack[]): string {
  const names = [...new Set(prongs.map((prong) => prong.from.name))].sort((a, b) => a.localeCompare(b, "en"))
  if (names.length <= 1) return `Attack from ${names[0] ?? "the line"}`
  if (names.length === 2) return `Two-pronged attack from ${names[0]} and ${names[1]}`
  const head = names.slice(0, -1).join(", ")
  return `Concentric attack from ${head} and ${names[names.length - 1]}`
}

function strengthOf(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + unit.strength, 0)
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function provinceName(state: { provinces: Province[] }, id: string): string {
  return findProvince(state, id)?.name ?? id
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "their lines"
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
}

function reject(proposal: Proposal, summary: string): Resolution {
  return { proposal, status: "rejected", summary }
}

function findProvince(state: { provinces: Province[] }, id: string): Province | undefined {
  return state.provinces.find((province) => province.id === id)
}

function findUnit(
  state: { provinces: Province[] },
  id: string,
): { unit: Unit; province: Province } | undefined {
  for (const province of state.provinces) {
    const unit = province.units.find((item) => item.id === id)
    if (unit) return { unit, province }
  }
  return undefined
}
