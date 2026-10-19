import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  PROVINCE_LABEL_FULL_ZOOM,
  PROVINCE_LABEL_HIDDEN_ZOOM,
  applyProvinceLabelOpacity,
  provinceLabelOpacity,
} from "@/lib/map/province-label-zoom"

const OPENING_ZOOM = 6.833576
const EUROPE_ZOOM = 5.3172

describe("province label zoom", () => {
  it("keeps names and counters solid at the opening zoom", () => {
    expect(provinceLabelOpacity(OPENING_ZOOM)).toBe(1)
    expect(provinceLabelOpacity(PROVINCE_LABEL_FULL_ZOOM)).toBe(1)
    expect(OPENING_ZOOM).toBeGreaterThan(PROVINCE_LABEL_FULL_ZOOM)
  })

  it("hides names and counters on the Europe zoom, fading in between", () => {
    expect(provinceLabelOpacity(EUROPE_ZOOM)).toBe(0)
    expect(provinceLabelOpacity(PROVINCE_LABEL_HIDDEN_ZOOM)).toBe(0)
    expect(OPENING_ZOOM - PROVINCE_LABEL_HIDDEN_ZOOM).toBeGreaterThan(1.3)
    expect(OPENING_ZOOM - PROVINCE_LABEL_HIDDEN_ZOOM).toBeLessThan(1.6)
    const mid = (PROVINCE_LABEL_FULL_ZOOM + PROVINCE_LABEL_HIDDEN_ZOOM) / 2
    const faded = provinceLabelOpacity(mid)
    expect(faded).toBeGreaterThan(0.4)
    expect(faded).toBeLessThan(0.6)
    expect(provinceLabelOpacity(mid + 0.2)).toBeGreaterThan(faded)
  })

  it("writes opacity on the marker without touching its classes", () => {
    const target = { style: { opacity: "kept" } }
    applyProvinceLabelOpacity(target, OPENING_ZOOM)
    expect(target.style.opacity).toBe("")
    applyProvinceLabelOpacity(target, EUROPE_ZOOM)
    expect(target.style.opacity).toBe("0")
    applyProvinceLabelOpacity(target, (PROVINCE_LABEL_FULL_ZOOM + PROVINCE_LABEL_HIDDEN_ZOOM) / 2)
    expect(Number(target.style.opacity)).toBeCloseTo(0.5, 2)

    const set = { opacity: -1, setOpacity(value: number) { this.opacity = value } }
    applyProvinceLabelOpacity(set, EUROPE_ZOOM)
    expect(set.opacity).toBe(0)
    applyProvinceLabelOpacity(set, OPENING_ZOOM)
    expect(set.opacity).toBe(1)
  })

  it("gates labels from the map without replacing marker className", () => {
    const source = readFileSync("components/war-map.tsx", "utf8")
    expect(source).toContain("applyProvinceLabelOpacity")
    expect(source).toContain("applyMarkerFace")
    expect(source).not.toMatch(/\.className\s*=/)
  })
})