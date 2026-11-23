// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { readFileSync } from "node:fs"
import { FloatingWindow } from "@/components/floating-window"
import { dragPreservesSize, positionAfterPointerDrag } from "@/lib/ui/window-drag"

describe("FloatingWindow pointer drag", () => {
  it("wires press-drag-release pointer handlers (no click-to-place)", () => {
    const src = readFileSync("components/floating-window.tsx", "utf8")
    expect(src).toContain("onPointerDown")
    expect(src).toContain("onPointerMove")
    expect(src).toContain("onPointerUp")
    expect(src).toContain("setPointerCapture")
    expect(src).toContain('data-testid="floating-window-drag-handle"')
    expect(src).toContain("positionAfterPointerDrag")
    expect(src).toContain("onTrayHover")
    expect(src).toContain("shouldFileIntoTray")
    expect(src).toContain("liftYAboveTray")
    expect(src).toContain("onPointerCancel")
    expect(src).toContain("onLostPointerCapture")
    expect(src).toContain("setPointerCapture")
    expect(src).not.toMatch(/click-to-place|dragMode|placing/)
    expect(src).not.toMatch(/>Stow</)
    expect(src).not.toContain("floating-window-stow")
  })

  it("moves on pointerdown → move → up without a second click, and keeps size", async () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number
      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 0
      }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent)
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()

    const moves: Array<{ x: number; y: number }> = []
    const onMove = vi.fn((x: number, y: number) => {
      moves.push({ x, y })
    })
    const onFocus = vi.fn()
    const onClose = vi.fn()

    const host = document.createElement("div")
    host.style.position = "relative"
    host.style.width = "1440px"
    host.style.height = "820px"
    Object.defineProperty(host, "clientWidth", { value: 1440 })
    Object.defineProperty(host, "clientHeight", { value: 820 })
    document.body.append(host)
    const mount = document.createElement("div")
    host.append(mount)

    const root = createRoot(mount)
    await act(async () => {
      root.render(
        <FloatingWindow
          title="Orders"
          open
          x={100}
          y={120}
          z={30}
          testId="orders-window"
          onFocus={onFocus}
          onClose={onClose}
          onMove={onMove}
          resizable={false}
        >
          <div style={{ height: 200 }}>body</div>
        </FloatingWindow>,
      )
    })

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    })

    const dialog = host.querySelector('[data-testid="orders-window"]') as HTMLElement
    expect(dialog).toBeTruthy()
    const beforeH = dialog.getBoundingClientRect().height
    Object.defineProperty(dialog, "offsetWidth", { value: 320, configurable: true })
    Object.defineProperty(dialog, "offsetHeight", {
      value: beforeH || 360,
      configurable: true,
    })
    Object.defineProperty(dialog, "offsetParent", { value: host, configurable: true })

    const handle = host.querySelector(
      '[data-testid="floating-window-drag-handle"]',
    ) as HTMLElement
    expect(handle).toBeTruthy()

    await act(async () => {
      handle.dispatchEvent(
        new TestPointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          clientX: 150,
          clientY: 130,
        }),
      )
      handle.dispatchEvent(
        new TestPointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          clientX: 190,
          clientY: 170,
        }),
      )
      handle.dispatchEvent(
        new TestPointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          clientX: 190,
          clientY: 170,
        }),
      )
    })

    expect(onFocus).toHaveBeenCalled()
    expect(onMove).toHaveBeenCalled()
    expect(moves.at(-1)).toEqual({ x: 140, y: 160 })
    expect(dialog.getAttribute("data-dragging")).toBeNull()

    const afterH = dialog.getBoundingClientRect().height
    expect(dragPreservesSize({ w: 320, h: beforeH || afterH }, { w: 320, h: afterH || beforeH })).toBe(
      true,
    )

    const pure = positionAfterPointerDrag(
      { x: 100, y: 120 },
      { clientX: 150, clientY: 130 },
      { clientX: 190, clientY: 170 },
      { w: 320, h: 360 },
      { width: 1440, height: 820 },
    )
    expect(pure).toEqual({ x: 140, y: 160 })

    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  async function mountOrders(onStow: ReturnType<typeof vi.fn>) {
    class TestPointerEvent extends MouseEvent {
      pointerId: number
      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 0
      }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent)
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true })

    const host = document.createElement("div")
    host.style.position = "relative"
    host.style.width = "1440px"
    host.style.height = "820px"
    Object.defineProperty(host, "clientWidth", { value: 1440 })
    Object.defineProperty(host, "clientHeight", { value: 820 })
    Object.defineProperty(host, "getBoundingClientRect", {
      value: () => ({ top: 0, left: 0, bottom: 820, right: 1440, width: 1440, height: 820 }),
      configurable: true,
    })
    document.body.append(host)
    const mount = document.createElement("div")
    host.append(mount)

    const root = createRoot(mount)
    await act(async () => {
      root.render(
        <FloatingWindow
          title="Orders"
          open
          x={100}
          y={120}
          z={40}
          testId="orders-window"
          onFocus={vi.fn()}
          onClose={vi.fn()}
          onMove={vi.fn()}
          onStow={onStow}
          resizable={false}
        >
          <div style={{ height: 200 }}>body</div>
        </FloatingWindow>,
      )
    })
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    })

    const dialog = host.querySelector('[data-testid="orders-window"]') as HTMLElement
    Object.defineProperty(dialog, "offsetWidth", { value: 320, configurable: true })
    Object.defineProperty(dialog, "offsetHeight", { value: 360, configurable: true })
    Object.defineProperty(dialog, "offsetParent", { value: host, configurable: true })
    const handle = host.querySelector(
      '[data-testid="floating-window-drag-handle"]',
    ) as HTMLElement
    return { host, root, handle, TestPointerEvent }
  }

  it("files on pointerup at clientY equal to the viewport height", async () => {
    const onStow = vi.fn()
    const { host, root, handle, TestPointerEvent } = await mountOrders(onStow)

    await act(async () => {
      handle.dispatchEvent(
        new TestPointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 2,
          button: 0,
          clientX: 150,
          clientY: 130,
        }),
      )
      handle.dispatchEvent(
        new TestPointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId: 2,
          clientX: 150,
          clientY: 880,
        }),
      )
      handle.dispatchEvent(
        new TestPointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 2,
          clientX: 150,
          clientY: 900,
        }),
      )
    })

    expect(onStow).toHaveBeenCalledTimes(1)
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it("files on pointerup beyond the viewport height", async () => {
    const onStow = vi.fn()
    const { host, root, handle, TestPointerEvent } = await mountOrders(onStow)

    await act(async () => {
      handle.dispatchEvent(
        new TestPointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 3,
          button: 0,
          clientX: 150,
          clientY: 130,
        }),
      )
      handle.dispatchEvent(
        new TestPointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 3,
          clientX: 150,
          clientY: 940,
        }),
      )
    })

    expect(onStow).toHaveBeenCalledTimes(1)
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it("files on pointercancel after the pointer entered the tray band", async () => {
    const onStow = vi.fn()
    const { host, root, handle, TestPointerEvent } = await mountOrders(onStow)

    await act(async () => {
      handle.dispatchEvent(
        new TestPointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 4,
          button: 0,
          clientX: 150,
          clientY: 130,
        }),
      )
      handle.dispatchEvent(
        new TestPointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId: 4,
          clientX: 150,
          clientY: 800,
        }),
      )
      handle.dispatchEvent(
        new TestPointerEvent("pointercancel", {
          bubbles: true,
          cancelable: true,
          pointerId: 4,
          clientX: 150,
          clientY: 800,
        }),
      )
    })

    expect(onStow).toHaveBeenCalledTimes(1)
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it("files on lostpointercapture after the pointer was over the tray", async () => {
    const onStow = vi.fn()
    const { host, root, handle, TestPointerEvent } = await mountOrders(onStow)

    await act(async () => {
      handle.dispatchEvent(
        new TestPointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 5,
          button: 0,
          clientX: 150,
          clientY: 130,
        }),
      )
      handle.dispatchEvent(
        new TestPointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId: 5,
          clientX: 150,
          clientY: 810,
        }),
      )
      handle.dispatchEvent(
        new TestPointerEvent("lostpointercapture", {
          bubbles: true,
          cancelable: true,
          pointerId: 5,
        }),
      )
    })

    expect(onStow).toHaveBeenCalledTimes(1)
    await act(async () => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })
})
