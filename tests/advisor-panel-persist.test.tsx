// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { AdvisorPanel } from "@/components/advisor-panel"
import { createInitialState } from "@/lib/data/scenario"

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("AdvisorPanel state retention", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    sessionStorage.clear()
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it("keeps phone TabsContent and desktop FloatingWindow mounted while filed", () => {
    const app = readFileSync("components/game-app.tsx", "utf8")
    expect(app).toMatch(/TabsContent value="advisor" keepMounted/)
    expect(app).toMatch(/!win\.open && win\.id !== "advisor"/)
    expect(app).toMatch(/keepMounted\s*\n\s*x=\{win\.x\}/)
    const paper = readFileSync("components/floating-window.tsx", "utf8")
    expect(paper).toContain("keepMounted")
    expect(paper).toContain("data-floating-window-kept")
  })

  it("keeps draft, reply, and suggestion cards after open=false then open=true", async () => {
    const state = createInitialState("normal")
    const unitId = state.provinces.find((p) => p.id === "krakow")?.units[0]?.id ?? "g-kra-11"

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            reply: "Press Kielce from Kraków.",
            offline: false,
            suggestions: [
              {
                id: "card-keep",
                label: "Attack Kielce",
                order: { type: "attack", from: "krakow", target: "kielce", unitIds: [unitId] },
                companions: [],
                queue: "new",
                valid: true,
                detail: "Favourable odds",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )

    function render(open: boolean) {
      root.render(
        <AdvisorPanel
          open={open}
          embedded
          state={state}
          queue={[]}
          closed={false}
          epoch={1}
          onClose={() => {}}
          onAccept={() => ({ ok: true })}
        />,
      )
    }

    await act(async () => {
      render(true)
    })

    const starter = host.querySelector(
      '[data-testid="advisor-starter-where"]',
    ) as HTMLButtonElement | null
    const starterBtn =
      starter ?? (host.querySelector("[data-testid^=advisor-starter-]") as HTMLButtonElement)
    expect(starterBtn).toBeTruthy()

    await act(async () => {
      starterBtn.click()
      // Flush ask() → fetch → setState.
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.querySelector('[data-testid="advisor-reply"]')?.textContent).toContain("Press Kielce")
    expect(host.querySelector('[data-testid="advisor-suggestion"]')?.textContent).toContain(
      "Attack Kielce",
    )

    await act(async () => {
      const draft = host.querySelector('[data-testid="advisor-input"]') as HTMLTextAreaElement
      setTextareaValue(draft, "And then Lemberg?")
    })
    expect((host.querySelector('[data-testid="advisor-input"]') as HTMLTextAreaElement).value).toBe(
      "And then Lemberg?",
    )

    // Hide (phone tab switch / desktop file) then show again — same React instance.
    await act(async () => {
      render(false)
    })
    expect(host.querySelector('[data-testid="advisor-panel"]')).toBeNull()

    await act(async () => {
      render(true)
    })

    expect(host.querySelector('[data-testid="advisor-reply"]')?.textContent).toContain("Press Kielce")
    expect(host.querySelector('[data-testid="advisor-suggestion"]')?.textContent).toContain(
      "Attack Kielce",
    )
    expect((host.querySelector('[data-testid="advisor-input"]') as HTMLTextAreaElement).value).toBe(
      "And then Lemberg?",
    )
  })
})
