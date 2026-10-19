/**
 * Regenerates theater geometry from WorldOS theater regions (see scripts/build-worldos-theater.ts).
 * Run: npx tsx scripts/generate-theater-geometry.ts
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const ingest = join(root, "scripts/ingest-worldos-theater-regions.ts")
const build = join(root, "scripts/build-worldos-theater.ts")

let result = spawnSync("npx", ["tsx", ingest], { stdio: "inherit", cwd: root })
if (result.status !== 0) process.exit(result.status ?? 1)
result = spawnSync("npx", ["tsx", build], { stdio: "inherit", cwd: root })
process.exit(result.status ?? 1)
