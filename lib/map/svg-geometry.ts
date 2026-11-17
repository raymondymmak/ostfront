import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { eachCoord, geometryPolygons, type ProvinceGeometry } from "@/lib/data/geometry"

/** Same lon/lat → SVG path convention as `components/svg-map.tsx` (`y = -lat`). */
export function geometryPath(geometry: ProvinceGeometry): string {
  const parts: string[] = []
  for (const rings of geometryPolygons(geometry)) {
    for (const ring of rings) {
      if (ring.length < 3) continue
      const cmds = ring.map(([lon, lat], index) => `${index === 0 ? "M" : "L"}${lon},${-lat}`)
      parts.push(`${cmds.join(" ")} Z`)
    }
  }
  return parts.join(" ")
}

export function vignetteProvinceIds(provinceId: string, arrowFrom?: string[]): string[] {
  const target = CATALOG_BY_ID[provinceId]
  if (!target) return [provinceId]
  const ids = new Set<string>([provinceId])
  for (const neighbor of target.neighbors) ids.add(neighbor)
  for (const from of arrowFrom ?? []) ids.add(from)
  return [...ids]
}

export function vignetteViewBox(
  provinceIds: string[],
  pad = 0.35,
): { box: string; span: number; minLon: number; minLat: number; maxLon: number; maxLat: number } | null {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  let any = false
  for (const id of provinceIds) {
    const geometry = CATALOG_BY_ID[id]?.polygon
    if (!geometry) continue
    eachCoord(geometry, ([lon, lat]) => {
      any = true
      minLon = Math.min(minLon, lon)
      minLat = Math.min(minLat, lat)
      maxLon = Math.max(maxLon, lon)
      maxLat = Math.max(maxLat, lat)
    })
  }
  if (!any) return null
  minLon -= pad
  minLat -= pad
  maxLon += pad
  maxLat += pad
  const width = maxLon - minLon
  const height = maxLat - minLat
  return {
    box: `${minLon} ${-maxLat} ${width} ${height}`,
    span: Math.max(width, height),
    minLon,
    minLat,
    maxLon,
    maxLat,
  }
}

export function vignettePaths(provinceIds: string[]): { id: string; d: string }[] {
  return provinceIds
    .map((id) => {
      const polygon = CATALOG_BY_ID[id]?.polygon
      if (!polygon) return null
      const d = geometryPath(polygon)
      return d ? { id, d } : null
    })
    .filter(Boolean) as { id: string; d: string }[]
}