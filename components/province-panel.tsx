"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { objectiveValue } from "@/lib/data/objectives"
import { RECRUIT, recruitmentYard } from "@/lib/engine/economy"
import { engagementOdds } from "@/lib/engine/turn"
import { FACTION_LABEL, KIND_LABEL, TERRAIN_LABEL } from "@/lib/format"
import type { GameState, Province, Purse, UnitKind } from "@/lib/types"

type ProvincePanelProps = {
  state: GameState
  province: Province | null
  budget: Purse
  onSelect: (id: string) => void
  onOrder: (from: string, to: string) => void
  onFortify: (provinceId: string) => void
  onRecruit: (provinceId: string, kind: UnitKind) => void
  onCancelRecruit: (buildId: string) => void
}

export function ProvincePanel({
  state,
  province,
  budget,
  onSelect,
  onOrder,
  onFortify,
  onRecruit,
  onCancelRecruit,
}: ProvincePanelProps) {
  if (!province) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a province. Lemberg is the Austrian depot. The Russian line is Lublin and Volhynia.
      </div>
    )
  }

  const occupied = province.controller !== province.owner
  const friendly = province.controller === "central"

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl leading-none">{province.name}</h2>
            <Badge variant="outline">{TERRAIN_LABEL[province.terrain]}</Badge>
            {province.depot && province.controller === province.depot && (
              <Badge>Depot</Badge>
            )}
            {objectiveValue(state.scenario, province.id) > 0 && (
              <Badge variant="outline">★ {objectiveValue(state.scenario, province.id)} VP</Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Held by {FACTION_LABEL[province.controller]}. Homeland of{" "}
            {FACTION_LABEL[province.owner]}.
            {occupied ? " Occupation is feeding unrest." : ""}
          </p>
        </div>
        <Meter label="Supply" value={province.supply} tone={province.supply < 30 ? "bad" : "good"} />
        <Meter label="Unrest" value={province.unrest} tone={province.unrest > 60 ? "bad" : "warn"} />
        <p className="text-sm">
          Fortification {province.fort} / 3
          {province.supply < 30 && province.units.length > 0
            ? " · formations here cannot advance"
            : ""}
        </p>
        {friendly && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onFortify(province.id)}
          >
            Fortify {province.name}
          </Button>
        )}
        {friendly && recruitmentYard(province, "central") && (
          <div data-testid="recruit-panel" className="flex flex-col gap-2">
            <h3 className="text-xs tracking-wide text-muted-foreground uppercase">Raise troops</h3>
            <p className="text-sm text-muted-foreground">
              Paid when the fortnight closes, after formations in supply refit. You have {budget.mp} manpower and {budget.ip} industry to spend.
            </p>
            {(Object.keys(RECRUIT) as UnitKind[]).map((kind) => {
              const cost = RECRUIT[kind]
              const affordable = budget.mp >= cost.mp && budget.ip >= cost.ip
              return (
                <Button
                  key={kind}
                  type="button"
                  variant="outline"
                  disabled={!affordable}
                  data-testid={`recruit-${kind}`}
                  onClick={() => onRecruit(province.id, kind)}
                >
                  {cost.label} · {cost.mp} MP {cost.ip} IP · {cost.turns === 1 ? "1 fortnight" : "2 fortnights"}
                </Button>
              )
            })}
            {state.queue
              .filter((job) => job.provinceId === province.id && job.faction === "central")
              .map((job) => (
                <div key={job.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {job.name} · {job.remaining} fortnight{job.remaining === 1 ? "" : "s"}
                  </span>
                  <Button type="button" size="xs" variant="ghost" onClick={() => onCancelRecruit(job.id)}>
                    Cancel
                  </Button>
                </div>
              ))}
          </div>
        )}
        <Separator />
        <div>
          <h3 className="text-xs tracking-wide text-muted-foreground uppercase">Formations</h3>
          {province.units.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">No formations.</p>
          )}
          <ul className="mt-2 flex flex-col gap-2">
            {province.units.map((unit) => (
              <li key={unit.id} className="rounded-lg border border-border px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{unit.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {KIND_LABEL[unit.kind]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {FACTION_LABEL[unit.faction]} · strength {unit.strength} · morale{" "}
                  {unit.morale}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <Separator />
        <div>
          <h3 className="text-xs tracking-wide text-muted-foreground uppercase">Neighbors</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {province.neighbors.map((id) => {
              const neighbor = state.provinces.find((item) => item.id === id)
              if (!neighbor) return null
              const attack =
                friendly && neighbor.controller !== "central"
                  ? engagementOdds(
                      state,
                      province.id,
                      neighbor.id,
                      province.units
                        .filter((unit) => unit.faction === "central")
                        .map((unit) => unit.id),
                    )
                  : null
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (friendly) onOrder(province.id, neighbor.id)
                      else onSelect(neighbor.id)
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span>
                      {neighbor.name}
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {FACTION_LABEL[neighbor.controller]}
                        {neighbor.rail.includes(province.id) || province.rail.includes(neighbor.id)
                          ? " · rail"
                          : ""}
                        {attack
                          ? attack.empty
                            ? " · undefended"
                            : ` · odds ${attack.ratio.toFixed(2)} : 1`
                          : ""}
                      </span>
                    </span>
                    <span className="text-xs text-primary">
                      {friendly
                        ? neighbor.controller === "central"
                          ? "Move"
                          : "Attack"
                        : "Open"}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer text-foreground">How a fortnight is decided</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Move only across a shared border, and only into a friendly province.</li>
            <li>Supply under 30 cannot advance. Rails cost 1; roads cost the ground you enter.</li>
            <li>Attacks are strength × morale × supply against defense × terrain × fort, then a d6.</li>
            <li>The game master may ask for unrest or supply shifts of at most 20.</li>
            <li>Depots feed only their own side: Königsberg and Kraków; Warsaw and Volhynia (Rovno).</li>
          </ul>
        </details>
      </div>
    </ScrollArea>
  )
}

function Meter({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "good" | "warn" | "bad"
}) {
  const color =
    tone === "good" ? "bg-[#3d7a52]" : tone === "bad" ? "bg-[#a85b49]" : "bg-[#c6a15a]"
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}
