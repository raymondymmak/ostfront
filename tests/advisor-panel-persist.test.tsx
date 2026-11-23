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
    expect(paper).toMatch(/keepMounted/)
    expect(paper).toMatch(/data-floating-window-kept/)
  })

  it("keeps draft, reply, and highlights after open=false then open=true", async () => {
    const state = createInitialState()
    const onHighlights = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          reply: "Your queue presses Kielce. Engine odds are on the dispatch.",
          source: "rules",
          unavailable: false,
          followUp: "Do you want one column only?",
          highlights: [{ provinceId: "kielce", uiId: "queued-orders" }],
          ordersClosed: false,
        }),
      ),
    )

    function render(open: boolean) {
      root.render(
        <AdvisorPanel
          open={open}
          embedded
          gameId={"a".repeat(32)}
          state={state}
          queue={[]}
          selectedProvinceId={null}
          closed={false}
          epoch={1}
          onClose={() => {}}
          onHighlights={onHighlights}
        />,
      )
    }

    await act(async () => {
      render(true)
    })

    const starterBtn = host.querySelector("[data-testid^=advisor-starter-]") as HTMLButtonElement
    expect(starterBtn).toBeTruthy()

    await act(async () => {
      starterBtn.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.querySelector('[data-testid="advisor-reply"]')?.textContent).toContain("Kielce")
    expect(host.querySelector('[data-testid="advisor-suggestion"]')).toBeNull()
    expect(host.querySelector('[data-testid="advisor-follow-up"]')?.textContent).toContain("column")
    expect(onHighlights).toHaveBeenCalled()

    await act(async () => {
      const draft = host.querySelector('[data-testid="advisor-input"]') as HTMLTextAreaElement
      setTextareaValue(draft, "And then Lemberg?")
    })
    expect((host.querySelector('[data-testid="advisor-input"]') as HTMLTextAreaElement).value).toBe(
      "And then Lemberg?",
    )

    await act(async () => {
      render(false)
    })
    expect(host.querySelector('[data-testid="advisor-panel"]')).toBeNull()

    await act(async () => {
      render(true)
    })

    expect(host.querySelector('[data-testid="advisor-reply"]')?.textContent).toContain("Kielce")
    expect(host.querySelector('[data-testid="advisor-suggestion"]')).toBeNull()
    expect((host.querySelector('[data-testid="advisor-input"]') as HTMLTextAreaElement).value).toBe(
      "And then Lemberg?",
    )
  })

  it("clears busy state and shows a retryable message when the advisor call times out", async () => {
    vi.useFakeTimers()
    const state = createInitialState()
    const onHighlights = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal
          if (!signal) {
            reject(new Error("missing abort signal"))
            return
          }
          const fail = () => reject(new DOMException("Aborted", "AbortError"))
          if (signal.aborted) {
            fail()
            return
          }
          signal.addEventListener("abort", fail, { once: true })
        })
      }),
    )

    await act(async () => {
      root.render(
        <AdvisorPanel
          open
          embedded
          gameId={"a".repeat(32)}
          state={state}
          queue={[]}
          selectedProvinceId={null}
          closed={false}
          epoch={1}
          onClose={() => {}}
          onHighlights={onHighlights}
        />,
      )
    })

    const starterBtn = host.querySelector("[data-testid^=advisor-starter-]") as HTMLButtonElement
    await act(async () => {
      starterBtn.click()
    })

    const send = () => host.querySelector('[data-testid="advisor-send"]') as HTMLButtonElement
    expect(send().disabled).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(26_000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(host.querySelector('[data-testid="advisor-reply"]')?.textContent).toMatch(/timed out|Try again/i)
    expect(send().disabled).toBe(true) // disabled while draft empty
    await act(async () => {
      const draft = host.querySelector('[data-testid="advisor-input"]') as HTMLTextAreaElement
      setTextareaValue(draft, "Retry please")
    })
    expect(send().disabled).toBe(false)
    vi.useRealTimers()
  })
})
