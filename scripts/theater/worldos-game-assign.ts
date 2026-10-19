import * as turf from "@turf/turf"
import type { Feature, LineString, MultiPolygon, Polygon } from "geojson"
import { PROVINCE_DEFS } from "../../lib/data/definitions"
import { PLAYABLE_EMPIRES } from "./nations-1914"
import { assignGameId } from "./admin-assign"
import type { AdminPiece } from "./nations-1914"

export type WorldosRegion = Feature<Polygon | MultiPolygon> & {
  properties: {
    region_id: string
    name: string
    owner_1914: string
    admin?: string
    gameId?: string | null
  }
}

const NAME_RULES: { pattern: RegExp; gameId: string; nations?: string[] }[] = [
  { pattern: /samland|k.nigsberg|konigsberg/i, gameId: "konigsberg", nations: ["German Empire"] },
  { pattern: /gumbinnen|insterburg/i, gameId: "insterburg", nations: ["German Empire"] },
  { pattern: /allenstein|osterode|ostersode/i, gameId: "allenstein", nations: ["German Empire"] },
  { pattern: /danzig|gdansk|marienburg/i, gameId: "danzig", nations: ["German Empire"] },
  { pattern: /graudenz|marienwerder/i, gameId: "graudenz", nations: ["German Empire"] },
  { pattern: /thorn|torun/i, gameId: "thorn", nations: ["German Empire"] },
  { pattern: /bromberg|bydgoszcz/i, gameId: "bromberg", nations: ["German Empire"] },
  { pattern: /posen|poznan/i, gameId: "posen", nations: ["German Empire"] },
  { pattern: /memel|klaip/i, gameId: "memel", nations: ["German Empire"] },
  { pattern: /tilsit|sovetsk/i, gameId: "tilsit", nations: ["German Empire"] },
  { pattern: /shavli|siauliai|šiauliai/i, gameId: "shavli", nations: ["Russian Empire"] },
  { pattern: /kovno|kaunas/i, gameId: "kovno", nations: ["Russian Empire"] },
  { pattern: /vilna|vilnius|wilno/i, gameId: "vilna", nations: ["Russian Empire"] },
  { pattern: /suwalk|suwał/i, gameId: "suwalki", nations: ["Russian Empire"] },
  { pattern: /grodno/i, gameId: "grodno", nations: ["Russian Empire"] },
  { pattern: /minsk/i, gameId: "minsk", nations: ["Russian Empire"] },
  { pattern: /mlawa|mława/i, gameId: "mlawa", nations: ["Russian Empire"] },
  { pattern: /bialystok|białystok/i, gameId: "bialystok", nations: ["Russian Empire"] },
  { pattern: /plock|płock/i, gameId: "plock", nations: ["Russian Empire"] },
  { pattern: /warsaw|warszawa|warschau/i, gameId: "warsaw", nations: ["Russian Empire"] },
  { pattern: /siedlce/i, gameId: "siedlce", nations: ["Russian Empire"] },
  { pattern: /brest/i, gameId: "brest", nations: ["Russian Empire"] },
  { pattern: /pinsk/i, gameId: "pinsk", nations: ["Russian Empire"] },
  { pattern: /kalisz/i, gameId: "kalisz", nations: ["Russian Empire"] },
  { pattern: /lodz|łódź/i, gameId: "lodz", nations: ["Russian Empire"] },
  { pattern: /radom/i, gameId: "radom", nations: ["Russian Empire"] },
  { pattern: /lublin/i, gameId: "lublin", nations: ["Russian Empire"] },
  { pattern: /kovel|kowel/i, gameId: "kovel", nations: ["Russian Empire"] },
  { pattern: /lutsk|luck/i, gameId: "lutsk", nations: ["Russian Empire"] },
  { pattern: /kielce/i, gameId: "kielce", nations: ["Russian Empire"] },
  { pattern: /chelm|chełm/i, gameId: "chelm", nations: ["Russian Empire"] },
  { pattern: /rovno|rivne/i, gameId: "rovno", nations: ["Russian Empire"] },
  { pattern: /krakow|kraków|cracow/i, gameId: "krakow", nations: ["Austria-Hungary"] },
  { pattern: /tarnow|tarnów/i, gameId: "tarnow", nations: ["Austria-Hungary"] },
  { pattern: /rzeszow|rzeszów/i, gameId: "rzeszow", nations: ["Austria-Hungary"] },
  { pattern: /przemysl|przemyśl/i, gameId: "przemysl", nations: ["Austria-Hungary"] },
  { pattern: /lemberg|lviv|lwow|lwów/i, gameId: "lemberg", nations: ["Austria-Hungary"] },
  { pattern: /tarnopol/i, gameId: "tarnopol", nations: ["Austria-Hungary"] },
  { pattern: /stanislav|stanisław/i, gameId: "stanislav", nations: ["Austria-Hungary"] },
  { pattern: /kamenets|kamianets|podolia/i, gameId: "kamenets", nations: ["Russian Empire"] },
]

function nearestSeed(lon: number, lat: number): string {
  let best = PROVINCE_DEFS[0].id
  let bestD = Number.POSITIVE_INFINITY
  for (const def of PROVINCE_DEFS) {
    const d = (def.lon - lon) ** 2 + (def.lat - lat) ** 2
    if (d < bestD) {
      bestD = d
      best = def.id
    }
  }
  return best
}

export function assignRegionGameId(region: WorldosRegion): string | null {
  const owner = String(region.properties.owner_1914 ?? "")
  if (!PLAYABLE_EMPIRES.has(owner)) return null
  const label = `${region.properties.admin ?? ""} ${region.properties.name}`.trim()
  for (const rule of NAME_RULES) {
    if (!rule.pattern.test(label) && !rule.pattern.test(region.properties.name)) continue
    if (rule.nations && !rule.nations.includes(owner)) continue
    return rule.gameId
  }
  const piece: AdminPiece = {
    geometry: region.geometry,
    nationLabel: owner,
    admin: String(region.properties.admin ?? ""),
    name: region.properties.name,
    sourceId: region.properties.region_id,
  }
  return assignGameId(piece)
}

export function splitRegionByLine(
  region: WorldosRegion,
  line: [number, number][],
  gameA: string,
  gameB: string,
): WorldosRegion[] {
  const bbox = turf.bbox(region)
  const pad = 0.35
  const clip = turf.bboxPolygon([bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad])
  const extended = turf.lineString([
    [line[0][0] - 2, line[0][1]],
    ...line,
    [line.at(-1)![0] + 2, line.at(-1)![1]],
  ])
  const buffer = turf.buffer(extended, 0.08, { units: "kilometers" })
  if (!buffer) return [region]
  const west = turf.intersect(turf.featureCollection([region, buffer]))
  const east = turf.difference(turf.featureCollection([region, buffer]))
  const out: WorldosRegion[] = []
  const push = (feat: Feature<Polygon | MultiPolygon> | null, gameId: string) => {
    if (!feat || turf.area(feat) < 800_000) return
    out.push({
      type: "Feature",
      properties: { ...region.properties, gameId },
      geometry: feat.geometry as Polygon | MultiPolygon,
    })
  }
  push(west as Feature<Polygon | MultiPolygon>, gameA)
  push(east as Feature<Polygon | MultiPolygon>, gameB)
  return out.length === 2 ? out : [region]
}

export function applyCongressPolandSplits(regions: WorldosRegion[]): WorldosRegion[] {
  const bugLine: [number, number][] = [
    [23.2, 52.6],
    [23.45, 52.35],
    [23.65, 52.05],
    [23.85, 51.75],
    [24.0, 51.45],
  ]
  const out: WorldosRegion[] = []
  for (const region of regions) {
    if (region.properties.gameId === "warsaw" && turf.area(region) > 18_000_000_000) {
      const parts = splitRegionByLine(region, bugLine, "warsaw", "siedlce")
      out.push(...parts)
      continue
    }
    if (region.properties.gameId === "lublin" && turf.area(region) > 22_000_000_000) {
      const parts = splitRegionByLine(region, bugLine, "chelm", "lublin")
      out.push(...parts)
      continue
    }
    out.push(region)
  }
  return out
}

export function refineWithRivers(
  regions: WorldosRegion[],
  rivers: Feature<LineString>[],
): WorldosRegion[] {
  const out: WorldosRegion[] = []
  for (const region of regions) {
    if (!region.properties.gameId || turf.area(region) < 30_000_000) {
      out.push(region)
      continue
    }
    const centroid = turf.centroid(region)
    let split = false
    for (const river of rivers) {
      if (!turf.booleanIntersects(river, region)) continue
      const [lon, lat] = centroid.geometry.coordinates
      const seed = nearestSeed(lon, lat)
      const other = PROVINCE_DEFS.find((d) => d.id !== seed && d.id !== region.properties.gameId)
      if (!other) continue
      const parts = splitRegionByLine(region, river.geometry.coordinates as [number, number][], seed, other.id)
      if (parts.length === 2) {
        out.push(...parts)
        split = true
        break
      }
    }
    if (!split) out.push(region)
  }
  return out
}
