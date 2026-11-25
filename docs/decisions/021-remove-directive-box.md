# Remove the typed directive box

**Status:** proposed  
**Date:** 2026-11-24

## Context

The Orders panel had a Directive textarea. Typed text was parsed into “Will …” lines and, on closing the fortnight, sent as a `text` player order beside the queue. Arrows, neighbor buttons, formation chips, fortify, and recruit already queue those same actions. demo-check typed “Fortify Kraków.” into the box and left it there, so that dig-in was submitted with the queued attack.

## Decision

Remove the Directive label, the textarea (`data-testid=directive`), and the live preview from `components/order-panel.tsx`. `components/game-app.tsx` no longer keeps that text or appends a `text` order in `endTurn`. Teaching does not pass directive props. The turn route still accepts a `text` order when one is posted; `interpretOrders` is unchanged. demo-check asserts the field is absent.

## Consequences

Closing the fortnight sends only the queue. Players order with an arrow, a neighbor button, a chip, fortify, or recruit. A typed dig-in no longer rides along with the demo’s queued attack.
