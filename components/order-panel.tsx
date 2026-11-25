"use client"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { RECRUIT } from "@/lib/engine/economy"
import { combinedEngagementOdds, engagementOdds, findProvince, type EngagementPreview } from "@/lib/engine/turn"
import { ordersLocked } from "@/lib/finale"
import { combinedQueueLines, formatQueuedOrderLine, type QueuedOrder } from "@/lib/orders"
import { snapshotQueuedOrder } from "@/lib/queue-snapshot"
import { queuedOrderRiskNotes } from "@/lib/ui/order-warnings"
import type { GameState } from "@/lib/types"
import { OddsBar } from "@/components/odds-bar"

type OrderPanelProps = {
  state: GameState
  queue: QueuedOrder[]
  onQueue: (queue: QueuedOrder[]) => void
  orderMode: boolean
  onOrderMode: (value: boolean) => void
  hint: string | null
  busy: boolean
  onEndTurn: () => void
  onSelect: (id: string) => void
  endTurnLabel?: string
  /** When set, overrides finale-based lock (e.g. teaching feedback phase). */
  ordersLocked?: boolean
  /** Hide the end-turn / resolve control (e.g. /teach keeps Resolve only in the Lesson panel). */
  hideEndTurn?: boolean
}

export function OrderPanel({
  state,
  queue,
  onQueue,
  orderMode,
  onOrderMode,
  hint,
  busy,
  onEndTurn,
  onSelect,
  endTurnLabel,
  ordersLocked: ordersLockedProp,
  hideEndTurn = false,
}: OrderPanelProps) {
  const closed = ordersLockedProp ?? ordersLocked(Boolean(state.result))
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
            data-testid="draw-arrows"
            disabled={closed}
            onClick={() => {
              if (closed) return
              onOrderMode(!orderMode)
            }}
          >
            {orderMode ? "Drawing arrows" : "Draw arrows"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {closed
            ? "Orders are closed. Pan and zoom the map, open a province, or read the chronicle."
            : "Drag between provinces or click a neighbor. Ctrl+Enter closes the fortnight."}
        </p>
        {hint && (
          <p
            className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-2 text-sm"
            role="status"
            data-testid="order-hint"
          >
            {hint}
          </p>
        )}
        <Separator />
        <h3 className="text-xs tracking-wide text-muted-foreground uppercase">Queued arrows</h3>
        {combinedQueueLines(state, queue).map((line) => (
          <div key={line.targetId} className="text-sm text-muted-foreground">
            <p>
              {line.targetName} is one battle from {joinAnd(line.fromNames)}.
            </p>
            <OddsBar preview={line.preview} testId="combined-odds" />
          </div>
        ))}
        {queue.length === 0 && (
          <p className="text-sm text-muted-foreground">No arrows yet. Unordered formations hold.</p>
        )}
        <ul className="flex flex-col gap-2" data-testid="queued-orders">
          {queue.map((order) => {
            const from = findProvince(state, order.from)
            const odds =
              order.kind === "attack" && order.to ? queuedAttackOdds(state, queue, order) : null
            return (
              <li key={order.id} className="rounded-lg border border-border p-2.5" data-queued-order={JSON.stringify(snapshotQueuedOrder(state, order))}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm">{formatQueuedOrderLine(state, order)}</p>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={closed}
                    onClick={() => {
                      if (closed) return
                      onQueue(queue.filter((item) => item.id !== order.id))
                    }}
                  >
                    Remove
                  </Button>
                </div>
                {odds && (
                  <>
                    <OddsBar preview={odds} testId="attack-odds" compact />
                    {from && from.supply < 30 ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">Supply is too low to march.</p>
                    ) : null}
                  </>
                )}
                {queuedOrderRiskNotes(state, order).map((note) => (
                  <p
                    key={note}
                    className="mt-1 text-xs text-destructive"
                    data-testid={note.toLowerCase().includes("depot") ? "depot-warning" : "supply-warning"}
                  >
                    {note}
                  </p>
                ))}
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
                                disabled={closed}
                                onChange={() => {
                                  if (closed) return
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
        {!hideEndTurn && (
          <Button
            type="button"
            data-testid="end-turn"
            disabled={busy || closed}
            onClick={onEndTurn}
            className="w-full"
            size="lg"
          >
            {state.result
              ? "The campaign is over"
              : busy
                ? "Stavka is deliberating…"
                : (endTurnLabel ?? "Close the fortnight")}
          </Button>
        )}
        {!hideEndTurn && <Separator />}
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

function joinAnd(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}
