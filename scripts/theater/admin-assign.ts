import * as turf from "@turf/turf"
import type { Feature, LineString, MultiPolygon, Polygon } from "geojson"
import { PROVINCE_DEFS } from "../../lib/data/definitions"
import type { AdminPiece } from "./nations-1914"

const RULES: { pattern: RegExp; gameId: string; nations?: string[] }[] = [
  { pattern: /kaliningrad|warmian|masurian/i, gameId: "konigsberg", nations: ["German Empire"] },
  { pattern: /memel|klaiped/i, gameId: "memel", nations: ["German Empire"] },
  { pattern: /pomeranian|pomerania|west pomeranian/i, gameId: "danzig", nations: ["German Empire"] },
  { pattern: /kuyavian|kujaw/i, gameId: "thorn", nations: ["German Empire", "Russian Empire"] },
  { pattern: /greater poland|wielkopol/i, gameId: "posen", nations: ["German Empire"] },
  { pattern: /lower silesian|silesian|opole/i, gameId: "bromberg", nations: ["German Empire"] },
  { pattern: /lubusz/i, gameId: "posen", nations: ["German Empire"] },
  { pattern: /brandenburg|mecklenburg|sachsen/i, gameId: "posen", nations: ["German Empire"] },
  { pattern: /masovian|mazowieck/i, gameId: "warsaw", nations: ["Russian Empire"] },
  { pattern: /podlachian|podlaski/i, gameId: "bialystok", nations: ["Russian Empire"] },
  { pattern: /warmian/i, gameId: "allenstein", nations: ["German Empire"] },
  { pattern: /łódź|lodz/i, gameId: "lodz", nations: ["Russian Empire"] },
  { pattern: /świętokrzyskie|swietokrzysk/i, gameId: "kielce", nations: ["Russian Empire"] },
  { pattern: /lublin/i, gameId: "lublin", nations: ["Russian Empire"] },
  { pattern: /subcarpathian|podkarpack/i, gameId: "rzeszow", nations: ["Austria-Hungary"] },
  { pattern: /lesser poland|małopolsk|malopolsk/i, gameId: "krakow", nations: ["Austria-Hungary"] },
  { pattern: /volyn|rivne|zhytomyr/i, gameId: "lutsk", nations: ["Russian Empire"] },
  { pattern: /brest/i, gameId: "brest", nations: ["Russian Empire"] },
  { pattern: /grodno/i, gameId: "grodno", nations: ["Russian Empire"] },
  { pattern: /minsk/i, gameId: "minsk", nations: ["Russian Empire"] },
  { pattern: /vitebsk|mogilev|gomel/i, gameId: "pinsk", nations: ["Russian Empire"] },
  { pattern: /vilniaus|vilnius/i, gameId: "vilna", nations: ["Russian Empire"] },
  { pattern: /šiauliai|siauliai|panevezio|utena/i, gameId: "shavli", nations: ["Russian Empire"] },
  { pattern: /kauno|kaunas/i, gameId: "kovno", nations: ["Russian Empire"] },
  { pattern: /alytaus|marijampol/i, gameId: "kovno", nations: ["Russian Empire"] },
  { pattern: /lviv|l'viv|lviv/i, gameId: "lemberg", nations: ["Austria-Hungary"] },
  { pattern: /ternopil|ivano-frankivs|chernivtsi/i, gameId: "stanislav", nations: ["Austria-Hungary"] },
  { pattern: /khmel|ternopol/i, gameId: "tarnopol", nations: ["Austria-Hungary"] },
  { pattern: /transcarpathia|zakarpat/i, gameId: "stanislav", nations: ["Austria-Hungary"] },
  { pattern: /chernihiv|kiev|kyiv/i, gameId: "kamenets", nations: ["Russian Empire"] },
  { pattern: /pskov|smolensk|novgorod|tver/i, gameId: "minsk", nations: ["Russian Empire"] },
  { pattern: /bryansk/i, gameId: "pinsk", nations: ["Russian Empire"] },
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

export function assignGameId(piece: AdminPiece): string {
  const label = `${piece.admin} ${piece.name}`
  for (const rule of RULES) {
    if (!rule.pattern.test(label)) continue
    if (rule.nations && !rule.nations.includes(piece.nationLabel)) continue
    return rule.gameId
  }
  const c = turf.centroid(turf.feature(piece.geometry))
  const [lon, lat] = c.geometry.coordinates
  return nearestSeed(lon, lat)
}

export function refineWithRivers(
  pieces: { gameId: string; feature: Feature<Polygon | MultiPolygon> }[],
  rivers: Feature<LineString>[],
): { gameId: string; feature: Feature<Polygon | MultiPolygon> }[] {
  if (!rivers.length) return pieces
  const out: { gameId: string; feature: Feature<Polygon | MultiPolygon> }[] = []
  for (const piece of pieces) {
    const area = turf.area(piece.feature)
    if (area < 25_000_000) {
      out.push(piece)
      continue
    }
    const centroid = turf.centroid(piece.feature)
    let split = false
    for (const river of rivers) {
      const nearest = turf.nearestPointOnLine(river, centroid)
      if (turf.distance(centroid, nearest, { units: "kilometers" }) > 12) continue
      const buffered = turf.buffer(river, 0.35, { units: "kilometers" })
      if (!buffered) continue
      const diff = turf.difference(turf.featureCollection([piece.feature, buffered]))
      if (!diff || diff.geometry.type === "Polygon") continue
      const polys = diff.geometry.coordinates.map((c) => turf.polygon(c))
      if (polys.length < 2) continue
      for (const poly of polys) {
        if (turf.area(poly) < 8_000_000) continue
        const [lon, lat] = turf.centroid(poly).geometry.coordinates
        out.push({ gameId: nearestSeed(lon, lat), feature: poly as Feature<Polygon> })
      }
      split = true
      break
    }
    if (!split) out.push(piece)
  }
  return out
}
