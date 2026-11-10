# Ostfront features

## Teaching drill (Sprint 1–2 / Phase 2A–2B)

Route **`/teach`**. Entry link on the scenario picker: `[data-testid=begin-teach]`. Campaign at **`/`** is unchanged.

| Step | Selector / API | Proof |
| --- | --- | --- |
| Open drill | `[data-testid=teach-begin]` or `[data-testid=teach-begin-supply]` | `[data-testid=teach-app]`; lessons `converging-lublin` \| `supply-tradeoff` |
| Coach question | `[data-testid=teach-question]` | Guided variant only; silent shows `[data-testid=teach-silent-banner]` |
| Hints | `[data-testid=teach-request-hint]` | Guided only; supply hints reference `[data-testid=map-mode-supply]` |
| Plan on map | Same arrows / Province **Attack** as campaign | `[data-testid=queued-orders]`; engine preview attack/defence lines |
| Reasoning | `[data-testid=teach-reasoning]` | Free text; coach compares to server plan |
| Prediction (required) | `[data-testid=teach-prediction]` | Server rejects resolve if under 12 chars; stored on attempt; compared post-resolve in feedback |
| Belief recall | `[data-testid=teach-belief-recall]` | Silent session with `priorAttemptId`; server-loaded belief — not client-writable |
| Discuss plan (guided) | `[data-testid=teach-discuss-plan]` | POST **`/api/teach/coach`** |
| Pedagogy notice | `[data-testid=teach-pedagogy-notice]` | Guided fixed die roll disclosed before resolve |
| Resolve | `[data-testid=teach-resolve]` | POST **`/api/teach/resolve`** with `prediction` (strict schema). `[data-testid=teach-belief-stored]` shows belief persistence status |
| Silent follow-up | `[data-testid=teach-start-silent]` | No hints; optional belief recall from prior guided attempt |
| Supply lesson | `[data-testid=teach-start-supply]` or setup button | Trade-off Katowice (heavy, lower supply) vs Kraków (lean, depot-fed); preview ratios from engine |

Session: GET **`/api/teach/session?lessonId=…&variant=…&priorAttemptId=…`**.

Verified supply/combat (engine): attacker `max(0.15, supply/100)`; defender floor `0.3`; march/attack blocked below supply `30`; supply trace `100 − pathCost×11`, rail edge cost `1`.

Trust: teaching resolve does **not** accept client `GameState` for grading (scoped mitigation for #26). Full campaign **`/api/turn`** still trusts browser state.

## Chief of Staff suggestions

The advisor panel is `[data-testid=advisor-panel]`. Each suggestion is `[data-testid=advisor-suggestion]` and carries `data-advisor-state`, `data-advisor-queue-lines` (display text per order), and `data-advisor-orders` (structured kind/origin/target/units for QA). Queued arrows expose the same structure on each `[data-testid=queued-orders]` row via `data-queued-order`.

| State | Meaning | Control |
| --- | --- | --- |
| `new` | The order does not reuse a queued formation. | **Accept** `[data-testid=advisor-accept]` files every formation on the card, or none. |
| `duplicate` | Same order type, same units, and same target as an order already queued. | Shown, marked **Already queued**. Accept is disabled. |
| `conflict` | Reuses a division that already has a different queued order. | Shown, marked **Conflicts with:** the existing order (`[data-testid=advisor-queue]`). **Override** `[data-testid=advisor-override]` replaces that division's queued order. Other divisions on the same arrow stay. A second column for the same origin and target is not added. |

Suggestions are dropped when they are not a legal order, and `dropped` counts them. A fortify that is already at level 3 is dropped with the other illegal orders. The engine reason is recorded on the drop. Matching the queue is not a reason to drop one. Open cards are marked again whenever the queue changes, and Accept checks them once more against the queue it would file into. A formation that is now committed elsewhere makes the card a conflict; Override is required, and Accept files nothing. If the order can no longer be applied, Accept shows the reason (`[data-testid=advisor-notice]`) and the orders hint is replaced, so a previous "Filed in the queue" line does not stay up. A card that would leave a depot with no garrison shows `[data-testid=advisor-depot-warning]`. The rules fallback does not file that march when another order is available.

New cards are listed first, then conflicts. Duplicates stay visible and do not take one of the three suggestion slots. Odds figures stay on the engine-rendered card (`[data-testid=advisor-odds]`). A duplicate's own formations are not counted twice. The model is told not to mention odds in the reply, because the cards show them. Odds in the reply are otherwise left as written. A brace span (`{...}` or `｛...｝`) is removed whole. A stray brace is removed, and an `odds:` token directly beside that stray brace is removed with it. Any other `odds:` stays. Bare words such as `card1` are not tokens.

## Game-master events

An event the engine rejects stays on the turn record with status `rejected`. The chronicle shows it as **Rejected**. It is not removed before the turn is resolved.

---

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
| **Fortify** | **Province** tab: **Fortify …** `[data-testid=fortify]` (disabled state shows `[data-testid=fortify-reason]`). | **Orders** queue shows **Fortify** line (`[data-testid=queued-orders]`). |
| **Recruit** | **Province** tab at a yard: `[data-testid=recruit-panel]`; `[data-testid=recruit-infantry]` etc. | Queue shows **Raise … at** |
| **Map mode Control / Supply / Unrest** | `[data-testid=map-mode-none]`, `map-mode-supply`, `map-mode-unrest`. | `[data-testid=overlay-scale]` visible for Supply/Unrest only. |
| **Toggle rails** | Map legend → `[data-testid=rail-toggle]`. | Label **On** ↔ **Off**. |
| **Chief of Staff** | `[data-testid=advisor-toggle]`; panel `[data-testid=advisor-panel]`. Starters, or `[data-testid=advisor-input]` + `[data-testid=advisor-send]`. POST **`/api/advisor`**. | `[data-testid=advisor-reply]`; cards with `data-advisor-state` **`new`** (Accept), **`conflict`** (Override), or **`duplicate`** (**Already queued**, disabled Accept). |
| **End turn (button)** | **Close the fortnight** `[data-testid=end-turn]`. POST **`/api/turn`**. | `[data-testid=stavka-deliberating]` clears; new Chronicle date; `[data-testid=resolution-log]` includes **Resolved** / **Rejected**. |
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

When you add or change a player-visible feature, update this file and extend `scripts/demo-check.mjs`.
