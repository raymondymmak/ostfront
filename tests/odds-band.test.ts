import { describe, expect, it } from "vitest"
import type { EngagementPreview } from "@/lib/engine/turn"
import { oddsBand } from "@/lib/ui/odds-band"

function preview(overrides: Partial<EngagementPreview>): EngagementPreview {
  return {
    attack: 10,
    defense: 10,
    ratio: 1,
    empty: false,
    origins: 1,
    encircled: false,
    multiplier: 1,
    ...overrides,
  }
}

describe("oddsBand", () => {
  it("marks undefended targets as open", () => {
    const band = oddsBand(preview({ empty: true, ratio: Number.POSITIVE_INFINITY }))
    expect(band.tone).toBe("open")
    expect(band.label).toBe("Undefended")
  })

  it("uses ratio cut-offs for tone", () => {
    expect(oddsBand(preview({ ratio: 0.7 })).tone).toBe("bad")
    expect(oddsBand(preview({ ratio: 1.1 })).tone).toBe("even")
    expect(oddsBand(preview({ ratio: 1.6 })).tone).toBe("good")
  })

  it("keeps the simultaneous-march caveat in detail only", () => {
    const band = oddsBand(preview({ ratio: 1.2 }))
    expect(band.detail.join(" ")).toMatch(/simultaneous enemy march/)
    expect(band.label).not.toMatch(/dice/)
  })
})