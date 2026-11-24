import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { OddsBar } from "@/components/odds-bar"
import type { EngagementPreview } from "@/lib/engine/turn"

function preview(ratio: number): EngagementPreview {
  return {
    attack: 10 * ratio,
    defense: 10,
    ratio,
    empty: false,
    origins: 1,
    encircled: false,
    multiplier: 1,
  }
}

describe("OddsBar", () => {
  it("uses a fixed full-width fill regardless of ratio", () => {
    const favourable = renderToStaticMarkup(<OddsBar preview={preview(2.5)} testId="attack-odds" />)
    const unlikely = renderToStaticMarkup(<OddsBar preview={preview(0.5)} testId="attack-odds" />)
    expect(favourable).toMatch(/data-odds-fill="true"[^>]*w-full|w-full[^>]*data-odds-fill="true"/)
    expect(unlikely).toMatch(/data-odds-fill="true"[^>]*w-full|w-full[^>]*data-odds-fill="true"/)
    expect(favourable).not.toMatch(/style="width:/)
    expect(unlikely).not.toMatch(/style="width:/)
  })
})