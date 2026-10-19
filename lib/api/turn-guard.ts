/**
 * Lightweight abuse protection for POST /api/turn (Vercel serverless–friendly).
 * Rate limits are per warm instance (best-effort); pair with origin/token for production.
 */

export type GuardFailure = { ok: false; status: number; error: string }
export type GuardSuccess = { ok: true }
export type GuardResult = GuardSuccess | GuardFailure

const DEFAULT_MAX_BODY_BYTES = 512_000
const DEFAULT_RATE_WINDOW_MS = 60_000
const DEFAULT_RATE_MAX = 24

type RateBucket = { count: number; resetAt: number }

const rateBuckets = new Map<string, RateBucket>()

export function resetTurnGuardStateForTests(): void {
  rateBuckets.clear()
}

export function turnGuardConfig() {
  const maxBody = parsePositiveInt(process.env.TURN_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES)
  const windowMs = parsePositiveInt(
    process.env.TURN_RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_WINDOW_MS,
  )
  const rateMax = parsePositiveInt(process.env.TURN_RATE_LIMIT_MAX, DEFAULT_RATE_MAX)
  const token = process.env.TURN_API_TOKEN?.trim() || ""
  const allowedOrigins = parseOrigins(process.env.TURN_ALLOWED_ORIGINS)
  return { maxBody, windowMs, rateMax, token, allowedOrigins }
}

export function enforceTurnGuards(
  request: Request,
  bodyByteLength: number,
): GuardResult {
  const config = turnGuardConfig()

  const size = checkBodySize(bodyByteLength, config.maxBody)
  if (!size.ok) return size

  const ip = getClientIp(request)
  const rate = checkRateLimit(ip, config.windowMs, config.rateMax)
  if (!rate.ok) return rate

  const access = checkAccess(request, config.token, config.allowedOrigins)
  if (!access.ok) return access

  return { ok: true }
}

export function checkBodySize(bytes: number, maxBytes: number): GuardResult {
  if (bytes > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `Turn payload exceeds the ${maxBytes} byte limit.`,
    }
  }
  return { ok: true }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  return "unknown"
}

export function checkRateLimit(
  ip: string,
  windowMs: number,
  max: number,
  now = Date.now(),
): GuardResult {
  const key = ip || "unknown"
  let bucket = rateBuckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs }
    rateBuckets.set(key, bucket)
  }
  bucket.count += 1
  if (bucket.count > max) {
    return {
      ok: false,
      status: 429,
      error: "Too many turn requests. Try again in a minute.",
    }
  }
  return { ok: true }
}

export function checkAccess(
  request: Request,
  token: string,
  allowedOrigins: string[],
): GuardResult {
  if (token) {
    const headerToken =
      request.headers.get("x-ostfront-turn-token")?.trim() ||
      bearerToken(request.headers.get("authorization"))
    if (headerToken === token) return { ok: true }
  }

  if (allowedOrigins.length > 0) {
    const origin = requestOrigin(request)
    if (!origin) {
      return {
        ok: false,
        status: 403,
        error: "Turn API requires a browser origin or access token.",
      }
    }
    if (!allowedOrigins.includes(origin)) {
      return {
        ok: false,
        status: 403,
        error: "Turn API origin is not allowed.",
      }
    }
    return { ok: true }
  }

  if (token) {
    return {
      ok: false,
      status: 401,
      error: "Turn API access token is required.",
    }
  }

  return { ok: true }
}

export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | GuardFailure> {
  const contentLength = request.headers.get("content-length")
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10)
    if (Number.isFinite(declared) && declared > maxBytes) {
      return checkBodySize(declared, maxBytes) as GuardFailure
    }
  }

  const reader = request.body?.getReader()
  if (!reader) {
    return { ok: true, text: "" }
  }

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      return checkBodySize(total, maxBytes) as GuardFailure
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(merged) }
}

function bearerToken(header: string | null): string | undefined {
  if (!header) return undefined
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim()
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
}

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin")?.trim()
  if (origin) return normalizeOrigin(origin)

  const referer = request.headers.get("referer")?.trim()
  if (!referer) return null
  try {
    return normalizeOrigin(new URL(referer).origin)
  } catch {
    return null
  }
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "")
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}
