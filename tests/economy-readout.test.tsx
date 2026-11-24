// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { EconomyReadout } from "@/components/economy-readout"
import { createInitialState } from "@/lib/data/scenario"
import {
  CENTRAL_INDUSTRY_MULTIPLIER,
  describeProvinceIncome,
  explainIncome,
  explainRefit,
  projectIncome,
} from "@/lib/engine/economy"

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
    expect(panel.textContent).toContain("Reinforcing damaged armies costs 1 manpower per 4 strength.")
    expect(panel.textContent).not.toMatch(/×\s*1\.3/)
    expect(panel.textContent).not.toMatch(/multiplier/i)
    expect(panel.textContent).not.toMatch(/this fortnight/i)
    expect(panel.textContent).not.toMatch(/treasury already/i)
    expect(panel.textContent).not.toMatch(/round/i)
    expect(panel.textContent).not.toMatch(/refit/i)
    expect(panel.textContent).toContain("Austrian Silesia: 1 MP, 1 IND")
    const ruthenia = explainIncome(state, "central").provinces.find((province) => province.id === "podkarpatska_rus")
    if (ruthenia) expect(panel.textContent).toContain(describeProvinceIncome(ruthenia))
    for (const province of explained.provinces) {
      expect(panel.textContent).toContain(describeProvinceIncome(province))
    }

    const industry = host.querySelector('[data-testid="economy-industry"]') as HTMLButtonElement
    await act(async () => {
      industry.click()
    })
    expect(panel.getAttribute("data-economy-focus")).toBe("industry")
    expect(panel.textContent).toContain("Central Powers industry is ×1.3.")
    expect(panel.textContent).toContain("unrest/100")
    expect(panel.textContent).toContain("Reinforcing damaged armies costs 1 manpower per 4 strength.")
    expect(panel.textContent).toContain("Austrian Silesia: 1 MP, 1 IND")
    expect(panel.textContent).not.toMatch(/this fortnight/i)
    expect(panel.textContent).not.toMatch(/treasury already/i)
    expect(panel.textContent).not.toMatch(/round/i)
    expect(panel.textContent).not.toMatch(/refit/i)
    expect(panel.textContent).not.toMatch(/multiplier/i)

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
