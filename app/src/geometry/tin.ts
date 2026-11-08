// Ported from section_extract.js as part of PLAN.md Stage 2 (2026-09-19).
// This module is now the single source of truth for this logic — both
// the app (main.js) and the test suite import it directly, so there is
// no longer a hand-mirrored copy to drift out of sync.
import { triangulateCoords } from './constrain.ts';
import type { Point3, Triangle, TriIndex, Barycentric, TriangleHit } from '../types.ts';

export function barycentric(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Barycentric | null {
  var v0x=bx-ax, v0y=by-ay;
  var v1x=cx-ax, v1y=cy-ay;
  var v2x=px-ax, v2y=py-ay;
  var d00=v0x*v0x+v0y*v0y;
  var d01=v0x*v1x+v0y*v1y;
  var d11=v1x*v1x+v1y*v1y;
  var d20=v2x*v0x+v2y*v0y;
  var d21=v2x*v1x+v2y*v1y;
  var denom = d00*d11-d01*d01;
  if (Math.abs(denom) < 1e-9) return null;
  var v = (d11*d20-d01*d21)/denom;
  var w = (d00*d21-d01*d20)/denom;
  var u = 1-v-w;
  return {u:u, v:v, w:w};
}

export function buildTriIndex(points: Point3[], triangles: Triangle[]): TriIndex {
  var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (var i=0;i<points.length;i++){
    if (points[i].x<minX) minX=points[i].x;
    if (points[i].x>maxX) maxX=points[i].x;
    if (points[i].y<minY) minY=points[i].y;
    if (points[i].y>maxY) maxY=points[i].y;
  }
  var cells = 40;
  var cw = Math.max((maxX-minX)/cells, 1e-6);
  var ch = Math.max((maxY-minY)/cells, 1e-6);
  var grid: Record<string, number[]> = {};
  function cellKey(cx: number, cy: number){ return cx+'_'+cy; }
  for (var t=0;t<triangles.length;t++){
    var tri = triangles[t];
    var a=points[tri[0]], b=points[tri[1]], c=points[tri[2]];
    var tminx = Math.min(a.x,b.x,c.x), tmaxx = Math.max(a.x,b.x,c.x);
    var tminy = Math.min(a.y,b.y,c.y), tmaxy = Math.max(a.y,b.y,c.y);
    var cx0 = Math.floor((tminx-minX)/cw), cx1 = Math.floor((tmaxx-minX)/cw);
    var cy0 = Math.floor((tminy-minY)/ch), cy1 = Math.floor((tmaxy-minY)/ch);
    for (var cx=cx0; cx<=cx1; cx++){
      for (var cy=cy0; cy<=cy1; cy++){
        var key = cellKey(cx,cy);
        if (!grid[key]) grid[key] = [];
        grid[key].push(t);
      }
    }
  }
  return {minX:minX, minY:minY, cw:cw, ch:ch, grid:grid};
}

export function locateTriangle(x: number, y: number, points: Point3[], triangles: Triangle[], index: TriIndex): TriangleHit | null {
  var cx = Math.floor((x-index.minX)/index.cw);
  var cy = Math.floor((y-index.minY)/index.ch);
  var key = cx+'_'+cy;
  var candidates = index.grid[key];
  if (!candidates) return null;
  for (var i=0;i<candidates.length;i++){
    var tri = triangles[candidates[i]];
    var a=points[tri[0]], b=points[tri[1]], c=points[tri[2]];
    var bc = barycentric(x,y, a.x,a.y, b.x,b.y, c.x,c.y);
    if (!bc) continue;
    var eps = -1e-6;
    if (bc.u>=eps && bc.v>=eps && bc.w>=eps){
      return {index:candidates[i], bc:bc, a:a, b:b, c:c};
    }
  }
  return null;
}

export function elevationAt(x: number, y: number, points: Point3[], triangles: Triangle[], index: TriIndex): number | null {
  var hit = locateTriangle(x, y, points, triangles, index);
  if (!hit) return null;
  return hit.bc.u*hit.a.z + hit.bc.v*hit.b.z + hit.bc.w*hit.c.z;
}

export function triangleIndexAt(x: number, y: number, points: Point3[], triangles: Triangle[], index: TriIndex): number {
  var hit = locateTriangle(x, y, points, triangles, index);
  return hit ? hit.index : -1;
}

export function triangulate(points: Point3[]): Triangle[] {
  return triangulateConstrained(points, null).triangles;
}

// Same as triangulate(), optionally forcing breakline edges in (pairs of
// indices into `points`, see geometry/breaklines.ts). `failed` counts the
// edges that couldn't be (see geometry/constrain.ts).
export function triangulateConstrained(points: Point3[], edges: ArrayLike<number> | null): { triangles: Triangle[]; failed: number } {
  var n = points.length;
  if (n < 3) return {triangles: [], failed: 0};
  var coords = new Float64Array(n*2);
  for (var i=0;i<n;i++){ coords[2*i] = points[i].x; coords[2*i+1] = points[i].y; }
  var r = triangulateCoords(coords, edges);
  return {triangles: trianglesFromFlat(r.triangles), failed: r.failed};
}

export function trianglesFromFlat(tris: ArrayLike<number>): Triangle[] {
  var result: Triangle[] = new Array(Math.floor(tris.length/3));
  for (var i=0, t=0; i+2<tris.length; i+=3, t++) result[t] = [tris[i], tris[i+1], tris[i+2]];
  return result;
}
