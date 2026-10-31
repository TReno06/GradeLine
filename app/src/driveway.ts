// Driveway design (proposed) — PLAN.md Stage 2 checkpoint 3 port,
// extracted verbatim from main.js, with one real change: applyKerbPoints/
// applyLaybackTemplate now delegate to computeKerbPvisFrom/
// computeLaybackPvisFrom (./driveway/profile.js) instead of duplicating
// their arithmetic inline — those were ported as pure logic in
// checkpoint 2 but never wired up to replace the app's own copy; doing
// so here matches checkpoint 2's own "delegate instead of duplicating"
// pattern and removes a drift risk between the tested pure function and
// the app's copy of the same maths.
import { $ } from './dom.ts';
import { state } from './state.ts';
import { computeDrivewayProfileFrom, computeDrivewayComplianceFrom, computeKerbPvisFrom, computeLaybackPvisFrom } from './driveway/profile.ts';
import { VEHICLE_TEMPLATES, sweepVehicleTemplateFrom, findWorstVehicleSweepFrom, vehicleSweepRangeFrom } from './driveway/vehicle.ts';
import { computeSectionTableFrom } from './driveway/sectionTable.ts';
import { computeCutFillVolumeFrom } from './driveway/cutfill.ts';
import { pointAtChainage as pointAtChainageLocal } from './geometry/chainage.ts';
import { profileData, existingElevationAtChainage, existingElevationAtChainageForVerts } from './longsection.ts';
import { isProfileVisible } from './viewstate.ts';
import { drawProfile } from './rendering.ts';
import type { Pvi, DrivewayProfile, VehicleTemplate, Point2, ComplianceRow, GradeBreak, VehicleSweepResult, VehicleSweepRange, DrivewayRules, SectionTable } from './types.ts';

// Sorts the user's PVIs by chainage, drops any with non-finite values,
// and derives the grade (%) of each leg. Returns null if there aren't
// at least two usable, distinct-chainage PVIs.
// computeDrivewayProfileForPvis's actual logic is now
// ./driveway/profile.js's computeDrivewayProfileFrom.
export function computeDrivewayProfileForPvis(pvisArray: Pvi[]): DrivewayProfile | null {
  return computeDrivewayProfileFrom(pvisArray);
}
export function computeDrivewayProfile(): DrivewayProfile | null {
  return computeDrivewayProfileForPvis(state.driveway.pvis);
}

// Outline-only car silhouette geometry (§5.4 Stage 0c item 7), traced
// from the reference B85/B99 side-elevation DXFs supplied for this
// feature. Local coordinate frame: u = distance from the front wheel
// centre (+ve toward the rear, matching templateUndersideLocal's own
// convention), v = height above the wheel-to-ground contact line
// (v=0 is the ground, same convention the underside sweep uses) — so
// this shares its origin and axes with sweepVehicleTemplateFrom's
// output and can be positioned/rotated with the exact same transform.
// Each vehicle's coordinates are scaled uniformly so its own two wheel
// centres sit exactly `wheelbase` apart (matching VEHICLE_TEMPLATES
// above) — both source drawings already matched their own template's
// wheelbase to the millimetre once B99 was switched to the same 2004
// dimension sheet as its outline (see VEHICLE_TEMPLATES' own comment),
// so this scale factor is 1.0 for both; kept as a computed scale
// rather than assumed, so it stays correct if either ever drifts.
var CAR_OUTLINES: Record<string, {strokes: number[][][]; arcs: number[][]; circles: number[][]}> = {"b85":{"strokes":[[[3.279,1.062],[2.871,1.254]],[[3.622,1.019],[3.663,1.036]],[[3.539,0.93],[3.574,0.982]],[[3.719,1.075],[3.733,1.077]],[[3.729,1.06],[3.719,1.075]],[[3.725,1.05],[3.729,1.06]],[[0.394,0.258],[0.398,0.16]],[[0.642,0.847],[1.621,0.905]],[[2.001,1.313],[1.791,1.316]],[[1.791,1.316],[1.784,0.908]],[[1.784,0.908],[2.646,0.93]],[[0.864,1.101],[0.62,0.951]],[[0.62,0.951],[0.488,0.974]],[[1.196,1.324],[1.259,1.287]],[[2.779,1.007],[2.683,0.788]],[[1.721,1.087],[1.755,1.359]],[[-0.719,0.684],[-0.8,0.644]],[[-0.446,0.706],[-0.719,0.684]],[[0.517,0.76],[-0.446,0.706]],[[1.157,0.801],[0.517,0.76]],[[1.698,0.822],[1.157,0.801]],[[3.401,0.85],[2.708,0.846]],[[3.697,0.681],[3.68,0.801]],[[3.68,0.801],[3.905,0.944]],[[-0.382,0.247],[-0.802,0.254]],[[0.6,0.26],[0.396,0.255]],[[2.692,1.306],[2.7,1.324]],[[3.158,1.043],[2.764,1.233]],[[2.764,1.233],[2.698,1.266]],[[3.574,0.982],[3.202,1.014]],[[-0.908,0.523],[-0.892,0.511]],[[-0.86,0.526],[-0.802,0.542]],[[-0.736,0.565],[-0.621,0.569]],[[-0.568,0.653],[-0.571,0.679]],[[-0.571,0.679],[-0.6,0.698]],[[-0.827,0.668],[-0.858,0.559]],[[2.871,1.254],[2.737,1.313]],[[3.663,1.036],[3.279,1.062]],[[3.574,0.982],[3.622,1.019]],[[3.744,0.93],[3.539,0.93]],[[3.774,0.941],[3.744,0.93]],[[3.886,1.041],[3.774,0.941]],[[3.931,1.085],[3.886,1.041]],[[3.733,1.077],[3.918,1.108]],[[3.708,1.039],[3.725,1.05]],[[3.704,1.036],[3.66,1.034]],[[3.893,0.98],[3.867,1.013]],[[3.923,0.898],[3.893,0.98]],[[3.929,0.751],[3.923,0.898]],[[3.919,0.69],[3.929,0.751]],[[3.99,0.624],[3.919,0.69]],[[3.973,0.427],[3.99,0.624]],[[3.201,0.204],[3.906,0.266]],[[3.198,0.277],[3.201,0.204]],[[0.398,0.16],[2.416,0.162]],[[-0.369,0.159],[-0.375,0.247]],[[-0.667,0.163],[-0.369,0.159]],[[-0.815,0.175],[-0.667,0.163]],[[-0.887,0.218],[-0.815,0.175]],[[-0.915,0.363],[-0.895,0.326]],[[-0.92,0.443],[-0.915,0.363]],[[-0.91,0.526],[-0.92,0.443]],[[-0.859,0.563],[-0.91,0.526]],[[0.881,1.031],[0.642,0.847]],[[1.621,0.905],[1.704,1.309]],[[1.031,1.195],[0.864,1.101]],[[0.538,0.817],[0.584,0.936]],[[2.345,0.364],[2.323,0.276]],[[2.323,0.276],[0.6,0.26]],[[2.708,0.846],[1.698,0.822]],[[3.919,0.694],[3.697,0.681]],[[3.877,0.327],[3.198,0.277]],[[-0.892,0.511],[-0.86,0.526]],[[-0.802,0.542],[-0.736,0.565]],[[-0.621,0.569],[-0.599,0.612]],[[-0.599,0.612],[-0.568,0.653]]],"arcs":[[-0.354,-0.151,0.995,1.8311,1.9698],[2.568,-16.371,17.469,1.6901,1.7251],[1.505,0.519,0.866,1.7599,1.9463],[1.881,-1.444,2.865,1.5706,1.7599],[2.096,-0.572,1.991,1.3068,1.5453],[1.883,-1.36,2.807,1.2618,1.3068],[3.922,1.095,0.014,5.4848,1.8581],[2.819,0.262,0.379,0.0397,1.6444],[-0.868,0.25,0.037,2.5022,4.1702],[-0.937,0.302,0.048,5.6438,0.5267],[1.993,-0.038,1.351,1.3735,1.5643],[2.58,1.03,0.107,5.806,0.8962],[1.498,0.366,0.952,1.825,2.0842],[5.433,1.75,5.058,3.3882,3.4406],[2.56,0.805,0.124,5.0717,6.149],[2.302,0.894,0.443,1.0596,1.3829],[3.101,1.343,0.318,5.0214,5.2314],[-0.681,0.626,0.152,1.9698,2.8642],[1.09,-8.07,9.042,1.7047,1.7599],[3.686,0.452,0.289,5.5823,6.1985],[2.822,0.229,0.412,1.6444,3.3059],[-0.002,0.242,0.396,0.0397,1.6124],[-0.003,0.265,0.373,1.6124,3.192],[1.718,-0.144,1.443,1.9916,2.1894],[1.775,-0.276,1.586,1.6155,1.9905],[2.127,0.471,0.826,0.8913,1.4128],[1.932,1.365,0.836,5.7364,5.806],[1.06,0.649,0.548,2.8297,3.3882],[2.861,0.231,0.532,2.2597,2.8897],[2.704,0.421,0.286,1.9301,2.2597],[2.686,1.048,0.102,5.8673,0.9691],[2.079,0.37,1.011,0.8531,1.1203],[1.927,-1.499,2.865,1.4103,1.8061],[5.636,0.608,3.944,3.0198,3.1408],[5.319,0.609,3.627,3.1408,3.2343],[2.726,1.291,0.037,2.718,3.8659],[3.181,1.092,0.054,4.2615,5.0214],[4.651,-6.454,8.515,1.9896,2.0815],[1.845,-11.801,13.222,1.5479,1.568]],"circles":[[0.0,0.31,0.31],[0.0,0.31,0.232],[0.0,0.31,0.031],[0.0,0.31,0.046],[2.8,0.31,0.31],[2.8,0.31,0.232],[2.8,0.31,0.031]]},"b99":{"strokes":[[[1.104,0.683],[1.042,0.312]],[[1.135,1.03],[1.104,0.683]],[[4.085,0.312],[4.145,0.372]],[[4.077,0.422],[4.077,0.56]],[[4.25,0.56],[4.25,0.422]],[[4.2,0.372],[4.127,0.372]],[[4.127,0.61],[4.2,0.61]],[[3.935,1.806],[3.935,1.296]],[[3.894,2.2],[3.991,2.175]],[[3.991,2.175],[4.069,2.112]],[[4.069,2.112],[4.101,2.023]],[[4.101,2.023],[4.158,1.656]],[[4.202,1.274],[4.216,0.607]],[[4.158,1.656],[4.202,1.274]],[[-0.019,1.181],[-0.043,1.214]],[[0.442,1.852],[0.385,1.932]],[[-0.236,1.397],[-0.214,1.344]],[[0.514,1.181],[-0.019,1.181]],[[-0.043,1.214],[-0.033,1.254]],[[0.655,1.844],[1.005,1.844]],[[1.005,1.844],[1.054,1.805]],[[-0.033,1.254],[0.489,1.775]],[[0.557,1.817],[0.557,1.185]],[[1.076,1.755],[1.076,1.36]],[[1.076,1.36],[1.03,1.289]],[[2.513,1.296],[2.513,1.806]],[[1.338,1.806],[2.33,1.806],[2.33,1.296],[1.338,1.296],[1.338,1.806]],[[0.719,1.202],[0.514,1.181]],[[0.909,1.233],[0.719,1.202]],[[0.976,1.253],[0.909,1.233]],[[1.03,1.289],[0.976,1.253]],[[1.054,1.805],[1.076,1.755]],[[0.538,1.811],[0.655,1.844]],[[0.489,1.775],[0.538,1.811]],[[1.151,1.383],[1.135,1.03]],[[1.155,1.91],[1.151,1.383]],[[0.753,1.9],[1.155,1.91]],[[0.576,1.883],[0.753,1.9]],[[0.497,1.851],[0.576,1.883]],[[-0.053,1.368],[0.442,1.852]],[[-0.142,1.318],[-0.053,1.368]],[[-0.181,1.329],[-0.142,1.318]],[[-0.214,1.344],[-0.181,1.329]],[[0.742,2.181],[0.86,2.2]],[[0.641,2.124],[0.742,2.181]],[[0.48,2.014],[0.641,2.124]],[[0.385,1.932],[0.48,2.014]],[[-0.814,0.312],[-0.95,0.448]],[[-0.95,0.522],[-0.95,0.448]],[[-0.618,0.782],[-0.541,0.923]],[[-0.654,0.574],[-0.618,0.782]],[[-0.887,0.851],[-0.887,0.572]],[[-0.9,0.572],[-0.296,0.572]],[[-0.541,0.923],[0.497,1.851]],[[-0.852,0.927],[0.385,1.932]],[[-0.814,0.312],[4.085,0.312]],[[1.155,1.91],[4.119,1.91]],[[2.513,1.806],[3.935,1.806]],[[3.935,1.296],[2.513,1.296]],[[0.86,2.2],[3.894,2.2]]],"arcs":[[4.2,0.422,0.05,4.7124,6.2832],[4.127,0.422,0.05,3.1416,4.7124],[4.127,0.56,0.05,1.5708,3.1416],[4.2,0.56,0.05,0.0,1.5708],[-0.9,0.522,0.05,1.5708,3.1416],[-0.787,0.851,0.1,2.2818,3.1416]],"circles":[[0.0,0.322,0.322],[0.0,0.322,0.241],[0.0,0.322,0.032],[0.0,0.322,0.048],[3.05,0.322,0.322],[3.05,0.322,0.241],[3.05,0.322,0.032]]}};

// Draws the outline-only car silhouette (CAR_OUTLINES) on the same
// ground chord as the underside sweep above — same anchor-wheel ground
// point, same rotation — so its wheels always land exactly on the
// real wheel-contact points, never independently positioned. Uses a
// single canvas transform for the whole shape (translate+rotate+scale
// is affine, same as the underside sweep's own per-point maths) so
// arcs/circles in the source outline draw as true curves rather than
// a flattened polyline approximation.
//
// Drawn low-opacity and *underneath* the driveway design line/labels
// (call this before drawing those, not after) — three earlier
// silhouette attempts were removed for visually colliding with the
// design line in busy kerb+layback areas (see CLAUDE.md); z-order
// plus transparency is the fix this time, not omitting the shape.
//
// `flipped` matches sweepVehicleTemplateFrom's own convention: by
// default the wheel at `sweepChainage` (the transform's anchor point)
// is the REAR wheel, not the front — the vehicle faces toward
// increasing chainage (right, on a normally-drawn chart) without
// needing "reversing" ticked. CAR_OUTLINES' own (u,v) coordinates
// assume u=0 is the front wheel, so by default (front wheel NOT at the
// anchor) the whole affine transform is composed with a reflection of u
// around the wheelbase midpoint (u' = wheelbase - u) before the usual
// rotate+scale+translate, placing the outline's own front at the far
// (high-chainage) end instead of the anchor — applied at the matrix
// level so strokes/arcs/circles all mirror correctly, not just straight
// segments. When `flipped` (reversing), the front wheel genuinely is at
// the anchor (matching CAR_OUTLINES' own u=0 directly), so no mirror is
// needed and the vehicle faces left instead.
export function drawVehicleOutlineSilhouette(ctx: CanvasRenderingContext2D, px: (ch: number) => number, py: (rl: number) => number, pxPerUnitX: number, pxPerUnitY: number, template: VehicleTemplate, sweepRes: VehicleSweepResult, sweepChainage: number, flipped?: boolean){
  var outline = CAR_OUTLINES[template.key];
  if (!outline) return;
  var a = sweepRes.cosA*pxPerUnitX, b = -sweepRes.sinA*pxPerUnitY,
      c = -sweepRes.sinA*pxPerUnitX, d = -sweepRes.cosA*pxPerUnitY,
      e = px(sweepChainage), f = py(sweepRes.rlFront);
  if (!flipped){
    e = e + a*template.wheelbase;
    f = f + b*template.wheelbase;
    a = -a; b = -b;
  }
  ctx.save();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = '#AEB8BF';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.1 / Math.max(Math.abs(pxPerUnitX), 1e-6);
  var i: number, pts: number[][];
  for (i=0; i<outline.strokes.length; i++){
    pts = outline.strokes[i];
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var j=1; j<pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
    ctx.stroke();
  }
  for (i=0; i<outline.arcs.length; i++){
    var ar = outline.arcs[i];
    ctx.beginPath();
    ctx.arc(ar[0], ar[1], ar[2], ar[3], ar[4]);
    ctx.stroke();
  }
  for (i=0; i<outline.circles.length; i++){
    var ci = outline.circles[i];
    ctx.beginPath();
    ctx.arc(ci[0], ci[1], ci[2], 0, Math.PI*2);
    ctx.stroke();
  }
  ctx.restore();
}

// vehicleSweepRangeFrom is ./driveway/vehicle.js's version, which takes
// the two boundary chainages directly instead of a whole profile object.
function vehicleSweepRange(template: VehicleTemplate, profile: DrivewayProfile, flipped?: boolean): VehicleSweepRange {
  return vehicleSweepRangeFrom(template, profile.pvis[0].chainage, profile.pvis[profile.pvis.length-1].chainage, flipped);
}

// Ground for the vehicle check: the driveway's own design profile
// within its chainage span (interpolated leg by leg — a vertical/zero-
// run leg resolves to its upper point, the far side of the face), and
// existing terrain beyond either end (already clamped to the surveyed
// range by existingElevationAtChainage), so the front/rear overhangs
// can still be checked right up to and past the kerb.
export function driveGroundRLAtForVerts(dwProfile: DrivewayProfile | null, verts: Point2[] | null, ch: number): number | null {
  if (dwProfile){
    var pvis = dwProfile.pvis;
    if (ch >= pvis[0].chainage - 1e-9 && ch <= pvis[pvis.length-1].chainage + 1e-9){
      for (var i=0;i<pvis.length-1;i++){
        var a = pvis[i], b = pvis[i+1];
        if (ch >= a.chainage - 1e-9 && ch <= b.chainage + 1e-9){
          if (b.chainage - a.chainage < 1e-9) return b.rl;
          var f = (ch - a.chainage)/(b.chainage-a.chainage);
          return a.rl + (b.rl-a.rl)*f;
        }
      }
      return pvis[pvis.length-1].rl;
    }
  }
  return existingElevationAtChainageForVerts(verts, ch);
}
export function driveGroundRLAt(dwProfile: DrivewayProfile | null, ch: number): number | null {
  return driveGroundRLAtForVerts(dwProfile, state.polyline, ch);
}

// For the optional width-between-alignments callback: the straight-
// line ground distance between the point at chainage `ch` along verts
// A and the point at the SAME chainage value along verts B — i.e. the
// actual horizontal separation implied by the chainage-matching
// assumption above, not a true perpendicular offset.
export function alignmentSeparationAt(vertsA: Point2[], cumA: number[], vertsB: Point2[], cumB: number[], ch: number): number | null {
  var totalA = cumA[cumA.length-1], totalB = cumB[cumB.length-1];
  if (!(totalA > 0) || !(totalB > 0)) return null;
  var cA = Math.max(0, Math.min(ch, totalA)), cB = Math.max(0, Math.min(ch, totalB));
  var ptA = pointAtChainageLocal(vertsA, cumA, cA), ptB = pointAtChainageLocal(vertsB, cumB, cB);
  return Math.hypot(ptA.x-ptB.x, ptA.y-ptB.y);
}

// Reads the compliance thresholds straight from the sidebar inputs
// (same pattern as grade-break-tolerance etc.) rather than caching
// them in state, so a tweak takes effect immediately on redraw.
export function drivewayRules(): DrivewayRules {
  function num(id: string, fallback: number): number {
    var v = parseFloat($<HTMLInputElement>(id).value);
    return isFinite(v) ? v : fallback;
  }
  return {
    maxGrade: num('dw-max-grade', 20),
    applyBoundaryRule: $<HTMLInputElement>('dw-chk-boundary').checked,
    maxGradeBoundary: num('dw-max-grade-boundary', 5),
    transitionThreshold: num('dw-transition-threshold', 12.5),
    minTransitionLength: num('dw-min-transition-length', 2)
  };
}

// Checks the design against the configured thresholds. This is a
// screening aid against the commonly-cited AS 2890.1 numeric rules —
// NOT a substitute for checking the actual current clause text (the
// standard is a paid Standards Australia document and gets amended)
// or for a qualified engineer's sign-off before council submission.
export function computeDrivewayCompliance(profile: DrivewayProfile | null): ComplianceRow[] {
  return computeDrivewayComplianceFrom(profile, drivewayRules());
}

// Builds the station/leg list behind the CAD-style section table: every
// existing-ground grade-break, PLUS the driveway's own design points,
// across the whole alignment (dwProfile null = no driveway, everything
// is existing-ground). A break that falls strictly inside the driveway
// design's chainage span still becomes its own station — it used to be
// dropped entirely there (only the driveway's own PVIs showed up),
// which silently skipped every reading between two widely-spaced PVIs;
// such a break's proposed level is the driveway's own design RL
// interpolated at that exact chainage, not just at its PVIs. Each leg
// is described exactly once, tagged 'existing' or 'new'.
export function computeSectionTable(breaks: GradeBreak[], dwProfile: DrivewayProfile | null): SectionTable {
  return computeSectionTableFrom(breaks, dwProfile, existingElevationAtChainage, driveGroundRLAt);
}

function renderDrivewayTable(){
  // Rows always follow chainage order — manual reordering was removed
  // by request, so the array itself is kept sorted here rather than
  // just its display, and editing a chainage re-sorts on the next
  // render. A stable sort (guaranteed by the JS spec) keeps same-
  // chainage pairs (e.g. a kerb reveal's vertical face) in whichever
  // relative order they were entered.
  state.driveway.pvis.sort(function(a,b){ return a.chainage-b.chainage; });
  var body = $('dw-pvi-body');
  var pvis = state.driveway.pvis;
  var html = '';
  for (var i=0;i<pvis.length;i++){
    var existing = existingElevationAtChainage(pvis[i].chainage);
    var cutFill = (existing!==null && isFinite(pvis[i].rl)) ? (pvis[i].rl - existing) : null;
    var cfText = cutFill===null ? '—' : (Math.abs(cutFill)<0.005 ? '0.00' :
      (cutFill>0 ? 'Fill ' + cutFill.toFixed(2) : 'Cut ' + Math.abs(cutFill).toFixed(2)));
    html += '<div class="pvi-row">' +
      '<input type="number" class="pvi-ch" data-i="' + i + '" step="0.1" value="' + pvis[i].chainage.toFixed(2) + '">' +
      '<input type="number" class="pvi-rl" data-i="' + i + '" step="0.01" value="' + pvis[i].rl.toFixed(3) + '">' +
      '<span class="pvi-existing mono">' + (existing===null?'—':existing.toFixed(3)) + '</span>' +
      '<span class="pvi-cutfill mono">' + cfText + '</span>' +
      '<button class="pvi-del" data-i="' + i + '" title="Remove point" type="button">&times;</button>' +
      '</div>';
  }
  body.innerHTML = html;
  var chInputs = body.querySelectorAll<HTMLInputElement>('.pvi-ch');
  for (var a=0;a<chInputs.length;a++){
    chInputs[a].addEventListener('change', function(this: HTMLInputElement){
      var idx = parseInt(this.getAttribute('data-i') as string,10);
      var v = parseFloat(this.value);
      if (isFinite(v)) state.driveway.pvis[idx].chainage = v;
      renderDrivewayUI();
    });
  }
  var rlInputs = body.querySelectorAll<HTMLInputElement>('.pvi-rl');
  for (var b=0;b<rlInputs.length;b++){
    rlInputs[b].addEventListener('change', function(this: HTMLInputElement){
      var idx = parseInt(this.getAttribute('data-i') as string,10);
      var v = parseFloat(this.value);
      if (isFinite(v)) state.driveway.pvis[idx].rl = v;
      renderDrivewayUI();
    });
  }
  var delBtns = body.querySelectorAll<HTMLButtonElement>('.pvi-del');
  for (var c=0;c<delBtns.length;c++){
    delBtns[c].addEventListener('click', function(this: HTMLButtonElement){
      var idx = parseInt(this.getAttribute('data-i') as string,10);
      state.driveway.pvis.splice(idx,1);
      renderDrivewayUI();
      if (isProfileVisible()) drawProfile();
    });
  }
}

function renderDrivewayCompliance(){
  var profile = computeDrivewayProfile();
  var rows = computeDrivewayCompliance(profile);
  if (profile && state.driveway.vehicleCheck.enabled){
    var template = VEHICLE_TEMPLATES[state.driveway.vehicleCheck.model];
    var flipped = state.driveway.vehicleCheck.flipped;
    var range = vehicleSweepRange(template, profile, flipped);
    var worst = findWorstVehicleSweepFrom(template, range.start, range.end,
      function(ch){ return driveGroundRLAt(profile, ch); }, 0.05, 0.02, flipped);
    if (worst){
      var mm = Math.round(Math.abs(worst.minClearance)*1000);
      var approxNote = template.official ? '' : ' — approximate check, not an AS 2890.1 published template';
      var directionNote = flipped ? ' reversing' : '';
      if (worst.scrapes){
        rows.push({cls:'diag-warn', text: template.label + directionNote + ' scrapes by ' + mm + 'mm near ch ' +
          worst.worstChainage.toFixed(2) + approxNote + '.'});
      } else {
        rows.push({cls:'diag-ok', text: template.label + directionNote + ' clears the whole driveway, by at least ' +
          mm + 'mm at its tightest point (ch ' + worst.worstChainage.toFixed(2) + ')' + approxNote + '.'});
      }
    }
  }
  var html = '';
  for (var i=0;i<rows.length;i++){
    html += '<div class="diag-row ' + rows[i].cls + '">' + rows[i].text + '</div>';
  }
  $('dw-compliance-body').innerHTML = html;
}

function updateVehicleReadout(profile: DrivewayProfile, template: VehicleTemplate, sweepCh: number, flipped?: boolean){
  var res = sweepVehicleTemplateFrom(template, sweepCh, function(ch){ return driveGroundRLAt(profile, ch); }, undefined, flipped);
  var el = $('dw-vc-readout');
  if (!res){ el.textContent = 'Ground data unavailable at this position.'; el.style.color = ''; return; }
  var mm = Math.round(Math.abs(res.minClearance)*1000);
  var approxNote = template.official ? '' : ' (approximate — no published AS 2890.1 template for ' + template.label + ')';
  var directionNote = flipped ? ' reversing' : '';
  if (res.scrapes){
    el.textContent = template.label + directionNote + ' SCRAPES by ' + mm + 'mm (worst point at ch ' + res.worstChainage.toFixed(2) + ')' + approxNote + '.';
    el.style.color = '#E0574A';
  } else {
    el.textContent = template.label + directionNote + ' clears by ' + mm + 'mm at its tightest point (ch ' + res.worstChainage.toFixed(2) + ')' + approxNote + '.';
    el.style.color = '#3ECF8E';
  }
}

function renderVehicleCheckUI(){
  var vc = state.driveway.vehicleCheck;
  $<HTMLInputElement>('dw-vc-enable').checked = vc.enabled;
  $('dw-vc-body').style.display = vc.enabled ? 'block' : 'none';
  if (!vc.enabled) return;
  $<HTMLSelectElement>('dw-vc-model').value = vc.model;
  $<HTMLInputElement>('dw-vc-flip').checked = !!vc.flipped;
  $('dw-vc-lead-label').textContent = vc.flipped ? 'front' : 'rear';
  var profile = computeDrivewayProfile();
  var slider = $<HTMLInputElement>('dw-vc-slider');
  if (!profile){
    slider.disabled = true;
    $('dw-vc-chainage-label').textContent = '—';
    $('dw-vc-readout').textContent = 'Add at least two design points first.';
    $('dw-vc-readout').style.color = '';
    return;
  }
  slider.disabled = false;
  var template = VEHICLE_TEMPLATES[vc.model];
  var range = vehicleSweepRange(template, profile, vc.flipped);
  slider.min = range.start.toFixed(3);
  slider.max = range.end.toFixed(3);
  if (vc.sweepChainage === null || vc.sweepChainage < range.start - 1e-6 || vc.sweepChainage > range.end + 1e-6){
    var worst = findWorstVehicleSweepFrom(template, range.start, range.end,
      function(ch){ return driveGroundRLAt(profile, ch); }, 0.05, 0.02, vc.flipped);
    vc.sweepChainage = worst ? worst.sweepChainage : range.start;
  }
  slider.value = String(vc.sweepChainage);
  $('dw-vc-chainage-label').textContent = vc.sweepChainage.toFixed(2) + 'm';
  updateVehicleReadout(profile, template, vc.sweepChainage, vc.flipped);
}

function renderCutFillVolume(){
  var widthInput = $<HTMLInputElement>('dw-cutfill-width');
  var readout = $('dw-cutfill-readout');
  if (state.driveway.cutFillCorridorWidth !== null && state.driveway.cutFillCorridorWidth !== undefined){
    widthInput.value = String(state.driveway.cutFillCorridorWidth);
  }
  var width = parseFloat(widthInput.value);
  if (!isFinite(width) || width <= 0){
    readout.textContent = 'Enter a corridor width to estimate cut/fill volume.';
    readout.style.color = '';
    return;
  }
  var profile = computeDrivewayProfile();
  var vol = (profile && profileData) ?
    computeCutFillVolumeFrom(profileData.samples, profile, width, existingElevationAtChainage, driveGroundRLAt) : null;
  if (!vol){
    readout.textContent = 'No ground data along the design to estimate volume.';
    readout.style.color = '';
    return;
  }
  readout.innerHTML = 'Cut ' + vol.cutVolume.toFixed(1) + '&nbsp;m&sup3; &nbsp;&nbsp; Fill ' +
    vol.fillVolume.toFixed(1) + '&nbsp;m&sup3; &nbsp;&nbsp; Net ' + (vol.netVolume>=0?'+':'') +
    vol.netVolume.toFixed(1) + '&nbsp;m&sup3; (fill&minus;cut)';
  readout.style.color = '';
}

export function renderDrivewayUI(){
  // "Proposed"/"Both" section-export buttons need an actual design to
  // export — disabled rather than hidden, so it's clear they exist but
  // need a driveway turned on first.
  var hasDesign = !!(state.driveway.enabled && computeDrivewayProfile());
  $<HTMLButtonElement>('btn-export-section-proposed').disabled = !hasDesign;
  $<HTMLButtonElement>('btn-export-section-both').disabled = !hasDesign;

  var noProfile = $('dw-no-profile');
  $<HTMLInputElement>('dw-enable').disabled = !profileData;
  if (!profileData){
    noProfile.style.display = 'block';
    $('dw-body').style.display = 'none';
    return;
  }
  noProfile.style.display = 'none';
  $<HTMLInputElement>('dw-enable').checked = state.driveway.enabled;
  $('dw-body').style.display = state.driveway.enabled ? 'block' : 'none';
  if (!state.driveway.enabled) return;
  renderDrivewayTable();
  renderDrivewayCompliance();
  renderVehicleCheckUI();
  renderCutFillVolume();
}

$('dw-cutfill-width').addEventListener('change', function(this: HTMLInputElement){
  var w = parseFloat(this.value);
  state.driveway.cutFillCorridorWidth = isFinite(w) && w > 0 ? w : null;
  renderCutFillVolume();
});

$('dw-vc-enable').addEventListener('change', function(this: HTMLInputElement){
  state.driveway.vehicleCheck.enabled = this.checked;
  if (this.checked) state.driveway.vehicleCheck.sweepChainage = null;
  renderVehicleCheckUI();
  renderDrivewayCompliance();
  if (isProfileVisible()) drawProfile();
});
$('dw-vc-model').addEventListener('change', function(this: HTMLSelectElement){
  state.driveway.vehicleCheck.model = this.value;
  state.driveway.vehicleCheck.sweepChainage = null;
  renderVehicleCheckUI();
  renderDrivewayCompliance();
  if (isProfileVisible()) drawProfile();
});
$('dw-vc-flip').addEventListener('change', function(this: HTMLInputElement){
  state.driveway.vehicleCheck.flipped = this.checked;
  // The valid sweep range and its worst point both shift with which
  // overhang leads, so re-find the worst point rather than keeping the
  // old sweepChainage, same as switching model does.
  state.driveway.vehicleCheck.sweepChainage = null;
  renderVehicleCheckUI();
  renderDrivewayCompliance();
  if (isProfileVisible()) drawProfile();
});
$('dw-vc-slider').addEventListener('input', function(this: HTMLInputElement){
  var v = parseFloat(this.value);
  if (!isFinite(v)) return;
  state.driveway.vehicleCheck.sweepChainage = v;
  $('dw-vc-chainage-label').textContent = v.toFixed(2) + 'm';
  var profile = computeDrivewayProfile();
  if (profile) updateVehicleReadout(profile, VEHICLE_TEMPLATES[state.driveway.vehicleCheck.model], v, state.driveway.vehicleCheck.flipped);
  if (isProfileVisible()) drawProfile();
});
$('dw-vc-jump-worst').addEventListener('click', function(){
  var profile = computeDrivewayProfile();
  if (!profile) return;
  var template = VEHICLE_TEMPLATES[state.driveway.vehicleCheck.model];
  var flipped = state.driveway.vehicleCheck.flipped;
  var range = vehicleSweepRange(template, profile, flipped);
  var worst = findWorstVehicleSweepFrom(template, range.start, range.end,
    function(ch){ return driveGroundRLAt(profile, ch); }, 0.05, 0.02, flipped);
  if (worst){
    state.driveway.vehicleCheck.sweepChainage = worst.sweepChainage;
    renderVehicleCheckUI();
    if (isProfileVisible()) drawProfile();
  }
});

$('dw-enable').addEventListener('change', function(this: HTMLInputElement){
  state.driveway.enabled = this.checked;
  if (state.driveway.enabled && state.driveway.pvis.length < 2 && profileData){
    // Seed with two points matching existing ground at the start and
    // end of the alignment, so the table opens with a valid (flat vs.
    // existing) design ready to edit rather than empty. The alignment
    // can run beyond the surveyed extent (e.g. its first/last vertex
    // sitting just off the edge of the TIN), in which case
    // existingElevationAtChainage(0)/(total) legitimately returns null
    // right at the very ends — the same condition the long-section
    // chart already handles by filtering null samples. Falling back to
    // a bare RL=0 there would seed a wildly wrong point (tens of
    // metres below real ground) that silently poisons every downstream
    // grade/compliance/vehicle-clearance check, so instead fall back to
    // the nearest chainage that actually has surveyed elevation data.
    var validSamples = profileData.samples.filter(function(s){ return s.elevation !== null; });
    var startCh = 0, startEl = existingElevationAtChainage(0);
    var endCh = profileData.total, endEl = existingElevationAtChainage(profileData.total);
    if (startEl === null && validSamples.length){
      startCh = validSamples[0].chainage;
      startEl = validSamples[0].elevation;
    }
    if (endEl === null && validSamples.length){
      endCh = validSamples[validSamples.length-1].chainage;
      endEl = validSamples[validSamples.length-1].elevation;
    }
    state.driveway.pvis = [
      {chainage: startCh, rl: startEl!==null ? startEl : 0},
      {chainage: endCh, rl: endEl!==null ? endEl : 0}
    ];
    state.driveway.frontier = null;
    state.driveway.kerbInvert = null;
  }
  renderDrivewayUI();
  if (isProfileVisible()) drawProfile();
});

// Sets the first two design points from the kerb & invert dimensions:
// the gutter invert at the chainage Thom enters, then the top of kerb
// directly above it (same chainage — a real vertical face, not a
// sloped leg, matching what a kerb face physically is). The chainage
// itself is manual too, not assumed to be 0 — a seeded design point
// (e.g. the alignment's start) is often already sitting at chainage 0,
// so the kerb needs to be placeable anywhere along the alignment
// without colliding with it. Any existing design point sitting exactly
// at the kerb chainage is replaced by the new kerb pair; anything
// before or after that chainage is left alone.
function applyKerbPoints(){
  var kerbCh = parseFloat($<HTMLInputElement>('dw-kerb-invert-chainage').value);
  var invert = parseFloat($<HTMLInputElement>('dw-kerb-invert-rl').value);
  var revealMm = parseFloat($<HTMLInputElement>('dw-kerb-reveal').value);
  if (![kerbCh,invert,revealMm].every(isFinite)){
    alert('Enter numeric values for the kerb invert chainage, invert RL, and kerb reveal.');
    return;
  }
  var kerbPvis = computeKerbPvisFrom(kerbCh, invert, revealMm);
  var topKerb = kerbPvis[1].rl;
  var before = state.driveway.pvis.filter(function(p){ return p.chainage < kerbCh - 1e-9; });
  var after = state.driveway.pvis.filter(function(p){ return p.chainage > kerbCh + 1e-9; });
  state.driveway.pvis = before.concat(kerbPvis).concat(after);
  state.driveway.frontier = {chainage: kerbCh, rl: topKerb};
  state.driveway.kerbInvert = {chainage: kerbCh, rl: invert};
  state.driveway.enabled = true;
  renderDrivewayUI();
  if (isProfileVisible()) drawProfile();
}
$('dw-apply-kerb').addEventListener('click', applyKerbPoints);

// Stamps the council layback/crossover legs in as design points, one
// either side of the kerb: the road-side leg runs BACK from the kerb
// invert (rising away from it, since the invert is the low point of
// the gutter), the property-side leg runs FORWARD from the top of
// kerb, same as this always worked. If no kerb has been set, both
// sides fall back to the same single reference point — the current
// "frontier" (last thing applied), or the first design point, or
// existing ground at chainage 0 if there's nothing at all — so the
// template still works stand-alone. AS 2890.1 governs the driveway
// *grades*, but the physical layback profile itself is a fixed council
// standard-drawing detail, not something the Standard specifies —
// Thom's call — so neither leg is ever checked against the grade
// limits below (see computeDrivewayProfile's `isTemplate` flag).
function applyLaybackTemplate(){
  var r1 = parseFloat($<HTMLInputElement>('dw-leg1-rise').value), w1 = parseFloat($<HTMLInputElement>('dw-leg1-run').value);
  var r2 = parseFloat($<HTMLInputElement>('dw-leg2-rise').value), w2 = parseFloat($<HTMLInputElement>('dw-leg2-run').value);
  if (![r1,w1,r2,w2].every(isFinite)){
    alert('Enter numeric values for both layback legs.');
    return;
  }
  var pvis = state.driveway.pvis.filter(function(p){ return p.template !== 'layback'; })
    .slice().sort(function(a,b){ return a.chainage-b.chainage; });
  var afterBase = state.driveway.frontier;
  if (!afterBase){
    if (pvis.length){
      afterBase = pvis[0];
    } else {
      var rl0 = existingElevationAtChainage(0);
      afterBase = {chainage:0, rl: rl0!==null ? rl0 : 0};
    }
  }
  var beforeBase = state.driveway.kerbInvert || afterBase;

  var newLegs = computeLaybackPvisFrom(beforeBase, afterBase, r1, w1, r2, w2);
  var chBefore = newLegs[0].chainage, chAfter = newLegs[1].chainage, rlAfter = newLegs[1].rl;

  // Keep the kerb points themselves (they sit inside this span) plus
  // anything genuinely outside it; drop anything else caught between
  // the two new legs (mirrors the old "replaces points within the
  // template's span" behaviour, now that the span straddles the kerb).
  var keep = pvis.filter(function(p){
    return p.template === 'kerb' || p.chainage <= chBefore + 1e-6 || p.chainage >= chAfter - 1e-6;
  });
  if (!keep.some(function(p){ return p.chainage > chAfter + 1e-6; }) &&
      profileData && profileData.total > chAfter + 1e-6){
    var endEl = existingElevationAtChainage(profileData.total);
    keep.push({chainage: profileData.total, rl: endEl!==null ? endEl : rlAfter});
  }
  state.driveway.pvis = keep.concat(newLegs);
  state.driveway.frontier = {chainage: chAfter, rl: rlAfter};
  state.driveway.enabled = true;
  renderDrivewayUI();
  if (isProfileVisible()) drawProfile();
}
$('dw-apply-layback').addEventListener('click', applyLaybackTemplate);

$('dw-add-point').addEventListener('click', function(){
  var last = state.driveway.pvis[state.driveway.pvis.length-1];
  var newCh = last ? Math.min(profileData.total, last.chainage + Math.max(1, profileData.total*0.1)) : 0;
  var existing = existingElevationAtChainage(newCh);
  state.driveway.pvis.push({chainage: newCh, rl: existing!==null ? existing : (last?last.rl:0)});
  renderDrivewayUI();
  if (isProfileVisible()) drawProfile();
});
['dw-max-grade','dw-chk-boundary','dw-max-grade-boundary','dw-transition-threshold','dw-min-transition-length'].forEach(function(id){
  $(id).addEventListener('change', function(){
    renderDrivewayCompliance();
    if (isProfileVisible()) drawProfile();
  });
});
