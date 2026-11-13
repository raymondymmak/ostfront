import { stripSeedFromState } from "@/lib/campaign/public-state"
import { createScenario } from "@/lib/data/scenario"
import { runCampaignSerialized } from "@/lib/campaign/serialize"
import { campaignHeadKey, campaignTurnKey } from "@/lib/campaign/redis-keys"
import {
  COMMIT_TURN_LUA,
  CREATE_CAMPAIGN_LUA,
  parseCommitTurnLuaReply,
} from "@/lib/campaign/redis-scripts"
import { CAMPAIGN_TTL_SECONDS, redisConfigured } from "@/lib/redis/env"
import { getRedisClient } from "@/lib/redis/client"
import type { Difficulty, GameState, SaveGame } from "@/lib/types"

const HEAD_VERSION = 1
const SNAPSHOT_VERSION = 1

export type CampaignHead = {
  version: typeof HEAD_VERSION
  gameId: string
  /** Fortnight index of the latest stored snapshot (matches save.state.turn). */
  turn: number
  seed: number
  difficulty: Difficulty
  createdAt: string
}

export type TurnSnapshot = {
  version: typeof SNAPSHOT_VERSION
  gameId: string
  turn: number
  save: SaveGame
}

type MemoryCampaign = {
  head: CampaignHead
  headEtag: string
  snapshots: Map<number, SaveGame>
}

const memoryStore = new Map<string, MemoryCampaign>()

/** Persisted snapshots omit combat seed; authoritative copy lives on `CampaignHead` only. */
function snapshotSave(save: SaveGame): SaveGame {
  return {
    ...save,
    state: { ...stripSeedFromState(save.state) } as GameState,
  }
}

export function resetCampaignStoreForTests(): void {
  memoryStore.clear()
}

export function isCampaignGameId(gameId: string): boolean {
  return /^[a-f0-9]{32}$/.test(gameId)
}

export function randomCampaignSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1
}

export function newCampaignGameId(): string {
  return crypto.randomUUID().replace(/-/g, "")
}

/** Legacy path helper (LLM scripts / docs). */
export function turnSnapshotPath(gameId: string, turn: number): string {
  return `campaigns/${gameId}/turn-${turn}.json`
}

function memoryStoreBackend(): boolean {
  return !redisConfigured()
}

async function loadHead(gameId: string): Promise<{ head: CampaignHead; etag?: string } | null> {
  if (memoryStoreBackend()) {
    const row = memoryStore.get(gameId)
    if (!row) return null
    return { head: row.head, etag: row.headEtag }
  }
  const redis = getRedisClient()
  if (!redis) return null
  const head = await redis.get<CampaignHead>(campaignHeadKey(gameId))
  if (!head || head.gameId !== gameId) return null
  return { head }
}

async function loadSnapshot(gameId: string, turn: number): Promise<SaveGame | null> {
  if (memoryStoreBackend()) {
    return memoryStore.get(gameId)?.snapshots.get(turn) ?? null
  }
  const redis = getRedisClient()
  if (!redis) return null
  const snap = await redis.get<TurnSnapshot>(campaignTurnKey(gameId, turn))
  if (!snap || snap.turn !== turn) return null
  return snap.save
}

export async function createStoredCampaign(
  difficulty: Difficulty,
  seed = randomCampaignSeed(),
): Promise<{ gameId: string; save: SaveGame }> {
  const gameId = newCampaignGameId()
  const state = createScenario("gorlice", difficulty, seed >>> 0)
  const save: SaveGame = { version: 2, gameId, state, log: [] }
  const createdAt = new Date().toISOString()
  const head: CampaignHead = {
    version: HEAD_VERSION,
    gameId,
    turn: 0,
    seed: seed >>> 0,
    difficulty,
    createdAt,
  }
  const snapshot: TurnSnapshot = {
    version: SNAPSHOT_VERSION,
    gameId,
    turn: 0,
    save: snapshotSave(save),
  }

  if (memoryStoreBackend()) {
    memoryStore.set(gameId, {
      head,
      headEtag: crypto.randomUUID(),
      snapshots: new Map([[0, snapshot.save]]),
    })
    return { gameId, save }
  }

  const redis = getRedisClient()
  if (!redis) throw new Error("Redis client missing")

  const reply = await redis.eval(
    CREATE_CAMPAIGN_LUA,
    [campaignHeadKey(gameId), campaignTurnKey(gameId, 0)],
    [JSON.stringify(head), JSON.stringify(snapshot), String(CAMPAIGN_TTL_SECONDS)],
  )
  const tag = Array.isArray(reply) ? String(reply[0]) : ""
  if (tag !== "ok") throw new Error("Campaign create failed")
  return { gameId, save }
}

export async function loadStoredCampaign(gameId: string): Promise<{
  head: CampaignHead
  save: SaveGame
} | null> {
  if (!isCampaignGameId(gameId)) return null
  const loaded = await loadHead(gameId)
  if (!loaded) return null
  const save = await loadSnapshot(gameId, loaded.head.turn)
  if (!save?.state) return null
  return { head: loaded.head, save: { ...save, version: 2, gameId } }
}

export type CommitTurnResult =
  | { ok: true }
  | { ok: false; status: number; code: "stale_turn" | "storage_conflict"; error: string }

/**
 * Immutable turn snapshot (SET NX) plus atomic head advance (Lua).
 * Losers of a race get storage_conflict (409).
 */
export async function commitCampaignTurn(
  gameId: string,
  expectedTurn: number,
  nextSave: SaveGame,
): Promise<CommitTurnResult> {
  if (memoryStoreBackend()) {
    return runCampaignSerialized(gameId, () =>
      commitCampaignTurnInner(gameId, expectedTurn, nextSave),
    )
  }
  return commitCampaignTurnInner(gameId, expectedTurn, nextSave)
}

async function commitCampaignTurnInner(
  gameId: string,
  expectedTurn: number,
  nextSave: SaveGame,
): Promise<CommitTurnResult> {
  const nextTurn = nextSave.state.turn
  if (nextTurn !== expectedTurn + 1) {
    return {
      ok: false,
      status: 409,
      code: "stale_turn",
      error: `Expected fortnight ${expectedTurn}, but the resolved state is out of date.`,
    }
  }

  const snapshot: TurnSnapshot = {
    version: SNAPSHOT_VERSION,
    gameId,
    turn: nextTurn,
    save: snapshotSave({ ...nextSave, version: 2, gameId }),
  }
  const loaded = await loadHead(gameId)
  if (!loaded || loaded.head.turn !== expectedTurn) {
    return {
      ok: false,
      status: 409,
      code: "stale_turn",
      error: `Expected fortnight ${expectedTurn}, but the server holds fortnight ${loaded?.head.turn ?? "?"}. Reload or start a new campaign.`,
    }
  }
  const nextHead: CampaignHead = { ...loaded.head, turn: nextTurn }

  if (memoryStoreBackend()) {
    const row = memoryStore.get(gameId)
    if (!row || row.head.turn !== expectedTurn) {
      return {
        ok: false,
        status: 409,
        code: "stale_turn",
        error: `Expected fortnight ${expectedTurn}, but the server holds fortnight ${row?.head.turn ?? "?"}. Reload or start a new campaign.`,
      }
    }
    if (row.snapshots.has(nextTurn)) {
      return {
        ok: false,
        status: 409,
        code: "storage_conflict",
        error:
          "Another request already closed this fortnight. Reload the campaign and continue from the chronicle.",
      }
    }
    row.snapshots.set(nextTurn, snapshot.save)
    row.head = nextHead
    row.headEtag = crypto.randomUUID()
    return { ok: true }
  }

  const redis = getRedisClient()
  if (!redis) throw new Error("Redis client missing")

  const reply = await redis.eval(
    COMMIT_TURN_LUA,
    [campaignHeadKey(gameId), campaignTurnKey(gameId, nextTurn)],
    [
      String(expectedTurn),
      JSON.stringify(nextHead),
      JSON.stringify(snapshot),
      String(CAMPAIGN_TTL_SECONDS),
    ],
  )
  const parsed = parseCommitTurnLuaReply(reply)
  if (parsed.result === "ok") return { ok: true }
  if (parsed.result === "stale" || parsed.result === "missing") {
    return {
      ok: false,
      status: 409,
      code: "stale_turn",
      error: `Expected fortnight ${expectedTurn}, but the server holds fortnight ${parsed.currentTurn ?? "?"}. Reload or start a new campaign.`,
    }
  }
  return {
    ok: false,
    status: 409,
    code: "storage_conflict",
    error:
      "Another request already closed this fortnight. Reload the campaign and continue from the chronicle.",
  }
}

/** Local and CI tests without Redis use an in-memory store; prod needs KV REST env. */
export function campaignStorageMode(): "redis" | "memory" {
  return memoryStoreBackend() ? "memory" : "redis"
}

/** Restore engine state with the server-held seed. */
export function withServerSeed(state: GameState, seed: number): GameState {
  return { ...state, seed: seed >>> 0 }
}
