/** Selectors for tabbable controls inside the news overlay. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute("disabled")) return false
    if (element.getAttribute("aria-hidden") === "true") return false
    return true
  })
}

/** Keep Tab / Shift+Tab cycling within `container`. Returns true when the key was handled. */
export function handleNewsFocusTrapKeydown(event: KeyboardEvent, container: HTMLElement): boolean {
  if (event.key !== "Tab") return false
  const nodes = focusableElements(container)
  if (nodes.length === 0) return false

  const first = nodes[0]!
  const last = nodes[nodes.length - 1]!
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null

  if (event.shiftKey) {
    if (active === first || (active && !container.contains(active))) {
      event.preventDefault()
      last.focus()
      return true
    }
    return false
  }

  if (active === last || (active && !container.contains(active))) {
    event.preventDefault()
    first.focus()
    return true
  }
  return false
}

/** Redirect stray focus back into the overlay (defence in depth with `inert` on the game shell). */
export function refocusIntoContainer(container: HTMLElement, target: EventTarget | null): void {
  if (target instanceof Node && container.contains(target)) return
  const nodes = focusableElements(container)
  nodes[0]?.focus()
}