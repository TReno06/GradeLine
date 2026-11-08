// Breaklines (2026-11-08): lines the TIN's triangles must follow — kerb
// top / kerb invert / gutter lip strings, edges of concrete, etc. Without
// them, plain Delaunay happily joins a kerb-top shot straight to a
// gutter-lip shot (the 30mm-wide kerb-face strip makes slivers Delaunay
// avoids), turning a 150mm vertical kerb into a gentle ramp.
//
// Pure functions only — no DOM, no `state`. Two jobs:
//  1. arcBreakline: turn a DXF ARC into a draped 3D string. A DXF ARC has
//     ONE elevation for its whole length, so a surveyed kerb around a
//     corner comes in flat (e.g. 48.91 while the shots on it run 48.00 to
//     49.78); its levels are taken from the surveyed points on that layer
//     that lie on the arc instead.
//  2. prepareConstrainedInput: merge breakline vertices into the TIN's
//     point list and produce the constraint edge list, cleaned so the
//     constrained triangulation (geometry/constrain.ts) can't trip over
//     it — vertices snapped onto existing survey points, segments split
//     wherever a point sits on them, duplicates merged, and any segment
//     that crosses an earlier one dropped (and counted, so the UI can say).
import type { Point3, Breakline } from '../types.ts';

// --- arcs -------------------------------------------------------------

// Max chord sagitta (m) and max angle per chord when tessellating an arc —
// same limits expandBulgedPolyline (dxf.ts) uses for bulged polylines.
var ARC_MAX_SAGITTA = 0.005;
var ARC_MAX_STEP_DEG = 2;

export interface ArcSpec {
  cx: number; cy: number; z: number; r: number;
  startDeg: number; endDeg: number; // DXF convention: counter-clockwise from start to end
  mirrorX?: boolean;                // OCS extrusion (0,0,-1): x is mirrored in WCS
}

// `layerPoints`: surveyed points on the arc's own layer. Those within
// `onArcTol` of the arc (radially, and inside its sweep) become vertices
// of the string at their exact surveyed X/Y/Z, and every other vertex's
// level is interpolated along the arc between them (held flat beyond the
// outermost ones). With none on it, the arc keeps its own single level.
export function arcBreakline(arc: ArcSpec, layerPoints: Point3[], onArcTol?: number): Point3[] {
  var r = arc.r;
  if (!(r > 0) || !isFinite(r)) return [];
  var tol = onArcTol === undefined ? Math.max(0.02, r*0.001) : onArcTol;
  var sx = arc.mirrorX ? -1 : 1;
  var a0 = arc.startDeg * Math.PI/180;
  var sweep = ((arc.endDeg - arc.startDeg) % 360 + 360) % 360;
  if (sweep < 1e-9) sweep = 360;
  var sweepRad = sweep * Math.PI/180;
  var arcLen = r * sweepRad;
  // WCS centre: with a mirrored OCS, the stored centre x is itself mirrored.
  var cxW = sx*arc.cx;

  function xyAt(s: number){ // s = arc length from the start point
    var a = a0 + s/r;
    return {x: sx*(arc.cx + r*Math.cos(a)), y: arc.cy + r*Math.sin(a)};
  }

  // Surveyed points on the arc, by arc length from the start.
  var onArc: {s: number; p: Point3}[] = [];
  for (var i=0;i<layerPoints.length;i++){
    var p = layerPoints[i];
    var dx = sx*(p.x - cxW), dy = p.y - arc.cy;
    var d = Math.sqrt(dx*dx + dy*dy);
    if (Math.abs(d - r) > tol) continue;
    var ang = Math.atan2(dy, dx) - a0;
    ang = ((ang % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
    var s = ang * r;
    // Allow a little slop past either end (a shot right on the end point
    // can land a hair outside the sweep).
    if (s > arcLen + tol){
      if (2*Math.PI*r - s <= tol) s = 0; else continue;
    }
    onArc.push({s: Math.min(Math.max(s, 0), arcLen), p: p});
  }
  onArc.sort(function(a,b){ return a.s - b.s; });

  function zAt(s: number): number {
    if (!onArc.length) return arc.z;
    if (s <= onArc[0].s) return onArc[0].p.z;
    var last = onArc[onArc.length-1];
    if (s >= last.s) return last.p.z;
    for (var k=0;k<onArc.length-1;k++){
      var A = onArc[k], B = onArc[k+1];
      if (s <= B.s){
        var span = B.s - A.s;
        return span < 1e-9 ? A.p.z : A.p.z + (B.p.z - A.p.z)*(s - A.s)/span;
      }
    }
    return last.p.z;
  }

  var stepByChord = 2*Math.sqrt(Math.max(0, 2*r*ARC_MAX_SAGITTA - ARC_MAX_SAGITTA*ARC_MAX_SAGITTA));
  var stepByAngle = r * ARC_MAX_STEP_DEG*Math.PI/180;
  var step = Math.min(stepByChord || stepByAngle, stepByAngle);
  var nSteps = Math.max(1, Math.ceil(arcLen/step - 1e-9));

  // Tessellation stations, minus any that fall within 10mm (along the arc)
  // of a surveyed point — that point stands in for them.
  var stations: {s: number; p: Point3 | null}[] = onArc.map(function(o){ return {s:o.s, p:o.p}; });
  for (var n=0;n<=nSteps;n++){
    var sn = arcLen * n/nSteps;
    var near = false;
    for (var m=0;m<onArc.length;m++){ if (Math.abs(onArc[m].s - sn) < 0.01){ near = true; break; } }
    if (!near) stations.push({s: sn, p: null});
  }
  stations.sort(function(a,b){ return a.s - b.s; });

  var out: Point3[] = [];
  for (var q=0;q<stations.length;q++){
    var st = stations[q];
    if (st.p){ out.push({x: st.p.x, y: st.p.y, z: st.p.z}); continue; }
    var xy = xyAt(st.s);
    out.push({x: xy.x, y: xy.y, z: zAt(st.s)});
  }
  return out;
}

// --- constrained input -----------------------------------------------

export interface ConstrainedInput {
  points: Point3[];  // the input points (exact X/Y duplicates removed) plus any new breakline vertices
  edges: number[];   // flat [a0,b0, a1,b1, ...] indices into `points`
  segments: number;  // constraint segments kept (after splitting)
  skippedCrossing: number; // segments dropped because they cross an earlier one
}

// Spatial hash over points, for "is there already a point within tol of
// here" (snapping) and "which points lie near this segment" (splitting).
function cellKey(ix: number, iy: number){ return ix + ',' + iy; }

class PointGrid {
  cell: number;
  map: Map<string, number[]> = new Map();
  pts: Point3[];
  constructor(pts: Point3[], cell: number){ this.pts = pts; this.cell = cell; }
  add(i: number){
    var p = this.pts[i];
    var k = cellKey(Math.floor(p.x/this.cell), Math.floor(p.y/this.cell));
    var list = this.map.get(k);
    if (list) list.push(i); else this.map.set(k, [i]);
  }
  // Indices in every cell overlapping the box.
  query(x0: number, y0: number, x1: number, y1: number, out: number[]){
    var ix0 = Math.floor(x0/this.cell), ix1 = Math.floor(x1/this.cell);
    var iy0 = Math.floor(y0/this.cell), iy1 = Math.floor(y1/this.cell);
    for (var ix=ix0; ix<=ix1; ix++) for (var iy=iy0; iy<=iy1; iy++){
      var list = this.map.get(cellKey(ix, iy));
      if (list) for (var j=0;j<list.length;j++) out.push(list[j]);
    }
  }
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number){
  return (bx-ax)*(cy-ay) - (by-ay)*(cx-ax);
}

// True when segments ab and cd cross at a point interior to both (sharing
// an end point is fine — that's how consecutive segments of one string meet).
function segmentsCross(a: Point3, b: Point3, c: Point3, d: Point3): boolean {
  var o1 = orient(a.x,a.y,b.x,b.y,c.x,c.y), o2 = orient(a.x,a.y,b.x,b.y,d.x,d.y);
  var o3 = orient(c.x,c.y,d.x,d.y,a.x,a.y), o4 = orient(c.x,c.y,d.x,d.y,b.x,b.y);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

// `tol` (m): breakline vertices within this of an existing point snap to
// it, and points within this of a segment's interior split it there.
export function prepareConstrainedInput(points: Point3[], breaklines: Breakline[], tol?: number): ConstrainedInput {
  var t = tol === undefined ? 0.001 : tol;

  // Exact X/Y duplicates are invisible to Delaunator anyway (it keeps one
  // and leaves the other out of every triangle); drop them up front so a
  // breakline never snaps to the copy that isn't triangulated.
  var seen = new Set<string>();
  var pts: Point3[] = [];
  for (var i=0;i<points.length;i++){
    var k = points[i].x + ',' + points[i].y;
    if (seen.has(k)) continue;
    seen.add(k);
    pts.push(points[i]);
  }

  var snapCell = Math.max(t*4, 0.01);
  var snap = new PointGrid(pts, snapCell);
  for (var a=0;a<pts.length;a++) snap.add(a);
  var cand: number[] = [];
  function indexFor(v: Point3, layer: string): number {
    cand.length = 0;
    snap.query(v.x-t, v.y-t, v.x+t, v.y+t, cand);
    var best = -1, bestD = t*t;
    for (var c=0;c<cand.length;c++){
      var p = pts[cand[c]];
      var dd = (p.x-v.x)*(p.x-v.x) + (p.y-v.y)*(p.y-v.y);
      if (dd <= bestD){ bestD = dd; best = cand[c]; }
    }
    if (best >= 0) return best;
    pts.push({x: v.x, y: v.y, z: v.z, layer: layer});
    snap.add(pts.length-1);
    return pts.length-1;
  }

  // 1. Vertices -> indices, strings -> raw segments.
  var raw: [number, number][] = [];
  for (var b=0;b<breaklines.length;b++){
    var bl = breaklines[b];
    var prev = -1;
    for (var v=0; v<bl.vertices.length; v++){
      var idx = indexFor(bl.vertices[v], bl.layer);
      if (prev >= 0 && idx !== prev) raw.push([prev, idx]);
      prev = idx;
    }
  }

  // 2. Split each segment wherever a point sits on its interior — the
  // constrained triangulation refuses an edge that passes through a point.
  var gridCell = 1;
  var grid = new PointGrid(pts, gridCell);
  for (var g=0; g<pts.length; g++) grid.add(g);
  var split: [number, number][] = [];
  for (var r=0;r<raw.length;r++){
    var ia = raw[r][0], ib = raw[r][1];
    var A = pts[ia], B = pts[ib];
    var dx = B.x-A.x, dy = B.y-A.y, len2 = dx*dx + dy*dy;
    cand.length = 0;
    grid.query(Math.min(A.x,B.x)-t, Math.min(A.y,B.y)-t, Math.max(A.x,B.x)+t, Math.max(A.y,B.y)+t, cand);
    var on: {u: number; i: number}[] = [];
    for (var c2=0;c2<cand.length;c2++){
      var pi = cand[c2];
      if (pi === ia || pi === ib) continue;
      var P = pts[pi];
      var u = ((P.x-A.x)*dx + (P.y-A.y)*dy) / len2;
      if (u <= 0 || u >= 1) continue;
      var ex = A.x + u*dx - P.x, ey = A.y + u*dy - P.y;
      if (ex*ex + ey*ey <= t*t) on.push({u: u, i: pi});
    }
    if (!on.length){ split.push([ia, ib]); continue; }
    on.sort(function(p1,p2){ return p1.u - p2.u; });
    var from = ia;
    for (var o=0;o<on.length;o++){ if (on[o].i !== from){ split.push([from, on[o].i]); from = on[o].i; } }
    if (from !== ib) split.push([from, ib]);
  }

  // 3. Merge duplicates (either direction), then drop any segment that
  // crosses one already kept — first come, first kept, in file order.
  var segSeen = new Set<string>();
  var kept: [number, number][] = [];
  var segGrid: Map<string, number[]> = new Map();
  var segCell = 2;
  var skipped = 0;
  var near: number[] = [];
  for (var s=0;s<split.length;s++){
    var s0 = split[s][0], s1 = split[s][1];
    var key = s0 < s1 ? s0+'_'+s1 : s1+'_'+s0;
    if (segSeen.has(key)) continue;
    segSeen.add(key);
    var P0 = pts[s0], P1 = pts[s1];
    var ix0 = Math.floor(Math.min(P0.x,P1.x)/segCell), ix1 = Math.floor(Math.max(P0.x,P1.x)/segCell);
    var iy0 = Math.floor(Math.min(P0.y,P1.y)/segCell), iy1 = Math.floor(Math.max(P0.y,P1.y)/segCell);
    near.length = 0;
    for (var gx=ix0; gx<=ix1; gx++) for (var gy=iy0; gy<=iy1; gy++){
      var lst = segGrid.get(cellKey(gx, gy));
      if (lst) for (var q=0;q<lst.length;q++) near.push(lst[q]);
    }
    var crosses = false;
    for (var n=0;n<near.length && !crosses;n++){
      var K = kept[near[n]];
      if (segmentsCross(P0, P1, pts[K[0]], pts[K[1]])) crosses = true;
    }
    if (crosses){ skipped++; continue; }
    var keptIdx = kept.length;
    kept.push([s0, s1]);
    for (var hx=ix0; hx<=ix1; hx++) for (var hy=iy0; hy<=iy1; hy++){
      var ck = cellKey(hx, hy);
      var cl = segGrid.get(ck);
      if (cl) cl.push(keptIdx); else segGrid.set(ck, [keptIdx]);
    }
  }

  var edges: number[] = new Array(kept.length*2);
  for (var e=0;e<kept.length;e++){ edges[2*e] = kept[e][0]; edges[2*e+1] = kept[e][1]; }
  return {points: pts, edges: edges, segments: kept.length, skippedCrossing: skipped};
}
