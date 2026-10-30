# Ostfront features

## Chief of Staff suggestions

The advisor panel is `[data-testid=advisor-panel]`. Each suggestion is `[data-testid=advisor-suggestion]` and carries `data-advisor-state`:

| State | Meaning | Control |
| --- | --- | --- |
| `new` | The order does not reuse a queued formation. | **Accept** `[data-testid=advisor-accept]` files every formation on the card, or none. |
| `duplicate` | Same order type, same units, and same target as an order already queued. | Shown, marked **Already queued**. Accept is disabled. |
| `conflict` | Reuses a division that already has a different queued order. | Shown, marked **Conflicts with:** the existing order (`[data-testid=advisor-queue]`). **Override** `[data-testid=advisor-override]` replaces that division's queued order. Other divisions on the same arrow stay. A second column for the same origin and target is not added. |

Suggestions are dropped only when they are not a legal order. Matching the queue is not a reason to drop one. Open cards are marked again whenever the queue changes, and Accept checks them once more against the queue it would file into. A formation that is now committed elsewhere makes the card a conflict; Override is required, and Accept files nothing. If the order can no longer be applied, Accept shows the reason (`[data-testid=advisor-notice]`) and leaves the queue unchanged.

New cards are listed first, then conflicts. Duplicates stay visible and do not take one of the three suggestion slots. Odds figures stay on the engine-rendered card (`[data-testid=advisor-odds]`). A duplicate's own formations are not counted twice. Any sentence in the advisor's prose that mentions odds, a ratio, a percentage, or a `{placeholder}` is removed whole.

## Game-master events

An event the engine rejects stays on the turn record with status `rejected`. The chronicle shows it as **Rejected**. It is not removed before the turn is resolved.
