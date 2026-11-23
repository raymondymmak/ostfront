// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { readFileSync } from "node:fs"
import { SvgMap } from "@/components/svg-map"
import { freshGame } from "@/lib/storage"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import type { MapProvince } from "@/components/war-map"
import {
  isNeighborOrderTarget,
  legalTargets,
  nonAdjacentArrowHint,
} from "@/lib/ui/legal-targets"

function mapProvinces(): MapProvince[] {
  const { state } = freshGame()
  return state.provinces.map((province) => ({
    ...province,
    polygon: CATALOG_BY_ID[province.id]?.polygon ?? [],
    centroid: CATALOG_BY_ID[province.id]?.centroid ?? [0, 0],
  }))
}

describe("arrow neighbor UI guard", () => {
  it("wires MapLibre + SVG preview invalid styling and touch/pointer drag", () => {
    const war = readFileSync("components/war-map.tsx", "utf8")
    expect(war).toContain("data-arrow-drag")
    expect(war).toContain("not-allowed")
    expect(war).toContain("neighborDrop")
    expect(war).toContain("touchstart")
    expect(war).toContain("touchmove")
    expect(war).toContain("touchend")
    expect(war).toMatch(/properties:\s*\{\s*valid:/)

    const layers = readFileSync("lib/map/war-map-layers.ts", "utf8")
    expect(layers).toContain('["get", "valid"]')

    const svg = readFileSync("components/svg-map.tsx", "utf8")
    expect(svg).toContain("data-arrow-drag")
    expect(svg).toContain("data-arrow-valid")
    expect(svg).toContain("not-allowed")
    expect(svg).toContain("onPointerDown")
    expect(svg).toContain("onPointerUp")

    const game = readFileSync("components/game-app.tsx", "utf8")
    expect(game).toContain("isNeighborOrderTarget")
    expect(game).toContain("nonAdjacentArrowHint")
    expect(game).toMatch(/if \(!isNeighborOrderTarget\(targets, toId\)\)/)

    const teach = readFileSync("components/teaching-app.tsx", "utf8")
    expect(teach).toContain("isNeighborOrderTarget")
    expect(teach).toContain("nonAdjacentArrowHint")
  })

  it("marks SVG preview invalid over a non-neighbor and valid over a neighbor", async () => {
    const provinces = mapProvinces()
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    const onDraw = vi.fn()
    const onSelect = vi.fn()

    await act(async () => {
      root.render(
        <SvgMap
          provinces={provinces}
          selectedId="krakow"
          overlay="none"
          orders={[]}
          flashIds={[]}
          orderMode
          showRails={false}
          onSelect={onSelect}
          onDraw={onDraw}
        />,
      )
    })

    const fromPath = host.querySelector('[data-province-id="krakow"]') as SVGPathElement
    const neighborPath = host.querySelector('[data-province-id="kielce"]') as SVGPathElement
    const farPath = host.querySelector('[data-province-id="warszawa"]') as SVGPathElement
    expect(fromPath).toBeTruthy()
    expect(neighborPath).toBeTruthy()
    expect(farPath).toBeTruthy()

    // jsdom lacks PointerEvent — polyfill a minimal Event subclass.
    class TestPointerEvent extends Event {
      pointerId: number
      clientX: number
      clientY: number
      constructor(type: string, init: PointerEventInit & { pointerId?: number } = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.clientX = init.clientX ?? 0
        this.clientY = init.clientY ?? 0
      }
    }

    await act(async () => {
      fromPath.dispatchEvent(
        new TestPointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }),
      )
    })
    expect(host.querySelector('[data-testid="svg-map"]')?.getAttribute("data-arrow-drag")).toBe(
      "invalid",
    )

    await act(async () => {
      farPath.dispatchEvent(new TestPointerEvent("pointerover", { bubbles: true, pointerId: 1 }))
    })
    expect(host.querySelector('[data-testid="svg-map"]')?.getAttribute("data-arrow-drag")).toBe(
      "invalid",
    )

    await act(async () => {
      neighborPath.dispatchEvent(
        new TestPointerEvent("pointerover", { bubbles: true, pointerId: 1 }),
      )
    })
    expect(host.querySelector('[data-testid="svg-map"]')?.getAttribute("data-arrow-drag")).toBe(
      "valid",
    )

    await act(async () => {
      farPath.dispatchEvent(
        new TestPointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }),
      )
    })
    expect(onDraw).toHaveBeenCalledWith("krakow", "warszawa")

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it("keeps non-adjacent out of the legalTargets neighbor drop set", () => {
    const { state } = freshGame()
    const targets = legalTargets(state, "krakow", [])
    expect(isNeighborOrderTarget(targets, "warszawa")).toBe(false)
    expect(nonAdjacentArrowHint("Kraków", "Warsaw")).toContain("cancelled")
  })
})
