import type { Echelon, Unit } from "@/lib/types"

/**
 * Units in a province are one list, linked by `parentId`.
 * Today's formations are armies and have no parent, so every helper below
 * returns that same list and the same strength.
 *
 * When a corps or division is added under an army:
 * - a child whose parent is in the same list is not a second formation
 * - fighting strength sits on the children; the parent's own strength is the
 *   command rollup and is not added again
 * - a child whose parent is elsewhere fights on its own, which is how a
 *   later order can detach one echelon without rewriting combat
 */
export function echelonOf(unit: Unit): Echelon {
  return unit.echelon ?? "army"
}

export function childUnits(units: readonly Unit[], parentId: string): Unit[] {
  return units.filter((unit) => unit.parentId === parentId)
}

export function descendantUnits(units: readonly Unit[], rootId: string): Unit[] {
  return childUnits(units, rootId).flatMap((child) => [child, ...descendantUnits(units, child.id)])
}

/** Formations that can be ordered. Subordinates of a present parent are not. */
export function independentFormations(units: readonly Unit[]): Unit[] {
  const ids = new Set(units.map((unit) => unit.id))
  return units.filter((unit) => !unit.parentId || !ids.has(unit.parentId))
}

/** Where the strength of one formation actually lives. */
export function strengthHolders(units: readonly Unit[], unit: Unit): Unit[] {
  const children = childUnits(units, unit.id)
  if (!children.length) return [unit]
  return children.flatMap((child) => strengthHolders(units, child))
}

/**
 * Bodies combat, refit, and the strength counter add up.
 * `roots` limits the sum to formations the order actually named.
 */
export function fightingUnits(units: readonly Unit[], roots?: readonly Unit[]): Unit[] {
  const selected = roots ?? independentFormations(units)
  return selected.flatMap((unit) => strengthHolders(units, unit))
}

export function formationStrength(units: readonly Unit[], unit: Unit): number {
  return strengthHolders(units, unit).reduce((sum, holder) => sum + holder.strength, 0)
}

export function listedStrength(units: readonly Unit[]): number {
  return fightingUnits(units).reduce((sum, unit) => sum + unit.strength, 0)
}

/** The named formations plus subordinates standing in the same list. */
export function partyOf(units: readonly Unit[], ids: readonly string[]): Unit[] {
  const wanted = new Set(ids)
  for (const id of ids) {
    for (const descendant of descendantUnits(units, id)) wanted.add(descendant.id)
  }
  return units.filter((unit) => wanted.has(unit.id))
}

/** A command node stays on the map while it still has children. */
export function standingUnits(units: readonly Unit[]): Unit[] {
  return units.filter((unit) => {
    if (childUnits(units, unit.id).length > 0) return true
    return unit.strength >= 5 && unit.morale > 0
  })
}

/**
 * Harm is applied to strength holders. A parent is kept, unharmed, when any
 * subordinate survives, so the link is not thrown away with the casualties.
 */
export function keptAfterHarm(party: readonly Unit[], harmed: readonly Unit[]): Unit[] {
  const harmedById = new Map(harmed.map((unit) => [unit.id, unit]))
  const alive = new Set(harmed.map((unit) => unit.id))
  return party.flatMap((unit) => {
    const next = harmedById.get(unit.id)
    if (next) return [next]
    const descendants = descendantUnits(party, unit.id)
    if (descendants.some((child) => alive.has(child.id))) return [unit]
    return []
  })
}
