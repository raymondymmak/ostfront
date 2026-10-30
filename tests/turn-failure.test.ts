import { describe, expect, it } from "vitest"
import { formatTurnFailure } from "@/lib/turn-failure"

describe("formatTurnFailure", () => {
  it("prints the status and a string error from this app", () => {
    const message = formatTurnFailure(401, JSON.stringify({ error: "Turn API access token is required." }))
    expect(message).toBe("Turn failed (401): Turn API access token is required.")
    expect(message).not.toContain("[object Object]")
  })

  it("reads a nested message from a host 401 body", () => {
    const message = formatTurnFailure(
      401,
      JSON.stringify({ error: { code: "unauthorized", message: "Authentication Required" } }),
    )
    expect(message).toBe("Turn failed (401): Authentication Required")
    expect(message).not.toContain("[object Object]")
  })

  it("uses a generic message when the body is not JSON", () => {
    const html = "<html><head><title>x</title></head><body><h1>Authentication Required</h1></body></html>"
    const message = formatTurnFailure(500, html)
    expect(message).toBe("Turn failed (500): The server could not complete the turn.")
    expect(message).not.toContain("x")
    expect(message).not.toContain("Authentication Required")
    expect(message).not.toContain("[object Object]")
    expect(message).not.toContain("<")
    expect(formatTurnFailure(401, "not json")).toBe("Turn failed (401): The server could not complete the turn.")
  })

  it("still names the status when the body is empty", () => {
    expect(formatTurnFailure(500, "")).toBe("Turn failed (500).")
  })
})
