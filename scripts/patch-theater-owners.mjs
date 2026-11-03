/**
 * Apply scripts/theater-owner-fixes.json to lib/data/theater-geometry.json.
 *
 * The Python theater build cannot run here (MapChart, HOI4, and the 1914
 * GeoJSON stay off the machine). Country borders are shared arcs whose two
 * states have different owner_1914 values, so they can be rebuilt from the
 * topology. Labels are rebuilt only for owners whose non-playable states changed.
 *
 * On current main the border layer is 564 geometries (553 LineStrings and 11
 * MultiLineStrings) covering 576 arcs. The check below compares that arc set.
 * The write emits one LineString per arc, which is what a second run expects.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { merge } from "topojson-client"
import * as turf from "@turf/turf"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, "..")
const FIXES_PATH = resolve(SCRIPT_DIR, "theater-owner-fixes.json")
const GEOMETRY_PATH = resolve(ROOT, "lib/data/theater-geometry.json")

/** Same frame as EASTERN_VIEW in scripts/build-hoi4-theater.py. */
const EASTERN_VIEW = [-3.0286, -3.248, 3.5801, 3.105]
/** 1 px² at 0.05 °/px. Pieces smaller than this are ignored, as in the Python build. */
const MIN_CLIP_AREA = 0.0025
/** 80 px at 0.05 °/px. A far label is added when the home point is at least this far away. */
const FAR_LABEL_DEG = 4

function eachArcIndex(arcs, visit) {
  if (!arcs || arcs.length === 0) return
  if (typeof arcs[0] === "number") {
    for (const index of arcs) visit(index < 0 ? ~index : index)
    return
  }
  for (const child of arcs) eachArcIndex(child, visit)
}

function storedArcSet(countryBorders) {
  const arcs = new Set()
  for (const geometry of countryBorders.geometries ?? []) eachArcIndex(geometry.arcs, (index) => arcs.add(index))
  return arcs
}

/** One LineString per shared arc whose two states have different owners, sorted by arc index. */
export function countryBorderGeometries(data) {
  const states = data.topology.objects.states.geometries
  const users = new Map()
  for (const state of states) {
    const seen = new Set()
    eachArcIndex(state.arcs, (index) => seen.add(index))
    for (const index of seen) {
      const list = users.get(index)
      if (list) list.push(state)
      else users.set(index, [state])
    }
  }
  const kept = []
  for (const [index, list] of users) {
    if (list.length !== 2) continue
    if (list[0].properties.owner_1914 !== list[1].properties.owner_1914) kept.push(index)
  }
  kept.sort((left, right) => left - right)
  return kept.map((index) => ({ type: "LineString", arcs: [index] }))
}

function assertBorderBaseline(data) {
  const stored = storedArcSet(data.topology.objects.countryBorders)
  const recomputed = new Set(countryBorderGeometries(data).map((line) => line.arcs[0]))
  const missing = [...stored].filter((index) => !recomputed.has(index))
  const extra = [...recomputed].filter((index) => !stored.has(index))
  if (missing.length || extra.length) {
    throw new Error(
      `countryBorders arc set does not match owners: stored ${stored.size}, recomputed ${recomputed.size}, missing ${missing.length}, extra ${extra.length}`,
    )
  }
  const unpatched = data.stateOwners.Cairo === "egypt" && data.stateOwners.Hulunbuir === "mongolia"
  if (unpatched && stored.size !== 576) {
    throw new Error(`expected the unpatched 576-arc country border set, found ${stored.size}`)
  }
}

function ringArea(ring) {
  if (!ring || ring.length < 4) return 0
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

function geometryArea(geometry) {
  if (!geometry) return 0
  if (geometry.type === "Polygon") {
    const [outer, ...holes] = geometry.coordinates
    return ringArea(outer) - holes.reduce((sum, hole) => sum + ringArea(hole), 0)
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce(
      (sum, coordinates) => sum + geometryArea({ type: "Polygon", coordinates }),
      0,
    )
  }
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.reduce((sum, geometry) => sum + geometryArea(geometry), 0)
  }
  return 0
}

function polygonPieces(geometry) {
  if (!geometry) return []
  if (geometry.type === "Polygon") return [geometry]
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }))
  }
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(polygonPieces)
  return []
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6
}

function featurePoint(geometry) {
  const point = turf.pointOnFeature({ type: "Feature", properties: {}, geometry })
  const [lon, lat] = point.geometry.coordinates
  return [round6(lon), round6(lat)]
}

function euclidean(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function ownerMembers(geometries) {
  const members = new Map()
  for (const geometry of geometries) {
    if (geometry.properties.playable) continue
    const owner = geometry.properties.owner_1914
    const list = members.get(owner)
    if (list) list.push(geometry.properties.stateId)
    else members.set(owner, [geometry.properties.stateId])
  }
  for (const list of members.values()) list.sort()
  return members
}

function changedOwnerSet(before, after) {
  const changed = new Set()
  for (const owner of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(owner)?.join("\0") ?? ""
    const right = after.get(owner)?.join("\0") ?? ""
    if (left !== right) changed.add(owner)
  }
  return changed
}

function labelForOwner(data, owner, name) {
  const objects = data.topology.objects.states.geometries.filter(
    (geometry) => !geometry.properties.playable && geometry.properties.owner_1914 === owner,
  )
  if (objects.length === 0) return null
  const merged = merge(data.topology, objects)
  const parts = polygonPieces(merged).map((geometry) => ({ type: "Feature", properties: {}, geometry }))
  if (parts.length === 0) return null
  const visible = []
  for (const part of parts) {
    const clipped = turf.bboxClip(part, EASTERN_VIEW)
    const area = geometryArea(clipped.geometry)
    if (area < MIN_CLIP_AREA) continue
    visible.push({ feature: clipped, area })
  }
  const points = []
  if (visible.length > 0) {
    const best = visible.reduce((left, right) => (left.area >= right.area ? left : right))
    const pieces = polygonPieces(best.feature.geometry)
    const piece = pieces.reduce((left, right) => (geometryArea(left) >= geometryArea(right) ? left : right))
    points.push(featurePoint(piece))
  }
  const largest = parts.reduce((left, right) => (geometryArea(left.geometry) >= geometryArea(right.geometry) ? left : right))
  const far = featurePoint(largest.geometry)
  if (points.length === 0 || euclidean(far, points[0]) > FAR_LABEL_DEG) points.push(far)
  return { owner, name, label: points[0], labels: points }
}

function loadFixes() {
  const fixes = JSON.parse(readFileSync(FIXES_PATH, "utf8"))
  if (!Array.isArray(fixes) || fixes.length !== 28) {
    throw new Error(`expected 28 owner fixes, found ${Array.isArray(fixes) ? fixes.length : "not-an-array"}`)
  }
  const seen = new Set()
  for (const row of fixes) {
    if (!row || typeof row.stateId !== "string" || typeof row.owner !== "string" || typeof row.reason !== "string") {
      throw new Error(`bad owner fix row: ${JSON.stringify(row)}`)
    }
    if (seen.has(row.stateId)) throw new Error(`duplicate owner fix: ${row.stateId}`)
    seen.add(row.stateId)
  }
  return fixes
}

function applyFixes(data, fixes) {
  const byId = new Map(data.topology.objects.states.geometries.map((geometry) => [geometry.properties.stateId, geometry]))
  const prior = new Map()
  for (const row of fixes) {
    const geometry = byId.get(row.stateId)
    if (!geometry) throw new Error(`owner fix names a missing state: ${row.stateId}`)
    if (geometry.properties.playable) throw new Error(`owner fix names a playable state: ${row.stateId}`)
    if (!(row.stateId in data.stateOwners)) throw new Error(`owner fix is missing from stateOwners: ${row.stateId}`)
    if (data.stateOwners[row.stateId] !== geometry.properties.owner_1914) {
      throw new Error(`stateOwners and owner_1914 disagree for ${row.stateId}`)
    }
    if (!(row.owner in data.ownerColors) && data.stateOwners[row.stateId] !== row.owner) {
      throw new Error(`owner fix uses an unknown owner color: ${row.owner}`)
    }
    prior.set(row.stateId, { owner: geometry.properties.owner_1914, source: geometry.properties.source })
  }

  const beforeMembers = ownerMembers(data.topology.objects.states.geometries)
  for (const row of fixes) {
    const geometry = byId.get(row.stateId)
    geometry.properties.owner_1914 = row.owner
    geometry.properties.source = "override"
    data.stateOwners[row.stateId] = row.owner
  }
  const afterMembers = ownerMembers(data.topology.objects.states.geometries)
  const changed = changedOwnerSet(beforeMembers, afterMembers)

  data.topology.objects.countryBorders = {
    type: "GeometryCollection",
    geometries: countryBorderGeometries(data),
  }

  const names = new Map(data.countryLabels.map((label) => [label.owner, label.name]))
  const nextLabels = []
  for (const label of data.countryLabels) {
    if (!changed.has(label.owner)) {
      nextLabels.push(label)
      continue
    }
    if (!afterMembers.get(label.owner)?.length) continue
    const rebuilt = labelForOwner(data, label.owner, label.name)
    if (!rebuilt) throw new Error(`could not place a label for ${label.owner}`)
    nextLabels.push(rebuilt)
  }
  for (const owner of changed) {
    if (nextLabels.some((label) => label.owner === owner)) continue
    if (!afterMembers.get(owner)?.length) continue
    const name = names.get(owner)
    if (!name) throw new Error(`changed owner has no country name: ${owner}`)
    const rebuilt = labelForOwner(data, owner, name)
    if (!rebuilt) throw new Error(`could not place a label for ${owner}`)
    nextLabels.push(rebuilt)
  }
  nextLabels.sort((left, right) => (left.owner < right.owner ? -1 : left.owner > right.owner ? 1 : 0))
  data.countryLabels = nextLabels

  const used = new Set(data.topology.objects.states.geometries.map((geometry) => geometry.properties.owner_1914))
  for (const owner of Object.keys(data.ownerColors)) {
    if (!used.has(owner)) delete data.ownerColors[owner]
  }

  const seenAudit = new Set(data.ownerAudit.deJure.map((row) => `${row.id}\0${row.reason}`))
  for (const row of fixes) {
    const key = `${row.stateId}\0${row.reason}`
    if (seenAudit.has(key)) continue
    const previous = prior.get(row.stateId)
    data.ownerAudit.deJure.push({
      id: row.stateId,
      owner: row.owner,
      resolvedOwner: previous.owner,
      method: previous.source,
      reason: row.reason,
    })
  }
}

function main() {
  const fixes = loadFixes()
  const data = JSON.parse(readFileSync(GEOMETRY_PATH, "utf8"))
  assertBorderBaseline(data)
  applyFixes(data, fixes)
  writeFileSync(GEOMETRY_PATH, JSON.stringify(data))
  const owners = new Set(fixes.map((row) => row.owner))
  console.log(
    `patched ${fixes.length} states; countryBorders ${data.topology.objects.countryBorders.geometries.length}; labels ${data.countryLabels.length}; changed owners ${[...owners].sort().join(",")}`,
  )
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
