/**
 * Playable provinces from WorldOS 1914 regions.
 * Whole regions are merged onto the existing game ids. A region is split only when
 * several game provinces share it, along a Natural Earth river or a short deliberate line.
 *
 * Run: npm run ingest:worldos && npm run build:theater
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as turf from "@turf/turf"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"
import { PROVINCE_DEFS } from "../lib/data/definitions"
import { neighborsFromPolygons, type ProvinceRings } from "../lib/data/geometry"
import { RAIL_PAIRS } from "../lib/data/rails"
import { displayRivers, loadRivers, riverThrough, type RiverIndex } from "./theater/load-rivers"
import { cutContaining, outerRings } from "./theater/polygon-cut"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const REGIONS_PATH = join(ROOT, "lib/data/worldos-theater-regions.geojson")
const OUT_PATH = join(ROOT, "lib/data/theater-geometry.json")
const WORK = join(ROOT, "scripts/cache/worldos-theater-build")

const VIEW_BBOX: [number, number, number, number] = [9, 43.2, 34.2, 58.0]
const SOURCE =
  "Region geometry derived from the worldos.cc World War I Game map (World101), itself built from Natural Earth (public domain) and aourednik/historical-basemaps 1914 owners (CC-BY-SA); used in a non-commercial learning project."

type Poly = Polygon | MultiPolygon
type Region = Feature<Poly> & {
  properties: {
    id: string
    name: string
    owner_1914: string
    owner_label: string
    country_modern?: string
  }
}

type Piece = Feature<Poly> & { properties: { gid: string; kind: "province" | "backdrop"; name: string } }

const SEED = Object.fromEntries(PROVINCE_DEFS.map((def) => [def.id, [def.lon, def.lat] as [number, number]]))

function roundCoord([lon, lat]: [number, number]): [number, number] {
  return [Math.round(lon * 10000) / 10000, Math.round(lat * 10000) / 10000]
}

function loadRegions(): Region[] {
  if (!existsSync(REGIONS_PATH)) {
    throw new Error(`missing ${REGIONS_PATH} — run npm run ingest:worldos`)
  }
  const collection = JSON.parse(readFileSync(REGIONS_PATH, "utf8")) as FeatureCollection
  const regions: Region[] = []
  for (const feature of collection.features) {
    if (!feature.geometry || (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon")) {
      continue
    }
    const props = feature.properties ?? {}
    const id = String(props.id ?? "")
    if (!id || props.owner_1914 == null || props.owner_label == null) {
      throw new Error("theater regions are missing id/owner_1914/owner_label — ingest the WorldOS extract, not the bootstrap")
    }
    regions.push(feature as Region)
  }
  if (regions.length < 100) throw new Error(`expected about 103 WorldOS regions, found ${regions.length}`)
  return regions
}

function ensureRivers(): string[] {
  const europe = join(ROOT, "scripts/cache/ne_10m_rivers_europe.geojson")
  const world = join(ROOT, "scripts/cache/ne_10m_rivers_lake_centerlines.geojson")
  mkdirSync(join(ROOT, "scripts/cache"), { recursive: true })
  const sources: [string, string][] = [
    [
      europe,
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_europe.geojson",
    ],
    [
      world,
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson",
    ],
  ]
  for (const [path, url] of sources) {
    if (existsSync(path)) continue
    console.log(`fetching ${url}`)
    execFileSync("curl", ["-fsSL", "-o", path, url], { stdio: "inherit" })
  }
  return [europe, world]
}

function byId(regions: Region[]): Map<string, Region> {
  return new Map(regions.map((region) => [region.properties.id, region]))
}

function mustRegion(map: Map<string, Region>, id: string): Region {
  const region = map.get(id)
  if (!region) throw new Error(`missing WorldOS region ${id}`)
  return region
}

function polygonComponents(feature: Feature<Poly>): Feature<Polygon>[] {
  if (feature.geometry.type === "Polygon") return [feature as Feature<Polygon>]
  return feature.geometry.coordinates
    .filter((rings) => rings[0] && rings[0].length >= 4)
    .map((rings) => turf.polygon(rings))
}

function containsPoint(feature: Feature<Poly>, point: [number, number]) {
  return turf.booleanPointInPolygon(turf.point(point), feature)
}

function borderKm(a: Feature<Poly>, b: Feature<Poly>) {
  const outline = (feature: Feature<Poly>) => {
    const lines: number[][][] = []
    for (const part of polygonComponents(feature)) {
      const line = turf.polygonToLine(part)
      if (line.type !== "Feature") continue
      if (line.geometry.type === "LineString") lines.push(line.geometry.coordinates as number[][])
      else lines.push(...(line.geometry.coordinates as number[][][]))
    }
    return turf.multiLineString(lines)
  }
  try {
    return turf.length(turf.lineOverlap(outline(a), outline(b), { tolerance: 0.004 }), { units: "kilometers" })
  } catch {
    return 0
  }
}

/**
 * A river or a bent cut can leave a lobe that contains neither city. That lobe is
 * attached to whichever side it actually borders, so a province stays one piece.
 */
function cutOff(
  feature: Feature<Poly>,
  line: [number, number][],
  seed: [number, number],
  label: string,
  keepInRest: [number, number][] = [],
): { piece: Feature<Poly>; rest: Feature<Poly> } {
  try {
    const { inside, outside } = cutContaining(feature, line, seed)
    for (const other of keepInRest) {
      if (containsPoint(inside, other) || !containsPoint(outside, other)) {
        throw new Error("cut pulled another city out of the remainder")
      }
    }
    const insideParts = polygonComponents(inside)
    const outsideParts = polygonComponents(outside)
    const pieceMain = insideParts.filter((part) => containsPoint(part, seed))
    const restMain = keepInRest.length
      ? outsideParts.filter((part) => keepInRest.some((point) => containsPoint(part, point)))
      : outsideParts.slice().sort((a, b) => turf.area(b) - turf.area(a)).slice(0, 1)
    if (!pieceMain.length || !restMain.length) throw new Error("cut missed a city")
    const claimed = new Set<Feature<Polygon>>([...pieceMain, ...restMain])
    const orphans = [...insideParts, ...outsideParts]
      .filter((part) => !claimed.has(part))
      .sort((a, b) => turf.area(b) - turf.area(a))
    const pieceParts: Feature<Poly>[] = [...pieceMain]
    const restParts: Feature<Poly>[] = [...restMain]
    for (const orphan of orphans) {
      const toPiece = borderKm(orphan, unionParts(pieceParts))
      const toRest = borderKm(orphan, unionParts(restParts))
      if (toPiece >= toRest) pieceParts.push(orphan)
      else restParts.push(orphan)
    }
    const piece = unionParts(pieceParts)
    const rest = unionParts(restParts)
    console.log(
      `  ${label}: ${(turf.area(piece) / 1e6).toFixed(0)} km² / rest ${(turf.area(rest) / 1e6).toFixed(0)} km²`,
    )
    return { piece, rest }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label}: ${message}`)
  }
}

function cutOffRiver(
  rivers: RiverIndex,
  feature: Feature<Poly>,
  riverName: string,
  fallback: [number, number][],
  seed: [number, number],
  label: string,
  keepInRest: [number, number][] = [],
): { piece: Feature<Poly>; rest: Feature<Poly> } {
  const river = riverThrough(rivers, riverName, feature)
  if (river) {
    try {
      console.log(`  trying ${riverName}`)
      return cutOff(feature, river, seed, `${label} via ${riverName}`, keepInRest)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`  ${riverName} cut failed (${message}); using a deliberate line`)
    }
  } else {
    console.log(`  ${riverName} misses this piece; using a deliberate line`)
  }
  return cutOff(feature, fallback, seed, label, keepInRest)
}

function provincePiece(gameId: string, feature: Feature<Poly>): Piece {
  const def = PROVINCE_DEFS.find((item) => item.id === gameId)
  return {
    type: "Feature",
    properties: { gid: gameId, kind: "province", name: def?.name ?? gameId },
    geometry: feature.geometry,
  }
}

function backdropPiece(feature: Feature<Poly>, owner: string, label: string): Piece | null {
  const view = turf.bboxPolygon(VIEW_BBOX)
  const clipped = turf.intersect(turf.featureCollection([feature, view]))
  if (!clipped || turf.area(clipped) < 8_000_000) return null
  return {
    type: "Feature",
    properties: { gid: `bg:${owner}`, kind: "backdrop", name: label },
    geometry: clipped.geometry as Poly,
  }
}

function unionParts(parts: Feature<Poly>[]): Feature<Poly> {
  if (parts.length === 1) return parts[0]
  const union = turf.union(turf.featureCollection(parts))
  if (!union) throw new Error("union failed")
  return union as Feature<Poly>
}

function assertSeed(feature: Feature<Poly>, gameId: string) {
  const seed = SEED[gameId]
  if (!seed) throw new Error(`unknown game id ${gameId}`)
  if (turf.booleanPointInPolygon(turf.point(seed), feature)) return
  const distance = turf.pointToPolygonDistance(turf.point(seed), feature, { units: "kilometers" })
  if (gameId === "memel" && distance < 40) return
  throw new Error(`${gameId} seed is ${distance.toFixed(1)} km outside its polygon`)
}

function buildPieces(regions: Region[], rivers: RiverIndex): Piece[] {
  const regionsById = byId(regions)
  const consumed = new Set<string>()
  const pieces: Piece[] = []
  const provinceParts = new Map<string, Feature<Poly>[]>()

  const take = (id: string) => {
    if (consumed.has(id)) throw new Error(`region ${id} used twice`)
    consumed.add(id)
    return mustRegion(regionsById, id)
  }
  const add = (gameId: string, feature: Feature<Poly>) => {
    const list = provinceParts.get(gameId) ?? []
    list.push(feature)
    provinceParts.set(gameId, list)
  }

  const whole: [string, string][] = [
    ["memel", "memel"],
    ["posen", "posen"],
    ["kalisz", "kalisz"],
    ["piotrkow", "lodz"],
    ["kielce", "kielce"],
    ["vilna", "vilna"],
    ["east_galicia", "lemberg"],
    ["stanislau", "stanislav"],
  ]
  for (const [regionId, gameId] of whole) add(gameId, take(regionId))

  console.log("east prussia")
  {
    let rest: Feature<Poly> = take("east_prussia")
    const allenstein = cutOff(
      rest,
      [
        [19.05, 54.22],
        [20.7, 54.18],
        [21.35, 54.05],
        [21.55, 53.05],
      ],
      SEED.allenstein,
      "allenstein",
    )
    add("allenstein", allenstein.piece)
    rest = allenstein.rest
    const tilsit = cutOff(
      rest,
      [
        [20.7, 54.92],
        [21.45, 54.88],
        [22.15, 54.82],
        [23.1, 54.78],
      ],
      SEED.tilsit,
      "tilsit",
    )
    add("tilsit", tilsit.piece)
    rest = tilsit.rest
    const konigsberg = cutOff(
      rest,
      [
        [21.22, 55.4],
        [21.22, 54.7],
        [21.35, 54.15],
        [21.55, 53.2],
      ],
      SEED.konigsberg,
      "konigsberg",
    )
    add("konigsberg", konigsberg.piece)
    add("insterburg", konigsberg.rest)
  }

  console.log("west prussia")
  {
    let rest: Feature<Poly> = take("west_prussia")
    const danzig = cutOff(rest, [[16.5, 53.92], [20.1, 53.92]], SEED.danzig, "danzig")
    add("danzig", danzig.piece)
    rest = danzig.rest
    const graudenz = cutOff(rest, [[16.5, 53.4], [20.1, 53.4]], SEED.graudenz, "graudenz")
    add("graudenz", graudenz.piece)
    rest = graudenz.rest
    const bromberg = cutOffRiver(
      rivers,
      rest,
      "Vistula",
      [
        [18.35, 53.45],
        [18.32, 53.0],
        [18.4, 52.35],
      ],
      SEED.bromberg,
      "bromberg",
      [SEED.thorn],
    )
    add("bromberg", bromberg.piece)
    add("thorn", bromberg.rest)
  }

  console.log("kovno / shavli")
  {
    const region = take("kovno")
    const shavli = cutOff(
      region,
      [
        [20.9, 55.32],
        [24.2, 55.34],
        [26.9, 55.38],
      ],
      SEED.shavli,
      "shavli",
      [SEED.kovno],
    )
    add("shavli", shavli.piece)
    add("kovno", shavli.rest)
  }

  console.log("mariampol + lomza")
  {
    const mariampol = take("mariampol")
    let rest: Feature<Poly> = take("lomza_bialystok")
    const suwalki = cutOffRiver(
      rivers,
      rest,
      "Narew",
      [
        [21.4, 53.58],
        [23.2, 53.55],
        [24.1, 53.52],
      ],
      SEED.suwalki,
      "suwalki",
      [SEED.bialystok],
    )
    add("suwalki", unionParts([suwalki.piece, mariampol]))
    add("bialystok", suwalki.rest)
  }

  console.log("grodno / minsk")
  {
    const region = take("grodno")
    const grodno = cutOff(region, [[25.05, 55.2], [25.05, 52.5]], SEED.grodno, "grodno", [SEED.minsk])
    add("grodno", grodno.piece)
    add("minsk", grodno.rest)
  }

  console.log("warsaw region + dobrzyn")
  {
    const dobrzyn = take("dobrzyn_wloclawek")
    let rest: Feature<Poly> = take("warsaw")
    const mlawa = cutOffRiver(
      rivers,
      rest,
      "Narew",
      [
        [19.1, 52.82],
        [21.4, 52.8],
        [23.3, 52.74],
      ],
      SEED.mlawa,
      "mlawa",
      [SEED.plock, SEED.warsaw, SEED.siedlce, SEED.radom],
    )
    add("mlawa", mlawa.piece)
    rest = mlawa.rest
    const radom = cutOffRiver(
      rivers,
      rest,
      "Pilica",
      [
        [19.2, 51.72],
        [20.6, 51.62],
        [21.6, 51.55],
        [22.4, 51.48],
      ],
      SEED.radom,
      "radom",
      [SEED.plock, SEED.warsaw, SEED.siedlce],
    )
    add("radom", radom.piece)
    rest = radom.rest
    const plock = cutOffRiver(
      rivers,
      rest,
      "Vistula",
      [
        [20.25, 52.95],
        [20.25, 52.2],
        [20.3, 51.6],
      ],
      SEED.plock,
      "plock",
      [SEED.warsaw, SEED.siedlce],
    )
    add("plock", unionParts([plock.piece, dobrzyn]))
    rest = plock.rest
    const warsaw = cutOffRiver(
      rivers,
      rest,
      "Bug",
      [
        [21.65, 52.95],
        [21.65, 52.15],
        [21.7, 51.45],
      ],
      SEED.warsaw,
      "warsaw",
      [SEED.siedlce],
    )
    add("warsaw", warsaw.piece)
    add("siedlce", warsaw.rest)
  }

  console.log("lublin / chelm")
  {
    const region = take("lublin")
    const lublin = cutOffRiver(
      rivers,
      region,
      "Wieprz",
      [
        [23.02, 52.45],
        [23.02, 51.4],
        [23.05, 50.25],
      ],
      SEED.lublin,
      "lublin",
      [SEED.chelm],
    )
    add("lublin", lublin.piece)
    // The Warsaw region never meets Brest-Litovsk. Chełm holds that whole border and
    // also meets Siedlce, so its northern end is the rail link.
    const link = cutOff(
      lublin.rest,
      [
        [22.3, 51.9],
        [24.4, 51.9],
      ],
      [23.2, 52.1],
      "siedlce-brest",
      [SEED.chelm],
    )
    add("siedlce", link.piece)
    add("chelm", link.rest)
  }

  console.log("brest / pinsk")
  {
    const region = take("brest_litovsk")
    const brest = cutOff(region, [[24.85, 53.6], [24.85, 51.3]], SEED.brest, "brest", [SEED.pinsk])
    add("brest", brest.piece)
    add("pinsk", brest.rest)
  }

  console.log("volhynia")
  {
    let rest: Feature<Poly> = take("volhynia")
    const kovel = cutOff(rest, [[25.05, 52.2], [25.05, 49.6]], SEED.kovel, "kovel", [SEED.lutsk, SEED.rovno])
    add("kovel", kovel.piece)
    rest = kovel.rest
    const lutsk = cutOff(rest, [[25.85, 52.15], [25.85, 49.6]], SEED.lutsk, "lutsk", [SEED.rovno])
    add("lutsk", lutsk.piece)
    add("rovno", lutsk.rest)
  }

  console.log("west galicia")
  {
    const region = take("west_galicia")
    const krakow = cutOffRiver(
      rivers,
      region,
      "Dunajec",
      [
        [20.35, 50.55],
        [20.48, 49.85],
        [20.6, 49.1],
      ],
      SEED.krakow,
      "krakow",
      [SEED.tarnow],
    )
    add("krakow", krakow.piece)
    add("tarnow", krakow.rest)
  }

  console.log("galicia przemysl → rzeszow / przemysl")
  {
    const region = take("galicia_przemysl")
    // The San runs north–south and would give Rzeszów the entire border with Tarnów.
    // This line crosses that border so both Rzeszów and Przemyśl stay north of the
    // Carpathians and both meet West Galicia.
    const rzeszow = cutOff(
      region,
      [
        [21.24, 49.82],
        [22.15, 49.92],
        [22.9, 50.02],
        [23.35, 50.12],
      ],
      SEED.rzeszow,
      "rzeszow",
      [SEED.przemysl],
    )
    add("rzeszow", rzeszow.piece)
    add("przemysl", rzeszow.rest)
  }

  console.log("tarnopol / podolia → tarnopol + kamenets")
  {
    const tarnopol = take("tarnopol")
    const podolia = take("podolia")
    // The Dniester is Tarnopol's southern border, so it cannot connect Stanislav to Podolia.
    // A band along lat 49 reaches both neighbors; Kamenets is that band plus western Podolia.
    const kept = cutOff(
      tarnopol,
      [
        [24.85, 49.06],
        [25.5, 49.02],
        [26.35, 48.98],
      ],
      SEED.tarnopol,
      "tarnopol",
    )
    add("tarnopol", kept.piece)
    const west = cutOff(podolia, [[28.15, 51.2], [28.15, 47.2]], SEED.kamenets, "kamenets")
    add("kamenets", unionParts([west.piece, kept.rest]))
    const east = backdropPiece(west.rest, podolia.properties.owner_1914, podolia.properties.owner_label)
    if (east) pieces.push(east)
  }

  // WorldOS exclaves smaller than 250 km² are folded into the playable neighbor
  // they share a border with, so a province is not a scatter of specks.
  const folded = new Map<string, Feature<Poly>>()
  for (const [gameId, parts] of provinceParts) folded.set(gameId, unionParts(parts))
  let moved = true
  while (moved) {
    moved = false
    for (const [gameId, feature] of folded) {
      const parts = polygonComponents(feature)
      if (parts.length < 2) continue
      const speck = parts.find((part) => turf.area(part) < 250_000_000 && !containsPoint(part, SEED[gameId]))
      if (!speck) continue
      let host = ""
      let hostKm = 0
      for (const [otherId, other] of folded) {
        if (otherId === gameId) continue
        const km = borderKm(speck, other)
        if (km > hostKm) {
          host = otherId
          hostKm = km
        }
      }
      if (!host || hostKm < 0.5) continue
      folded.set(gameId, unionParts(parts.filter((part) => part !== speck)))
      folded.set(host, unionParts([folded.get(host)!, speck]))
      console.log(`  folded ${(turf.area(speck) / 1e6).toFixed(0)} km² of ${gameId} into ${host}`)
      moved = true
      break
    }
  }
  provinceParts.clear()
  for (const [gameId, feature] of folded) provinceParts.set(gameId, [feature])

  for (const [gameId, parts] of provinceParts) {
    const feature = unionParts(parts)
    assertSeed(feature, gameId)
    pieces.push(provincePiece(gameId, feature))
  }

  const missing = PROVINCE_DEFS.filter((def) => !provinceParts.has(def.id)).map((def) => def.id)
  if (missing.length) throw new Error(`no geometry for ${missing.join(", ")}`)

  for (const region of regions) {
    if (consumed.has(region.properties.id)) continue
    const box = turf.bbox(region)
    const missesView =
      box[2] < VIEW_BBOX[0] || box[0] > VIEW_BBOX[2] || box[3] < VIEW_BBOX[1] || box[1] > VIEW_BBOX[3]
    if (missesView) continue
    const piece = backdropPiece(region, region.properties.owner_1914, region.properties.owner_label)
    if (piece) pieces.push(piece)
  }
  return pieces
}

function runMapshaper(input: string, output: string) {
  const mapshaper = join(ROOT, "node_modules/mapshaper/bin/mapshaper")
  execFileSync(
    mapshaper,
    [
      "-i",
      input,
      "encoding=utf8",
      "-clean",
      "overlap-rule=max-area",
      "-dissolve",
      "gid",
      "copy-fields=kind,name",
      "-simplify",
      "weighted",
      "90%",
      "keep-shapes",
      "-clean",
      "-o",
      output,
      "format=geojson",
      "precision=0.0001",
      "gj2008",
    ],
    { stdio: "inherit", cwd: ROOT },
  )
}

function ringsOf(feature: Feature<Poly>): ProvinceRings {
  return outerRings(feature as Feature<Poly> & { properties: Record<string, unknown> })
}

function geometryFeature(rings: ProvinceRings): Feature<Poly> {
  if (rings.length === 1) return turf.polygon(rings)
  return turf.multiPolygon(rings.map((ring) => [ring]))
}

function main() {
  const rivers = loadRivers(ensureRivers())
  const pieces = buildPieces(loadRegions(), rivers)
  mkdirSync(WORK, { recursive: true })
  const rawPath = join(WORK, "pieces.geojson")
  const dissolvedPath = join(WORK, "dissolved.geojson")
  writeFileSync(rawPath, JSON.stringify({ type: "FeatureCollection", features: pieces }))
  runMapshaper(rawPath, dissolvedPath)

  const dissolved = JSON.parse(readFileSync(dissolvedPath, "utf8")) as FeatureCollection<Poly>
  const polygons: Record<string, ProvinceRings> = {}
  const backdrop: { id: string; name: string; polygon: [number, number][] }[] = []
  for (const feature of dissolved.features) {
    const gid = String(feature.properties?.gid ?? "")
    const rings = outerRings(feature as Feature<Poly>)
    if (!rings.length) continue
    if (gid.startsWith("bg:")) {
      const name = String(feature.properties?.name ?? gid.slice(3))
      rings.forEach((ring, index) => {
        if (turf.area(turf.polygon([ring])) < 8_000_000) return
        backdrop.push({
          id: `${gid.slice(3)}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name,
          polygon: ring.map(roundCoord),
        })
      })
      continue
    }
    polygons[gid] = rings.map((ring) => ring.map(roundCoord))
  }

  const missing = PROVINCE_DEFS.filter((def) => !polygons[def.id]?.[0] || polygons[def.id][0].length < 4)
  if (missing.length) throw new Error(`dissolved mesh lost ${missing.map((def) => def.id).join(", ")}`)

  const centroids: Record<string, [number, number]> = {}
  let minProvinceAreaKm2 = Number.POSITIVE_INFINITY
  const provinceFeatures: Feature<Poly>[] = []
  for (const def of PROVINCE_DEFS) {
    const feature = geometryFeature(polygons[def.id])
    provinceFeatures.push(feature)
    const areaKm2 = turf.area(feature) / 1e6
    minProvinceAreaKm2 = Math.min(minProvinceAreaKm2, areaKm2)
    const inside = turf.pointOnFeature(feature)
    centroids[def.id] = roundCoord(inside.geometry.coordinates as [number, number])
    const [minLon, minLat, maxLon, maxLat] = turf.bbox(feature)
    const diagonal = turf.distance(turf.point([minLon, minLat]), turf.point([maxLon, maxLat]), { units: "kilometers" })
    console.log(
      `${def.id.padEnd(12)} ${areaKm2.toFixed(0).padStart(7)} km²  diag ${diagonal.toFixed(0).padStart(4)} km`,
    )
  }

  const neighbors = neighborsFromPolygons(polygons)
  const gaps = RAIL_PAIRS.filter(([a, b]) => !neighbors[a]?.includes(b))
  if (gaps.length) {
    console.error("rail pairs that do not share a border:")
    for (const pair of gaps) console.error(`  ${pair.join(" — ")}`)
    throw new Error(`${gaps.length} rail gaps`)
  }

  const playableUnion = turf.union(turf.featureCollection(provinceFeatures))
  if (!playableUnion) throw new Error("playable union failed")
  const playableAreaKm2 = turf.area(playableUnion) / 1e6
  const landFeatures = [
    ...provinceFeatures,
    ...backdrop.map((region) => turf.polygon([region.polygon])),
  ]
  const landUnion = turf.union(turf.featureCollection(landFeatures))
  const landPolygons: [number, number][][] = landUnion ? ringsOf(landUnion as Feature<Poly>).map((ring) => ring.map(roundCoord)) : []
  const viewRing: [number, number][] = [
    [VIEW_BBOX[0], VIEW_BBOX[1]],
    [VIEW_BBOX[2], VIEW_BBOX[1]],
    [VIEW_BBOX[2], VIEW_BBOX[3]],
    [VIEW_BBOX[0], VIEW_BBOX[3]],
    [VIEW_BBOX[0], VIEW_BBOX[1]],
  ]
  const playableBox = turf.bbox(playableUnion)
  const theaterBbox: [number, number, number, number] = [
    Math.round(playableBox[0] * 100) / 100,
    Math.round(playableBox[1] * 100) / 100,
    Math.round(playableBox[2] * 100) / 100,
    Math.round(playableBox[3] * 100) / 100,
  ]

  const payload = {
    source: SOURCE,
    bbox: theaterBbox,
    viewBbox: VIEW_BBOX,
    landPolygons,
    seaPolygons: [viewRing],
    polygons,
    centroids,
    neighbors,
    backdrop,
    rivers: displayRivers(rivers, [theaterBbox[0] - 0.4, theaterBbox[1] - 0.3, theaterBbox[2] + 0.6, theaterBbox[3] + 0.3]),
    validation: {
      theaterLandAreaKm2: Math.round(playableAreaKm2),
      playableAreaKm2: Math.round(playableAreaKm2),
      minProvinceAreaKm2: Math.round(minProvinceAreaKm2),
    },
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(payload)}\n`)
  const bytes = Buffer.byteLength(JSON.stringify(payload))
  console.log(`wrote ${OUT_PATH} (${(bytes / 1e6).toFixed(2)} MB, ${backdrop.length} backdrop rings)`)
}

main()
