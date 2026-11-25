# Queue one formation by dragging its chip

**Status:** proposed  
**Date:** 2026-11-24

## Context

Map arrows and neighbor buttons queue every unassigned formation in the province (leaving a depot garrison). A typed directive does the same parsing. There was no way to send one formation onto a neighbour without editing the queue checkboxes afterward.

## Decision

At zoom 7.4 and above, `components/army-chips.tsx` draws one chip per independent formation on the MapLibre map. Dragging a Central Powers chip calls `reduceChipDrag` in `lib/ui/drag-order.ts`. The pointer that starts the drag is the only one that can move or release it (`ownsDragPointer`); a second finger cannot start another chip or commit the first. That reducer is the only thing that changes the queue. Before release it calls `assessManeuvers`, the same check `resolveManeuvers` uses, so a knowable refusal (supply under 30, no shared border, already ordered, digging in) never draws or queues the arrow. The province is shown blocked with the one-line hover, for example `Supply 22 < 30`. A legal neighbour becomes one move or attack for that formation, and an illegal drop returns the same queue array. The pointer near a map edge sets a pan direction; the map pans while the drag lasts. `legalTargets` classifies neighbours through that same check. `resolveTurn` still records outcomes that are not knowable until the fortnight resolves.

The directive box stays. Chips are not drawn on the WebGL-failure SVG fallback.

## Consequences

Campaign and teaching both pass the drop into the existing queue. demo-check zooms in, drags Kraków’s chip onto Kielce, removes that order, and restores the opening camera so later steps still see an empty queue. A player can still draw arrows, use neighbor buttons, and type a directive.
