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

Recent: **015** — campaign coach (no orders, server-loaded state); **014** — terminal fortnights advance turn index (#62); **013** — slim HUD + Options menu (Part 8); **012** — document tray; **011** — `/teach` shell.

When you change architecture, routes, storage, trust boundaries, or game rules, update `ARCHITECTURE.md` and add or revise an ADR in the same pull request (see `AGENTS.md`).
