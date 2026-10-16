declare module "d3-delaunay" {
  export class Delaunay {
    static from(points: ArrayLike<ArrayLike<number>>): Delaunay
    neighbors(index: number): Iterable<number>
    voronoi(bounds: [number, number, number, number]): Voronoi
  }

  export class Voronoi {
    cellPolygon(index: number): [number, number][] | null
  }
}
