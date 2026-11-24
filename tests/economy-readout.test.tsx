// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { EconomyReadout } from "@/components/economy-readout"
import { createInitialState } from "@/lib/data/scenario"
import { CENTRAL_INDUSTRY_MULTIPLIER, explainIncome, explainRefit, projectIncome } from "@/lib/engine/economy"

describe("economy readout", () => {
  it("opens on click and shows the engine figures for manpower and industry", async () => {
    const state = createInitialState("normal")
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<EconomyReadout state={state} refitSkipIds={["g-kra-11"]} />)
    })

    const manpower = host.querySelector('[data-testid="economy-manpower"]') as HTMLButtonElement
    expect(manpower).toBeTruthy()
    expect(host.querySelector('[data-testid="economy-breakdown"]')).toBeNull()

    await act(async () => {
      manpower.click()
    })

    const panel = host.querySelector('[data-testid="economy-breakdown"]') as HTMLElement
    const income = projectIncome(state, "central")
    const explained = explainIncome(state, "central")
    const refit = explainRefit(state, "central", new Set(["g-kra-11"]))
    expect(panel).toBeTruthy()
    expect(panel.getAttribute("data-economy-focus")).toBe("manpower")
    expect(panel.getAttribute("data-income-mp")).toBe(String(income.mp))
    expect(panel.getAttribute("data-income-ip")).toBe(String(income.ip))
    expect(panel.getAttribute("data-refit-mp")).toBe(String(refit.mp))
    expect(panel.getAttribute("data-industry-multiplier")).toBe(String(CENTRAL_INDUSTRY_MULTIPLIER))
    expect(panel.textContent).toContain("unrest/100")
    expect(panel.textContent).toContain("halved if occupied")
    expect(panel.textContent).toContain("under 30")
    expect(panel.textContent).toContain("1.3")
    expect(panel.textContent).toContain("per 4 strength")
    expect(panel.textContent).toContain(`+${income.mp}`)
    expect(panel.textContent).toContain(`+${explained.income.ip}`)
    expect(panel.textContent).toContain("queued attacks are left out")

    const industry = host.querySelector('[data-testid="economy-industry"]') as HTMLButtonElement
    await act(async () => {
      industry.click()
    })
    expect(panel.getAttribute("data-economy-focus")).toBe("industry")

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(host.querySelector('[data-testid="economy-breakdown"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
