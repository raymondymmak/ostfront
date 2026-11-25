# Show the economy breakdown on the HUD and shade the map by resource yield

**Status:** proposed  
**Date:** 2026-11-24

## Context

Manpower and industry in the top bar were two stock figures plus a fortnightly income, with the arithmetic only in `docs/RULES.md` and `lib/engine/economy.ts`. Supply and Unrest already had map lenses. There was no way to see which provinces produced the purse, or where yield sat on the map, without reading the source.

## Decision

Keep `projectIncome` as the purse. Add `explainIncome` and `provinceIncomeDetail` beside it. The HUD (`components/economy-readout.tsx`) prints the yield rule — base yield × (1 − unrest/100), halved when occupied, zero under supply 30 — then one terse line per held province (`Austrian Silesia: 1 MP, 1 IND`, or `0 (supply 27 < 30)` when supply is under the floor). Industry also shows Central Powers industry ×1.3. Manpower does not. Both add one sentence: reinforcing damaged armies costs 1 manpower per 4 strength. The panel does not repeat the treasury, this fortnight’s income, or rounding.

Add a Resources overlay in `lib/map/province-paint.ts`. It shades `provinceResourceYield` (local manpower + industry only). National multipliers stay off the colour so a province reads the same whoever holds it, aside from occupation and supply. The map does not print MP/IND labels. The province panel (`[data-testid=province-yield]`) shows that same terse yield for the selected province.

A map hover that is about the order’s origin — supply under 30, or no unassigned formation — is shown only while the pointer is on that province (`mapProvinceHoverNote`). It is not copied onto neighbors. Dropping an arrow still uses `legalTargetHoverNote`, so the orders hint can explain the refusal.

## Consequences

The breakdown cannot drift from the purse: tests require `explainIncome(...).income` to equal `projectIncome`. The legend scale and demo-check both look for the yield formula. The coach may point at `map-mode-resources`. Russian difficulty still changes income and is described by `explainIncome`, but the campaign HUD only opens the Central Powers breakdown.
