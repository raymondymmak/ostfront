import { CATALOG_BY_ID } from "@/lib/data/catalog"
import type { BattleFacts, Faction, TurnRecord } from "@/lib/types"

const VIEWER: Faction = "central"

/** Losses from the human player's faction (Central Powers). */
export function lossesLine(battle: BattleFacts, viewer: Faction = VIEWER): string {
  const ours =
    viewer === battle.attacker ? battle.attackerLoss : battle.defenderLoss
  const theirs =
    viewer === battle.attacker ? battle.defenderLoss : battle.attackerLoss
  return `Ours −${ours} · Theirs −${theirs}`
}

export function provinceLabel(id: string): string {
  return CATALOG_BY_ID[id]?.name ?? id
}

/** Compact battle row for the Log drawer routine list. */
export function battleRoutineLine(battle: BattleFacts, summary: string): string {
  const losses = lossesLine(battle)
  if (battle.kind === "meeting") {
    const lead = summary.split(/\.\s/)[0] ?? summary
    return `${lead} ${losses}`
  }
  const name = provinceLabel(battle.targetId)
  return `${name} — ${losses}`
}

export function battleForProvince(record: TurnRecord, provinceId: string): BattleFacts | undefined {
  for (const item of record.resolutions) {
    if (item.status !== "applied" || !item.battle) continue
    if (item.battle.targetId === provinceId && item.battle.kind === "assault") return item.battle
  }
  return undefined
}