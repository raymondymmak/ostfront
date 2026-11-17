import { describe, expect, it } from "vitest"
import { chronicleHandlesEscapeKey, newsEscapeDismissesQueue } from "@/lib/news/overlay-stack"

describe("news overlay keyboard stack", () => {
  it("lets Escape skip all news before the Log drawer handles it", () => {
    expect(newsEscapeDismissesQueue("Escape", true)).toBe(true)
    expect(chronicleHandlesEscapeKey(true)).toBe(false)
  })

  it("allows the Log drawer to close on Escape when no news cards", () => {
    expect(chronicleHandlesEscapeKey(false)).toBe(true)
    expect(newsEscapeDismissesQueue("Escape", false)).toBe(false)
  })
})