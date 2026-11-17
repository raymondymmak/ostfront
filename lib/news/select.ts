import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { objectiveValue, scenarioSpec } from "@/lib/data/objectives"
import { easternObjectives } from "@/lib/engine/victory"
import { newsImage } from "@/lib/news/images"
import { headlineFor, loreLine } from "@/lib/news/lore"
import type { NewsEvent, NewsKind } from "@/lib/news/types"
import type { Faction, GameState, TurnRecord } from "@/lib/types"

const MAX_NEWS = 4

const PRIORITY: Record<NewsKind, number> = {
  objectiveTaken: 400,
  objectiveMissed: 380,
  cityTaken: 300,
  cityLost: 290,
  depotLost: 200,
}

type Draft = {
  kind: NewsKind
  provinceId: string
  faction: Faction
  priority: number
}

function isCity(scenario: GameState["scenario"], provinceId: string, terrain: string): boolean {
  return terrain === "urban" || objectiveValue(scenario, provinceId) > 0
}

function provinceName(id: string): string {
  return CATALOG_BY_ID[id]?.name ?? id
}

function attackArrows(
  state: GameState,
  provinceId: string,
  winner: Faction,
): string[] {
  const target = state.provinces.find((p) => p.id === provinceId)
  if (!target) return []
  return target.neighbors.filter((neighborId) => {
    const neighbor = state.provinces.find((p) => p.id === neighborId)
    return neighbor?.controller === winner
  })
}

function buildEvent(draft: Draft, prev: GameState, next: GameState, record: TurnRecord): NewsEvent {
  const name = provinceName(draft.provinceId)
  const tone = draft.faction === "central" ? "victory" : "defeat"
  const arrows = attackArrows(next, draft.provinceId, draft.faction)
  return {
    id: `${record.turn}-${draft.kind}-${draft.provinceId}`,
    kind: draft.kind,
    provinceId: draft.provinceId,
    provinceName: name,
    faction: draft.faction,
    headline: headlineFor(draft.kind, draft.provinceId, name, record.turn),
    lore: loreLine(draft.kind, draft.provinceId, name, draft.faction, record.turn),
    image: newsImage(draft.kind, draft.provinceId, record.turn, arrows.length ? arrows : undefined, tone),
    turn: record.turn,
  }
}

export function selectNewsEvents(prev: GameState, next: GameState, record: TurnRecord): NewsEvent[] {
  const spec = scenarioSpec(prev.scenario)
  const drafts: Draft[] = []
  const claimed = new Set<string>()

  for (const objective of easternObjectives(spec)) {
    const takenTurn = next.capturedOn[objective.id]
    const wasCaptured = prev.capturedOn[objective.id]
    if (takenTurn === record.turn && wasCaptured === undefined) {
      drafts.push({
        kind: "objectiveTaken",
        provinceId: objective.id,
        faction: "central",
        priority: PRIORITY.objectiveTaken,
      })
      claimed.add(objective.id)
    }
    if (
      objective.parTurn === record.turn &&
      (takenTurn === undefined || takenTurn > objective.parTurn)
    ) {
      const holder = next.provinces.find((p) => p.id === objective.id)?.controller
      if (holder !== "central") {
        drafts.push({
          kind: "objectiveMissed",
          provinceId: objective.id,
          faction: "russia",
          priority: PRIORITY.objectiveMissed,
        })
        claimed.add(objective.id)
      }
    }
  }

  for (const change of record.controlChanges) {
    if (claimed.has(change.provinceId)) continue
    const meta = CATALOG_BY_ID[change.provinceId]
    const terrain = meta?.terrain ?? "plains"
    const prevProvince = prev.provinces.find((p) => p.id === change.provinceId)
    const depotFaction = prevProvince?.depot

    if (depotFaction && depotFaction === change.from) {
      drafts.push({
        kind: "depotLost",
        provinceId: change.provinceId,
        faction: change.to,
        priority: PRIORITY.depotLost,
      })
      claimed.add(change.provinceId)
      continue
    }

    if (isCity(prev.scenario, change.provinceId, terrain)) {
      const kind: NewsKind = change.to === "central" ? "cityTaken" : "cityLost"
      drafts.push({
        kind,
        provinceId: change.provinceId,
        faction: change.to,
        priority: PRIORITY[kind],
      })
      claimed.add(change.provinceId)
    }
  }

  drafts.sort((a, b) => b.priority - a.priority || a.provinceId.localeCompare(b.provinceId))
  return drafts.slice(0, MAX_NEWS).map((draft) => buildEvent(draft, prev, next, record))
}

function shorten(line: string, max = 96): string {
  const trimmed = line.replace(/\s+/g, " ").trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

/** One-line Chronicle rows for routine fortnight activity (not headline news). */
export function routineLog(record: TurnRecord): string[] {
  const rows: string[] = []
  for (const line of record.logistics) {
    if (/collect \d+ manpower/i.test(line)) {
      rows.push(shorten(line))
      continue
    }
    if (/reinforc/i.test(line) || /refit/i.test(line)) {
      rows.push(shorten(line))
      continue
    }
    if (/supply|cut off|revolt|exceeds supply capacity|drops below supply/i.test(line)) {
      rows.push(shorten(line))
    }
  }
  for (const item of record.resolutions) {
    if (item.status !== "applied") continue
    if (/income|treasury|raised|arrives|build/i.test(item.summary)) {
      rows.push(shorten(item.summary))
    }
  }
  return rows.slice(0, 12)
}