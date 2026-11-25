# Architecture decision records (ADRs)

Short notes on choices that shape Ostfront. Each ADR is one file in this folder.

## Format

| Field | What to write |
| --- | --- |
| **Title** | One line: the decision in active voice |
| **Status** | `accepted`, `superseded`, or `proposed` |
| **Date** | When the decision landed in `main` (from the merge commit, not the draft PR) |
| **Context** | What problem or constraint forced a choice |
| **Decision** | What we did |
| **Consequences** | What became easier, harder, or riskier |

Keep ADRs small. Link to `ARCHITECTURE.md` and code paths instead of pasting implementation detail.

Recent: **021** — remove the typed directive box; **020** — drag a formation chip to queue one move or attack; **019** — HUD economy breakdown and a resource-yield map lens; **018** — OpenAI, then the existing OpenRouter client, then staff simulation; **017** — campaign shell lifecycle reducer; **016** — `applyAttack` wraps `resolveManeuvers`; teach grades on `BattleFacts`; **015** — campaign coach (no orders, server-loaded state); **014** — terminal fortnights advance turn index, freeze date (#62); **013** — slim HUD + Options menu (Part 8); **012** — document tray for stowed parchment papers (Part 7); **011** — `/teach` general’s-table shell; **010** — campaign floating windows.

When you change architecture, routes, storage, trust boundaries, or game rules, update `ARCHITECTURE.md` and add or revise an ADR in the same pull request (see `AGENTS.md`).
