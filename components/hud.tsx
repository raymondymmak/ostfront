"use client"

import { Button } from "@/components/ui/button"
import { listedStrength } from "@/lib/engine/echelon"
import { projectIncome } from "@/lib/engine/economy"
import { standing } from "@/lib/engine/victory"
import { statusLabel } from "@/lib/finale"
import { scenarioSpec } from "@/lib/data/objectives"
import { FACTION_LABEL } from "@/lib/format"
import type { GameState } from "@/lib/types"

type HudProps = {
  state: GameState
  armReset: boolean
  onReset: () => void
  advisorOpen: boolean
  onAdvisor: () => void
}

export function Hud({ state, armReset, onReset, advisorOpen, onAdvisor }: HudProps) {
  const central = strength(state, "central")
  const russia = strength(state, "russia")
  const held = {
    central: state.provinces.filter((province) => province.controller === "central").length,
    russia: state.provinces.filter((province) => province.controller === "russia").length,
  }
  const spec = scenarioSpec(state.scenario)
  const board = standing(state)
  const income = projectIncome(state, "central")
  const purse = state.treasury.central
  const shown = statusLabel(Boolean(state.result), state.result?.grade ?? board.grade)
  const total = central + russia
  const centralShare = total === 0 ? 0 : (central / total) * 100
  const russiaShare = total === 0 ? 0 : 100 - centralShare
  const fortnight = Math.min(state.turn + 1, spec.length)

  return (
    <header className="border-b border-border px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 md:flex-nowrap md:items-center">
        <p className="shrink-0 font-display text-[1.65rem] leading-none tracking-wide text-primary italic">
          Ostfront
        </p>
        <div
          data-testid="objectives"
          className="order-3 w-full min-w-0 md:order-none md:w-auto md:flex-1"
        >
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-[#2a241e]"
            role="img"
            aria-label={`Listed strength. ${FACTION_LABEL.central} ${central} versus ${FACTION_LABEL.russia} ${russia}.`}
          >
            <div
              className={`h-full bg-[#4a6d90] ${central > 0 && russia > 0 ? "shadow-[inset_-1px_0_0_rgba(246,241,228,0.85)]" : ""}`}
              style={{ width: `${centralShare}%` }}
              title={`${FACTION_LABEL.central} listed strength ${central}`}
            />
            <div
              className="h-full bg-[#a85b49]"
              style={{ width: `${russiaShare}%` }}
              title={`${FACTION_LABEL.russia} listed strength ${russia}`}
            />
          </div>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            <span title={`${FACTION_LABEL.central} listed strength versus ${FACTION_LABEL.russia}`}>
              Strength{" "}
              <span className="text-[#d5e2f2]" title={`${FACTION_LABEL.central} listed strength`}>
                <span className="sr-only">{FACTION_LABEL.central} </span>
                {central}
              </span>
              {" vs "}
              <span className="text-[#f0d2cb]" title={`${FACTION_LABEL.russia} listed strength`}>
                <span className="sr-only">{FACTION_LABEL.russia} </span>
                {russia}
              </span>
            </span>
            <span aria-hidden="true"> · </span>
            <span title={`Provinces held, ${FACTION_LABEL.central} versus ${FACTION_LABEL.russia}`}>
              Provinces{" "}
              <span title={`Provinces held by the ${FACTION_LABEL.central}`}>
                <span className="sr-only">{FACTION_LABEL.central} </span>
                {held.central}
              </span>
              {" vs "}
              <span title={`Provinces held by ${FACTION_LABEL.russia}`}>
                <span className="sr-only">{FACTION_LABEL.russia} </span>
                {held.russia}
              </span>
            </span>
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs text-muted-foreground">
            <span data-testid="treasury">
              Manpower{" "}
              <span title="Manpower in the treasury">{purse.mp}</span>{" "}
              <span title="Manpower income this fortnight">(+{income.mp})</span>
              <span aria-hidden="true"> · </span>
              Industry{" "}
              <span title="Industry in the treasury">{purse.ip}</span>{" "}
              <span title="Industry income this fortnight">(+{income.ip})</span>
            </span>
            <span title="Eastern victory points you hold, of those on the map">
              ★ VP <span title="Eastern victory points you hold">{board.captured}</span>
              /<span title="Eastern victory points available">{board.available}</span>
            </span>
            {state.result ? (
              <span data-testid="grade" title="The campaign is over">
                {shown}
              </span>
            ) : (
              <span>
                Grade{" "}
                <span data-testid="grade" title="Grade if the campaign ended this fortnight">
                  {shown}
                </span>
              </span>
            )}
            {!state.result && board.next ? (
              <span title={board.next.overdue ? "This objective is past its date" : "Next objective on the timetable"}>
                {board.next.name} by {board.next.date}
                {board.next.overdue ? " · overdue" : ""}
              </span>
            ) : null}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
          <div className="text-right">
            <p className="font-display text-xl leading-none" title="Date of this fortnight">
              {state.date}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Fortnight{" "}
              <span title="This fortnight, counting from the start of the campaign">{fortnight}</span>
              {" / "}
              <span title="Fortnights in the campaign">{spec.length}</span>
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant={advisorOpen ? "default" : "outline"}
              aria-expanded={advisorOpen}
              data-testid="advisor-toggle"
              onClick={onAdvisor}
            >
              Chief of Staff
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onReset}>
              {armReset ? "Confirm restart" : "Restart"}
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}

function strength(state: GameState, faction: "central" | "russia") {
  return state.provinces.reduce(
    (sum, province) => sum + listedStrength(province.units.filter((unit) => unit.faction === faction)),
    0,
  )
}
