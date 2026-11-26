"use client"

import Image from "next/image"
import { EconomyReadout } from "@/components/economy-readout"
import { HudOptionsMenu } from "@/components/hud-options-menu"
import { listedStrength } from "@/lib/engine/echelon"
import { standing } from "@/lib/engine/victory"
import { statusLabel } from "@/lib/finale"
import { scenarioSpec } from "@/lib/data/objectives"
import { FACTION_LABEL } from "@/lib/format"
import type { GameState } from "@/lib/types"

type HudProps = {
  state: GameState
  armReset: boolean
  onReset: () => void
  teachMode?: boolean
  /** Short lesson goal shown instead of the campaign objective on /teach. */
  teachGoal?: string
  /** Desktop general's-table: parchment chrome (window toggles live in the document tray). */
  tableShell?: boolean
  /** Unit ids ordered to attack. Left out of the manpower refit bill. */
  refitSkipIds?: readonly string[]
}

export function Hud({
  state,
  armReset,
  onReset,
  teachMode,
  teachGoal,
  tableShell: _tableShell = false,
  refitSkipIds,
}: HudProps) {
  void _tableShell
  const central = strength(state, "central")
  const russia = strength(state, "russia")
  const spec = scenarioSpec(state.scenario)
  const board = standing(state)
  const shown = statusLabel(Boolean(state.result), state.result?.grade ?? board.grade)
  const total = central + russia
  const centralShare = total === 0 ? 0 : (central / total) * 100
  const russiaShare = total === 0 ? 0 : 100 - centralShare
  const fortnight = Math.min(state.turn + 1, spec.length)

  return (
    <header className="table-hud shrink-0 px-3 py-1.5 sm:px-4" data-testid="table-hud">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-nowrap">
        <p className="flex shrink-0 items-center gap-2 font-display text-[1.35rem] leading-none tracking-wide text-primary italic sm:text-[1.45rem]">
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={28}
            height={28}
            className="size-7 rounded-sm"
            priority
          />
          Ostfront
        </p>
        <div
          data-testid="objectives"
          className="order-3 w-full min-w-0 md:order-none md:w-auto md:flex-1"
        >
          {teachMode ? (
            <p
              data-testid="teach-goal"
              className="text-center text-sm font-medium leading-snug text-foreground md:text-left"
            >
              {teachGoal ?? "Teaching drill"}
            </p>
          ) : null}
          {!teachMode && (
            <>
              <div
                className="flex h-2.5 w-full overflow-hidden rounded-full border border-leather/25 bg-paper shadow-inner"
                role="img"
                aria-label={`Listed strength. ${FACTION_LABEL.central} ${central} versus ${FACTION_LABEL.russia} ${russia}.`}
              >
                <div
                  className={`h-full bg-faction-central ${central > 0 && russia > 0 ? "shadow-[inset_-1px_0_0_rgba(246,241,228,0.85)]" : ""}`}
                  style={{ width: `${centralShare}%` }}
                  title={`${FACTION_LABEL.central} listed strength ${central}`}
                />
                <div
                  className="h-full bg-faction-russia"
                  style={{ width: `${russiaShare}%` }}
                  title={`${FACTION_LABEL.russia} listed strength ${russia}`}
                />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-center text-[11px] leading-tight text-muted-foreground sm:text-xs lg:justify-start lg:gap-x-2.5 xl:flex-nowrap">
                <span title={`${FACTION_LABEL.central} listed strength versus ${FACTION_LABEL.russia}`}>
                  Strength{" "}
                  <span
                    className="font-semibold text-faction-central"
                    title={`${FACTION_LABEL.central} listed strength`}
                  >
                    <span className="sr-only">{FACTION_LABEL.central} </span>
                    {central}
                  </span>
                  {" vs "}
                  <span
                    className="font-semibold text-faction-russia"
                    title={`${FACTION_LABEL.russia} listed strength`}
                  >
                    <span className="sr-only">{FACTION_LABEL.russia} </span>
                    {russia}
                  </span>
                </span>
                <span aria-hidden="true" className="hidden lg:inline">
                  ·
                </span>
                <EconomyReadout state={state} refitSkipIds={refitSkipIds} />
                <span aria-hidden="true" className="hidden lg:inline">
                  ·
                </span>
                <span title="Eastern victory points you hold, of those on the map">
                  ★ VP <span title="Eastern victory points you hold">{board.captured}</span>
                  /<span title="Eastern victory points available">{board.available}</span>
                </span>
                <span aria-hidden="true" className="hidden lg:inline">
                  ·
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
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <div className="text-right leading-tight">
            <p className="font-display text-base leading-none sm:text-lg" title="Date of this fortnight">
              {state.date}
            </p>
            {!teachMode && (
              <p className="mt-0.5 text-[10px] text-muted-foreground sm:text-xs">
                Fortnight{" "}
                <span title="This fortnight, counting from the start of the campaign">{fortnight}</span>
                {" / "}
                <span title="Fortnights in the campaign">{spec.length}</span>
              </p>
            )}
          </div>
          {teachMode ? (
            <span
              className="hidden rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] sm:inline sm:text-xs"
              data-testid="teach-mode-badge"
            >
              Teaching drill
            </span>
          ) : null}
          <HudOptionsMenu armReset={armReset} teachMode={teachMode} onReset={onReset} />
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
