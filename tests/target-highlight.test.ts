import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  TARGET_HIGHLIGHT_FADE_MS,
  TARGET_HIGHLIGHT_LAYER,
  TARGET_HIGHLIGHT_OPACITY,
  pulseTargetHighlight,
  targetsActive,
} from "@/lib/map/target-highlight"

describe("target highlight fade", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("exports a short opacity pulse for neighbour lifts", () => {
    expect(TARGET_HIGHLIGHT_LAYER).toBe("target-fill")
    expect(TARGET_HIGHLIGHT_FADE_MS).toBeGreaterThanOrEqual(200)
    expect(TARGET_HIGHLIGHT_FADE_MS).toBeLessThanOrEqual(400)
    expect(TARGET_HIGHLIGHT_OPACITY).toBeGreaterThan(0.5)
    expect(targetsActive(undefined)).toBe(false)
    expect(targetsActive({ move: [], attack: [] })).toBe(false)
    expect(targetsActive({ move: ["katowice"], attack: [] })).toBe(true)
  })

  it("pulses layer opacity on selection change without rewriting role via setData", () => {
    const highlight = readFileSync("lib/map/target-highlight.ts", "utf8")
    const layers = readFileSync("lib/map/war-map-layers.ts", "utf8")
    const map = readFileSync("components/war-map.tsx", "utf8")
    expect(highlight).toContain("pulseTargetHighlight")
    expect(highlight).toContain("applyProvinceRoleStates")
    expect(highlight).toContain("fill-opacity-transition")
    expect(highlight).toContain("requestAnimationFrame")
    expect(highlight).toContain("easeOutQuad")
    expect(layers).toContain(`id: TARGET_HIGHLIGHT_LAYER`)
    expect(layers).toContain('["feature-state", "role"]')
    expect(layers).toContain("targetFillColor")
    expect(map).toContain("pulseTargetHighlight")
    expect(map).toContain("applyProvinceRoleStates")
    expect(map).toContain("highlightKeyRef")
    expect(map).toContain("provinceDataKeyRef")
  })

  it("snaps opacity to 0 then lerps up across painted frames", () => {
    const frames: Array<(t: number) => void> = []
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push((t) => cb(t))
      return frames.length
    })

    const opacities: number[] = []
    const map = {
      getLayer: (id: string) => (id === TARGET_HIGHLIGHT_LAYER ? {} : undefined),
      setPaintProperty: (_layer: string, prop: string, value: unknown) => {
        if (prop === "fill-opacity" && typeof value === "number") opacities.push(value)
      },
    }

    pulseTargetHighlight(map as never, true, 200)
    expect(opacities).toEqual([0])
    expect(frames).toHaveLength(1)

    frames.shift()!(0) // outer rAF
    expect(opacities).toEqual([0])
    expect(frames).toHaveLength(1)

    frames.shift()!(0) // inner rAF → start tick at t=0
    expect(opacities[opacities.length - 1]).toBe(0)
    expect(frames).toHaveLength(1)

    frames.shift()!(100) // mid fade
    const mid = opacities[opacities.length - 1]!
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(TARGET_HIGHLIGHT_OPACITY)
    expect(frames).toHaveLength(1)

    frames.shift()!(200) // done
    expect(opacities[opacities.length - 1]).toBeCloseTo(TARGET_HIGHLIGHT_OPACITY, 5)
    expect(frames).toHaveLength(0)
  })

  it("cancels a pending fade when pulsed again before finish", () => {
    const frames: Array<(t: number) => void> = []
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push((t) => cb(t))
      return frames.length
    })

    const opacities: number[] = []
    const map = {
      getLayer: () => ({}),
      setPaintProperty: (_layer: string, prop: string, value: unknown) => {
        if (prop === "fill-opacity" && typeof value === "number") opacities.push(value)
      },
    }

    pulseTargetHighlight(map as never, true, 200)
    pulseTargetHighlight(map as never, true, 200)
    // Drain all scheduled frames with advancing time; only the second pulse should finish.
    let now = 0
    while (frames.length) {
      now += 50
      frames.shift()!(now)
    }
    expect(opacities.filter((v) => v === 0).length).toBeGreaterThanOrEqual(2)
    expect(opacities[opacities.length - 1]).toBeCloseTo(TARGET_HIGHLIGHT_OPACITY, 5)
    // Stale pulse must not keep writing after cancel — at most one completed ramp.
    const peaks = opacities.filter((v) => Math.abs(v - TARGET_HIGHLIGHT_OPACITY) < 1e-6)
    expect(peaks.length).toBe(1)
  })
})
