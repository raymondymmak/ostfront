/**
 * Regenerates theater geometry by tracing HOI4 provinces (see scripts/build-hoi4-theater.ts).
 * Run: npx tsx scripts/generate-theater-geometry.ts
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const script = join(dirname(fileURLToPath(import.meta.url)), "build-hoi4-theater.ts")
const result = spawnSync("npx", ["tsx", script], { stdio: "inherit", cwd: join(script, "../..") })
process.exit(result.status ?? 1)
