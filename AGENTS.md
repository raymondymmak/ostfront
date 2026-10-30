<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## QA before merge

After implementing or changing player-visible behavior, run `npm run demo-check` against your Vercel preview URL (`DEMO_URL=… npm run demo-check` or `npm run demo-check -- --url …`). Attach the printed step summary and relevant screenshots from `demo-check-output/` when marking work done. Update **`FEATURES.md`** whenever you add or change a feature (selectors, routes, proof). Install the browser once with `npx playwright install chromium`.

