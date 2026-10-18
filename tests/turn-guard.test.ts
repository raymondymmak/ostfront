import { beforeEach, describe, expect, it } from "vitest"
import {
  checkAccess,
  checkBodySize,
  checkRateLimit,
  enforceTurnGuards,
  resetTurnGuardStateForTests,
} from "@/lib/api/turn-guard"

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/turn", {
    method: "POST",
    headers,
  })
}

describe("turn guard", () => {
  beforeEach(() => {
    resetTurnGuardStateForTests()
    delete process.env.TURN_API_TOKEN
    delete process.env.TURN_ALLOWED_ORIGINS
    delete process.env.TURN_MAX_BODY_BYTES
    delete process.env.TURN_RATE_LIMIT_MAX
    delete process.env.TURN_RATE_LIMIT_WINDOW_MS
  })

  it("rejects oversized bodies", () => {
    const result = checkBodySize(600_000, 512_000)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(413)
  })

  it("rate limits by client ip", () => {
    process.env.TURN_RATE_LIMIT_MAX = "2"
    process.env.TURN_RATE_LIMIT_WINDOW_MS = "60000"
    expect(checkRateLimit("1.2.3.4", 60_000, 2).ok).toBe(true)
    expect(checkRateLimit("1.2.3.4", 60_000, 2).ok).toBe(true)
    const blocked = checkRateLimit("1.2.3.4", 60_000, 2)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.status).toBe(429)
  })

  it("allows matching origins when configured", () => {
    process.env.TURN_ALLOWED_ORIGINS = "https://ostfront-two.vercel.app"
    const ok = checkAccess(
      requestWith({ origin: "https://ostfront-two.vercel.app" }),
      "",
      ["https://ostfront-two.vercel.app"],
    )
    expect(ok.ok).toBe(true)

    const bad = checkAccess(
      requestWith({ origin: "https://evil.example" }),
      "",
      ["https://ostfront-two.vercel.app"],
    )
    expect(bad.ok).toBe(false)
  })

  it("accepts a shared token when configured", () => {
    process.env.TURN_API_TOKEN = "secret"
    const ok = enforceTurnGuards(
      requestWith({ "x-ostfront-turn-token": "secret" }),
      100,
    )
    expect(ok.ok).toBe(true)

    const bad = enforceTurnGuards(requestWith({}), 100)
    expect(bad.ok).toBe(false)
  })
})
