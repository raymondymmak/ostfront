"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FACTION_LABEL } from "@/lib/format"
import type { GameState } from "@/lib/types"

type HudProps = {
  state: GameState
  overlay: "none" | "supply" | "unrest"
  onOverlay: (overlay: "none" | "supply" | "unrest") => void
  armReset: boolean
  onReset: () => void
}

export function Hud({ state, overlay, onOverlay, armReset, onReset }: HudProps) {
  const central = strength(state, "central")
  const russia = strength(state, "russia")
  const held = {
    central: state.provinces.filter((province) => province.controller === "central").length,
    russia: state.provinces.filter((province) => province.controller === "russia").length,
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-3 py-2.5 sm:px-4">
      <div className="min-w-40">
        <p className="font-display text-[1.65rem] leading-none tracking-wide text-primary italic">
          Ostfront
        </p>
        <p className="mt-1 text-xs tracking-wide text-muted-foreground uppercase">
          Eastern Front · June 1915
        </p>
      </div>
      <div className="text-center">
        <p className="font-display text-xl leading-none">{state.date}</p>
        <p className="mt-1 text-xs text-muted-foreground">Fortnight {state.turn + 1}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-[#4a6d90] text-[#d5e2f2]">
          {FACTION_LABEL.central} {central} · {held.central}
        </Badge>
        <Badge variant="outline" className="border-[#a85b49] text-[#f0d2cb]">
          {FACTION_LABEL.russia} {russia} · {held.russia}
        </Badge>
        <div className="flex rounded-lg border border-border p-0.5">
          {(
            [
              ["none", "Control"],
              ["supply", "Supply"],
              ["unrest", "Unrest"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={overlay === id ? "default" : "ghost"}
              aria-pressed={overlay === id}
              onClick={() => onOverlay(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onReset}>
          {armReset ? "Confirm restart" : "Restart"}
        </Button>
      </div>
    </header>
  )
}

function strength(state: GameState, faction: "central" | "russia") {
  return state.provinces.reduce(
    (sum, province) =>
      sum +
      province.units
        .filter((unit) => unit.faction === faction)
        .reduce((inner, unit) => inner + unit.strength, 0),
    0,
  )
}
