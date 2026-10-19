import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import * as turf from "@turf/turf"
import type { Feature, FeatureCollection, Polygon } from "geojson"
import { NATION_GID_START } from "./id-codes"

const CS_LABELS: Record<string, string> = {
  "Germany (Prussia)": "German Empire",
  "Austria-Hungary": "Austria-Hungary",
  "Russia (Soviet Union)": "Russian Empire",
  Rumania: "Romania",
  Sweden: "Sweden",
  Denmark: "Denmark",
  Netherlands: "Netherlands",
  Norway: "Norway",
  Switzerland: "Switzerland",
  Italy: "Italy",
  Turkey: "Ottoman Empire",
  Montenegro: "Montenegro",
  Serbia: "Serbia",
  Bulgaria: "Bulgaria",
  Greece: "Greece",
  Albania: "Albania",
}

function activeInJune1915(props: Record<string, unknown>): boolean {
  const gwsyear = Number(props.gwsyear)
  const gweyear = Number(props.gweyear)
  const gwsmonth = Number(props.gwsmonth ?? 1)
  const gwemonth = Number(props.gwemonth ?? 12)
  const start = gwsyear + (gwsmonth - 1) / 12
  const end = gweyear >= 9999 ? 9999 : gweyear + (gwemonth - 1) / 12
  const june1915 = 1915 + 5 / 12
  return start <= june1915 && end >= june1915
}

export type NationTable = {
  nameToGid: Map<string, number>
  gidToName: Map<number, string>
  cshapes: FeatureCollection
}

export function loadNationTable(cacheDir: string): NationTable {
  const path = join(cacheDir, "CShapes-2.0.geojson")
  if (!existsSync(path)) throw new Error("missing scripts/cache/CShapes-2.0.geojson")
  const cshapes = JSON.parse(readFileSync(path, "utf8")) as FeatureCollection
  const names = [...new Set(Object.values(CS_LABELS))].sort()
  const nameToGid = new Map<string, number>()
  const gidToName = new Map<number, string>()
  names.forEach((name, i) => {
    const gid = NATION_GID_START + i
    nameToGid.set(name, gid)
    gidToName.set(gid, name)
  })
  return { nameToGid, gidToName, cshapes }
}

export function nationAtPoint(
  table: NationTable,
  lon: number,
  lat: number,
): { gid: number; name: string } | null {
  const pt = turf.point([lon, lat])
  for (const feature of table.cshapes.features) {
    const props = feature.properties as Record<string, unknown>
    if (!activeInJune1915(props)) continue
    const rawName = String(props.cntry_name ?? "")
    const label = CS_LABELS[rawName]
    if (!label) continue
    if (/poland|slovak|ukraine|lithuania|latvia|belarus|czech/i.test(rawName)) continue
    if (!turf.booleanPointInPolygon(pt, feature as Feature<Polygon>)) continue
    const gid = table.nameToGid.get(label)!
    return { gid, name: label }
  }
  return null
}
