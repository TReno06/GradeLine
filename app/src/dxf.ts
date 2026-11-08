// DXF parsing (ASCII DXF only) — PLAN.md Stage 2 checkpoint 3 port,
// extracted verbatim from main.js. Pure functions: no `state`, no DOM.
// Only parseDXFFile/pickAlignmentCandidates/buildAlignmentEntries (plus
// expandBulgedPolyline, for its tests) are used outside this module; the
// rest are internal parsing steps.
import type { Point2, Point3, DxfPolyline, DxfGeometry, RawAlignment, PointLayer, Breakline, OffsiteLayer } from './types.ts';
import { arcBreakline } from './geometry/breaklines.ts';
import type { ArcSpec } from './geometry/breaklines.ts';

interface DxfPair { code: number; val: string; }
interface DxfEntity { type: string; codes: DxfPair[]; }

function polyLength(verts: Point2[]): number {
  var len = 0;
  for (var i=1;i<verts.length;i++){
    var dx = verts[i].x-verts[i-1].x, dy = verts[i].y-verts[i-1].y;
    len += Math.sqrt(dx*dx+dy*dy);
  }
  return len;
}

// Parse the raw code/value pairs of an ASCII DXF file.
function dxfPairs(text: string): DxfPair[] {
  text = text.replace(/^﻿/, '');
  var lines = text.split(/\r\n|\n|\r/);
  var pairs: DxfPair[] = [];
  for (var i=0;i+1<lines.length;i+=2){
    var codeStr = lines[i].trim();
    if (codeStr === '') continue;
    var code = parseInt(codeStr, 10);
    if (isNaN(code)) continue;
    pairs.push({code:code, val:(lines[i+1]||'').replace(/\r$/,'').trim()});
  }
  return pairs;
}

// Restrict to the ENTITIES section if one is clearly marked; otherwise use everything
// (handles minimal/non-standard DXF exports that skip the section table).
function dxfEntitiesSectionPairs(pairs: DxfPair[]): DxfPair[] {
  var start = -1, end = pairs.length;
  for (var i=0;i<pairs.length;i++){
    if (pairs[i].code===2 && pairs[i].val==='ENTITIES' && i>0 && pairs[i-1].code===0 && pairs[i-1].val==='SECTION'){
      start = i+1;
    } else if (start>=0 && pairs[i].code===0 && pairs[i].val==='ENDSEC'){
      end = i; break;
    }
  }
  if (start < 0) return pairs;
  return pairs.slice(start, end);
}

// Group flat code/value pairs into entities split on code-0 markers.
function dxfEntities(pairs: DxfPair[]): DxfEntity[] {
  var entities: DxfEntity[] = [];
  var cur: DxfEntity | null = null;
  for (var i=0;i<pairs.length;i++){
    var pr = pairs[i];
    if (pr.code === 0){
      if (cur) entities.push(cur);
      cur = {type: pr.val, codes: []};
    } else if (cur){
      cur.codes.push(pr);
    }
  }
  if (cur) entities.push(cur);
  return entities;
}

function dxfGet(entity: DxfEntity, code: number): string | undefined {
  for (var i=0;i<entity.codes.length;i++){ if (entity.codes[i].code===code) return entity.codes[i].val; }
  return undefined;
}

interface BulgeVertex { x: number; y: number; z: number; bulge: number; }

function dxfLwpolylineVerts(entity: DxfEntity): BulgeVertex[] {
  var verts: BulgeVertex[] = [], pending: BulgeVertex | null = null;
  for (var i=0;i<entity.codes.length;i++){
    var c = entity.codes[i];
    if (c.code === 10){ pending = {x: parseFloat(c.val), y: 0, z: 0, bulge: 0}; }
    else if (c.code === 20 && pending){ pending.y = parseFloat(c.val); verts.push(pending); pending = null; }
    // A vertex's bulge (42) follows its own 10/20 pair and describes the
    // arc from that vertex to the next one.
    else if (c.code === 42 && verts.length){ var b = parseFloat(c.val); verts[verts.length-1].bulge = isFinite(b) ? b : 0; }
  }
  return verts;
}

function isClosedPolyline(entity: DxfEntity): boolean {
  var flags = parseInt(dxfGet(entity, 70) || '0', 10);
  return isFinite(flags) && (flags & 1) === 1;
}

// Expands a DXF polyline's vertex list into plain straight-segment
// vertices: every non-zero bulge (an arc, as drawn by AutoCAD/Civil3D
// fillets at alignment corners) is tessellated into short chords, and a
// closed polyline gets its closing segment back to the first vertex.
// Before this, bulges were ignored outright — a filleted corner came in
// as a single straight chord cutting the corner off, shortening the
// alignment's real chainage and visibly breaking the 3D line at every
// curved corner. Bulge b = tan(theta/4), theta the arc's included angle,
// positive = counter-clockwise from this vertex to the next. Chords are
// sized so the arc is never more than 5mm off (and never more than 2
// degrees per chord), which keeps chainage accurate to well under a
// millimetre per metre of arc. Z is carried linearly along each segment.
export function expandBulgedPolyline(verts: BulgeVertex[], closed: boolean): Point3[] {
  var out: Point3[] = [];
  var n = verts.length;
  if (!n) return out;
  var segCount = closed ? n : n-1;
  out.push({x:verts[0].x, y:verts[0].y, z:verts[0].z});
  for (var i=0;i<segCount;i++){
    var a = verts[i], b = verts[(i+1)%n];
    var bulge = a.bulge || 0;
    var dx = b.x-a.x, dy = b.y-a.y;
    var chord = Math.sqrt(dx*dx+dy*dy);
    if (Math.abs(bulge) > 1e-9 && chord > 1e-9){
      var theta = 4*Math.atan(bulge);              // signed included angle
      var radius = chord / (2*Math.abs(Math.sin(theta/2)));
      // Centre sits on the chord's perpendicular bisector, on the left
      // of a->b for a counter-clockwise (positive) bulge.
      var off = (chord/2) * (1 - bulge*bulge) / (2*bulge);
      var nx = -dy/chord, ny = dx/chord;
      var cx = (a.x+b.x)/2 + nx*off, cy = (a.y+b.y)/2 + ny*off;
      var a0 = Math.atan2(a.y-cy, a.x-cx);
      var maxStep = 2*Math.PI/180;
      var tolStep = radius > 0.005 ? 2*Math.acos(1 - 0.005/radius) : maxStep;
      var step = Math.min(maxStep, tolStep);
      var pieces = Math.min(720, Math.max(1, Math.ceil(Math.abs(theta)/step)));
      for (var k=1;k<pieces;k++){
        var t = k/pieces;
        var ang = a0 + theta*t;
        out.push({x: cx + radius*Math.cos(ang), y: cy + radius*Math.sin(ang), z: a.z + (b.z-a.z)*t});
      }
    }
    out.push({x:b.x, y:b.y, z:b.z});
  }
  return out;
}

// Walks entities, pulling out POINT entities and LWPOLYLINE/POLYLINE (+VERTEX) chains.
// Returns {points:[{x,y,z}], polylines:[{vertices:[{x,y,z}], flat:bool}]}
// Some surveys export a 3D-face mesh instead of discrete POINT entities.
// Adjacent faces typically share exact corner vertices, which would
// otherwise get added to the TIN input multiple times — dedupe points
// that coincide in X,Y,Z (within a tight epsilon) before triangulating.
function dedupeExactPoints(points: Point3[]): Point3[] {
  var seen: Record<string, boolean> = {};
  var out: Point3[] = [];
  for (var i=0;i<points.length;i++){
    var p = points[i];
    var key = p.x.toFixed(6)+'_'+p.y.toFixed(6)+'_'+p.z.toFixed(6);
    if (seen[key]) continue;
    seen[key] = true;
    out.push(p);
  }
  return out;
}

function dxfNum(e: DxfEntity, code: number, fallback: number): number {
  var raw = dxfGet(e, code);
  if (raw === undefined) return fallback;
  var v = parseFloat(raw);
  return isNaN(v) ? NaN : v;
}

function extractDXFGeometry(entities: DxfEntity[]): DxfGeometry {
  var points: Point3[] = [];
  var polylines: DxfPolyline[] = [];
  var breaklines: Breakline[] = [];
  var arcs: {spec: ArcSpec; layer: string}[] = [];
  var faceCount = 0;

  for (var i=0;i<entities.length;i++){
    var e = entities[i];

    if (e.type === 'POINT'){
      var px = parseFloat(dxfGet(e,10)), py = parseFloat(dxfGet(e,20));
      var pzRaw = dxfGet(e,30);
      var pz = pzRaw!==undefined ? parseFloat(pzRaw) : 0;
      var player = dxfGet(e,8); if (player===undefined) player = '0';
      if (!isNaN(px) && !isNaN(py) && !isNaN(pz)) points.push({x:px, y:py, z:pz, layer:player, source:'point'});

    } else if (e.type === '3DFACE'){
      // Four corners at group codes 10/20/30, 11/21/31, 12/22/32, 13/23/33.
      // Triangular faces commonly repeat the 3rd corner as the 4th.
      var fLayer = dxfGet(e,8); if (fLayer===undefined) fLayer = '0';
      var cornerCodes = [[10,20,30],[11,21,31],[12,22,32],[13,23,33]];
      var faceCorners: Point3[] = [];
      for (var cc=0; cc<cornerCodes.length; cc++){
        var cxRaw = dxfGet(e, cornerCodes[cc][0]);
        if (cxRaw === undefined) continue;
        var cX = parseFloat(cxRaw), cY = parseFloat(dxfGet(e, cornerCodes[cc][1]));
        var cZraw = dxfGet(e, cornerCodes[cc][2]);
        var cZ = cZraw!==undefined ? parseFloat(cZraw) : 0;
        if (!isNaN(cX) && !isNaN(cY) && !isNaN(cZ)) faceCorners.push({x:cX, y:cY, z:cZ});
      }
      var uniqueCorners: Point3[] = [];
      for (var uc=0; uc<faceCorners.length; uc++){
        var isDup = false;
        for (var uc2=0; uc2<uniqueCorners.length; uc2++){
          if (Math.abs(faceCorners[uc].x-uniqueCorners[uc2].x)<1e-9 &&
              Math.abs(faceCorners[uc].y-uniqueCorners[uc2].y)<1e-9 &&
              Math.abs(faceCorners[uc].z-uniqueCorners[uc2].z)<1e-9){ isDup = true; break; }
        }
        if (!isDup) uniqueCorners.push(faceCorners[uc]);
      }
      if (uniqueCorners.length >= 3){
        faceCount++;
        for (var fp=0; fp<uniqueCorners.length; fp++){
          points.push({x:uniqueCorners[fp].x, y:uniqueCorners[fp].y, z:uniqueCorners[fp].z, layer:fLayer, source:'3dface'});
        }
      }

    } else if (e.type === 'LINE'){
      // Breakline (2026-11-08): survey strings (kerb top/invert, edge of
      // concrete...) commonly come through as plain 3D LINEs, one per
      // segment, in WCS. Only used if their layer is ticked (pipeline.ts).
      var lLayer = dxfGet(e,8); if (lLayer===undefined) lLayer = '0';
      var l0 = {x: dxfNum(e,10,NaN), y: dxfNum(e,20,NaN), z: dxfNum(e,30,0)};
      var l1 = {x: dxfNum(e,11,NaN), y: dxfNum(e,21,NaN), z: dxfNum(e,31,0)};
      if ([l0.x,l0.y,l0.z,l1.x,l1.y,l1.z].every(isFinite) && (l0.x !== l1.x || l0.y !== l1.y)){
        breaklines.push({layer: lLayer, vertices: [l0, l1]});
      }

    } else if (e.type === 'ARC'){
      // Breakline too, but an ARC has one elevation for its whole length,
      // so its levels come from the surveyed points on it — resolved after
      // this loop, once every POINT is known (arcBreakline).
      var aLayer = dxfGet(e,8); if (aLayer===undefined) aLayer = '0';
      var extZ = dxfNum(e,230,1);
      var spec: ArcSpec = {cx: dxfNum(e,10,NaN), cy: dxfNum(e,20,NaN), z: dxfNum(e,30,0), r: dxfNum(e,40,NaN),
        startDeg: dxfNum(e,50,0), endDeg: dxfNum(e,51,360), mirrorX: extZ < 0};
      // Only arcs drawn flat in plan (extrusion straight up or down) can be strings.
      var extX = dxfNum(e,210,0), extY = dxfNum(e,220,0);
      if ([spec.cx,spec.cy,spec.z,spec.r,spec.startDeg,spec.endDeg].every(isFinite) && spec.r > 0 &&
          Math.abs(extX) < 1e-9 && Math.abs(extY) < 1e-9){
        if (spec.mirrorX) spec.z = -spec.z; // OCS z points down
        arcs.push({spec: spec, layer: aLayer});
      }

    } else if (e.type === 'LWPOLYLINE'){
      var verts2d = dxfLwpolylineVerts(e);
      var elevRaw = dxfGet(e,38);
      var elev = elevRaw!==undefined ? parseFloat(elevRaw) : 0;
      if (isNaN(elev)) elev = 0;
      var plLayer = dxfGet(e,8); if (plLayer===undefined) plLayer = '0';
      for (var lv=0; lv<verts2d.length; lv++) verts2d[lv].z = elev;
      var verts = expandBulgedPolyline(verts2d, isClosedPolyline(e)).map(function(v){ return {x:v.x, y:v.y, z:v.z, layer:plLayer}; });
      if (verts.length >= 2) polylines.push({vertices:verts, flat: Math.abs(elev) < 1e-9, layer:plLayer});

    } else if (e.type === 'POLYLINE'){
      var rawVerts3: BulgeVertex[] = [];
      var polyLayer = dxfGet(e,8); if (polyLayer===undefined) polyLayer = '0';
      var polyClosed = isClosedPolyline(e);
      var j = i+1;
      while (j<entities.length && entities[j].type==='VERTEX'){
        var ve = entities[j];
        var vx = parseFloat(dxfGet(ve,10)), vy = parseFloat(dxfGet(ve,20));
        var vzRaw = dxfGet(ve,30);
        var vz = vzRaw!==undefined ? parseFloat(vzRaw) : 0;
        var vbRaw = dxfGet(ve,42);
        var vb = vbRaw!==undefined ? parseFloat(vbRaw) : 0;
        if (!isNaN(vx) && !isNaN(vy)) rawVerts3.push({x:vx, y:vy, z:isNaN(vz)?0:vz, bulge:isFinite(vb)?vb:0});
        j++;
      }
      i = j - 1; // consume VERTEX (and stop before SEQEND, the outer loop's i++ will skip it)
      var verts3: Point3[] = expandBulgedPolyline(rawVerts3, polyClosed).map(function(v){ return {x:v.x, y:v.y, z:v.z, layer:polyLayer}; });
      if (verts3.length >= 2){
        var anyNonZero = false, varies = false;
        for (var k=0;k<verts3.length;k++){
          if (Math.abs(verts3[k].z) > 1e-9) anyNonZero = true;
          if (Math.abs(verts3[k].z - verts3[0].z) > 1e-9) varies = true;
        }
        polylines.push({vertices: verts3, flat: !anyNonZero, layer:polyLayer});
        // A 3D polyline whose level changes along it is a surveyed string,
        // not a contour (a contour holds one level): also a breakline.
        if (varies) breaklines.push({layer: polyLayer, vertices: verts3.map(function(v){ return {x:v.x, y:v.y, z:v.z}; })});
      }
    }
  }
  if (arcs.length){
    var byLayer: Record<string, Point3[]> = {};
    for (var pi=0; pi<points.length; pi++){
      var pl = points[pi].layer || '0';
      (byLayer[pl] || (byLayer[pl] = [])).push(points[pi]);
    }
    for (var ai=0; ai<arcs.length; ai++){
      var av = arcBreakline(arcs[ai].spec, byLayer[arcs[ai].layer] || []);
      if (av.length >= 2) breaklines.push({layer: arcs[ai].layer, vertices: av});
    }
  }
  return {points: dedupeExactPoints(points), polylines: polylines, faceCount: faceCount, breaklines: breaklines};
}

// Per-layer point counts, sorted by name — feeds both a fresh DXF load's
// layer-filter checklist (main.ts) and a reloaded project file's (jobs.ts),
// so the two never compute this breakdown two different ways.
// Breaklines (2026-11-08) count per layer too, so a layer holding only
// linework still gets a checkbox.
export function computeLayerBreakdown(points: Point3[], breaklines?: Breakline[] | null, anchors?: Point2[] | null): PointLayer[] {
  var layerCounts: Record<string, number> = {};
  var lineCounts: Record<string, number> = {};
  var offsite = findOffsiteLayers(points, breaklines, anchors);
  for (var i=0;i<points.length;i++){
    var ly = points[i].layer || '0';
    layerCounts[ly] = (layerCounts[ly]||0) + 1;
  }
  var bls = breaklines || [];
  for (var b=0;b<bls.length;b++){
    var bl = bls[b].layer || '0';
    lineCounts[bl] = (lineCounts[bl]||0) + 1;
    if (!(bl in layerCounts)) layerCounts[bl] = 0;
  }
  return Object.keys(layerCounts).sort().map(function(name){
    var entry: PointLayer = {layer:name, count:layerCounts[name]};
    if (lineCounts[name]) entry.lines = lineCounts[name];
    if (offsite[name]) entry.offsite = offsite[name];
    return entry;
  });
}

// Layers that sit away from the rest of the survey (2026-11-08). A real job
// had its DTM 3D faces ~51m west of the kerb, boundary,
// contours and alignments — ticking it with the rest stretched the TIN across
// the gap. Title-block layers near (0,0) are the other common case.
//
// Layers are grouped by their plan extents: two layers whose bounding boxes
// come within OFFSITE_GAP of each other are in the same group (and so on,
// transitively). The main group is the one holding the most alignment
// vertices (where the work is), else the one with the most points; every
// layer outside it is reported with its distance and direction from the
// main group's centroid. Only a note for the user — nothing is unticked.
export var OFFSITE_GAP = 5; // metres
export function findOffsiteLayers(points: Point3[], breaklines?: Breakline[] | null, anchors?: Point2[] | null): Record<string, OffsiteLayer> {
  interface Box { name: string; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number; n: number; }
  var boxes: Record<string, Box> = {};
  function add(name: string, x: number, y: number){
    if (!isFinite(x) || !isFinite(y)) return;
    var b = boxes[name] || (boxes[name] = {name: name, x0: x, y0: y, x1: x, y1: y, sx: 0, sy: 0, n: 0});
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
    b.sx += x; b.sy += y; b.n++;
  }
  for (var i=0;i<points.length;i++) add(points[i].layer || '0', points[i].x, points[i].y);
  var bls = breaklines || [];
  for (var b=0;b<bls.length;b++) for (var v=0;v<bls[b].vertices.length;v++) add(bls[b].layer || '0', bls[b].vertices[v].x, bls[b].vertices[v].y);
  var list = Object.keys(boxes).map(function(k){ return boxes[k]; });
  if (list.length < 2) return {};

  var parent = list.map(function(_, k){ return k; });
  function root(k: number): number { while (parent[k] !== k){ parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
  for (var a=0;a<list.length;a++) for (var c=a+1;c<list.length;c++){
    var A = list[a], C = list[c];
    var gx = Math.max(0, A.x0 - C.x1, C.x0 - A.x1), gy = Math.max(0, A.y0 - C.y1, C.y0 - A.y1);
    if (Math.hypot(gx, gy) <= OFFSITE_GAP) parent[root(a)] = root(c);
  }

  interface Group { x0: number; y0: number; x1: number; y1: number; sx: number; sy: number; n: number; hits: number; }
  var groups: Record<number, Group> = {};
  for (var g=0;g<list.length;g++){
    var L = list[g], r = root(g);
    var G = groups[r] || (groups[r] = {x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1, sx: 0, sy: 0, n: 0, hits: 0});
    G.x0 = Math.min(G.x0, L.x0); G.y0 = Math.min(G.y0, L.y0); G.x1 = Math.max(G.x1, L.x1); G.y1 = Math.max(G.y1, L.y1);
    G.sx += L.sx; G.sy += L.sy; G.n += L.n;
  }
  var keys = Object.keys(groups).map(Number);
  if (keys.length < 2) return {};
  var an = anchors || [];
  for (var q=0;q<an.length;q++) for (var t=0;t<keys.length;t++){
    var H = groups[keys[t]];
    if (an[q].x >= H.x0 - OFFSITE_GAP && an[q].x <= H.x1 + OFFSITE_GAP && an[q].y >= H.y0 - OFFSITE_GAP && an[q].y <= H.y1 + OFFSITE_GAP) H.hits++;
  }
  var main = keys[0];
  for (var m=1;m<keys.length;m++){
    var M = groups[keys[m]], B = groups[main];
    if (M.hits > B.hits || (M.hits === B.hits && M.n > B.n)) main = keys[m];
  }
  var mx = groups[main].sx / groups[main].n, my = groups[main].sy / groups[main].n;
  var DIRS = ['E','NE','N','NW','W','SW','S','SE'];
  var out: Record<string, OffsiteLayer> = {};
  for (var o=0;o<list.length;o++){
    if (root(o) === main) continue;
    var dx = list[o].sx / list[o].n - mx, dy = list[o].sy / list[o].n - my;
    var octant = ((Math.round(Math.atan2(dy, dx) / (Math.PI/4)) % 8) + 8) % 8;
    out[list[o].name] = {distance: Math.hypot(dx, dy), direction: DIRS[octant]};
  }
  return out;
}

// "~51m W" / "~6,250km SW" — a rough figure, it only has to say how far off.
export function describeOffsite(o: OffsiteLayer): string {
  var d = o.distance;
  var txt = d >= 1000 ? Math.round(d/1000).toLocaleString('en-AU') + 'km'
          : (d >= 100 ? String(Math.round(d/10)*10) : String(Math.round(d))) + 'm';
  return '~' + txt + ' ' + o.direction;
}

export function parseDXFFile(text: string): DxfGeometry {
  var pairs = dxfEntitiesSectionPairs(dxfPairs(text));
  var entities = dxfEntities(pairs);
  return extractDXFGeometry(entities);
}

// Among the flat (zero-elevation) DXF polylines, prefer ones on a layer
// whose name looks like "alignment" (survey convention) — typically there
// are one or two of these. Falls back to treating every flat polyline as
// a candidate if none match, so files without that layer naming still work.
export function pickAlignmentCandidates(flatPolylines: DxfPolyline[]): DxfPolyline[] {
  if (!flatPolylines.length) return [];
  var layerMatches = flatPolylines.filter(function(p){ return /align/i.test(p.layer||''); });
  return layerMatches.length ? layerMatches : flatPolylines;
}

// Turns raw candidate polylines into labeled, selectable alignment entries
// — grouped by layer, longest-first within a layer, disambiguated with
// "#1"/"#2" when a layer has more than one.
export function buildAlignmentEntries(candidates: DxfPolyline[]): RawAlignment[] {
  var byLayer: Record<string, DxfPolyline[]> = {};
  for (var i=0;i<candidates.length;i++){
    var ly = candidates[i].layer || '0';
    if (!byLayer[ly]) byLayer[ly] = [];
    byLayer[ly].push(candidates[i]);
  }
  var entries: RawAlignment[] = [];
  var layerNames = Object.keys(byLayer).sort();
  for (var li=0; li<layerNames.length; li++){
    var ly2 = layerNames[li];
    var list = byLayer[ly2];
    list.sort(function(a,b){ return polyLength(b.vertices)-polyLength(a.vertices); });
    for (var idx=0; idx<list.length; idx++){
      var c = list[idx];
      var label = ly2 + (list.length>1 ? (' #'+(idx+1)) : '');
      label += ' — ' + c.vertices.length + ' pts, ' + polyLength(c.vertices).toFixed(1) + 'm';
      entries.push({
        label: label,
        layer: ly2,
        vertices: c.vertices.map(function(v){ return {x:v.x, y:v.y}; })
      });
    }
  }
  return entries;
}
