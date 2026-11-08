// Ported from section_extract.js as part of PLAN.md Stage 2 (2026-09-19).
// This module is now the single source of truth for this logic — both
// the app (main.js) and the test suite import it directly, so there is
// no longer a hand-mirrored copy to drift out of sync.

import { triangleIndexAt, elevationAt } from './tin.ts';
import type { Point2, Point3, Triangle, TriIndex, IntervalMark, ProfileSample } from '../types.ts';

// Linearly interpolates a point on the ground line at an arbitrary
// chainage, between whichever two profileData.samples bracket it —
// exactly the same piecewise-linear segment drawProfile() itself draws
// between consecutive samples, so the result always matches the pixel
// under the cursor. Used by the profile hover handler (rendering.ts) so
// the split-view 3D marker (and the tooltip reading) glides continuously
// along the ground as the mouse moves, instead of snapping between
// whichever sample happens to be nearest. Returns null outside the
// samples' range, or across a data gap (either bracketing sample has
// elevation:null) — never invents ground there. Binary search over the
// (chainage-sorted) samples, since this runs on every mousemove.
export function interpolatedSampleAt(samples: ProfileSample[] | null, ch: number): ProfileSample | null {
  if (!samples || samples.length < 2) return null;
  if (ch <= samples[0].chainage){
    return samples[0].elevation===null ? null : samples[0];
  }
  var lastS = samples[samples.length-1];
  if (ch >= lastS.chainage){
    return lastS.elevation===null ? null : lastS;
  }
  // First sample at or beyond ch (exists, since ch < lastS.chainage);
  // the bracketing segment is the one ending there.
  var lo = 1, hi = samples.length-1;
  while (lo < hi){
    var mid = (lo + hi) >> 1;
    if (samples[mid].chainage < ch) lo = mid + 1; else hi = mid;
  }
  var a = samples[lo-1], b = samples[lo];
  if (a.elevation===null || b.elevation===null) return null;
  var span = b.chainage - a.chainage;
  var f = span > 1e-9 ? (ch-a.chainage)/span : 0;
  return {
    chainage: ch,
    x: a.x + (b.x-a.x)*f,
    y: a.y + (b.y-a.y)*f,
    elevation: a.elevation + (b.elevation-a.elevation)*f
  };
}

// The (approximate) inverse of pointAtChainage: given an arbitrary
// point, finds the closest point ON the polyline (verts/cum) — checking
// every segment's own clamped closest point, not the infinite line
// through it, so this degrades gracefully at a polyline's own ends
// rather than extrapolating past them — and returns that point's
// chainage along the polyline, plus the perpendicular offset distance
// from `pt` to it. Used by the crossfall view's perpendicular-
// projection mode (PLAN.md Appendix B item 2) to project a point on one
// alignment onto another alignment's own line, rather than assuming the
// two run parallel from a shared chainage-0 start (the matching-
// chainage-value mode's own stated assumption). Returns {chainage:0,
// offset:0} for a degenerate polyline (fewer than 2 vertices) rather
// than throwing.
export function chainageOfClosestPoint(verts: Point2[], cum: number[], pt: Point2): {chainage: number; offset: number} {
  var bestDist2 = Infinity, bestChainage = 0;
  for (var i=0; i<verts.length-1; i++){
    var a = verts[i], b = verts[i+1];
    var dx = b.x-a.x, dy = b.y-a.y;
    var mag2 = dx*dx+dy*dy;
    var u: number;
    if (mag2 < 1e-12){
      u = 0;
    } else {
      u = ((pt.x-a.x)*dx + (pt.y-a.y)*dy) / mag2;
      if (u < 0) u = 0; else if (u > 1) u = 1;
    }
    var fx = a.x+u*dx, fy = a.y+u*dy;
    var ddx = pt.x-fx, ddy = pt.y-fy;
    var dist2 = ddx*ddx+ddy*ddy;
    if (dist2 < bestDist2){
      bestDist2 = dist2;
      bestChainage = cum[i] + u*(cum[i+1]-cum[i]);
    }
  }
  return {chainage: bestChainage, offset: bestDist2===Infinity ? 0 : Math.sqrt(bestDist2)};
}

// Unit direction of travel along a polyline at chainage ch. On a gently
// turning polyline (a tessellated curve, each vertex turning less than
// SMOOTH_TURN_DEG) the direction turns smoothly along each segment, from
// the averaged direction at one vertex to the next — so a line drawn
// square to it sweeps round a curve like a true radius instead of jumping
// at every vertex. A sharper vertex is a real corner: the direction stays
// each segment's own on either side, and exactly on the corner it's the
// average of the two (the bisector).
var SMOOTH_TURN_DEG = 15;
export function tangentAtChainage(verts: Point2[], cum: number[], ch: number): Point2 | null {
  if (verts.length < 2) return null;
  function dir(i: number): Point2 | null {
    if (i < 0 || i >= verts.length - 1) return null;
    var dx = verts[i+1].x - verts[i].x, dy = verts[i+1].y - verts[i].y, m = Math.hypot(dx, dy);
    return m > 1e-12 ? {x: dx/m, y: dy/m} : null;
  }
  function avg(p: Point2, q: Point2): Point2 | null {
    var sx = p.x + q.x, sy = p.y + q.y, sm = Math.hypot(sx, sy);
    return sm > 1e-12 ? {x: sx/sm, y: sy/sm} : null;
  }
  var cosLimit = Math.cos(SMOOTH_TURN_DEG * Math.PI / 180);
  // Direction to blend from/to at vertex v, as seen from segment seg.
  function atVertex(v: number, seg: number): Point2 | null {
    var own = dir(seg), other = dir(v === seg ? seg - 1 : seg + 1);
    if (!own) return other;
    if (!other || own.x*other.x + own.y*other.y < cosLimit) return own;
    return avg(own, other) || own;
  }
  var seg = 0;
  while (seg < cum.length-2 && cum[seg+1] < ch) seg++;
  var d = dir(seg);
  // Exactly on an interior vertex: the bisector (smooth or sharp alike).
  var onVertex = seg > 0 && Math.abs(ch - cum[seg]) < 1e-6 ? seg
    : (seg < cum.length-2 && Math.abs(ch - cum[seg+1]) < 1e-6 ? seg + 1 : -1);
  if (onVertex >= 0){
    var p = dir(onVertex - 1), q = dir(onVertex);
    return (p && q && avg(p, q)) || q || p;
  }
  if (!d) return dir(seg - 1) || dir(seg + 1);
  var t0 = atVertex(seg, seg) || d, t1 = atVertex(seg + 1, seg) || d;
  var len = cum[seg+1] - cum[seg];
  var f = len > 1e-12 ? Math.max(0, Math.min(1, (ch - cum[seg]) / len)) : 0;
  var bx = t0.x + (t1.x - t0.x) * f, by = t0.y + (t1.y - t0.y) * f, bm = Math.hypot(bx, by);
  return bm > 1e-12 ? {x: bx/bm, y: by/bm} : d;
}

// Crossfall's "perpendicular" comparison (2026-11-08, owner's request:
// crossfall should be read square to the alignments). From the point at
// chainage chA on alignment A, a line is drawn square to A (both ways)
// and the nearest place it crosses alignment B is returned: B's chainage
// there, and the distance across (offset). This is what a crossfall
// check across a driveway means — on a bend the inside edge is shorter,
// so the same chainage value on each edge is NOT the same place across
// the driveway. If the square line misses B altogether (past B's ends),
// falls back to the nearest point on B (chainageOfClosestPoint, the
// method this replaced).
export function chainageSquareAcross(vertsA: Point2[], cumA: number[], chA: number, vertsB: Point2[], cumB: number[]): {chainage: number; offset: number} {
  var total = cumA[cumA.length-1];
  var c = Math.max(0, Math.min(chA, total));
  var p = pointAtChainage(vertsA, cumA, c);
  var t = tangentAtChainage(vertsA, cumA, c);
  if (!t) return chainageOfClosestPoint(vertsB, cumB, p);
  var nx = -t.y, ny = t.x;
  var best = Infinity, bestCh = 0;
  for (var i=0; i<vertsB.length-1; i++){
    var a = vertsB[i], b = vertsB[i+1];
    var ex = b.x - a.x, ey = b.y - a.y;
    // p + s*n = a + u*e
    var det = -nx*ey + ex*ny;
    if (Math.abs(det) < 1e-12) continue;
    var rx = a.x - p.x, ry = a.y - p.y;
    var s = (-rx*ey + ex*ry) / det;
    var u = (nx*ry - ny*rx) / det;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    if (Math.abs(s) < best){
      best = Math.abs(s);
      bestCh = cumB[i] + Math.max(0, Math.min(1, u)) * (cumB[i+1] - cumB[i]);
    }
  }
  if (best === Infinity) return chainageOfClosestPoint(vertsB, cumB, p);
  return {chainage: bestCh, offset: best};
}

export function pointAtChainage(verts: Point2[], cum: number[], ch: number): Point2 {
    var segIdx = 0;
    while (segIdx < cum.length-2 && cum[segIdx+1] < ch) segIdx++;
    var segStart = cum[segIdx], segEnd = cum[segIdx+1];
    var f = (segEnd-segStart) > 1e-9 ? (ch-segStart)/(segEnd-segStart) : 0;
    var x = verts[segIdx].x + (verts[segIdx+1].x-verts[segIdx].x)*f;
    var y = verts[segIdx].y + (verts[segIdx+1].y-verts[segIdx].y)*f;
    return {x:x, y:y};
  }

export function computeExactBreakChainages(verts: Point2[], cum: number[], total: number, points: Point3[], triangles: Triangle[], index: TriIndex): number[] {
    if (total <= 0) return [];
    var fineStep = Math.max(0.02, Math.min(0.5, total/1000));
    var chainages = [];
    var prevCh = 0;
    var prevPt = pointAtChainage(verts, cum, 0);
    var prevTri = triangleIndexAt(prevPt.x, prevPt.y, points, triangles, index);
    var n = Math.ceil(total/fineStep);
    for (var s=1; s<=n; s++){
      var ch = Math.min(total, s*fineStep);
      var pt = pointAtChainage(verts, cum, ch);
      var tri = triangleIndexAt(pt.x, pt.y, points, triangles, index);
      if (tri !== prevTri){
        var lo = prevCh, hi = ch, loTri = prevTri;
        for (var iter=0; iter<24; iter++){
          var mid = (lo+hi)/2;
          var midPt = pointAtChainage(verts, cum, mid);
          var midTri = triangleIndexAt(midPt.x, midPt.y, points, triangles, index);
          if (midTri === loTri) lo = mid; else hi = mid;
        }
        chainages.push(hi);
      }
      prevCh = ch; prevTri = tri;
    }
    return chainages;
  }

// Same algorithm as the app's computeIntervalMarks(), parameterized on
// verts/points/triangles/index instead of reading module-level state, so
// it can be unit tested directly against a synthetic TIN.
export function computeIntervalMarksFrom(verts: Point2[] | null, points: Point3[], triangles: Triangle[], index: TriIndex, interval: number): IntervalMark[] {
  if (!verts || !verts.length || !interval || interval <= 0) return [];
  var cum = [0];
  for (var i=1;i<verts.length;i++){
    var dx = verts[i].x-verts[i-1].x, dy = verts[i].y-verts[i-1].y;
    cum.push(cum[i-1] + Math.sqrt(dx*dx+dy*dy));
  }
  var total = cum[cum.length-1];
  if (total <= 0) return [];
  var marks: IntervalMark[] = [];
  var ch = 0;
  while (true){
    var c = Math.min(ch, total);
    var pt = pointAtChainage(verts, cum, c);
    var z = elevationAt(pt.x, pt.y, points, triangles, index);
    marks.push({chainage:c, elevation:z, x:pt.x, y:pt.y});
    if (c >= total - 1e-9) break;
    ch += interval;
  }
  return marks;
}
