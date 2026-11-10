import { BlobError, BlobPreconditionFailedError, get, head, put } from "@vercel/blob"
import { createScenario } from "@/lib/data/scenario"
import { runCampaignSerialized } from "@/lib/campaign/serialize"
import type { Difficulty, GameState, SaveGame } from "@/lib/types"

const HEAD_VERSION = 1
const SNAPSHOT_VERSION = 1
const BLOB_PREFIX = "campaigns"

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

function headPath(gameId: string): string {
  return `${BLOB_PREFIX}/${gameId}/head.json`
}

export function turnSnapshotPath(gameId: string, turn: number): string {
  return `${BLOB_PREFIX}/${gameId}/turn-${turn}.json`
}

function memoryStoreBackend(): boolean {
  return !process.env.BLOB_READ_WRITE_TOKEN?.trim()
}

function isConflictError(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true
  if (error instanceof BlobError && /already exists|precondition/i.test(error.message)) {
    return true
  }
  return false
}

async function readBlobJson<T>(pathname: string): Promise<{ data: T; etag?: string } | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) return null
  try {
    const meta = await head(pathname, { token })
    if (!meta?.url) return null
    const blob = await get(meta.url, { access: "private", token })
    if (!blob || blob.statusCode !== 200 || !blob.stream) return null
    const text = await new Response(blob.stream).text()
    return { data: JSON.parse(text) as T, etag: meta.etag }
  } catch {
    return null
  }
}

async function loadHead(gameId: string): Promise<{ head: CampaignHead; etag?: string } | null> {
  if (memoryStoreBackend()) {
    const row = memoryStore.get(gameId)
    if (!row) return null
    return { head: row.head, etag: row.headEtag }
  }
  const blob = await readBlobJson<CampaignHead>(headPath(gameId))
  if (!blob?.data || blob.data.gameId !== gameId) return null
  return { head: blob.data, etag: blob.etag }
}

async function loadSnapshot(gameId: string, turn: number): Promise<SaveGame | null> {
  if (memoryStoreBackend()) {
    return memoryStore.get(gameId)?.snapshots.get(turn) ?? null
  }
  const blob = await readBlobJson<TurnSnapshot>(turnSnapshotPath(gameId, turn))
  if (!blob?.data || blob.data.turn !== turn) return null
  return blob.data.save
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
  const snapshot: TurnSnapshot = { version: SNAPSHOT_VERSION, gameId, turn: 0, save }

  if (memoryStoreBackend()) {
    memoryStore.set(gameId, {
      head,
      headEtag: crypto.randomUUID(),
      snapshots: new Map([[0, save]]),
    })
    return { gameId, save }
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) throw new Error("Blob token missing")

  await put(headPath(gameId), JSON.stringify(head), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
    token,
  })
  await put(turnSnapshotPath(gameId, 0), JSON.stringify(snapshot), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
    token,
  })
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
 * Immutable turn snapshot (allowOverwrite: false) plus head CAS (ifMatch).
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

  const loaded = await loadHead(gameId)
  if (!loaded || loaded.head.turn !== expectedTurn) {
    return {
      ok: false,
      status: 409,
      code: "stale_turn",
      error: `Expected fortnight ${expectedTurn}, but the server holds fortnight ${loaded?.head.turn ?? "?"}. Reload or start a new campaign.`,
    }
  }

  const snapshot: TurnSnapshot = {
    version: SNAPSHOT_VERSION,
    gameId,
    turn: nextTurn,
    save: { ...nextSave, version: 2, gameId },
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

  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) throw new Error("Blob token missing")

  try {
    await put(turnSnapshotPath(gameId, nextTurn), JSON.stringify(snapshot), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json",
      token,
    })
  } catch (error) {
    if (isConflictError(error)) {
      return {
        ok: false,
        status: 409,
        code: "storage_conflict",
        error:
          "Another request already closed this fortnight. Reload the campaign and continue from the chronicle.",
      }
    }
    throw error
  }

  try {
    await put(headPath(gameId), JSON.stringify(nextHead), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      ifMatch: loaded.etag,
      token,
    })
  } catch (error) {
    if (isConflictError(error)) {
      return {
        ok: false,
        status: 409,
        code: "storage_conflict",
        error:
          "Another request already closed this fortnight. Reload the campaign and continue from the chronicle.",
      }
    }
    throw error
  }

  return { ok: true }
}

/** Local and CI tests without Blob use an in-memory store; prod needs BLOB_READ_WRITE_TOKEN. */
export function campaignStorageMode(): "blob" | "memory" {
  return memoryStoreBackend() ? "memory" : "blob"
}

/** Restore engine state with the server-held seed. */
export function withServerSeed(state: GameState, seed: number): GameState {
  return { ...state, seed: seed >>> 0 }
}
