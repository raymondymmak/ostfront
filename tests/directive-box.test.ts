import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("directive box", () => {
  it("is gone from the orders panel and is not sent when the fortnight closes", () => {
    const panel = readFileSync("components/order-panel.tsx", "utf8")
    const app = readFileSync("components/game-app.tsx", "utf8")
    const teach = readFileSync("components/teaching-app.tsx", "utf8")
    const demo = readFileSync("scripts/demo-check.mjs", "utf8")

    expect(panel).not.toContain("data-testid=\"directive\"")
    expect(panel).not.toContain("onDirective")
    expect(app).not.toContain("setDirective")
    expect(app).not.toContain("type: \"text\"")
    expect(teach).not.toContain("onDirective")
    expect(demo).toContain("14-no-directive")
    expect(demo).not.toContain("data-testid=directive].fill")
  })
})
