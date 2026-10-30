# Ostfront feature map (QA & agents)

Route for every feature: **`/`** (single-page app). Unless noted, actions assume a campaign is in progress (scenario picker closed).

Stable selectors prefer `[data-testid=…]`. Button labels are fallbacks when test ids are not set.

| Feature | How to reach it | Proof it worked |
| --- | --- | --- |
| **Start campaign / pick difficulty** | On first load (or after Restart → Confirm), modal `[data-testid=scenario-picker]`: choose `[data-testid=difficulty-easy\|normal\|hard]`, then **Begin the offensive** `[data-testid=begin-scenario]`. | Picker hides; map `[data-testid=war-map]` visible; HUD date **2 May 1915**; Chronicle shows opening copy. |
| **Read briefing** | With an empty turn log, Chronicle `[data-testid=chronicle]` (desktop: bottom strip; mobile: **Chronicle** tab `[data-testid=tab-chronicle]`). | Text includes **2 May 1915, Gorlice–Tarnów** and the scenario briefing paragraph from `BRIEFING`. |
| **Top bar readout** | Always in `<header>` after campaign start. | `[data-testid=objectives]` strength bar; labels **Strength**, **Provinces**; `[data-testid=treasury]` manpower/industry; **★ VP** fraction; `[data-testid=grade]` provisional or final grade; date and fortnight counter top-right. |
| **Select province** | Click a province on `[data-testid=war-map]` / `[data-testid=svg-map]`, or a formation under **Your formations** in Orders, or **Province** tab `[data-testid=tab-province]` after selecting on the map. | Province tab shows province name (default selection **Kraków** at start). |
| **Province tab** | `[data-testid=tab-province]` (**Province**). | Supply/unrest meters, neighbors list, fortify/recruit when eligible. |
| **Issue move or attack (neighbor)** | **Province** tab: under **Neighbors**, click a row (**Move** into friendly, **Attack** into enemy). | **Orders** tab lists queued arrow; attack rows may show `[data-testid=attack-odds]`. |
| **Draw arrows on map** | **Orders** tab: **Draw arrows** `[data-testid=draw-arrows]` (toggles **Drawing arrows**); drag between provinces on the map when mode is on. | `aria-pressed="true"` on draw button; new queue entry on **Orders** tab. |
| **Typed directive** | **Orders** tab: textarea `[data-testid=directive]`. | Parsed lines under the field (e.g. **Will entrench Kraków.**); optional text order sent on end turn. |
| **Fortify** | **Province** tab on a Central-held province: **Fortify …** `[data-testid=fortify-province]`. | **Orders** queue shows **Fortify** line. |
| **Recruit** | **Province** tab at a yard (depot or own urban, supply ≥ 60): **Raise troops** `[data-testid=recruit-panel]`; buttons `[data-testid=recruit-infantry]`, `recruit-cavalry`, `recruit-artillery`. | Queue shows **Raise … at**; costs listed on the button. |
| **Map mode Control** | On-map control stack `[data-testid=map-mode]` → **Control** `[data-testid=map-mode-none]`. | Supply/unrest legend strip `[data-testid=overlay-scale]` hidden. |
| **Map mode Supply** | `[data-testid=map-mode-supply]`. | `[data-testid=overlay-scale]` visible with **Supply** ramp. |
| **Map mode Unrest** | `[data-testid=map-mode-unrest]`. | `[data-testid=overlay-scale]` visible with **Unrest** ramp. |
| **Toggle rails** | Map legend (bottom-left): expand **Map legend** if collapsed; **Rails** → **On/Off** `[data-testid=rail-toggle]`. | Button label flips **On** ↔ **Off**; rail lines on map toggle. |
| **Chief of Staff (Falkenhayn)** | **Chief of Staff** `[data-testid=advisor-toggle]`; panel `[data-testid=advisor-panel]`. Starters `[data-testid=advisor-starter-weakest]`, `advisor-starter-fortnight`; or type in `[data-testid=advisor-input]` and **Send** `[data-testid=advisor-send]`. POST **`/api/advisor`**. | `[data-testid=advisor-reply]` with non-empty text (not **unavailable offline** on deployed env with model key). Optional `[data-testid=advisor-suggestion]` cards with **Accept** `[data-testid=advisor-accept]`. |
| **End turn / simultaneous resolution** | **Close the fortnight** `[data-testid=end-turn]` or **Ctrl+Enter** / **Cmd+Enter**. POST **`/api/turn`**. | Banner **Stavka is deliberating…** `[data-testid=stavka-deliberating]` then clears; queue empties; Chronicle gains a dated entry; `[data-testid=resolution-log]` lists **Resolved** / **Rejected** lines. Failures: `[role=alert]` turn error, or `[data-testid=gm-fallback]` / `[data-testid=gm-warning]` with staff fallback text. |
| **GM narration & diplomacy** | After end turn, select the new date in Chronicle sidebar or scroll the article. | Paragraphs of `[data-testid=chronicle]` narration; diplomacy lines in muted list; badge **Game master** vs **Staff simulation**. |
| **Finale banner (campaign ended, map first)** | When `state.result` is set and result modal not open. | `[data-testid=finale-banner]` with `[data-testid=finale-summary]` and **See result** `[data-testid=see-result]`. |
| **Win / loss end screen** | From finale banner **See result**, or automatically when `resultOpen` is true. | Modal `[data-testid=endgame]`: grade headline, reason, score, ★ VP; **Back to map** `[data-testid=back-to-map]`; **Play again** returns to `[data-testid=scenario-picker]`. |
| **Restart campaign** | HUD **Restart** (confirm **Confirm restart**). | `[data-testid=scenario-picker]` opens; local save cleared. |

## Automated demo path

```bash
npx playwright install chromium   # once per machine
DEMO_URL=https://your-preview.vercel.app npm run demo-check
# or: npm run demo-check -- --url https://ostfront-two.vercel.app
```

Writes screenshots and logs under `demo-check-output/` (gitignored). LLM steps (advisor, turn close) use long timeouts (~45s / ~140s).

When you add or change a player-visible feature, update this table and extend `scripts/demo-check.mjs` if the happy path should cover it.
