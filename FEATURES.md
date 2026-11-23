# Ostfront features

## Teaching drill (Sprint 1–2 / Phase 2A–2B / Phase 2D Part 6)

Route **`/teach`**. Entry link on the scenario picker: `[data-testid=begin-teach]`. Campaign at **`/`** is unchanged.

On desktop (`lg+`, ≥1024px) `/teach` uses the same general’s-table shell as the campaign: full-width map, parchment HUD (title, date, `[data-testid=teach-goal]` — no window buttons), and draggable **Lesson** / **Orders** / **Province** / **Legend** papers (`[data-testid=teach-lesson-window]`, `[data-testid=teach-orders-window]`, `[data-testid=teach-province-window]`, `[data-testid=legend-window]`). Stowed papers sit in `[data-testid=document-tray]` as tabs (`[data-testid=teach-lesson-toggle]`, `[data-testid=tab-orders]`, …). Drag a paper onto the tray (`data-drop-active` / `data-over-tray`) or press Escape to file it; drag a tab up onto the map or press Enter on a focused tab to take it out — no Stow buttons or click-to-toggle. Restore keeps width and last height. Press–drag–release on `[data-testid=floating-window-drag-handle]` (header-only Y clamp so papers can reach the tray); height does not change while dragging; optional `[data-testid=floating-window-resize-handle]`. Default-open: Lesson (top-left), Legend under it, Orders (top-right) — non-overlapping at 1440×900 / 1280×800 so Kraków/Kielce/Lublin stay clear. Exactly one Resolve: `[data-testid=teach-resolve]` in Lesson (pinned in `[data-testid=teach-resolve-bar]`); Orders has no `[data-testid=end-turn]`. `[data-testid=teach-app]` carries `data-teach-shell=desktop|stacked`. Brass lesson-focus via `data-lesson-highlights`. Below `lg`, `h-dvh` stacked map → bounded Lesson (`[data-testid=teach-lesson-stack]`, Resolve in-viewport) → phone tray swapping Orders/Province/Legend — checked at 390×844.

| Step | Selector / API | Proof |
| --- | --- | --- |
| Open drill | `[data-testid=teach-begin]` or `[data-testid=teach-begin-supply]` | `[data-testid=teach-app]`; lessons `converging-lublin` \| `supply-tradeoff` |
| Coach question | `[data-testid=teach-question]` | Short map-first prompt; longer copy behind `[data-testid=teach-briefing-toggle]` → `[data-testid=teach-briefing]` |
| Lesson focus | Map `data-lesson-highlights` | Target + prong province ids highlighted on load |
| Hints | `[data-testid=teach-request-hint]` | Guided only; supply hints reference `[data-testid=map-mode-supply]` |
| Plan on map | Same arrows / Province **Attack** as campaign | `[data-testid=queued-orders]`; engine preview attack/defence lines |
| Reasoning | `[data-testid=teach-reasoning]` | Free text; coach compares to server plan |
| Prediction (required) | `[data-testid=teach-prediction]` | Server rejects resolve if under 12 chars; stored on attempt; compared post-resolve in feedback |
| Belief recall | `[data-testid=teach-belief-recall]` | Silent session with `priorAttemptId`; server-loaded belief — not client-writable |
| Discuss plan (guided) | `[data-testid=teach-discuss-plan]` | POST **`/api/teach/coach`** |
| Pedagogy notice | `[data-testid=teach-pedagogy-notice]` | Guided fixed die roll disclosed (expandable) before resolve |
| Resolve | `[data-testid=teach-resolve]` | POST **`/api/teach/resolve`** with `prediction` (strict schema). `[data-testid=teach-belief-stored]` shows belief persistence status |
| Silent follow-up | `[data-testid=teach-start-silent]` | No hints; optional belief recall from prior guided attempt |
| Supply lesson | `[data-testid=teach-start-supply]` or setup button | Trade-off Katowice (heavy, lower supply) vs Kraków (lean, depot-fed); preview ratios from engine |

Session: GET **`/api/teach/session?lessonId=…&variant=…&priorAttemptId=…`**.

Verified supply/combat (engine): attacker `max(0.15, supply/100)`; defender floor `0.3`; march/attack blocked below supply `30`; network supply `100 − pathCost×11`, rail edge cost `1`.

### Province supply capacity (Sprint 3)

Each province has a **garrison supply capacity** (terrain base + depot bonus when controlled + 6× rail links). When fighting strength in the province exceeds capacity, **effective supply** scales as `networkSupply × min(1, capacity ÷ garrisonStrength)` — shown on the map Supply overlay and used for **attacks launched from** that province. **Defenders** still use the network line (`networkSupply`) in combat. **Your depot** still issues bulk rations: attacks launched from a depot you control never march below **72% of network supply**, even when the map shows overcrowding. Over-capacity provinces are spelled out in the fortnight **Chronicle** logistics.

**Converging attacks:** when any prong marches below supply **60**, the flank bonus is off and the pooled battle uses the **worst prong’s launch supply**, then scales it by `objective capacity ÷ (garrison + attackers)` when the combined column overfills the target. Well-fed prongs (all ≥ 60) still pool per-prong power with the normal flank multiplier (converging Lublin lesson).

### Fortify (Sprint 3)

**Fortify** costs **2 industry**, binds the province garrison for that fortnight (no move/attack), and raises fort **one level on the next fortnight** (max 3). Capturing a fortified province reduces its fort by **one level** when control changes. Queue text still uses `[data-testid=fortify]`; the resolution log names IP spent and when entrenchments complete.

Trust: teaching resolve does **not** accept client `GameState` for grading. Full campaign **`/api/turn`** loads state from server Redis by `gameId` and accepts only `expectedTurn` and `orders` (server seed, #26).

## News cards (HOI4-style)

After each fortnight resolves, up to four headline cards (`[data-testid=news-card]`) appear in a viewport-level overlay (`[data-testid=news-card-overlay]`, `z-index` above sidebar and map). **Onward** (`[data-testid=news-onward]`) or Enter advances; **Skip all** (`[data-testid=news-skip-all]`) or Esc dismisses the queue. Images use `[data-testid=news-card-photo]` or `[data-testid=news-card-map]` (stylized vignette, not the live map). Encirclement beats (when the engine marks a pocket) trump duplicate city headlines; city and encirclement cards may show a factual `[data-testid=news-card-losses]` line (`Ours −N · Theirs −M`) from engine `BattleFacts`, not from lore text.

The map uses the full main height (no bottom Chronicle bar). Open **Log** (`[data-testid=chronicle-log-toggle]`) for the Chronicle (`[data-testid=chronicle-drawer]`; panel shell `[data-testid=mobile-chronicle-panel]`). On desktop (`lg+`, min-width 1024px) the campaign is a general's table: full-width map, no fixed 23rem right dock; **Orders**, **Province**, **Log**, **Legend**, **Chief of Staff**, and **Orders from OHL** are draggable parchment papers filed into / taken from `[data-testid=document-tray]` (HUD has no window buttons). Press–drag–release; drag onto the tray or Escape files a paper; drag a tab out or Enter restores (width/last size kept) — no Stow buttons. Default-open after Begin: Orders, Legend (bottom-left), Orders from OHL. Below `lg`, stacked map + tray tab strip for Orders/Province; the map-corner Log control stays above the legend at every width from 640–1023px (no `sm:bottom-3` overlap). Inside `[data-testid=chronicle]`, the latest fortnight shows compact routine rows (`[data-testid=chronicle-routine]`) including short battle loss lines when `Resolution.battle` is present; **Details** (`[data-testid=chronicle-details-toggle]` → `[data-testid=chronicle-details]`) holds full narration, resolutions (`[data-testid=resolution-log]`), and logistics.

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
| **Start campaign / pick difficulty** | First load or Restart → Confirm: full-screen `[data-testid=scenario-picker]` (`[data-testid=campaign-start-backdrop]` only — no live map). Parchment card `[data-testid=campaign-start-card]` is centred (incl. iOS safe areas); difficulty `[data-testid=difficulty]` and actions `[data-testid=campaign-start-actions]` span the card padding with equal left/right insets. Pick `[data-testid=difficulty-easy\|normal\|hard]`, **Begin** `[data-testid=begin-scenario]`, optional **More** briefing. | Picker hidden; `[data-testid=war-map]` and HUD mount; date **2 May 1915**. |
| **Read campaign goal** | Pre-start: `[data-testid=briefing-task]` on the start screen. After Begin: `[data-testid=campaign-goal]` inside **Orders from OHL** (`[data-testid=ohl-orders-window]`), not the HUD strength readout. Desktop: dismissible floating window (default open; reopen with **OHL**). Below `lg`: dismissible strip under the header. Teaching drill: `[data-testid=teach-goal]` shows the lesson title (not the campaign objective); campaign scoring (treasury / VP / grade) is hidden. | One-line objective. Full paragraphs only behind **More**. |
| **Top bar readout** | Always in `<header>` after campaign start. | `[data-testid=objectives]` strength bar; labels **Strength**, **Provinces**; `[data-testid=treasury]` manpower/industry; **★ VP** fraction; `[data-testid=grade]` provisional or final grade; date and fortnight counter top-right. Window papers open from the bottom **document tray** (`[data-testid=document-tray]`): **Orders** `[data-testid=tab-orders]`, **Province** `[data-testid=tab-province]`, **Log** `[data-testid=chronicle-log-toggle]`, **Legend** `[data-testid=legend-toggle]`, **Chief of Staff** `[data-testid=advisor-toggle]`, **OHL** `[data-testid=ohl-toggle]`. |
| **Legal move / attack highlights** | Select any province (or switch selection). | Neighbour move/attack/reach provinces lighten from their own fill with a short fade-in (same pulse when switching). Non-targets keep their normal base fill — no whole-map dim. `data-map-targets` lists ids and `order:true|false`; hover still explains blocked reasons. |
| **Attack odds bar** | Queue an attack or open an enemy neighbor on **Province**. | `[data-testid=attack-odds]` or `[data-testid=combined-odds]` with `data-odds-band` and `data-ratio`; long caveat on hover/title. |
| **Select province (map)** | Click a province on `[data-testid=war-map]` (MapLibre canvas); click again or press **Esc** (when news/Log are closed) to clear selection. | **Province** tab `h2` shows that province (demo clicks **Katowice**, not default Kraków). Labels/counters are symbol layers, not HTML markers. |
| **Select province (list)** | **Orders** → **Your formations** row, or **Province** tab after map selection. | Province panel title updates. |
| **Province tab** | `[data-testid=tab-province]` (**Province**). | Supply/unrest meters, neighbors list, fortify/recruit when eligible. |
| **Neighbor Move** | **Province** tab: neighbor row with **Move** (friendly target). | **Orders** queue: **Move to … from …** |
| **Neighbor Attack** | **Province** tab: neighbor row with **Attack** (enemy). | Queue shows attack line; optional `[data-testid=attack-odds]`. |
| **Draw arrows on map** | **Orders** tab: **Draw arrows** `[data-testid=draw-arrows]`; drag between provinces when mode is on (optional in demo-check). | `aria-pressed="true"`; queue entry appears. |
| **Typed directive** | **Orders** tab: textarea `[data-testid=directive]`. | Parsed **Will …** lines under the field. |
| **Fortify** | **Province** tab: **Fortify …** `[data-testid=fortify]` (disabled state shows `[data-testid=fortify-reason]`). | **Orders** queue shows **Fortify** line (`[data-testid=queued-orders]`). |
| **Recruit** | **Province** tab at a yard: `[data-testid=recruit-panel]`; `[data-testid=recruit-infantry]` etc. | Queue shows **Raise … at** |
| **Map mode Control / Supply / Unrest** | `[data-testid=map-mode-none]`, `map-mode-supply`, `map-mode-unrest`. | `[data-testid=overlay-scale]` visible for Supply/Unrest only. |
| **Toggle rails** | Map legend → `[data-testid=rail-toggle]`. | Label **On** ↔ **Off**. Held rails: light casing + near-black track (~2.0–3.0px, ~0.85 opacity); cut rails dashed at the same weight; above fills/borders, under labels/counters. |
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
