import { CAMPAIGN_TTL_SECONDS } from "@/lib/redis/env"
import type { RedisLike } from "@/lib/redis/client"
import { COMMIT_TURN_LUA, CREATE_CAMPAIGN_LUA } from "@/lib/campaign/redis-scripts"

type Stored = { value: string; expiresAt: number | null }

/** In-memory Redis REST fake for Vitest (supports campaign Lua scripts). */
export function createFakeRedisClient(): RedisLike {
  const data = new Map<string, Stored>()

  const now = () => Date.now()

  const getEntry = (key: string): Stored | undefined => {
    const entry = data.get(key)
    if (!entry) return undefined
    if (entry.expiresAt != null && entry.expiresAt <= now()) {
      data.delete(key)
      return undefined
    }
    return entry
  }

  const setNx = (key: string, value: string, ttlSec?: number): boolean => {
    if (getEntry(key)) return false
    const expiresAt =
      ttlSec != null && ttlSec > 0 ? now() + ttlSec * 1000 : null
    data.set(key, { value, expiresAt })
    return true
  }

  const runCommitTurn = (keys: string[], args: string[]): string[] => {
    const headRaw = getEntry(keys[0])?.value
    if (!headRaw) return ["missing"]
    const head = JSON.parse(headRaw) as { turn: number }
    const expected = Number.parseInt(args[0], 10)
    if (head.turn !== expected) return ["stale", String(head.turn)]
    if (getEntry(keys[1])) return ["conflict"]
    const ttl = Number.parseInt(args[3], 10) || CAMPAIGN_TTL_SECONDS
    if (!setNx(keys[1], args[2], ttl)) return ["conflict"]
    const expiresAt = ttl > 0 ? now() + ttl * 1000 : null
    data.set(keys[0], { value: args[1], expiresAt })
    return ["ok"]
  }

  const runCreateCampaign = (keys: string[], args: string[]): string[] => {
    if (getEntry(keys[0])) return ["exists"]
    const ttl = Number.parseInt(args[2], 10) || CAMPAIGN_TTL_SECONDS
    if (!setNx(keys[0], args[0], ttl)) return ["exists"]
    if (!setNx(keys[1], args[1], ttl)) {
      data.delete(keys[0])
      return ["exists"]
    }
    return ["ok"]
  }

  const normalize = (script: string) => script.replace(/\s+/g, " ").trim()
  const commitNorm = normalize(COMMIT_TURN_LUA)
  const createNorm = normalize(CREATE_CAMPAIGN_LUA)

  return {
    async get<T>(key: string): Promise<T | null> {
      const entry = getEntry(key)
      if (!entry) return null
      try {
        return JSON.parse(entry.value) as T
      } catch {
        return entry.value as T
      }
    },

    async set(
      key: string,
      value: string,
      options?: { nx?: boolean; ex?: number },
    ): Promise<string | null> {
      const serialized = value
      if (options?.nx) {
        return setNx(key, serialized, options.ex) ? "OK" : null
      }
      const expiresAt =
        options?.ex != null && options.ex > 0 ? now() + options.ex * 1000 : null
      data.set(key, { value: serialized, expiresAt })
      return "OK"
    },

    async exists(...keys: string[]): Promise<number> {
      return keys.filter((k) => getEntry(k)).length
    },

    async mget(...keys: string[]): Promise<(string | null)[]> {
      return keys.map((k) => getEntry(k)?.value ?? null)
    },

    async del(...keys: string[]): Promise<number> {
      let n = 0
      for (const k of keys) {
        if (data.delete(k)) n++
      }
      return n
    },

    async expire(key: string, seconds: number): Promise<number> {
      const entry = data.get(key)
      if (!entry) return 0
      entry.expiresAt = seconds > 0 ? now() + seconds * 1000 : null
      return 1
    },

    async ping(): Promise<string> {
      return "PONG"
    },

    async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
      const normalizedScript = normalize(script)
      if (normalizedScript === commitNorm) {
        return runCommitTurn(keys, args)
      }
      if (normalizedScript === createNorm) {
        return runCreateCampaign(keys, args)
      }
      throw new Error("fake redis: unsupported script")
    },
  }
}
