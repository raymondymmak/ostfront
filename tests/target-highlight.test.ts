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

  it("wires feature-state roles and a paint-transition opacity pulse", () => {
    expect(TARGET_HIGHLIGHT_LAYER).toBe("target-fill")
    expect(TARGET_HIGHLIGHT_FADE_MS).toBeGreaterThanOrEqual(200)
    expect(TARGET_HIGHLIGHT_FADE_MS).toBeLessThanOrEqual(400)
    expect(TARGET_HIGHLIGHT_OPACITY).toBeGreaterThan(0.5)
    expect(targetsActive({ move: ["katowice"], attack: [] })).toBe(true)

    const highlight = readFileSync("lib/map/target-highlight.ts", "utf8")
    const layers = readFileSync("lib/map/war-map-layers.ts", "utf8")
    const map = readFileSync("components/war-map.tsx", "utf8")
    expect(highlight).toContain("pulseTargetHighlight")
    expect(highlight).toContain("fill-opacity-transition")
    expect(highlight).toContain("requestAnimationFrame")
    expect(highlight).not.toContain("easeOutQuad")
    expect(layers).toContain('["feature-state", "role"]')
    expect(map).toContain("pulseTargetHighlight")
    expect(map).toContain("highlightKeyRef")
  })

  it("snaps opacity to 0 then restores it after a painted frame", () => {
    const frames: Array<() => void> = []
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(() => cb(0))
      return frames.length
    })

    const calls: Array<[string, unknown]> = []
    const map = {
      getLayer: (id: string) => (id === TARGET_HIGHLIGHT_LAYER ? {} : undefined),
      setPaintProperty: (layer: string, prop: string, value: unknown) => {
        calls.push([`${layer}:${prop}`, value])
      },
    }

    pulseTargetHighlight(map as never, true, 280)
    expect(calls).toEqual([
      [`${TARGET_HIGHLIGHT_LAYER}:fill-opacity-transition`, { duration: 0, delay: 0 }],
      [`${TARGET_HIGHLIGHT_LAYER}:fill-opacity`, 0],
    ])

    frames.shift()!()
    frames.shift()!()
    expect(calls).toEqual([
      [`${TARGET_HIGHLIGHT_LAYER}:fill-opacity-transition`, { duration: 0, delay: 0 }],
      [`${TARGET_HIGHLIGHT_LAYER}:fill-opacity`, 0],
      [`${TARGET_HIGHLIGHT_LAYER}:fill-opacity-transition`, { duration: 280, delay: 0 }],
      [`${TARGET_HIGHLIGHT_LAYER}:fill-opacity`, TARGET_HIGHLIGHT_OPACITY],
    ])
  })
})
