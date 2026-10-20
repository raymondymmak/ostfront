"use client"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { independentFormations, partyOf } from "@/lib/engine/echelon"
import { RECRUIT } from "@/lib/engine/economy"
import { combinedEngagementOdds, engagementOdds, findProvince, type EngagementPreview } from "@/lib/engine/turn"
import { KIND_LABEL } from "@/lib/format"
import { interpretOrders } from "@/lib/gm/interpret"
import type { QueuedOrder } from "@/lib/orders"
import type { GameState } from "@/lib/types"

type OrderPanelProps = {
  state: GameState
  directive: string
  onDirective: (value: string) => void
  queue: QueuedOrder[]
  onQueue: (queue: QueuedOrder[]) => void
  orderMode: boolean
  onOrderMode: (value: boolean) => void
  hint: string | null
  busy: boolean
  onEndTurn: () => void
  onSelect: (id: string) => void
}

export function OrderPanel({
  state,
  directive,
  onDirective,
  queue,
  onQueue,
  orderMode,
  onOrderMode,
  hint,
  busy,
  onEndTurn,
  onSelect,
}: OrderPanelProps) {
  const parsed = directive.trim()
    ? interpretOrders(state, [{ type: "text", text: directive }])
    : { proposals: [], notes: [] }
  const forces = state.provinces.flatMap((province) =>
    province.units
      .filter((unit) => unit.faction === "central")
      .map((unit) => ({ unit, province })),
  )

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-xl leading-none">Orders</h2>
          <Button
            type="button"
            size="sm"
            variant={orderMode ? "default" : "outline"}
            aria-pressed={orderMode}
            onClick={() => onOrderMode(!orderMode)}
          >
            {orderMode ? "Drawing arrows" : "Draw arrows"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Drag between provinces, click a neighbor, or write an order. Ctrl+Enter closes the fortnight.
        </p>
        {hint && (
          <p className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-2 text-sm" role="status">
            {hint}
          </p>
        )}
        <label className="text-xs tracking-wide text-muted-foreground uppercase" htmlFor="directive">
          Directive
        </label>
        <textarea
          id="directive"
          data-testid="directive"
          value={directive}
          onChange={(event) => onDirective(event.target.value)}
          placeholder="Attack Lublin. Fortify Lemberg."
          rows={3}
          className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {parsed.proposals.length > 0 && (
          <ul className="text-sm text-muted-foreground">
            {parsed.proposals.map((proposal, index) => (
              <li key={index}>{describeProposal(state, proposal, parsed.proposals)}</li>
            ))}
          </ul>
        )}
        {parsed.notes.map((note) => (
          <p key={note} className="text-sm text-destructive">
            {note}
          </p>
        ))}
        <Separator />
        <h3 className="text-xs tracking-wide text-muted-foreground uppercase">Queued arrows</h3>
        {queue.length === 0 && (
          <p className="text-sm text-muted-foreground">No arrows yet. Unordered formations hold.</p>
        )}
        <ul className="flex flex-col gap-2">
          {queue.map((order) => {
            const from = findProvince(state, order.from)
            const to = order.to ? findProvince(state, order.to) : undefined
            const odds =
              order.kind === "attack" && order.to ? queuedAttackOdds(state, queue, order) : null
            return (
              <li key={order.id} className="rounded-lg border border-border p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm">
                    {order.kind === "fortify"
                      ? `Fortify ${from?.name ?? order.from}`
                      : order.kind === "recruit"
                        ? `Raise ${order.unitKind ? KIND_LABEL[order.unitKind] : "troops"} at ${from?.name ?? order.from}`
                        : order.kind === "cancelRecruit"
                          ? "Cancel a formation in the yards"
                          : order.kind === "attack"
                            ? `Attack ${to?.name ?? order.to} from ${from?.name ?? order.from}`
                            : `Move to ${to?.name ?? order.to} from ${from?.name ?? order.from}`}
                  </p>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => onQueue(queue.filter((item) => item.id !== order.id))}
                  >
                    Remove
                  </Button>
                </div>
                {odds && (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="attack-odds">
                    {describeOdds(odds)}
                    {from && from.supply < 30 ? " Supply is too low to march." : ""}
                  </p>
                )}
                {emptiesDepot(state, order) && (
                  <p className="mt-1 text-xs text-destructive" data-testid="depot-warning">
                    This order empties the {from?.name ?? "depot"} depot. Leave a garrison unless you mean to abandon it.
                  </p>
                )}
                {order.kind === "recruit" && order.unitKind && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {RECRUIT[order.unitKind].mp} manpower, {RECRUIT[order.unitKind].ip} industry. Arrives when the fortnight closes
                    {RECRUIT[order.unitKind].turns > 1 ? ", one fortnight later" : ""}.
                  </p>
                )}
                {order.kind !== "fortify" && order.kind !== "recruit" && order.kind !== "cancelRecruit" && from && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {from.units
                      .filter((unit) => unit.faction === "central")
                      .map((unit) => {
                        const on = order.unitIds.includes(unit.id)
                        return (
                          <li key={unit.id}>
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => {
                                  const unitIds = on
                                    ? order.unitIds.filter((id) => id !== unit.id)
                                    : [...order.unitIds, unit.id]
                                  if (!unitIds.length) {
                                    onQueue(queue.filter((item) => item.id !== order.id))
                                    return
                                  }
                                  onQueue(
                                    queue.map((item) =>
                                      item.id === order.id ? { ...item, unitIds } : item,
                                    ),
                                  )
                                }}
                              />
                              {unit.name} · {unit.strength}
                            </label>
                          </li>
                        )
                      })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
        <Button
          type="button"
          data-testid="end-turn"
          disabled={busy || !!state.result}
          onClick={onEndTurn}
          className="w-full"
          size="lg"
        >
          {state.result ? "The campaign is over" : busy ? "Staff conference…" : "Close the fortnight"}
        </Button>
        <Separator />
        <h3 className="text-xs tracking-wide text-muted-foreground uppercase">Your formations</h3>
        <ul className="flex flex-col gap-1">
          {forces.map(({ unit, province }) => (
            <li key={unit.id}>
              <button
                type="button"
                onClick={() => onSelect(province.id)}
                className="flex w-full justify-between gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-muted"
              >
                <span>{unit.name}</span>
                <span className="text-muted-foreground">
                  {province.name} · {unit.strength}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </ScrollArea>
  )
}

function emptiesDepot(state: GameState, order: QueuedOrder): boolean {
  if (order.kind === "fortify" || order.kind === "recruit" || order.kind === "cancelRecruit") return false
  const from = findProvince(state, order.from)
  if (!from || from.depot !== "central") return false
  const held = independentFormations(from.units.filter((unit) => unit.faction === "central"))
  const departing = new Set(partyOf(from.units, order.unitIds).map((unit) => unit.id))
  return held.length > 0 && held.every((unit) => departing.has(unit.id))
}

function queuedAttackOdds(
  state: GameState,
  queue: QueuedOrder[],
  order: QueuedOrder,
): EngagementPreview | null {
  if (!order.to) return null
  const mates = queue.filter((item) => item.kind === "attack" && item.to === order.to)
  if (mates.length < 2) return engagementOdds(state, order.from, order.to, order.unitIds)
  return combinedEngagementOdds(
    state,
    order.to,
    mates.map((item) => ({ fromId: item.from, unitIds: item.unitIds })),
  )
}

function describeOdds(odds: EngagementPreview): string {
  if (odds.empty && odds.origins < 2) return "Undefended, before the dice."
  const ratio = odds.empty ? "undefended" : `${odds.ratio.toFixed(2)} : 1`
  if (odds.origins >= 2) {
    const shape = odds.origins === 2 ? "Two-pronged" : "Concentric"
    const ring = odds.encircled ? ", and the defender is surrounded" : ""
    return `${shape}, about ${ratio} before the dice${ring}.`
  }
  return `About ${ratio} before the dice.`
}

function describeProposal(
  state: GameState,
  proposal: ReturnType<typeof interpretOrders>["proposals"][number],
  proposals: ReturnType<typeof interpretOrders>["proposals"],
): string {
  if (proposal.type === "fortify") {
    return `Will entrench ${findProvince(state, proposal.province)?.name ?? proposal.province}.`
  }
  if (proposal.type === "move") {
    const located = state.provinces
      .flatMap((province) => province.units)
      .find((unit) => unit.id === proposal.unit)
    return `Will move ${located?.name ?? proposal.unit} to ${
      findProvince(state, proposal.to)?.name ?? proposal.to
    }.`
  }
  if (proposal.type === "attack") {
    const mates = proposals.filter(
      (item) => item.type === "attack" && item.target === proposal.target,
    )
    const odds =
      mates.length > 1
        ? combinedEngagementOdds(
            state,
            proposal.target,
            mates.map((item) =>
              item.type === "attack" ? { fromId: item.from, unitIds: item.units } : { fromId: "", unitIds: [] },
            ),
          )
        : engagementOdds(state, proposal.from, proposal.target, proposal.units)
    const ratio = !odds ? "unknown odds" : odds.empty ? "undefended" : `${odds.ratio.toFixed(2)} : 1`
    const shape = odds && odds.origins > 1 ? (odds.origins === 2 ? "two-pronged " : "concentric ") : ""
    return `Will attack ${findProvince(state, proposal.target)?.name ?? proposal.target} from ${
      findProvince(state, proposal.from)?.name ?? proposal.from
    } (${shape}${ratio} before the dice).`
  }
  return "Staff note."
}
