"use client"

import { Check } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { objectiveValue } from "@/lib/data/objectives"
import { ordersLocked } from "@/lib/finale"
import { RECRUIT, recruitmentYard } from "@/lib/engine/economy"
import { combinedEngagementOdds, engagementOdds, type EngagementPreview } from "@/lib/engine/turn"
import { provinceActionState, type QueuedOrder } from "@/lib/orders"
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
  queue?: QueuedOrder[]
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
  queue = [],
}: ProvincePanelProps) {
  if (!province) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a province. Lemberg is Austrian soil, held by the Russian 3rd Army. Rovno is the Russian depot.
      </div>
    )
  }

  const occupied = province.controller !== province.owner
  const friendly = province.controller === "central"
  const closed = ordersLocked(Boolean(state.result))
  const action = provinceActionState(state, province.id, queue, budget)
  const recruitReasons = [
    ...new Set(
      (Object.keys(RECRUIT) as UnitKind[])
        .map((kind) => action.recruit[kind].reason)
        .filter((reason): reason is string => !!reason),
    ),
  ]
  const everyRecruitDisabled = (Object.keys(RECRUIT) as UnitKind[]).every(
    (kind) => action.recruit[kind].disabled,
  )

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
        {friendly && !closed ? (
<<<<<<< HEAD
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="secondary"
              disabled={action.fortify.disabled}
              aria-disabled={action.fortify.disabled}
              data-testid="fortify"
              onClick={() => onFortify(province.id)}
            >
              {action.fortify.queued ? <Check aria-hidden /> : null}
              {action.fortify.queued ? `Fortify queued · ${province.name}` : `Fortify ${province.name}`}
            </Button>
            {action.fortify.queued ? (
              <p className="text-xs text-muted-foreground">Remove it in the Orders tab.</p>
            ) : action.fortify.reason ? (
              <p className="text-xs text-muted-foreground" data-testid="fortify-reason">
                {action.fortify.reason}
              </p>
            ) : null}
          </div>
=======
          <Button
            type="button"
            variant="secondary"
            onClick={() => onFortify(province.id)}
          >
            Fortify {province.name}
          </Button>
>>>>>>> 267885c (QA fixes: redact secrets, fail-fast, expanded demo path)
        ) : null}
        {friendly && !closed && recruitmentYard(province, "central") ? (
          <div data-testid="recruit-panel" className="flex flex-col gap-2">
            <h3 className="text-xs tracking-wide text-muted-foreground uppercase">Raise troops</h3>
            <p className="text-sm text-muted-foreground">
              Paid when the fortnight closes, after formations in supply refit. You have {budget.mp} manpower and {budget.ip} industry to spend.
            </p>
            {(Object.keys(RECRUIT) as UnitKind[]).map((kind) => {
              const cost = RECRUIT[kind]
              const item = action.recruit[kind]
              return (
                <div key={kind} className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={item.disabled}
                    aria-disabled={item.disabled}
                    title={item.reason ?? undefined}
                    data-testid={`recruit-${kind}`}
                    onClick={() => onRecruit(province.id, kind)}
                  >
                    {cost.label} · {cost.mp} MP {cost.ip} IP · {cost.turns === 1 ? "1 fortnight" : "2 fortnights"}
                    {item.queued ? " · queued" : ""}
                  </Button>
                  {item.queued ? (
                    <p className="text-xs text-muted-foreground">Remove it in the Orders tab.</p>
                  ) : null}
                </div>
              )
            })}
            {everyRecruitDisabled ? (
              <p className="text-xs text-muted-foreground" data-testid="recruit-reason">
                {recruitReasons.join(" · ")}
              </p>
            ) : null}
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
        ) : null}
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
                !closed && friendly && neighbor.controller !== "central"
                  ? previewNeighbor(state, province, neighbor.id, queue)
                  : null
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!closed && friendly) onOrder(province.id, neighbor.id)
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
                        {attack ? ` · ${neighborOddsLabel(attack)}` : ""}
                      </span>
                    </span>
                    <span className="text-xs text-primary">
                      {closed || !friendly
                        ? "Open"
                        : neighbor.controller === "central"
                          ? "Move"
                          : "Attack"}
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
            <li>Both sides lock their orders from the same map. Digging is resolved first. Marches and attacks are then resolved together.</li>
            <li>Move only across a shared border, and only into a friendly province. Two friendly columns may exchange provinces. They pass on the road.</li>
            <li>Supply under 30 cannot advance. Rails cost 1; roads cost the ground you enter. A province taken this fortnight does not feed or starve a battle already locked.</li>
            <li>Attacks are strength × morale × supply against defense × terrain × fort, then a d6. Odds shown here are against the garrison as it stands.</li>
            <li>
              Two or more neighbors attacking the same province in one fortnight fight as one battle, with a flanking bonus. If no friendly exit remains, the defender is surrounded.
            </li>
            <li>A formation that attacks out leaves a rear guard at half strength. Two attacks across the same border are a meeting engagement: both columns fall back. Two sides entering the same empty province bounce.</li>
            <li>The game master may ask for unrest or supply shifts of at most 20 per province, events included. Events land before the battles and never on Central Powers home soil.</li>
            <li>Depots feed only their own side, and only while that side holds them: Königsberg, Kraków and Lemberg; Warsaw and Volhynia (Rovno).</li>
          </ul>
        </details>
      </div>
    </ScrollArea>
  )
}

function previewNeighbor(
  state: GameState,
  province: Province,
  neighborId: string,
  queue: QueuedOrder[],
): EngagementPreview | null {
  const localIds = province.units.filter((unit) => unit.faction === "central").map((unit) => unit.id)
  const pending = queue.filter(
    (order) => order.kind === "attack" && order.to === neighborId && order.from !== province.id,
  )
  if (!pending.length) return engagementOdds(state, province.id, neighborId, localIds)
  return combinedEngagementOdds(state, neighborId, [
    { fromId: province.id, unitIds: localIds },
    ...pending.map((order) => ({ fromId: order.from, unitIds: order.unitIds })),
  ])
}

function neighborOddsLabel(attack: EngagementPreview): string {
  if (attack.origins > 1) {
    const shape = attack.origins === 2 ? "two-pronged" : "concentric"
    const ratio = attack.empty ? "undefended" : `${attack.ratio.toFixed(2)} : 1`
    return attack.encircled ? `one battle, ${shape}, surrounded, ${ratio}` : `one battle, ${shape}, ${ratio}`
  }
  return attack.empty ? "undefended" : `odds ${attack.ratio.toFixed(2)} : 1`
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
