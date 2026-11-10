import { get, head, put } from "@vercel/blob"
import { createScenario } from "@/lib/data/scenario"
import type { Difficulty, SaveGame } from "@/lib/types"

const STORE_VERSION = 1
const BLOB_PREFIX = "campaigns"

export type StoredCampaign = {
  version: typeof STORE_VERSION
  gameId: string
  save: SaveGame
  createdAt: string
  updatedAt: string
}

const memoryStore = new Map<string, StoredCampaign>()

export function resetCampaignStoreForTests(): void {
  memoryStore.clear()
}

export function campaignBlobPath(gameId: string): string {
  return `${BLOB_PREFIX}/${gameId}.json`
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

function memoryStoreEnabled(): boolean {
  return !process.env.BLOB_READ_WRITE_TOKEN?.trim()
}

export async function createStoredCampaign(
  difficulty: Difficulty,
  seed = randomCampaignSeed(),
): Promise<{ gameId: string; save: SaveGame }> {
  const gameId = newCampaignGameId()
  const state = createScenario("gorlice", difficulty, seed >>> 0)
  const save: SaveGame = { version: 2, gameId, state, log: [] }
  const now = new Date().toISOString()
  const stored: StoredCampaign = {
    version: STORE_VERSION,
    gameId,
    save,
    createdAt: now,
    updatedAt: now,
  }
  await writeStoredCampaign(stored)
  return { gameId, save }
}

async function writeStoredCampaign(stored: StoredCampaign): Promise<void> {
  const payload = JSON.stringify({ ...stored, updatedAt: new Date().toISOString() })
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (token) {
    await put(campaignBlobPath(stored.gameId), payload, {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      token,
    })
    return
  }
  memoryStore.set(stored.gameId, JSON.parse(payload) as StoredCampaign)
}

export async function loadStoredCampaign(gameId: string): Promise<StoredCampaign | null> {
  if (!isCampaignGameId(gameId)) return null
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (token) {
    try {
      const meta = await head(campaignBlobPath(gameId), { token })
      if (!meta?.url) return null
      const blob = await get(meta.url, { access: "private", token })
      if (!blob || blob.statusCode !== 200 || !blob.stream) return null
      const text = await new Response(blob.stream).text()
      const parsed = JSON.parse(text) as StoredCampaign
      if (parsed.gameId !== gameId || !parsed.save?.state) return null
      return parsed
    } catch {
      return null
    }
  }
  return memoryStore.get(gameId) ?? null
}

export async function persistCampaignSave(gameId: string, save: SaveGame): Promise<boolean> {
  const current = await loadStoredCampaign(gameId)
  if (!current) return false
  await writeStoredCampaign({
    ...current,
    save: { ...save, version: 2, gameId },
  })
  return true
}

/** Local and CI tests without Blob use an in-memory store; prod needs BLOB_READ_WRITE_TOKEN. */
export function campaignStorageMode(): "blob" | "memory" {
  return memoryStoreEnabled() ? "memory" : "blob"
}
