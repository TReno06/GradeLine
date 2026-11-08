// The one triangulation routine, shared by the Web Worker
// (triangulation.worker.ts) and the main-thread fallback (tin.ts), so the
// two can never disagree. Plain Delaunay via delaunator; when breakline
// edges are given, Constrainautor then flips triangles in place until
// every one of those edges is a triangle edge (2026-11-08).
//
// Each edge is constrained on its own inside try/catch: input that slips
// past prepareConstrainedInput's cleaning (e.g. a near-collinear point the
// robust predicates see differently) costs that one edge, counted in
// `failed`, never the whole surface. A throw part-way through only ever
// leaves valid flips behind — still a valid triangulation.
import Delaunator from 'delaunator';
import Constrainautor from '@kninnug/constrainautor';

export interface TriangulationResult {
  triangles: Uint32Array;
  failed: number; // breakline edges that could not be forced in
}

export function triangulateCoords(coords: Float64Array, edges: ArrayLike<number> | null): TriangulationResult {
  var d = new Delaunator(coords);
  var failed = 0;
  if (edges && edges.length && d.triangles.length){
    var con = new Constrainautor(d);
    for (var i=0;i+1<edges.length;i+=2){
      try { con.constrainOne(edges[i], edges[i+1]); }
      catch (err) { failed++; }
    }
  }
  return {triangles: d.triangles, failed: failed};
}
