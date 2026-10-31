// Long section (profile) — PLAN.md Stage 2 checkpoint 3 port, extracted
// verbatim from main.js. Leaf module: only depends on state/DOM/geometry,
// never on rendering/view3d/driveway/pipeline, so it stays free of the
// circular-import graph those modules form with each other.
import { $ } from './dom.ts';
import { state } from './state.ts';
import { elevationAt } from './geometry/tin.ts';
import { pointAtChainage, computeExactBreakChainages, computeIntervalMarksFrom } from './geometry/chainage.ts';
import type { Point2, TriIndex, ProfileData, ProfileSample, GradeBreak, IntervalMark } from './types.ts';

// simple uniform grid index over triangles for faster lookup — owned
// here since every long-section/chainage lookup below needs it; set by
// pipeline.js via setTriIndex()/clearTriIndex() after each rebuild
// (an importing module can only ever read a live binding, never assign
// it, so the setters are the one way another module can update this).
export var triIndex: TriIndex | null = null;
export function setTriIndex(idx: TriIndex | null){ triIndex = idx; }
export function clearTriIndex(){ triIndex = null; }

// The computed long section for the active alignment, and its pan/zoom
// view state. Same live-binding rule as triIndex above: other modules
// import { profileData } to read it, and call setProfileData()/
// recomputeProfileData() to change it.
export var profileData: ProfileData | null = null;
export function setProfileData(v: ProfileData | null){ profileData = v; }
export function recomputeProfileData(): ProfileData | null { profileData = computeLongSection(); return profileData; }

// Long-section pan/zoom — independent of the underlying data. zoom=1 is
// "fit everything" (the old, only, behaviour); centerCh/centerEl are the
// world coordinates shown at the plot's centre, null meaning "use the
// data's own midpoint" until the user drags. Reset whenever the section
// itself changes (new data, different alignment) so an old zoom/pan
// doesn't linger on unrelated content; preserved across sample-interval
// tweaks, true-scale toggling, and view switches.
export var profileView: {zoom: number; centerCh: number | null; centerEl: number | null} = { zoom: 1, centerCh: null, centerEl: null };
export function resetProfileView(){
  profileView.zoom = 1;
  profileView.centerCh = null;
  profileView.centerEl = null;
}

// Alignment vertices are kept permanently in state.rawAlignments[i]
// in original, uncentered raw coordinates (centerData() only ever
// mutates a mapped copy). That means any alignment — not just the
// active one — can be converted into the current centered frame with
// the already-established offsetX/offsetY, without touching the
// shared TIN. Used by the crossfall view to read a second alignment's
// existing ground alongside the active one's.
export function centeredVertsForAlignment(alignIndex: number): Point2[] | null {
  var a = state.rawAlignments && state.rawAlignments[alignIndex];
  if (!a || !a.vertices || !a.vertices.length) return null;
  return a.vertices.map(function(v){ return {x: v.x - state.offsetX, y: v.y - state.offsetY}; });
}

export function computeLongSectionForVerts(verts: Point2[] | null, interval: number): ProfileData | null {
  if (!verts || !triIndex) return null;
  var cum = [0];
  for (var i=1;i<verts.length;i++){
    var dx = verts[i].x-verts[i-1].x, dy = verts[i].y-verts[i-1].y;
    cum.push(cum[i-1] + Math.sqrt(dx*dx+dy*dy));
  }
  var total = cum[cum.length-1];
  if (total <= 0) return null;

  // The exact TIN-crossing chainages fix the section's real shape;
  // the user's interval only adds evenly-spaced points between them
  // (for a smoother/denser export or plot) and never removes detail.
  var exactChainages = computeExactBreakChainages(verts, cum, total, state.points, state.triangles, triIndex);
  var nSamples = Math.max(2, Math.ceil(total/interval));
  var allChainages = [0, total];
  for (var e=0;e<exactChainages.length;e++) allChainages.push(exactChainages[e]);
  for (var s=0; s<=nSamples; s++) allChainages.push(Math.min(total, s*interval));
  allChainages.sort(function(a,b){ return a-b; });

  var mergeEps = Math.max(total*1e-6, 1e-4);
  var mergedChainages: number[] = [];
  for (var m=0;m<allChainages.length;m++){
    if (mergedChainages.length && (allChainages[m]-mergedChainages[mergedChainages.length-1]) < mergeEps) continue;
    mergedChainages.push(allChainages[m]);
  }

  var samples: ProfileSample[] = [];
  for (var k=0;k<mergedChainages.length;k++){
    var ch = mergedChainages[k];
    var pt = pointAtChainage(verts, cum, ch);
    var z = elevationAt(pt.x, pt.y, state.points, state.triangles, triIndex);
    samples.push({chainage:ch, elevation:z, x:pt.x, y:pt.y});
  }
  return {samples:samples, total:total};
}

export function computeLongSection(): ProfileData | null {
  if (!state.polyline) return null;
  var interval = parseFloat($<HTMLInputElement>('sample-interval').value) || 2;
  return computeLongSectionForVerts(state.polyline, interval);
}

// A regular chainage/RL reading ladder, independent of grade-break
// detection — e.g. "mark every 10m" regardless of where the terrain
// actually changes grade. Same exact TIN interpolation as the real
// section samples (pointAtChainage + elevationAt), not a linear
// interpolation between existing samples, so the levels shown are as
// accurate as the terrain data allows at exactly that chainage.
export function computeIntervalMarks(interval: number): IntervalMark[] {
  if (!state.polyline || !triIndex) return [];
  return computeIntervalMarksFrom(state.polyline, state.points, state.triangles, triIndex, interval);
}

// Manually-set datum RL for the long section (chart + DXF export) —
// Thom's own reference level, e.g. for a council long-section drawing
// convention. GradeLine never picks this for him; it's just read back
// from the sidebar field when the checkbox is on and the value parses.
export function datumRLValue(): number | null {
  if (!$<HTMLInputElement>('chk-datum').checked) return null;
  var v = parseFloat($<HTMLInputElement>('datum-rl').value);
  return isFinite(v) ? v : null;
}

// Ramer-Douglas-Peucker line simplification, applied to the (chainage,
// elevation) ground line to pick out its "grade break" points — the
// start, the end, and anywhere the ground deviates from a straight grade
// by more than `epsilon` (an elevation tolerance). Always keeps both
// endpoints. Used both to annotate the 2D long section and to mark
// chainage lines in the exported DXF.
function perpendicularDistance(pt: Point2, lineStart: Point2, lineEnd: Point2): number {
  var dx = lineEnd.x-lineStart.x, dy = lineEnd.y-lineStart.y;
  var mag2 = dx*dx+dy*dy;
  if (mag2 < 1e-12){
    var ddx0 = pt.x-lineStart.x, ddy0 = pt.y-lineStart.y;
    return Math.sqrt(ddx0*ddx0+ddy0*ddy0);
  }
  var u = ((pt.x-lineStart.x)*dx + (pt.y-lineStart.y)*dy) / mag2;
  var ix = lineStart.x + u*dx, iy = lineStart.y + u*dy;
  var ddx = pt.x-ix, ddy = pt.y-iy;
  return Math.sqrt(ddx*ddx+ddy*ddy);
}

function rdpSimplify(points: Point2[], epsilon: number): Point2[] {
  if (points.length < 3) return points.slice();
  var start = points[0], end = points[points.length-1];
  var dmax = 0, index = 0;
  for (var i=1;i<points.length-1;i++){
    var d = perpendicularDistance(points[i], start, end);
    if (d > dmax){ dmax = d; index = i; }
  }
  if (dmax > epsilon){
    var left = rdpSimplify(points.slice(0, index+1), epsilon);
    var right = rdpSimplify(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [start, end];
}

// points: [{x:chainage, y:elevation}]; returns the simplified subset,
// always including the first and last point.
function simplifyProfile(points: Point2[], epsilon: number): Point2[] {
  if (!points.length) return [];
  var eps = (typeof epsilon === 'number' && epsilon > 0) ? epsilon : 0.05;
  return rdpSimplify(points, eps);
}

// samples: profileData.samples with null elevations already filtered out.
// Returns [{chainage, elevation}], always including the first and last
// sample — used both to annotate the 2D long section and to mark
// chainage lines in the exported DXF.
export function computeGradeBreaks(samples: ProfileSample[], tolerance: number): GradeBreak[] {
  var pts = samples.map(function(s){ return {x:s.chainage, y:s.elevation as number}; });
  return simplifyProfile(pts, tolerance).map(function(p){ return {chainage:p.x, elevation:p.y}; });
}

function cumulativeChainagesLocal(verts: Point2[]): number[] {
  var cum = [0];
  for (var i=1;i<verts.length;i++){
    var dx = verts[i].x-verts[i-1].x, dy = verts[i].y-verts[i-1].y;
    cum.push(cum[i-1] + Math.sqrt(dx*dx+dy*dy));
  }
  return cum;
}
export { cumulativeChainagesLocal as cumulativeChainages };

// Existing-ground elevation at an arbitrary chainage along the active
// alignment, using the same exact TIN interpolation as the long
// section itself (not a linear guess) — null if that chainage falls
// outside the triangulated surface or there's no alignment loaded.
export function existingElevationAtChainageForVerts(verts: Point2[] | null, ch: number): number | null {
  if (!verts || !triIndex) return null;
  var cum = cumulativeChainagesLocal(verts);
  var total = cum[cum.length-1];
  if (total <= 0) return null;
  var c = Math.max(0, Math.min(ch, total));
  var pt = pointAtChainage(verts, cum, c);
  return elevationAt(pt.x, pt.y, state.points, state.triangles, triIndex);
}
export function existingElevationAtChainage(ch: number): number | null {
  return existingElevationAtChainageForVerts(state.polyline, ch);
}
