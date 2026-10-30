<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## QA before merge

**Pass your preview URL via the environment** (do not put share tokens on the npm command line):

`DEMO_URL=https://<your-preview>.vercel.app npm run demo-check`

Optional flags: `--continue`, `--allow-fallback`, `--force-fail` / `DEMO_FORCE_FAIL=1`. Attach the step summary and `demo-check-output/` screenshots when marking work done. Update **`FEATURES.md`** when player-visible behavior changes. Install Chromium once: `npx playwright install chromium`.

**Exit code:** `0` only when no step **failed**. Steps recorded as **skipped** (e.g. step 16 with no advisor cards) still exit **non-zero** unless you passed **`--allow-fallback`**. Login, Vercel protection, deployment-not-found, and HTTP load failures abort the run immediately even with **`--continue`**.

If `DEMO_URL` is unset, the script warns and uses production `https://raymondymmak-ostfront.vercel.app` (local smoke only — not for agent sign-off).

**Protected previews:** Set `VERCEL_AUTOMATION_BYPASS_SECRET` (never commit). Or put a share link in **`DEMO_URL`** only (`_vercel_share=…`). Avoid `npm run demo-check -- --url '…?_vercel_share=…'` because npm may log the token before the script runs.

**Redaction:** When `configureRedaction()` is given bypass/share values (from env at runtime), the script replaces registered literal forms (raw, URL-encoded, double-encoded, mixed-case percent-encoding, standard base64 and base64url) and scrubs common `_vercel_share` / `x-vercel-protection-bypass` query shapes in its own logs. **`tests/demo-check-redact.test.ts`** covers those paths. Unknown tokens are **not** redacted — do not paste secrets into URLs or logs expecting magic scrubbing. Does **not** scrub npm’s command-line echo.

**Flags:** `--continue` runs later steps after a normal failure; `--allow-fallback` allows Staff simulation in chronicle checks and **SKIP** (not PASS) when step 16 truly has no cards (live cards are still accepted when present); `--force-fail` verifies non-zero exit.
