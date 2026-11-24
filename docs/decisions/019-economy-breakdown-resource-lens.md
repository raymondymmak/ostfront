# Show the economy breakdown on the HUD and shade the map by resource yield

**Status:** proposed  
**Date:** 2026-11-24

## Context

Manpower and industry in the top bar were two stock figures plus a fortnightly income, with the arithmetic only in `docs/RULES.md` and `lib/engine/economy.ts`. Supply and Unrest already had map lenses. There was no way to see which provinces produced the purse, or where yield sat on the map, without reading the source.

## Decision

Keep `projectIncome` as the rounded purse. Add `explainIncome`, `provinceIncomeDetail`, and `explainRefit` beside it so the HUD (`components/economy-readout.tsx`) prints the same factors: base yield × (1 − unrest/100), halved when occupied, zero under supply 30, Central Powers industry ×1.3, and refit at 1 manpower per 4 strength. Queued attacks are omitted from that bill, matching `spendable`.

Add a Resources overlay in `lib/map/province-paint.ts`. It shades `provinceResourceYield` (local manpower + industry only). National multipliers stay off the colour so a province reads the same whoever holds it, aside from occupation and supply.

## Consequences

The breakdown cannot drift from the purse: tests require `explainIncome(...).income` to equal `projectIncome`. The legend scale and demo-check both look for the yield formula. The coach may point at `map-mode-resources`. Russian difficulty still changes income and is described by `explainIncome`, but the campaign HUD only opens the Central Powers breakdown.
