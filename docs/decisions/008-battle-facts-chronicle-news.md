# Battle facts on turn resolutions

**Status:** accepted  
**Date:** 2025-11-17

## Context

News cards and the Chronicle Log need **engine-authored loss counts** and encirclement beats without inventing numbers or changing combat rules. Summaries already contained loss sentences; presentation needed structured data.

## Decision

Add an optional `battle?: BattleFacts` field on `Resolution`, populated in `resolveManeuvers` only for meeting engagements and assaults that already emit a **Losses —** line. `lib/news/` consumes facts for encirclement cards (`NewsKind.encirclement`), map arrows (parsed prong names from the assault title when needed—no extra fields on `BattleFacts`), compact **Ours · Theirs** loss lines, and Log drawer routine rows. Zod schemas accept records with or without `battle` so older saves load unchanged.

## Consequences

- UI can show deterministic lore alongside factual losses; engine summaries and dice behavior stay the source of truth.
- Encirclement priority (below objectives, above plain city beats) dedupes double headlines when a pocket also takes a city.
- Any future need for explicit prong province ids on cards would require extending `BattleFacts` (not done in this change).