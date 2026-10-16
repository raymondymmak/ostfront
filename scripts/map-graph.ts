import { RAIL_GAPS, CATALOG } from "../lib/data/catalog"

console.log(`provinces ${CATALOG.length}`)
console.log(RAIL_GAPS.length ? `missing rails: ${RAIL_GAPS.map((pair) => pair.join("–")).join(", ")}` : "rails complete")
for (const province of CATALOG) {
  console.log(
    `${province.id.padEnd(12)} ${province.neighbors.join(", ")}`,
  )
}
