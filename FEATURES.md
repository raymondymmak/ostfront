# Ostfront features

## Chief of Staff suggestions

The advisor panel is `[data-testid=advisor-panel]`. Each suggestion is `[data-testid=advisor-suggestion]` and carries `data-advisor-state`:

| State | Meaning | Control |
| --- | --- | --- |
| `new` | The order does not reuse a queued formation. | **Accept** `[data-testid=advisor-accept]` files it. |
| `duplicate` | Same order type, same units, and same target as an order already queued. | Shown, marked **Already queued**. Accept is disabled. |
| `conflict` | Reuses a division that already has a different queued order. | Shown, marked **Conflicts with:** the existing order (`[data-testid=advisor-queue]`). **Override** `[data-testid=advisor-override]` replaces that division's queued order. Other divisions on the same arrow stay. A second column for the same origin and target is not added. |

Suggestions are dropped only when they are not a legal order. Matching the queue is not a reason to drop one. Odds figures stay on the engine-rendered card (`[data-testid=advisor-odds]`). The advisor's prose does not include them.

## Game-master events

An event the engine rejects stays on the turn record with status `rejected`. The chronicle shows it as **Rejected**. It is not removed before the turn is resolved.
