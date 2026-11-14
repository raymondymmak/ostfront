import { Redis } from "@upstash/redis"
import { redisRestCredentials } from "@/lib/redis/env"

let productionClient: Redis | null | undefined

export type RedisLike = {
  get: <T>(key: string) => Promise<T | null>
  set: (
    key: string,
    value: string,
    opts?: { nx?: boolean; ex?: number },
  ) => Promise<string | null>
  eval: (script: string, keys: string[], args: string[]) => Promise<unknown>
  exists: (...keys: string[]) => Promise<number>
  mget: (...keys: string[]) => Promise<(string | null)[]>
  del: (...keys: string[]) => Promise<number>
  expire: (key: string, seconds: number) => Promise<number>
  ping: () => Promise<string>
}

let testOverride: RedisLike | null = null

/** Vitest injects an in-memory fake; production uses Upstash REST. */
export function setRedisClientForTests(client: RedisLike | null): void {
  testOverride = client
}

export function getRedisClient(): RedisLike | null {
  if (testOverride) return testOverride
  if (productionClient === undefined) {
    const creds = redisRestCredentials()
    productionClient = creds ? new Redis({ url: creds.url, token: creds.token }) : null
  }
  return productionClient as RedisLike
}

export function resetRedisClientForTests(): void {
  testOverride = null
  productionClient = undefined
}
