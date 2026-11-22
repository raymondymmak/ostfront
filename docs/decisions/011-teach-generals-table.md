# Teaching drill uses the general’s-table shell

**Status:** accepted  
**Date:** 2026-11-22  
**Context:** ADR 010 put the campaign on a map-first floating-window layout at `lg+` but left `/teach` on a three-column dock. Phase 2D Part 6 asked for the same parchment table on the tutorial, with low-text prompts and persistent lesson target highlights, without changing lesson resolve logic or trust boundaries.  
**Decision:** Reuse `FloatingWindow`, HUD parchment chrome, and `useDesktopShell` on `/teach`. Desktop windows are Lesson, Orders, Province, and Legend (`lib/ui/teach-windows.ts`) — not Log / Chief of Staff / OHL. Escape closes the topmost teach window, then clears selection. Lesson copy is a short map-first prompt; longer briefing and pedagogy sit behind expandable controls. MapLibre adds brass lesson-focus fill/outline layers for target and source provinces (`lib/map/lesson-highlight.ts`), pulsing only when motion is allowed. Below `lg`, keep the stacked map + Orders/Province tabs + Lesson column.  
**Consequences:** Demo-check and FEATURES treat `/teach` desktop as a general’s table with `data-lesson-highlights` and open Lesson/Orders/Legend windows. Campaign window ids stay separate from teach ids. Shared `--primary` / `--brass-deep` darken slightly so parchment text contrast clears WCAG AA; map faction paints are unchanged.
