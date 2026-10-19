import { contours } from "d3-contour"

/**
 * Extract polygon rings for one label value on a pixel grid (shared cell edges).
 */
export function traceLabelPolygons(
  width: number,
  height: number,
  labels: Uint16Array,
  target: number,
): [number, number][][] {
  const values = new Float64Array(width * height)
  for (let i = 0; i < values.length; i++) {
    values[i] = labels[i] === target ? 1 : 0
  }
  const rings: [number, number][][] = []
  const polys = contours().size([width, height]).thresholds([0.5])(values)
  for (const poly of polys) {
    for (const ring of poly.coordinates) {
      for (const loop of ring) {
        const closed = loop as [number, number][]
        if (closed.length >= 4) rings.push(closed)
      }
    }
  }
  return rings
}
