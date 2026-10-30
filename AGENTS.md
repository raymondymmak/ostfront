<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## QA before merge

After implementing or changing player-visible behavior, run `npm run demo-check` against the live game or your Vercel preview (`DEMO_URL=… npm run demo-check` or `npm run demo-check -- --url …`; default **`https://raymondymmak-ostfront.vercel.app`**). Attach the printed step summary and relevant screenshots from `demo-check-output/` when marking work done. Update **`FEATURES.md`** whenever you add or change a feature (selectors, routes, proof). Install the browser once with `npx playwright install chromium`.

**Protected previews:** If deployment protection blocks Playwright, set `VERCEL_AUTOMATION_BYPASS_SECRET` in the environment (never commit it or paste it into logs). The script sends `x-vercel-protection-bypass` and `x-vercel-set-bypass-cookie: true` on every request. Alternatively, set `DEMO_URL` to a share link that includes `_vercel_share=…`; the script opens that URL once to set the cookie, then continues on the same origin at the app path without re-appending the query (avoids redirect loops).

