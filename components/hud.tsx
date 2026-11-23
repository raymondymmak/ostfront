"use client"

import { Button } from "@/components/ui/button"
import { listedStrength } from "@/lib/engine/echelon"
import { projectIncome } from "@/lib/engine/economy"
import { standing } from "@/lib/engine/victory"
import { statusLabel } from "@/lib/finale"
import { scenarioSpec } from "@/lib/data/objectives"
import { FACTION_LABEL } from "@/lib/format"
import type { TableWindowId } from "@/lib/ui/table-windows"
import type { TeachWindowId } from "@/lib/ui/teach-windows"
import type { GameState } from "@/lib/types"

type HudProps = {
  state: GameState
  armReset: boolean
  onReset: () => void
  advisorOpen: boolean
  onAdvisor: () => void
  teachMode?: boolean
  /** Short lesson goal shown instead of the campaign objective on /teach. */
  teachGoal?: string
  /** Desktop general's-table: window toggle buttons (campaign or /teach). */
  tableShell?: boolean
  windowOpen?: Partial<Record<TableWindowId, boolean>>
  onToggleWindow?: (id: TableWindowId) => void
  teachWindowOpen?: Partial<Record<TeachWindowId, boolean>>
  onToggleTeachWindow?: (id: TeachWindowId) => void
}

export function Hud({
  state,
  armReset,
  onReset,
  advisorOpen,
  onAdvisor,
  teachMode,
  teachGoal,
  tableShell = false,
  windowOpen = {},
  onToggleWindow,
  teachWindowOpen = {},
  onToggleTeachWindow,
}: HudProps) {
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
    <header className="table-hud px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 md:flex-nowrap md:items-center">
        <p className="shrink-0 font-display text-[1.65rem] leading-none tracking-wide text-primary italic">
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
                className="flex h-3 w-full overflow-hidden rounded-full border border-leather/25 bg-paper shadow-inner"
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
              <p className="mt-1 text-center text-xs text-muted-foreground">
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
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
          <div className="text-right">
            <p className="font-display text-xl leading-none" title="Date of this fortnight">
              {state.date}
            </p>
            {!teachMode && (
              <p className="mt-1 text-xs text-muted-foreground">
                Fortnight{" "}
                <span title="This fortnight, counting from the start of the campaign">{fortnight}</span>
                {" / "}
                <span title="Fortnights in the campaign">{spec.length}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {teachMode && tableShell ? (
              <>
                <span
                  className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs"
                  data-testid="teach-mode-badge"
                >
                  Teaching drill
                </span>
                <TeachWindowToggle
                  id="lesson"
                  label="Lesson"
                  testId="teach-lesson-toggle"
                  pressed={Boolean(teachWindowOpen.lesson)}
                  onToggle={onToggleTeachWindow}
                />
                <TeachWindowToggle
                  id="orders"
                  label="Orders"
                  testId="tab-orders"
                  pressed={Boolean(teachWindowOpen.orders)}
                  onToggle={onToggleTeachWindow}
                />
                <TeachWindowToggle
                  id="province"
                  label="Province"
                  testId="tab-province"
                  pressed={Boolean(teachWindowOpen.province)}
                  onToggle={onToggleTeachWindow}
                />
                <TeachWindowToggle
                  id="legend"
                  label="Legend"
                  testId="legend-toggle"
                  pressed={Boolean(teachWindowOpen.legend)}
                  onToggle={onToggleTeachWindow}
                />
              </>
            ) : teachMode ? (
              <span
                className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs"
                data-testid="teach-mode-badge"
              >
                Teaching drill
              </span>
            ) : tableShell ? (
              <>
                <WindowToggle
                  id="orders"
                  label="Orders"
                  testId="tab-orders"
                  pressed={Boolean(windowOpen.orders)}
                  onToggle={onToggleWindow}
                />
                <WindowToggle
                  id="province"
                  label="Province"
                  testId="tab-province"
                  pressed={Boolean(windowOpen.province)}
                  onToggle={onToggleWindow}
                />
                <WindowToggle
                  id="log"
                  label="Log"
                  testId="chronicle-log-toggle"
                  pressed={Boolean(windowOpen.log)}
                  onToggle={onToggleWindow}
                />
                <WindowToggle
                  id="legend"
                  label="Legend"
                  testId="legend-toggle"
                  pressed={Boolean(windowOpen.legend)}
                  onToggle={onToggleWindow}
                />
                <Button
                  type="button"
                  size="sm"
                  variant={advisorOpen ? "default" : "outline"}
                  aria-expanded={advisorOpen}
                  data-testid="advisor-toggle"
                  className={
                    advisorOpen
                      ? "rounded-sm border-brass/70 bg-brass text-ink shadow-sm hover:bg-brass/90 hover:text-ink"
                      : "rounded-sm border-leather/40 bg-paper text-ink hover:bg-paper-deep"
                  }
                  onClick={onAdvisor}
                >
                  Chief of Staff
                </Button>
                <WindowToggle
                  id="ohl"
                  label="OHL"
                  testId="ohl-toggle"
                  pressed={Boolean(windowOpen.ohl)}
                  onToggle={onToggleWindow}
                  title="Orders from OHL"
                />
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant={advisorOpen ? "default" : "outline"}
                aria-expanded={advisorOpen}
                data-testid="advisor-toggle"
                className={
                  advisorOpen
                    ? "rounded-sm border-brass/70 bg-brass text-ink shadow-sm hover:bg-brass/90 hover:text-ink"
                    : "rounded-sm border-leather/40 bg-paper text-ink hover:bg-paper-deep"
                }
                onClick={onAdvisor}
              >
                Chief of Staff
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-sm border-leather/40 bg-paper text-ink hover:bg-paper-deep"
              onClick={onReset}
            >
              {armReset ? "Confirm restart" : teachMode ? "Restart drill" : "Restart"}
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}

function WindowToggle({
  id,
  label,
  testId,
  pressed,
  onToggle,
  title,
}: {
  id: TableWindowId
  label: string
  testId: string
  pressed: boolean
  onToggle?: (id: TableWindowId) => void
  title?: string
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={pressed ? "default" : "outline"}
      aria-pressed={pressed}
      data-testid={testId}
      title={title}
      className={
        pressed
          ? "rounded-sm border-brass/70 bg-brass text-ink shadow-sm hover:bg-brass/90 hover:text-ink"
          : "rounded-sm border-leather/40 bg-paper text-ink hover:bg-paper-deep"
      }
      onClick={() => onToggle?.(id)}
    >
      {label}
    </Button>
  )
}

function TeachWindowToggle({
  id,
  label,
  testId,
  pressed,
  onToggle,
}: {
  id: TeachWindowId
  label: string
  testId: string
  pressed: boolean
  onToggle?: (id: TeachWindowId) => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={pressed ? "default" : "outline"}
      aria-pressed={pressed}
      data-testid={testId}
      className={
        pressed
          ? "rounded-sm border-brass/70 bg-brass text-ink shadow-sm hover:bg-brass/90 hover:text-ink"
          : "rounded-sm border-leather/40 bg-paper text-ink hover:bg-paper-deep"
      }
      onClick={() => onToggle?.(id)}
    >
      {label}
    </Button>
  )
}

function strength(state: GameState, faction: "central" | "russia") {
  return state.provinces.reduce(
    (sum, province) => sum + listedStrength(province.units.filter((unit) => unit.faction === faction)),
    0,
  )
}
