// The built-in sample job (2026-11-08): a made-up residential lot, laid out
// like a real driveway job so every part of the app has something to show.
//
// The street curves: everything along it (road, kerb, footpath, boundary)
// is laid out at fixed offsets v from a curved baseline,
// v = y - bend(x), bend(x) = 0.012 (x - 27)^2 — so at the driveway (x = 11)
// the kerb runs about 21 degrees off east-west. Across the street (v):
//
//   v = 4      front boundary; behind it the lot climbs a front bank, then
//              8% up to the house, falling 3% to the east as well
//   v = 1.2-2.4  concrete footpath in a verge rising 2.5% from the kerb
//   v = -0.4   back of kerb (barrier kerb, 150mm face) — dropped to a
//              layback (30mm lip rising 70mm over 450mm) across the
//              driveway, x 9-13, with 0.9m splays
//   v = -0.6   kerb invert;  v = -1  gutter lip
//   v = -5     road crown (3% crossfall); the street falls 1.5% east
//
// The driveway leaves the kerb square to it, then bends left on an 8m
// radius to run north into the garage. One alignment runs up each edge of
// the 3m driveway, each with its own design (council layback, 4% across
// the footpath, a 2m transition, the main grade, transitions onto the
// garage floor) that passes the default AS 2890.1 checks. On the bend the
// west (inside) edge is about 1.1m shorter than the east edge — which is
// why crossfall is read square across the alignments, not at matching
// chainage values.
//
// Pure and deterministic (no Math.random), so tests can check it.
import type { Point2, Point3, Breakline, Pvi } from './types.ts';

export interface SampleDesign {
  pvis: Pvi[];
  kerbChainage: number;
  kerbInvertRl: number;
  revealMm: number;
  garageFfl: number;
}
export interface SampleAlignment {
  label: string;
  vertices: Point2[];
  design: SampleDesign;
}
export interface SampleSite {
  points: Point3[];
  breaklines: Breakline[];
  alignments: SampleAlignment[];
  garage: {x0: number; x1: number; y0: number; y1: number; ffl: number};
}

var X0 = 0, X1 = 40;
var DRIVE_X = 11;             // where the driveway centreline crosses the kerb
var DRIVE_HALF = 1.5;         // half the driveway width
var TURN_R = 8;               // centreline radius of the bend into the garage
var V_CROWN = -5, V_FAR = -9, V_LIP = -1, V_INVERT = -0.6, V_KERB_FRONT = -0.55, V_KERB_BACK = -0.4;
var V_PATH_NEAR = 1.2, V_PATH_FAR = 2.4, V_BOUNDARY = 4;
var GARAGE_Y0 = 27, GARAGE_Y1 = 33, GARAGE_HALF = 3;
var LAY = {x0: 9, x1: 13, splay: 0.9, lipMm: 30, riseMm: 70, runMm: 450};

export function sampleBend(x: number){ return 0.012 * (x - 27) * (x - 27); }
function bendSlope(x: number){ return 0.024 * (x - 27); }
function vOf(x: number, y: number){ return y - sampleBend(x); }

function trend(x: number){ return -0.015 * (x - 20); } // street falls east
function crown(x: number){ return 42.0 + trend(x); }
function roadAt(x: number, v: number){ return crown(x) - 0.03 * Math.abs(v - V_CROWN); }
function lipAt(x: number){ return roadAt(x, V_LIP); }
function invertAt(x: number){ return lipAt(x) - 0.04; }
// 1 across the layback opening, 0 at full kerb, linear through the splays.
function layW(x: number){
  if (x >= LAY.x0 && x <= LAY.x1) return 1;
  var d = x < LAY.x0 ? LAY.x0 - x : x - LAY.x1;
  return Math.max(0, 1 - d / LAY.splay);
}
function lerp(a: number, b: number, t: number){ return a + (b - a) * t; }
function kerbFrontAt(x: number){ return invertAt(x) + lerp(0.15, LAY.lipMm / 1000, layW(x)); }
// Back of kerb: 150mm behind the face on a barrier kerb; on the layback, the
// top of the rise, 450mm from the invert (layback lip + 70mm).
function kerbBackV(x: number){ return lerp(V_KERB_BACK, V_INVERT + LAY.runMm / 1000, layW(x)); }
function kerbBackAt(x: number){ return invertAt(x) + lerp(0.145, (LAY.lipMm + LAY.riseMm) / 1000, layW(x)); }
// Verge: 2.5% up from a barrier kerb's back; across the layback, a straight
// grade from the layback's back up to the normal verge level at the boundary.
function vergeAt(x: number, v: number){
  var normal = invertAt(x) + 0.145 + 0.025 * (v - V_KERB_BACK);
  var w = layW(x);
  if (w <= 0) return normal;
  var vb = kerbBackV(x), zb = kerbBackAt(x);
  var zBoundary = invertAt(x) + 0.145 + 0.025 * (V_BOUNDARY - V_KERB_BACK);
  return lerp(normal, zb + (zBoundary - zb) * (v - vb) / (V_BOUNDARY - vb), w);
}
function smooth(t: number){ t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
// Natural surface behind the boundary (d metres in): a front bank (1.8m
// over 6m), then 8% up to the house, then nearly flat; the lot also falls
// 3% to the east, with a gentle undulation. Both fade in from the boundary
// so the lot meets the verge cleanly.
function naturalAt(x: number, y: number){
  var d = vOf(x, y) - V_BOUNDARY;
  var base = vergeAt(x, V_BOUNDARY)
    + 1.8 * smooth(d / 6)
    + 0.08 * Math.max(0, Math.min(d - 6, 14))
    + 0.02 * Math.max(0, d - 20);
  var lotFall = -0.03 * (x - 20) * smooth(d / 6);
  return base + lotFall + 0.12 * Math.sin(0.45 * x) * Math.cos(0.35 * y) * smooth((d - 1) / 3);
}
// Deterministic jitter in [-0.5, 0.5).
function jitter(i: number, j: number, k: number){
  var s = Math.sin(i * 12.9898 + j * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}
function r3(v: number){ return Math.round(v * 1000) / 1000; }

// Driveway centreline: from the road crown, square to the kerb at
// x = DRIVE_X, to 2m inside the boundary; then a left-hand arc (TURN_R)
// until it heads due north; then straight north to 1m inside the garage.
function driveCentreline(): Point2[] {
  var m = bendSlope(DRIVE_X), len = Math.hypot(1, m);
  var n = {x: -m / len, y: 1 / len};                    // square to the kerb, into the lot
  var k = {x: DRIVE_X, y: V_INVERT + sampleBend(DRIVE_X)};
  var s = {x: k.x + (V_CROWN - V_INVERT) * n.x, y: k.y + (V_CROWN - V_INVERT) * n.y};
  var c = {x: k.x + (V_BOUNDARY - V_INVERT + 2) * n.x, y: k.y + (V_BOUNDARY - V_INVERT + 2) * n.y};
  var pts: Point2[] = [s, c];
  var phi0 = Math.atan2(n.y, n.x), phi1 = Math.PI / 2;
  var o = {x: c.x - TURN_R * Math.sin(phi0), y: c.y + TURN_R * Math.cos(phi0)};
  var steps = Math.max(2, Math.ceil((phi1 - phi0) / (3 * Math.PI / 180)));
  for (var i = 1; i <= steps; i++){
    var phi = phi0 + (phi1 - phi0) * i / steps;
    pts.push({x: o.x + TURN_R * Math.sin(phi), y: o.y - TURN_R * Math.cos(phi)});
  }
  var d = pts[pts.length - 1];
  pts.push({x: d.x, y: GARAGE_Y0 + 1});
  return pts;
}
// Offset a polyline sideways (+ = left) using each vertex's averaged normal.
function offsetPolyline(pts: Point2[], off: number): Point2[] {
  return pts.map(function(p, i){
    var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    var tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty);
    return {x: r3(p.x - off * ty / tl), y: r3(p.y + off * tx / tl)};
  });
}
function cumulative(pts: Point2[]): number[] {
  var c = [0];
  for (var i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return c;
}
function pointAt(pts: Point2[], cum: number[], ch: number): Point2 {
  var i = 0;
  while (i < cum.length - 2 && cum[i + 1] < ch) i++;
  var f = cum[i + 1] > cum[i] ? (ch - cum[i]) / (cum[i + 1] - cum[i]) : 0;
  return {x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f};
}
// First chainage along the polyline where test(point) turns true (to 1mm).
function chainageWhere(pts: Point2[], cum: number[], test: (p: Point2) => boolean): number {
  var total = cum[cum.length - 1];
  for (var ch = 0; ch <= total; ch += 0.001) if (test(pointAt(pts, cum, ch))) return ch;
  return total;
}

export function buildSampleSite(): SampleSite {
  var points: Point3[] = [];
  var breaklines: Breakline[] = [];
  function pt(x: number, y: number, z: number, layer: string){ points.push({x: r3(x), y: r3(y), z: r3(z), layer: layer}); }
  // Strings along the street: a vertex every 1m (≤3mm off the true curve)
  // plus at the layback's splay ends.
  var xs: number[] = [];
  for (var gx = X0; gx <= X1 + 1e-9; gx += 1) xs.push(gx);
  [LAY.x0 - LAY.splay, LAY.x1 + LAY.splay].forEach(function(v){ if (xs.indexOf(v) < 0) xs.push(v); });
  xs.sort(function(a, b){ return a - b; });
  function line(layer: string, v: number | ((x: number) => number), zf: (x: number) => number){
    var verts: Point3[] = [];
    for (var xi = 0; xi < xs.length; xi++){
      var x = xs[xi];
      var vv = typeof v === 'number' ? v : v(x);
      var p = {x: r3(x), y: r3(vv + sampleBend(x)), z: r3(zf(x))};
      verts.push(p);
      if (xi % 2 === 0 || layW(x) > 0) pt(p.x, p.y, p.z, layer);
    }
    breaklines.push({layer: layer, vertices: verts});
  }

  // Road: far edge and two mid lines as shots; the crown is a ridge string.
  for (var x = X0; x <= X1 + 1e-9; x += 2){
    pt(x, V_FAR + sampleBend(x), roadAt(x, V_FAR), 'ROAD');
    pt(x + 1, -7 + sampleBend(x + 1), roadAt(x + 1, -7), 'ROAD');
    pt(x + 1, -3 + sampleBend(x + 1), roadAt(x + 1, -3), 'ROAD');
  }
  line('ROAD_CROWN', V_CROWN, crown);
  line('KERB_LIP', V_LIP, lipAt);
  line('KERB_INVERT', V_INVERT, invertAt);
  line('KERB_TOP', V_KERB_FRONT, kerbFrontAt);
  line('KERB_BACK', kerbBackV, kerbBackAt);
  line('FOOTPATH', V_PATH_NEAR, function(x){ return vergeAt(x, V_PATH_NEAR); });
  line('FOOTPATH', V_PATH_FAR, function(x){ return vergeAt(x, V_PATH_FAR); });
  for (var vx = X0; vx <= X1 + 1e-9; vx += 2){
    pt(vx + 1, 0.4 + sampleBend(vx + 1), vergeAt(vx + 1, 0.4), 'VERGE');
    pt(vx + 1, 3.3 + sampleBend(vx + 1), vergeAt(vx + 1, 3.3), 'VERGE');
    pt(vx, V_BOUNDARY + sampleBend(vx), vergeAt(vx, V_BOUNDARY), 'VERGE');
  }

  // Driveway and garage position.
  var centre = driveCentreline();
  var gx0 = r3(centre[centre.length - 1].x - GARAGE_HALF), gx1 = r3(centre[centre.length - 1].x + GARAGE_HALF);
  var ffl = r3(naturalAt(centre[centre.length - 1].x, GARAGE_Y0) + 0.15); // floor ~150mm above natural ground

  // Natural surface: jittered 1.6m grid behind the boundary, clear of the slab.
  var step = 1.6;
  for (var i = 0; X0 + i * step <= X1 + 1e-9; i++){
    for (var j = 0; j * step <= 39 + 1e-9; j++){
      var nx = X0 + i * step + (i > 0 && X0 + i * step < X1 ? 0.5 * jitter(i, j, 1) : 0);
      var ny = j * step + 0.5 * jitter(i, j, 2);
      if (vOf(nx, ny) < V_BOUNDARY + 0.8) continue;
      if (nx > gx0 - 0.3 && nx < gx1 + 0.3 && ny > GARAGE_Y0 - 0.3 && ny < GARAGE_Y1 + 0.3) continue;
      pt(nx, ny, naturalAt(nx, ny), 'NATURAL SURFACE');
    }
  }

  // Garage slab: a flat floor at FFL, edges as a closed breakline.
  var slab: Point3[] = [
    {x: gx0, y: GARAGE_Y0, z: ffl}, {x: gx1, y: GARAGE_Y0, z: ffl},
    {x: gx1, y: GARAGE_Y1, z: ffl}, {x: gx0, y: GARAGE_Y1, z: ffl}, {x: gx0, y: GARAGE_Y0, z: ffl}
  ];
  for (var s = 0; s < 4; s++) pt(slab[s].x, slab[s].y, ffl, 'GARAGE SLAB');
  pt((gx0 + gx1) / 2, (GARAGE_Y0 + GARAGE_Y1) / 2, ffl, 'GARAGE SLAB');
  breaklines.push({layer: 'GARAGE SLAB', vertices: slab});

  var west = offsetPolyline(centre, DRIVE_HALF), east = offsetPolyline(centre, -DRIVE_HALF);
  var alignments: SampleAlignment[] = [
    {label: 'Driveway west edge', vertices: west, design: designAlong(west, ffl)},
    {label: 'Driveway east edge', vertices: east, design: designAlong(east, ffl)}
  ];
  return {points: points, breaklines: breaklines, alignments: alignments,
    garage: {x0: gx0, x1: gx1, y0: GARAGE_Y0, y1: GARAGE_Y1, ffl: ffl}};
}

// The design along one edge alignment: kerb and layback matching the
// surveyed layback where the edge crosses the kerb (same template as the
// UI's defaults: road side 25mm over 450mm, property side 70mm over
// 450mm), 4% up the verge with 2% across the 1.2m concrete footpath (AS/NZS
// 2890.1:2004 Cl 3.3(d): 2.5% max over at least 1m) to the boundary, a 2m transition at 10%,
// the main grade, then 2m at 8% and 0.5m at 1% onto the garage floor.
function designAlong(verts: Point2[], ffl: number): SampleDesign {
  var cum = cumulative(verts);
  var kerbCh = chainageWhere(verts, cum, function(p){ return vOf(p.x, p.y) >= V_INVERT; });
  var chBoundary = chainageWhere(verts, cum, function(p){ return vOf(p.x, p.y) >= V_BOUNDARY; });
  var chPathNear = chainageWhere(verts, cum, function(p){ return vOf(p.x, p.y) >= V_PATH_NEAR; });
  var chPathFar = chainageWhere(verts, cum, function(p){ return vOf(p.x, p.y) >= V_PATH_FAR; });
  var chGarage = chainageWhere(verts, cum, function(p){ return p.y >= GARAGE_Y0; });
  var ki = invertAt(pointAt(verts, cum, kerbCh).x), reveal = LAY.lipMm;
  var pvis: Pvi[] = [
    {chainage: kerbCh - 0.45, rl: ki + 0.025, template: 'layback'},
    {chainage: kerbCh, rl: ki, template: 'kerb'},
    {chainage: kerbCh, rl: ki + reveal / 1000, template: 'kerb'},
    {chainage: kerbCh + LAY.runMm / 1000, rl: ki + reveal / 1000 + LAY.riseMm / 1000, template: 'layback'}
  ];
  function next(chainage: number, grade: number){
    var last = pvis[pvis.length - 1];
    pvis.push({chainage: chainage, rl: last.rl + grade * (chainage - last.chainage)});
  }
  next(chPathNear, 0.04);               // verge, under the 5% property-line limit
  next(chPathFar, 0.02);                // across the concrete footpath: 2.5% max over 1m+ (2004 Cl 3.3(d))
  next(chBoundary, 0.04);               // verge to the property line
  next(chBoundary + 2, 0.10);           // transition onto the bank
  var chMainEnd = chGarage - 2.5, chTop = chGarage - 0.5;
  var rlTopNeeded = ffl - 0.01 * (chGarage - chTop);
  var rlMainEnd = rlTopNeeded - 0.08 * (chTop - chMainEnd);
  var lastPvi = pvis[pvis.length - 1];
  next(chMainEnd, (rlMainEnd - lastPvi.rl) / (chMainEnd - lastPvi.chainage));
  next(chTop, 0.08);                    // transition off the bank
  next(chGarage, 0.01);                 // into the garage
  pvis.push({chainage: cum[cum.length - 1], rl: ffl});
  pvis.forEach(function(p){ p.chainage = r3(p.chainage); p.rl = r3(p.rl); });
  pvis[pvis.length - 2].rl = ffl;       // land exactly on the floor level after rounding
  return {pvis: pvis, kerbChainage: r3(kerbCh), kerbInvertRl: r3(ki), revealMm: reveal, garageFfl: ffl};
}
