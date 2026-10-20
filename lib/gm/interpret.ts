import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { attackerPower } from "@/lib/engine/combat"
import { findProvince } from "@/lib/engine/turn"
import { normalizeName } from "@/lib/format"
import type { GameState, PlayerOrder, Proposal, Province } from "@/lib/types"

export type InterpretedOrders = {
  proposals: Proposal[]
  notes: string[]
}

export function interpretOrders(
  state: GameState,
  orders: PlayerOrder[],
): InterpretedOrders {
  const proposals: Proposal[] = []
  const notes: string[] = []
  const claimed = new Set<string>()

  for (const order of orders) {
    if (order.type === "text") {
      const parsed = interpretText(state, order.text, claimed)
      proposals.push(...parsed.proposals)
      notes.push(...parsed.notes)
      continue
    }
    if (order.type === "fortify") {
      const province = findProvince(state, order.provinceId)
      if (!province) {
        notes.push("Fortify order names an unknown province.")
        continue
      }
      if (province.controller !== "central") {
        notes.push(`${province.name} is not yours to entrench.`)
        continue
      }
      proposals.push({ type: "fortify", province: province.id })
      continue
    }
    if (order.type === "recruit") {
      proposals.push({
        type: "recruit",
        faction: "central",
        province: order.provinceId,
        kind: order.unitKind,
      })
      continue
    }
    if (order.type === "cancelRecruit") {
      proposals.push({ type: "cancelRecruit", id: order.buildId })
      continue
    }
    if (order.type === "move") {
      const located = findUnit(state, order.unitId)
      if (!located) {
        notes.push("A move order names an unknown formation.")
        continue
      }
      if (located.unit.faction !== "central") {
        notes.push(`${located.unit.name} is not under your command.`)
        continue
      }
      if (claimed.has(located.unit.id)) {
        notes.push(`${located.unit.name} is already in the order stack.`)
        continue
      }
      claimed.add(located.unit.id)
      proposals.push({ type: "move", unit: located.unit.id, to: order.to })
      continue
    }

    const from = findProvince(state, order.from)
    if (!from) {
      notes.push("An attack order names an unknown province.")
      continue
    }
    let unitIds = order.unitIds.filter((id) => {
      const located = findUnit(state, id)
      return located?.province.id === from.id && located.unit.faction === "central"
    })
    if (!unitIds.length) {
      unitIds = from.units
        .filter((unit) => unit.faction === "central" && !claimed.has(unit.id))
        .map((unit) => unit.id)
    }
    unitIds = unitIds.filter((id) => !claimed.has(id))
    if (!unitIds.length) {
      notes.push(`${from.name} has no unassigned formation for that attack.`)
      continue
    }
    for (const id of unitIds) claimed.add(id)
    proposals.push({
      type: "attack",
      from: from.id,
      target: order.target,
      units: unitIds,
    })
  }

  return { proposals, notes }
}

function interpretText(
  state: GameState,
  text: string,
  claimed: Set<string>,
): InterpretedOrders {
  const proposals: Proposal[] = []
  const notes: string[] = []
  const lines = text
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) return { proposals, notes }

  for (const line of lines) {
    if (/^(hold|wait|no change)\b/i.test(line)) continue
    const move = line.match(
      /^(?:move|send|march)\s+(.+?)\s+to\s+(.+?)\.?$/i,
    )
    if (move) {
      const destination = findMentioned(state, move[2])[0]
      const units = findUnitsInText(state, move[1])
      if (!destination) {
        notes.push(`No province matches “${move[2].trim()}”.`)
        continue
      }
      const chosen = units.length
        ? units
        : fromProvinceUnits(state, move[1], claimed)
      if (!chosen.length) {
        notes.push(`No formation matches “${move[1].trim()}”.`)
        continue
      }
      for (const unit of chosen) {
        if (unit.faction !== "central") {
          notes.push(`${unit.name} is not under your command.`)
          continue
        }
        if (claimed.has(unit.id)) continue
        claimed.add(unit.id)
        proposals.push({ type: "move", unit: unit.id, to: destination.id })
      }
      continue
    }

    if (/\b(fortify|entrench|dig in)\b/i.test(line)) {
      const province = findMentioned(state, line).find(
        (item) => item.controller === "central",
      )
      if (!province) {
        notes.push(`Fortify needs one of your provinces: “${line}”.`)
        continue
      }
      proposals.push({ type: "fortify", province: province.id })
      continue
    }

    if (
      /\b(attack|assault|storm|seize|take)\b/i.test(line) ||
      /\b(advance|march)\s+on\b/i.test(line)
    ) {
      const mentioned = findMentioned(state, line)
      const target =
        mentioned.find((item) => item.controller !== "central") ??
        mentioned[0]
      if (!target) {
        notes.push(`No province matches the attack in “${line}”.`)
        continue
      }
      if (target.controller === "central") {
        notes.push(`${target.name} is already yours. Say where to move, or name an enemy province.`)
        continue
      }
      const originNamed = mentioned.find(
        (item) => item.id !== target.id && item.controller === "central",
      )
      const origin = originNamed ?? bestOrigin(state, target, claimed)
      if (!origin) {
        notes.push(
          `No supplied formation stands on the border of ${target.name}.`,
        )
        continue
      }
      const namedUnits = findUnitsInText(state, line).filter(
        (unit) => unit.faction === "central" && !claimed.has(unit.id),
      )
      const unitIds = (
        namedUnits.length
          ? namedUnits
          : origin.units.filter(
              (unit) => unit.faction === "central" && !claimed.has(unit.id),
            )
      ).map((unit) => unit.id)
      if (!unitIds.length) {
        notes.push(`${origin.name} has no unassigned formation.`)
        continue
      }
      for (const id of unitIds) claimed.add(id)
      proposals.push({
        type: "attack",
        from: origin.id,
        target: target.id,
        units: unitIds,
      })
      continue
    }

    if (findMentioned(state, line).length === 0 && findUnitsInText(state, line).length === 0) {
      notes.push(`The staff could not plot “${trimNote(line)}” onto the map. Name a province, or draw an arrow.`)
    }
  }

  return { proposals, notes }
}

function bestOrigin(
  state: GameState,
  target: Province,
  claimed: Set<string>,
): Province | undefined {
  let best: { province: Province; power: number } | undefined
  for (const id of target.neighbors) {
    const province = findProvince(state, id)
    if (!province || province.controller !== "central" || province.supply < 30) {
      continue
    }
    const units = province.units.filter(
      (unit) => unit.faction === "central" && !claimed.has(unit.id),
    )
    if (!units.length) continue
    const power = attackerPower(units, province.supply, target.terrain)
    if (!best || power > best.power) best = { province, power }
  }
  return best?.province
}

function fromProvinceUnits(
  state: GameState,
  text: string,
  claimed: Set<string>,
) {
  const origin = findMentioned(state, text).find(
    (province) => province.controller === "central",
  )
  if (!origin) return []
  return origin.units.filter(
    (unit) => unit.faction === "central" && !claimed.has(unit.id),
  )
}

function findMentioned(state: GameState, text: string): Province[] {
  const hay = ` ${normalizeName(text)} `
  const ranked = [...state.provinces].sort(
    (a, b) => b.name.length - a.name.length,
  )
  const found: Province[] = []
  for (const province of ranked) {
    const labels = [
      province.name,
      province.id,
      ...(CATALOG_BY_ID[province.id]?.aliases ?? []),
    ]
    if (labels.some((label) => hay.includes(` ${normalizeName(label)} `))) {
      found.push(province)
    }
  }
  return found
}

function findUnitsInText(state: GameState, text: string) {
  const hay = ` ${normalizeName(text)} `
  const units = state.provinces.flatMap((province) => province.units)
  return units.filter((unit) => {
    const name = normalizeName(unit.name)
    return hay.includes(` ${name} `) || hay.includes(` ${unit.id} `)
  })
}

function findUnit(state: GameState, id: string) {
  for (const province of state.provinces) {
    const unit = province.units.find((item) => item.id === id)
    if (unit) return { unit, province }
  }
  return undefined
}

function trimNote(line: string): string {
  return line.length > 80 ? `${line.slice(0, 77)}…` : line
}
