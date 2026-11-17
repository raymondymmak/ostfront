// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { focusableElements, handleNewsFocusTrapKeydown } from "@/lib/news/modal-focus"

describe("news modal focus trap", () => {
  it("lists only enabled buttons in the overlay", () => {
    const root = document.createElement("div")
    root.innerHTML = `
      <button type="button" id="skip">Skip all</button>
      <button type="button" id="onward" autofocus>Onward</button>
      <button type="button" disabled id="off">Off</button>
    `
    const buttons = focusableElements(root)
    expect(buttons.map((b) => b.id)).toEqual(["skip", "onward"])
  })

  it("wraps Tab from the last control back to the first", () => {
    const root = document.createElement("div")
    const skip = document.createElement("button")
    skip.id = "skip"
    const onward = document.createElement("button")
    onward.id = "onward"
    root.append(skip, onward)
    document.body.append(root)
    onward.focus()

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    const handled = handleNewsFocusTrapKeydown(event, root)
    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(skip)
    root.remove()
  })

  it("wraps Shift+Tab from the first control to the last", () => {
    const root = document.createElement("div")
    const skip = document.createElement("button")
    const onward = document.createElement("button")
    root.append(skip, onward)
    document.body.append(root)
    skip.focus()

    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })
    const handled = handleNewsFocusTrapKeydown(event, root)
    expect(handled).toBe(true)
    expect(document.activeElement).toBe(onward)
    root.remove()
  })
})

describe("onEndTurn guard while news is open", () => {
  it("does not dismiss news or close the fortnight from OrderPanel", () => {
    const app = readFileSync("components/game-app.tsx", "utf8")
    expect(app).toMatch(/onEndTurn=\{\(\) => \{\s*if \(newsQueue\.length\) return/)
    expect(app).not.toMatch(/if \(newsQueue\.length\) setNewsQueue\(\[\]\)\s*\n\s*void endTurn\(\)/)
  })
})