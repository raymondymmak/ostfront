import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("top bar and map chrome", () => {
  const hud = readFileSync("components/hud.tsx", "utf8")
  const legend = readFileSync("components/map-legend.tsx", "utf8")
  const map = readFileSync("components/war-map.tsx", "utf8")
  const app = readFileSync("components/game-app.tsx", "utf8")

  it("keeps the labelled situation in the top bar and drops the scenario subtitle", () => {
    expect(hud).toContain("Ostfront")
    expect(hud).not.toContain("spec.name")
    expect(hud).not.toContain("spec.kicker")
    expect(hud).not.toContain("onOverlay")
    expect(hud).not.toContain("Control")
    expect(hud).toContain("Strength")
    expect(hud).toContain("Provinces")
    expect(hud).toContain("Manpower")
    expect(hud).toContain("Industry")
    expect(hud).toContain("VP")
    expect(hud).toContain("Grade")
    expect(hud).toContain('data-testid="treasury"')
    expect(hud).toContain('data-testid="grade"')
    expect(hud).toContain('data-testid="objectives"')
    expect(hud).toContain('data-testid="advisor-toggle"')
    expect(hud).toContain("statusLabel")
  })

  it("puts map mode on the map and the rails toggle inside the open legend", () => {
    expect(map).toContain("<MapMode")
    expect(map).toContain("onOverlay={onOverlay}")
    expect(app).toContain("onOverlay={setOverlay}")
    const hudCall = app.slice(app.indexOf("<Hud"), app.indexOf("/>", app.indexOf("<Hud")))
    expect(hudCall).not.toContain("overlay")
    const openAt = legend.indexOf("{open &&")
    const toggleAt = legend.indexOf('data-testid="rail-toggle"')
    expect(toggleAt).toBeGreaterThan(openAt)
    expect(legend.slice(0, openAt)).not.toContain("rail-toggle")
    expect(legend).toContain('data-testid="overlay-scale"')
  })
})