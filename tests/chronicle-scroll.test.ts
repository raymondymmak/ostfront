import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { chronicleFollowsLatest } from "@/lib/chronicle-scroll"

describe("chronicle scroll", () => {
  it("follows the newest entry until the reader scrolls up", () => {
    expect(chronicleFollowsLatest(0, 200, 200)).toBe(true)
    expect(chronicleFollowsLatest(400, 640, 200)).toBe(true)
    expect(chronicleFollowsLatest(392, 640, 200)).toBe(true)
    expect(chronicleFollowsLatest(360, 640, 200)).toBe(false)
    expect(chronicleFollowsLatest(200, 640, 200)).toBe(false)
    expect(chronicleFollowsLatest(0, 640, 200)).toBe(false)
  })

  it("keeps the chronicle in a bounded scrollport", () => {
    const panel = readFileSync("components/timeline-panel.tsx", "utf8")
    const app = readFileSync("components/game-app.tsx", "utf8")
    expect(panel).toContain("min-h-0")
    expect(panel).toContain("overscroll-contain")
    expect(panel).toContain("chronicleFollowsLatest")
    expect(app).toContain("absolute inset-0")
    expect(app).toContain("overflow-hidden")
  })
})