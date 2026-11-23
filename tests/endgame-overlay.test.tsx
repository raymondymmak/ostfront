/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { EndgameModal } from "@/components/endgame-modal"
import { createInitialState } from "@/lib/data/scenario"
import { decideFortnight } from "@/lib/engine/victory"
import { ENDGAME_OVERLAY_Z, PAPER_DRAG_Z } from "@/lib/ui/table-windows"

describe("endgame overlay stacking", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    document.body.querySelectorAll("[data-testid=endgame], [data-testid=orders-paper-standin]").forEach((node) => {
      node.remove()
    })
  })

  it("stacks above the highest paper drag layer", () => {
    expect(ENDGAME_OVERLAY_Z).toBeGreaterThan(PAPER_DRAG_Z)
  })

  it("portals the dim above papers so elementFromPoint hits the backdrop", async () => {
    const state = createInitialState()
    state.turn = 5
    state.date = "11 July 1915"
    const result = decideFortnight(state)
    expect(result).not.toBeNull()

    const paper = document.createElement("div")
    paper.setAttribute("data-testid", "orders-paper-standin")
    paper.style.position = "fixed"
    paper.style.left = "40px"
    paper.style.top = "80px"
    paper.style.width = "280px"
    paper.style.height = "360px"
    paper.style.zIndex = String(PAPER_DRAG_Z)
    document.body.append(paper)

    await act(async () => {
      root.render(
        <EndgameModal
          state={state}
          result={result!}
          onBackToMap={() => {}}
          onPlayAgain={() => {}}
        />,
      )
    })

    const endgame = document.querySelector<HTMLElement>('[data-testid="endgame"]')
    expect(endgame).not.toBeNull()
    expect(endgame!.parentElement).toBe(document.body)
    expect(Number(endgame!.getAttribute("data-endgame-z"))).toBe(ENDGAME_OVERLAY_Z)
    expect(Number.parseInt(getComputedStyle(endgame!).zIndex, 10)).toBe(ENDGAME_OVERLAY_Z)

    paper.getBoundingClientRect = () =>
      ({
        x: 40,
        y: 80,
        width: 280,
        height: 360,
        top: 80,
        left: 40,
        right: 320,
        bottom: 440,
        toJSON() {
          return {}
        },
      }) as DOMRect
    endgame!.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
        top: 0,
        left: 0,
        right: 1440,
        bottom: 900,
        toJSON() {
          return {}
        },
      }) as DOMRect

    document.elementFromPoint = ((x: number, y: number) => {
      const hits = [endgame!, paper].filter((node) => {
        const r = node.getBoundingClientRect()
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
      })
      hits.sort(
        (a, b) =>
          Number.parseInt(getComputedStyle(b).zIndex || "0", 10) -
          Number.parseInt(getComputedStyle(a).zIndex || "0", 10),
      )
      return hits[0] ?? null
    }) as typeof document.elementFromPoint

    const top = document.elementFromPoint(100, 120)
    expect(top).toBe(endgame)
  })

  it("wires the campaign shell to portal EndgameModal and inert chrome while open", () => {
    const app = readFileSync("components/game-app.tsx", "utf8")
    expect(app).toContain("EndgameModal")
    expect(app).toContain('phase === "result"')
    expect(app).toContain("blockChrome")
    expect(app).toContain("inert: true")
    expect(app).not.toMatch(/data-testid="endgame"[\s\S]*z-40/)
  })
})
