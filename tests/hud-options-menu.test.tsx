// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { readFileSync } from "node:fs"
import { HudOptionsMenu } from "@/components/hud-options-menu"
import { Hud } from "@/components/hud"
import { createInitialState } from "@/lib/data/scenario"

describe("HudOptionsMenu", () => {
  it("exposes an accessible options trigger and menu markup", () => {
    const src = readFileSync("components/hud-options-menu.tsx", "utf8")
    expect(src).toContain('data-testid="hud-options"')
    expect(src).toContain('data-testid="hud-options-menu"')
    expect(src).toContain("hud-options-restart")
    expect(src).toContain("hud-options-settings")
    expect(src).toContain('aria-haspopup="menu"')
    expect(src).toContain('role="menu"')
    expect(src).toContain('role="menuitem"')
    expect(src).toContain("Settings (soon)")
    expect(src).toContain("Escape")
  })

  it("opens, closes on Escape, runs Restart, and keeps Settings disabled", async () => {
    const onReset = vi.fn()
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<HudOptionsMenu armReset={false} onReset={onReset} />)
    })

    const trigger = host.querySelector('[data-testid="hud-options"]') as HTMLButtonElement
    expect(trigger).toBeTruthy()
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu")

    await act(async () => {
      trigger.click()
    })

    const menu = host.querySelector('[data-testid="hud-options-menu"]') as HTMLElement
    expect(menu).toBeTruthy()
    expect(menu.getAttribute("role")).toBe("menu")
    expect(trigger.getAttribute("aria-expanded")).toBe("true")

    const settings = host.querySelector('[data-testid="hud-options-settings"]') as HTMLButtonElement
    expect(settings).toBeTruthy()
    expect(settings.getAttribute("aria-disabled")).toBe("true")
    expect(settings.textContent).toContain("Settings (soon)")

    await act(async () => {
      settings.click()
    })
    expect(onReset).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="hud-options-menu"]')).toBeTruthy()

    const restart = host.querySelector('[data-testid="hud-options-restart"]') as HTMLButtonElement
    expect(restart.textContent).toBe("Restart")
    await act(async () => {
      restart.click()
    })
    expect(onReset).toHaveBeenCalledTimes(1)
    // First click arms confirm; menu stays open so the label can flip.
    expect(host.querySelector('[data-testid="hud-options-menu"]')).toBeTruthy()

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(host.querySelector('[data-testid="hud-options-menu"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  it("ignores navigation keys once focus leaves the menu", async () => {
    const onReset = vi.fn()
    const host = document.createElement("div")
    document.body.append(host)
    const outside = document.createElement("button")
    outside.textContent = "map"
    document.body.append(outside)
    const root = createRoot(host)

    await act(async () => {
      root.render(<HudOptionsMenu armReset={false} onReset={onReset} />)
    })

    const trigger = host.querySelector('[data-testid="hud-options"]') as HTMLButtonElement
    await act(async () => {
      trigger.click()
    })
    expect(host.querySelector('[data-testid="hud-options-menu"]')).toBeTruthy()

    // Focus leaving the menu closes it so map/tray shortcuts are free again.
    await act(async () => {
      outside.focus()
    })
    expect(host.querySelector('[data-testid="hud-options-menu"]')).toBeNull()

    const arrow = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    })
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      document.dispatchEvent(arrow)
      document.dispatchEvent(escape)
    })
    expect(arrow.defaultPrevented).toBe(false)
    expect(escape.defaultPrevented).toBe(false)
    expect(host.querySelector('[data-testid="hud-options-menu"]')).toBeNull()

    const src = readFileSync("components/hud-options-menu.tsx", "utf8")
    expect(src).toContain("focusInsideMenu")
    expect(src).toContain('document.addEventListener("focusin", onFocusIn)')

    await act(async () => {
      root.unmount()
    })
    host.remove()
    outside.remove()
  })

  it("closes when clicking outside the menu", async () => {
    const onReset = vi.fn()
    const host = document.createElement("div")
    document.body.append(host)
    const outside = document.createElement("button")
    outside.textContent = "outside"
    document.body.append(outside)
    const root = createRoot(host)

    await act(async () => {
      root.render(<HudOptionsMenu armReset={false} onReset={onReset} />)
    })

    const trigger = host.querySelector('[data-testid="hud-options"]') as HTMLButtonElement
    await act(async () => {
      trigger.click()
    })
    expect(host.querySelector('[data-testid="hud-options-menu"]')).toBeTruthy()

    await act(async () => {
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })
    expect(host.querySelector('[data-testid="hud-options-menu"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    host.remove()
    outside.remove()
  })

  it("shows Confirm restart when armed and closes after confirm", async () => {
    const onReset = vi.fn()
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<HudOptionsMenu armReset onReset={onReset} />)
    })
    await act(async () => {
      ;(host.querySelector('[data-testid="hud-options"]') as HTMLButtonElement).click()
    })
    expect(host.querySelector('[data-testid="hud-options-restart"]')?.textContent).toBe(
      "Confirm restart",
    )
    await act(async () => {
      ;(host.querySelector('[data-testid="hud-options-restart"]') as HTMLButtonElement).click()
    })
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="hud-options-menu"]')).toBeNull()
    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})

describe("Hud slim layout", () => {
  it("places options beside the date and keeps readout test ids", () => {
    const hud = readFileSync("components/hud.tsx", "utf8")
    expect(hud).toContain("HudOptionsMenu")
    expect(hud).toContain('data-testid="table-hud"')
    expect(hud).toContain('data-testid="objectives"')
    expect(hud).toContain('data-testid="treasury"')
    expect(hud).toContain('data-testid="grade"')
    expect(hud).not.toMatch(/>Restart</)
    expect(hud).not.toContain("Confirm restart")
    expect(hud).toMatch(/py-1\.5/)
    expect(hud).toMatch(/xl:flex-nowrap/)
  })

  it("renders a compact header with options next to the date", async () => {
    const onReset = vi.fn()
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <Hud
          state={createInitialState("normal")}
          armReset={false}
          onReset={onReset}
          tableShell
        />,
      )
    })

    const header = host.querySelector('[data-testid="table-hud"]') as HTMLElement
    expect(header).toBeTruthy()
    expect(header.querySelector('[data-testid="objectives"]')).toBeTruthy()
    expect(header.querySelector('[data-testid="treasury"]')).toBeTruthy()
    expect(header.querySelector('[data-testid="grade"]')).toBeTruthy()
    expect(header.querySelector('[data-testid="hud-options"]')).toBeTruthy()
    expect(header.textContent).toContain("2 May 1915")
    expect(header.textContent).toContain("Strength")
    expect(header.textContent).toContain("Manpower")
    expect(header.textContent).not.toContain("Chief of Staff")
    // Restart is no longer a top-level HUD button.
    expect(header.querySelector('button[data-testid="hud-options-restart"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
