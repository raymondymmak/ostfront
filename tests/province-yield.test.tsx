// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { ProvincePanel } from "@/components/province-panel"
import { createInitialState } from "@/lib/data/scenario"
import type { UnitKind } from "@/lib/types"

const noop = () => {}

describe("province panel yield", () => {
  it("shows the selected province's manpower and industry yield", async () => {
    const state = createInitialState("normal")
    const krakow = state.provinces.find((item) => item.id === "krakow")!
    const ruthenia = state.provinces.find((item) => item.id === "podkarpatska_rus")!
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)

    function render(provinceId: string) {
      const province = state.provinces.find((item) => item.id === provinceId)!
      root.render(
        <ProvincePanel
          state={state}
          province={province}
          budget={{ mp: 20, ip: 20 }}
          onSelect={noop}
          onOrder={noop}
          onFortify={noop}
          onRecruit={noop as (provinceId: string, kind: UnitKind) => void}
          onCancelRecruit={noop}
        />,
      )
    }

    await act(async () => {
      render("krakow")
    })
    expect(host.querySelector("[data-testid=province-yield]")?.textContent).toBe("Yield 2 MP, 2 IND")
    expect(host.textContent).toContain(krakow.name)

    await act(async () => {
      render("podkarpatska_rus")
    })
    expect(host.querySelector("[data-testid=province-yield]")?.textContent).toBe(
      "Yield 0 (supply 27 < 30)",
    )
    expect(host.textContent).toContain(ruthenia.name)

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
