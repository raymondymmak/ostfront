import { independentFormations, partyOf } from "@/lib/engine/echelon"
import { lowSupplyMarchWarning, mergeOrderWarnings } from "@/lib/ui/order-warnings"
import { assessManeuvers } from "@/lib/engine/simultaneous"
import { findProvince, maneuverReservations } from "@/lib/engine/turn"
import { leaveDepotGarrison, type QueuedOrder } from "@/lib/orders"
import type { AttackProposal, GameState, MoveProposal, Province } from "@/lib/types"
import type { LegalTargets } from "@/lib/ui/types"

export type MarchPreview =
  | { ok: true; kind: "move" | "attack"; unitIds: string[]; warning: string | null }
  | { ok: false; hover: string }

type MarchState = Pick<GameState, "provinces" | "treasury">

/**
 * Legality for a drag that has not been released.
 * The yes/no comes from `assessManeuvers` (the resolver's own check).
 * A refusal is the short hover line, and the caller must not draw or queue the arrow.
 */
export function previewMarch(
  state: MarchState,
  queue: QueuedOrder[],
  fromId: string,
  toId: string,
  options?: { unitId?: string; commitAll?: boolean; reserved?: ReadonlySet<string> },
): MarchPreview {
  const from = state.provinces.find((province) => province.id === fromId)
  const to = state.provinces.find((province) => province.id === toId)
  if (!from || !to) return { ok: false, hover: "Unknown province." }
  if (from.controller !== "central") {
    return { ok: false, hover: "Stavka does not take your arrows. Start in a Central Powers province." }
  }
  if (fromId === toId) {
    const unit = options?.unitId ? from.units.find((item) => item.id === options.unitId) : undefined
    return { ok: false, hover: `${unit?.name ?? from.name} is already in ${from.name}.` }
  }

  const reserved = options?.reserved ?? maneuverReservations(state, fortifyProposals(queue))
  const claimed = claimedUnits(queue)
  if (options?.unitId) claimed.delete(options.unitId)

  if (options?.unitId) {
    const unit = from.units.find((item) => item.id === options.unitId)
    if (!unit) return { ok: false, hover: "Unknown formation." }
    if (!independentFormations(from.units).some((item) => item.id === unit.id)) {
      return { ok: false, hover: "That formation is under another command." }
    }
    if (unit.faction !== "central") {
      return { ok: false, hover: "Only Central Powers formations take your orders." }
    }
    const proposal = marchProposal(fromId, toId, [unit.id], to.controller === unit.faction)
    const verdict = assessManeuvers(state, [proposal], reserved, claimed)
    if (!verdict.ok) return { ok: false, hover: verdict.hover }
    return {
      ok: true,
      kind: proposal.type,
      unitIds: [unit.id],
      warning: mergeOrderWarnings(
        depotWarning(from, [unit.id], claimed, "order"),
        lowSupplyMarchWarning(from),
      ),
    }
  }

  const available = independentFormations(
    from.units.filter((unit) => unit.faction === "central" && !claimed.has(unit.id) && !reserved.has(unit.id)),
  )
  if (!available.length) {
    const any = independentFormations(from.units.filter((unit) => unit.faction === "central"))
    if (!any.length) return { ok: false, hover: `${from.name} has no unassigned formation.` }
    const sample = any[0]
    const proposal = marchProposal(fromId, toId, [sample.id], to.controller === sample.faction)
    const verdict = assessManeuvers(state, [proposal], reserved, claimed)
    return { ok: false, hover: verdict.ok ? `${from.name} has no unassigned formation.` : verdict.hover }
  }

  const chosen = leaveDepotGarrison(available, from.depot === "central", options?.commitAll ?? false)
  const ids = chosen.map((unit) => unit.id)
  const friendly = to.controller === "central"
  const proposals = friendly
    ? ids.map((id) => marchProposal(fromId, toId, [id], true))
    : [marchProposal(fromId, toId, ids, false)]
  const verdict = assessManeuvers(state, proposals, reserved, claimed)
  if (!verdict.ok) return { ok: false, hover: verdict.hover }
  return {
    ok: true,
    kind: to.controller === "central" ? "move" : "attack",
    unitIds: ids,
    warning: mergeOrderWarnings(depotWarning(from, ids, claimed, "arrow"), lowSupplyMarchWarning(from)),
  }
}

/** No arrow geometry when the engine would refuse the drop. */
export function marchPreviewLine(
  origin: [number, number],
  pointer: [number, number],
  verdict: MarchPreview,
): [[number, number], [number, number]] | null {
  if (!verdict.ok) return null
  return [origin, pointer]
}

/**
 * Neighbor highlights. Each neighbor is classified by `previewMarch`, not a second copy of the rules.
 */
export function legalTargets(state: GameState, provinceId: string, queue: QueuedOrder[]): LegalTargets {
  const empty: LegalTargets = {
    from: provinceId,
    move: [],
    attack: [],
    reach: { move: [], attack: [] },
    canOrder: false,
    originNote: null,
    blocked: [],
    depotWarn: [],
  }
  const from = findProvince(state, provinceId)
  if (!from) return empty

  const reach = neighborReach(state, from)
  const base = { ...empty, reach }

  if (from.controller !== "central") {
    return base
  }

  const reserved = maneuverReservations(state, fortifyProposals(queue))
  const move: string[] = []
  const attack: string[] = []
  const blocked: LegalTargets["blocked"] = []
  const depotWarn: LegalTargets["depotWarn"] = []

  for (const toId of from.neighbors) {
    const verdict = previewMarch(state, queue, from.id, toId, { reserved })
    if (!verdict.ok) {
      blocked.push({ id: toId, reason: verdict.hover })
      continue
    }
    if (verdict.kind === "move") move.push(toId)
    else attack.push(toId)
    if (verdict.warning) depotWarn.push({ id: toId, reason: verdict.warning })
  }

  const shared =
    blocked.length > 0 &&
    move.length === 0 &&
    attack.length === 0 &&
    blocked.every((item) => item.reason === blocked[0]?.reason)
  return {
    from: provinceId,
    move,
    attack,
    reach,
    canOrder: move.length + attack.length > 0,
    blocked,
    depotWarn,
    originNote: shared ? (blocked[0]?.reason ?? null) : null,
  }
}

/** Drop-hint text, including an origin refusal repeated onto a neighbor arrow. */
export function legalTargetHoverNote(targets: LegalTargets, provinceId: string): string | null {
  const blocked = targets.blocked.find((item) => item.id === provinceId)
  if (blocked) return blocked.reason
  const warn = targets.depotWarn.find((item) => item.id === provinceId)
  return warn?.reason ?? null
}

/**
 * Map tooltip for the province under the pointer.
 * A note about the origin (supply, no formation) appears only on that province.
 */
export function mapProvinceHoverNote(targets: LegalTargets, provinceId: string): string | null {
  if (provinceId === targets.from) return targets.originNote
  const blocked = targets.blocked.find((item) => item.id === provinceId)
  if (blocked && blocked.reason !== targets.originNote) return blocked.reason
  const warn = targets.depotWarn.find((item) => item.id === provinceId)
  return warn?.reason ?? null
}

/**
 * Neighbor ids from `legalTargets` (orderable move/attack, reach hints, and blocked
 * neighbors). Used as the UI drop set for map arrows — non-neighbors cancel.
 */
export function neighborTargetIds(targets: LegalTargets): string[] {
  const ids = new Set<string>([
    ...targets.move,
    ...targets.attack,
    ...targets.reach.move,
    ...targets.reach.attack,
    ...targets.blocked.map((item) => item.id),
  ])
  return [...ids]
}

export function isNeighborOrderTarget(targets: LegalTargets, provinceId: string): boolean {
  return neighborTargetIds(targets).includes(provinceId)
}

/** Hint when a drag drops off a shared border (UI guard; engine still rejects). */
export function nonAdjacentArrowHint(fromName: string, toName: string): string {
  return `${fromName} and ${toName} do not share a border. The arrow was cancelled.`
}

function fortifyProposals(queue: QueuedOrder[]) {
  return queue
    .filter((order) => order.kind === "fortify")
    .map((order) => ({ type: "fortify" as const, province: order.from }))
}

function claimedUnits(queue: QueuedOrder[]): Set<string> {
  return new Set(
    queue.flatMap((order) =>
      order.kind === "fortify" || order.kind === "recruit" || order.kind === "cancelRecruit" ? [] : order.unitIds,
    ),
  )
}

function marchProposal(
  fromId: string,
  toId: string,
  unitIds: string[],
  friendly: boolean,
): MoveProposal | AttackProposal {
  if (friendly) return { type: "move", unit: unitIds[0] ?? "", to: toId }
  return { type: "attack", from: fromId, target: toId, units: unitIds }
}

function depotWarning(
  from: Province,
  departingIds: string[],
  claimed: Set<string>,
  voice: "order" | "arrow",
): string | null {
  const departing = new Set(partyOf(from.units, departingIds).map((unit) => unit.id))
  const remaining = independentFormations(
    from.units.filter((unit) => unit.faction === "central" && !departing.has(unit.id) && !claimed.has(unit.id)),
  )
  if (from.depot !== "central" || remaining.length > 0) return null
  const noun = voice === "order" ? "order" : "arrow"
  return `This ${noun} empties the ${from.name} depot. Leave a garrison unless you mean to abandon it.`
}

function neighborReach(state: GameState, from: Province): { move: string[]; attack: string[] } {
  const move: string[] = []
  const attack: string[] = []
  for (const toId of from.neighbors) {
    const to = findProvince(state, toId)
    if (!to) continue
    if (to.controller === from.controller) move.push(toId)
    else attack.push(toId)
  }
  return { move, attack }
}