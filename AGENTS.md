<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## QA before merge

**You must pass your Vercel preview URL** — do not rely on the production default:

`DEMO_URL=https://<your-preview>.vercel.app npm run demo-check`

(or `npm run demo-check -- --url …`). Attach the printed step summary and screenshots from `demo-check-output/` when marking work done. Update **`FEATURES.md`** when you change player-visible behavior. Install Chromium once: `npx playwright install chromium`.

If neither `DEMO_URL` nor `--url` is set, the script **warns** and tests production `https://raymondymmak-ostfront.vercel.app` (for local smoke only).

**Protected previews:** Set `VERCEL_AUTOMATION_BYPASS_SECRET` in the environment (never commit it; logs redact secrets). The script sends the Vercel automation bypass headers on every request. Or use a share link in `DEMO_URL` with `_vercel_share=…`; the script visits it once, then continues on the same origin without keeping the query (avoids redirect loops). Share tokens and bypass values are **redacted** in stdout, `run.log`, `summary.json`, and `issues.log`.

**Flags:** `--continue` runs all steps after a failure; `--allow-fallback` allows **Staff simulation** instead of **Game master** in chronicle checks; `--force-fail` / `DEMO_FORCE_FAIL=1` fails one step deliberately to verify non-zero exit.
