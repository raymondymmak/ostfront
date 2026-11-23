"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Settings } from "lucide-react"
import { Button } from "@/components/ui/button"

export type HudOptionsMenuProps = {
  armReset: boolean
  teachMode?: boolean
  onReset: () => void
}

type MenuItemId = "restart" | "settings"

/**
 * Compact parchment options control for the HUD: gear opens a small menu
 * with Restart (existing arm/confirm flow) and a disabled Settings placeholder.
 */
export function HudOptionsMenu({ armReset, teachMode, onReset }: HudOptionsMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Partial<Record<MenuItemId, HTMLButtonElement | null>>>({})
  const menuId = useId()
  const labelId = useId()

  const restartLabel = armReset ? "Confirm restart" : teachMode ? "Restart drill" : "Restart"

  const items: Array<{ id: MenuItemId; label: string; disabled: boolean }> = [
    { id: "restart", label: restartLabel, disabled: false },
    { id: "settings", label: "Settings (soon)", disabled: true },
  ]

  function closeMenu(focusTrigger = true) {
    setOpen(false)
    if (focusTrigger) {
      queueMicrotask(() => triggerRef.current?.focus())
    }
  }

  function openMenu() {
    setOpen(true)
  }

  function focusItem(id: MenuItemId) {
    queueMicrotask(() => itemRefs.current[id]?.focus())
  }

  function enabledIds(): MenuItemId[] {
    return items.filter((item) => !item.disabled).map((item) => item.id)
  }

  function activate(id: MenuItemId) {
    if (id === "settings") return
    // First click arms confirm (label flips in place); second click closes + resets.
    const confirming = armReset
    onReset()
    if (confirming) closeMenu(true)
  }

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      const root = rootRef.current
      if (!root) return
      if (event.target instanceof Node && !root.contains(event.target)) {
        closeMenu(false)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        closeMenu(true)
        return
      }

      const enabled = enabledIds()
      const allIds = items.map((item) => item.id)
      const active = document.activeElement
      const currentId = allIds.find((id) => itemRefs.current[id] === active)

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        event.stopPropagation()
        if (enabled.length === 0) return
        if (!currentId) {
          focusItem(enabled[0]!)
          return
        }
        // Include disabled items in the arrow walk so Settings is reachable for
        // screen-reader discovery; activation still no-ops when disabled.
        const idx = allIds.indexOf(currentId)
        const next =
          event.key === "ArrowDown"
            ? allIds[(idx + 1) % allIds.length]!
            : allIds[(idx - 1 + allIds.length) % allIds.length]!
        focusItem(next)
        return
      }

      if (event.key === "Home") {
        event.preventDefault()
        focusItem(allIds[0]!)
        return
      }
      if (event.key === "End") {
        event.preventDefault()
        focusItem(allIds[allIds.length - 1]!)
        return
      }
    }

    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown, true)
    focusItem(items[0]!.id)

    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown, true)
    }
    // items / enabledIds are stable for a given open session (labels may change
    // with armReset but the id list does not).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open gate only
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Button
        ref={triggerRef}
        type="button"
        size="icon-sm"
        variant="outline"
        className="rounded-sm border-leather/40 bg-paper text-ink hover:bg-paper-deep aria-expanded:border-brass/70 aria-expanded:bg-brass/15"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Options"
        data-testid="hud-options"
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault()
            openMenu()
          }
        }}
      >
        <Settings className="size-3.5 text-brass" aria-hidden="true" strokeWidth={2} />
      </Button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={labelId}
          data-testid="hud-options-menu"
          className="absolute right-0 top-[calc(100%+4px)] z-[60] min-w-[11.5rem] rounded-sm border border-leather/45 bg-paper py-1 shadow-[0_8px_20px_rgba(36,28,20,0.18)]"
        >
          <p id={labelId} className="sr-only">
            Options
          </p>
          {items.map((item) => (
            <button
              key={item.id}
              ref={(node) => {
                itemRefs.current[item.id] = node
              }}
              type="button"
              role="menuitem"
              data-testid={item.id === "restart" ? "hud-options-restart" : "hud-options-settings"}
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              className={`flex w-full px-3 py-1.5 text-left text-sm outline-none ${
                item.disabled
                  ? "cursor-not-allowed text-ink-muted/70"
                  : "text-ink hover:bg-paper-deep focus:bg-paper-deep focus-visible:bg-brass/20"
              }`}
              onClick={() => {
                if (item.disabled) return
                activate(item.id)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  if (!item.disabled) activate(item.id)
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
