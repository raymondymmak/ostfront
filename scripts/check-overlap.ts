import * as turf from "@turf/turf"
import { buildTheater } from "../lib/data/geometry"

const theater = buildTheater()
const ids = Object.keys(theater.polygons)
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = turf.polygon(theater.polygons[ids[i]])
    const b = turf.polygon(theater.polygons[ids[j]])
    const o = turf.intersect(turf.featureCollection([a, b]))
    if (o && turf.area(o) > 1e6) {
      console.log(ids[i], ids[j], (turf.area(o) / 1e6).toFixed(0), "km2")
    }
  }
}
