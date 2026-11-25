// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest"
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

/** jsdom lacks PointerEvent — minimal Event subclass with pointer fields. */
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

describe("arrow neighbor UI guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("wires MapLibre + SVG preview invalid styling and touch/pointer drag", () => {
    const war = readFileSync("components/war-map.tsx", "utf8")
    expect(war).toContain("data-arrow-drag")
    expect(war).toContain("not-allowed")
    expect(war).toContain("previewMarch")
    expect(war).toContain("marchPreviewLine")
    expect(war).toContain("data-drag-reason")
    expect(war).toContain("touchstart")
    expect(war).toContain("touchmove")
    expect(war).toContain("touchend")
    expect(war).toContain("touchcancel")
    expect(war).toContain("cancelDrag")
    expect(war).toContain("pointercancel")
    expect(war).toMatch(/properties:\s*\{\s*valid:/)

    const layers = readFileSync("lib/map/war-map-layers.ts", "utf8")
    expect(layers).toContain('["get", "valid"]')

    const svg = readFileSync("components/svg-map.tsx", "utf8")
    expect(svg).toContain("data-arrow-drag")
    expect(svg).toContain("data-arrow-valid")
    expect(svg).toContain("not-allowed")
    expect(svg).toContain("onPointerDown")
    expect(svg).toContain("onPointerUp")
    expect(svg).toContain("elementFromPoint")
    expect(svg).toContain("releasePointerCapture")
    expect(svg).toContain('touchAction: "none"')
    expect(war).toContain("map.dragPan.disable()")
    expect(war).not.toContain("if (orderMode) map.dragPan.disable()")
    expect(war).toContain('touchAction = "none"')
    expect(svg).toContain("onPointerCancel")
    expect(svg).toContain("provinceIdAt")

    const game = readFileSync("components/game-app.tsx", "utf8")
    expect(game).toContain("previewMarch")
    expect(game).toContain("if (!verdict.ok)")

    const teach = readFileSync("components/teaching-app.tsx", "utf8")
    expect(teach).toContain("previewMarch")
    expect(teach).toContain("if (!verdict.ok)")
  })

  it("hit-tests drop target via elementFromPoint (touch capture safe)", async () => {
    const { state } = freshGame()
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
          treasury={state.treasury}
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

    const svg = host.querySelector('[data-testid="svg-map"]') as SVGSVGElement
    const fromPath = host.querySelector('[data-province-id="krakow"]') as SVGPathElement
    const neighborPath = host.querySelector('[data-province-id="kielce"]') as SVGPathElement
    const farPath = host.querySelector('[data-province-id="warszawa"]') as SVGPathElement
    expect(fromPath).toBeTruthy()
    expect(neighborPath).toBeTruthy()
    expect(farPath).toBeTruthy()
    expect(svg.style.touchAction).toBe("none")

    const release = vi.fn()
    fromPath.hasPointerCapture = () => true
    fromPath.releasePointerCapture = release

    await act(async () => {
      fromPath.dispatchEvent(
        new TestPointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }),
      )
    })
    expect(release).toHaveBeenCalledWith(1)
    expect(svg.getAttribute("data-arrow-drag")).toBe("invalid")

    // jsdom has no elementFromPoint — install a stub for touch-capture hit-testing.
    let hit: Element | null = farPath
    document.elementFromPoint = (() => hit) as typeof document.elementFromPoint

    await act(async () => {
      // Bubbles to the svg handler which hit-tests hover/drop.
      fromPath.dispatchEvent(
        new TestPointerEvent("pointermove", {
          bubbles: true,
          clientX: 40,
          clientY: 40,
          pointerId: 1,
        }),
      )
    })
    expect(svg.getAttribute("data-arrow-drag")).toBe("invalid")
    expect(svg.getAttribute("data-drag-block")).toBe("warszawa")
    expect(svg.getAttribute("data-drag-reason")).toBe("No shared border")
    expect(host.querySelector('[data-testid="svg-arrow-preview"]')).toBeNull()

    hit = neighborPath
    await act(async () => {
      fromPath.dispatchEvent(
        new TestPointerEvent("pointermove", {
          bubbles: true,
          clientX: 50,
          clientY: 50,
          pointerId: 1,
        }),
      )
    })
    expect(svg.getAttribute("data-arrow-drag")).toBe("valid")
    expect(svg.getAttribute("data-drag-reason")).toBeNull()

    hit = farPath
    await act(async () => {
      // pointerup still fires on the origin path (implicit capture) — hit-test must win.
      fromPath.dispatchEvent(
        new TestPointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX: 60,
          clientY: 60,
          pointerId: 1,
        }),
      )
    })
    expect(onDraw).toHaveBeenCalledWith("krakow", "warszawa")
    expect(onSelect).not.toHaveBeenCalled()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it("cancels SVG drag on pointercancel without committing", async () => {
    const { state } = freshGame()
    const provinces = mapProvinces()
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    const onDraw = vi.fn()

    await act(async () => {
      root.render(
        <SvgMap
          provinces={provinces}
          treasury={state.treasury}
          selectedId="krakow"
          overlay="none"
          orders={[]}
          flashIds={[]}
          orderMode
          showRails={false}
          onSelect={() => {}}
          onDraw={onDraw}
        />,
      )
    })

    const svg = host.querySelector('[data-testid="svg-map"]') as SVGSVGElement
    const fromPath = host.querySelector('[data-province-id="krakow"]') as SVGPathElement
    await act(async () => {
      fromPath.dispatchEvent(
        new TestPointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }),
      )
    })
    expect(svg.getAttribute("data-arrow-drag")).toBe("invalid")

    await act(async () => {
      svg.dispatchEvent(new TestPointerEvent("pointercancel", { bubbles: true, pointerId: 1 }))
    })
    expect(svg.getAttribute("data-arrow-drag")).toBeNull()
    expect(onDraw).not.toHaveBeenCalled()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it("blocks a starved neighbour during the drag and draws no arrow", async () => {
    const { state } = freshGame()
    const provinces = mapProvinces()
    const krakow = provinces.find((province) => province.id === "krakow")
    if (!krakow) throw new Error("krakow missing")
    krakow.supply = 22
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <SvgMap
          provinces={provinces}
          treasury={state.treasury}
          selectedId="krakow"
          overlay="none"
          orders={[]}
          flashIds={[]}
          orderMode
          showRails={false}
          onSelect={() => {}}
          onDraw={() => {}}
        />,
      )
    })
    const svg = host.querySelector('[data-testid="svg-map"]') as SVGSVGElement
    const fromPath = host.querySelector('[data-province-id="krakow"]') as SVGPathElement
    const neighborPath = host.querySelector('[data-province-id="kielce"]') as SVGPathElement
    document.elementFromPoint = (() => neighborPath) as typeof document.elementFromPoint
    await act(async () => {
      fromPath.dispatchEvent(
        new TestPointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }),
      )
      fromPath.dispatchEvent(
        new TestPointerEvent("pointermove", { bubbles: true, clientX: 12, clientY: 12, pointerId: 1 }),
      )
    })
    expect(svg.getAttribute("data-arrow-drag")).toBe("invalid")
    expect(svg.getAttribute("data-drag-block")).toBe("kielce")
    expect(svg.getAttribute("data-drag-reason")).toBe("Supply 22 < 30")
    expect(host.querySelector('[data-testid="svg-arrow-preview"]')).toBeNull()
    const blocked = host.querySelector('[data-province-id="kielce"]') as SVGPathElement
    expect(blocked.getAttribute("stroke")).toBe("#8a3a32")
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
