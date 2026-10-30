<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## QA before merge

**Pass your preview URL via the environment** (do not put share tokens on the npm command line):

`DEMO_URL=https://<your-preview>.vercel.app npm run demo-check`

Optional flags: `--continue`, `--allow-fallback`, `--force-fail` / `DEMO_FORCE_FAIL=1`. Attach the step summary and `demo-check-output/` screenshots when marking work done. Update **`FEATURES.md`** when player-visible behavior changes. Install Chromium once: `npx playwright install chromium`.

If `DEMO_URL` is unset, the script warns and uses production `https://raymondymmak-ostfront.vercel.app` (local smoke only — not for agent sign-off).

**Protected previews:** Set `VERCEL_AUTOMATION_BYPASS_SECRET` (never commit). Or put a share link in **`DEMO_URL`** only (`_vercel_share=…`). Avoid `npm run demo-check -- --url '…?_vercel_share=…'` because npm may log the token before the script runs.

**Redaction:** Script output and `demo-check-output/*` run `redactSensitiveText()` on known bypass/share values (raw, URL-encoded, double-encoded, base64, and case variants registered via `configureRedaction`) plus common `_vercel_share` / bypass query patterns. Covered by `tests/demo-check-redact.test.ts` (no substring ≥6 chars of configured tokens may remain). Does **not** scrub npm’s command-line echo or secrets you print outside the script.

**Flags:** `--continue` runs remaining steps after a failure; `--allow-fallback` allows Staff simulation in chronicle checks and records **SKIP** (not PASS) when step 16 gets no advisor cards; `--force-fail` verifies non-zero exit.
