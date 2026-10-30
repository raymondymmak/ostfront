# Ostfront feature map (QA & agents)

Route for every feature: **`/`** (single-page app). Unless noted, actions assume a campaign is in progress (scenario picker closed).

Stable selectors prefer `[data-testid=…]`. Button labels are fallbacks when test ids are not set.

| Feature | How to reach it | Proof it worked |
| --- | --- | --- |
| **Start campaign / pick difficulty** | On first load (or after Restart → Confirm), modal `[data-testid=scenario-picker]`: choose `[data-testid=difficulty-easy\|normal\|hard]`, then **Begin the offensive** `[data-testid=begin-scenario]`. | Picker hides; map `[data-testid=war-map]` visible; HUD date **2 May 1915**; Chronicle shows opening copy. |
| **Read briefing** | Chronicle `[data-testid=chronicle]`; on mobile (**390×844**) use **Chronicle** tab → `[data-testid=mobile-chronicle-panel]`. | Opening briefing text visible. |
| **Top bar readout** | Always in `<header>` after campaign start. | `[data-testid=objectives]` strength bar; labels **Strength**, **Provinces**; `[data-testid=treasury]` manpower/industry; **★ VP** fraction; `[data-testid=grade]` provisional or final grade; date and fortnight counter top-right. |
| **Select province (map)** | Click a province on `[data-testid=war-map]` (MapLibre canvas). | **Province** tab `h2` shows that province (demo clicks **Katowice**, not default Kraków). |
| **Select province (list)** | **Orders** → **Your formations** row, or **Province** tab after map selection. | Province panel title updates. |
| **Province tab** | `[data-testid=tab-province]` (**Province**). | Supply/unrest meters, neighbors list, fortify/recruit when eligible. |
| **Neighbor Move** | **Province** tab: neighbor row with **Move** (friendly target). | **Orders** queue: **Move to … from …** |
| **Neighbor Attack** | **Province** tab: neighbor row with **Attack** (enemy). | Queue shows attack line; optional `[data-testid=attack-odds]`. |
| **Draw arrows on map** | **Orders** tab: **Draw arrows** `[data-testid=draw-arrows]`; drag between provinces when mode is on (optional in demo-check). | `aria-pressed="true"`; queue entry appears. |
| **Typed directive** | **Orders** tab: textarea `[data-testid=directive]`. | Parsed **Will …** lines under the field. |
| **Fortify** | **Province** tab: **Fortify …** `[data-testid=fortify]` (added in PR #33). | **Orders** queue shows **Fortify** line (`[data-testid=queued-orders]`). |
| **Recruit** | **Province** tab at a yard: `[data-testid=recruit-panel]`; `[data-testid=recruit-infantry]` etc. | Queue shows **Raise … at** |
| **Map mode Control / Supply / Unrest** | `[data-testid=map-mode-none]`, `map-mode-supply`, `map-mode-unrest`. | `[data-testid=overlay-scale]` visible for Supply/Unrest only. |
| **Toggle rails** | Map legend → `[data-testid=rail-toggle]`. | Label **On** ↔ **Off**. |
| **Chief of Staff** | `[data-testid=advisor-toggle]`; panel `[data-testid=advisor-panel]`. Starters, or `[data-testid=advisor-input]` + `[data-testid=advisor-send]`. POST **`/api/advisor`**. | `[data-testid=advisor-reply]`; optional **Accept** `[data-testid=advisor-accept]`. |
| **End turn (button)** | **Close the fortnight** `[data-testid=end-turn]`. POST **`/api/turn`**. | `[data-testid=stavka-deliberating]` clears; new Chronicle date; `[data-testid=resolution-log]`. |
| **End turn (keyboard)** | **Ctrl+Enter** / **Cmd+Enter** with focus on the page. | Same as button. |
| **GM narration** | Chronicle article after end turn. | Narration paragraphs; badge **Game master** (not **Staff simulation** when LLM ran). |
| **Finale banner / end screen** | Not run in `demo-check` (needs a finished campaign). When `state.result` is set: `[data-testid=finale-banner]`, **See result** `[data-testid=see-result]`, modal `[data-testid=endgame]`. | Grade, reason, score; **Play again** → `[data-testid=scenario-picker]`. |
| **Restart** | HUD **Restart** → **Confirm restart**. | `[data-testid=scenario-picker]` opens. |

## Automated demo path

```bash
npx playwright install chromium   # once per machine
DEMO_URL=https://your-preview.vercel.app npm run demo-check
# Flags: --continue --allow-fallback --force-fail
```

Default without `DEMO_URL`: warns and uses production. **Agents must set `DEMO_URL` to their preview.** Do not pass share tokens via `npm run demo-check -- --url` (npm logs the command line).

Protected previews: `VERCEL_AUTOMATION_BYPASS_SECRET` or share link in **`DEMO_URL` only**. See `AGENTS.md` for redaction limits.

Writes screenshots and redacted logs under `demo-check-output/` (gitignored).

When you add or change a player-visible feature, update this table and extend `scripts/demo-check.mjs`.
