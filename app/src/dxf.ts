// DXF parsing (ASCII DXF only) — PLAN.md Stage 2 checkpoint 3 port,
// extracted verbatim from main.js. Pure functions: no `state`, no DOM.
// Only parseDXFFile/pickAlignmentCandidates/buildAlignmentEntries are
// used outside this module; the rest are internal parsing steps.
import type { Point2, Point3, DxfPolyline, DxfGeometry, RawAlignment, PointLayer } from './types.ts';

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

function dxfLwpolylineVerts(entity: DxfEntity): Point2[] {
  var verts: Point2[] = [], pending: Point2 | null = null;
  for (var i=0;i<entity.codes.length;i++){
    var c = entity.codes[i];
    if (c.code === 10){ pending = {x: parseFloat(c.val), y: 0}; }
    else if (c.code === 20 && pending){ pending.y = parseFloat(c.val); verts.push(pending); pending = null; }
  }
  return verts;
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

function extractDXFGeometry(entities: DxfEntity[]): DxfGeometry {
  var points: Point3[] = [];
  var polylines: DxfPolyline[] = [];
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

    } else if (e.type === 'LWPOLYLINE'){
      var verts2d = dxfLwpolylineVerts(e);
      var elevRaw = dxfGet(e,38);
      var elev = elevRaw!==undefined ? parseFloat(elevRaw) : 0;
      if (isNaN(elev)) elev = 0;
      var plLayer = dxfGet(e,8); if (plLayer===undefined) plLayer = '0';
      var verts = verts2d.map(function(v){ return {x:v.x, y:v.y, z:elev, layer:plLayer}; });
      if (verts.length >= 2) polylines.push({vertices:verts, flat: Math.abs(elev) < 1e-9, layer:plLayer});

    } else if (e.type === 'POLYLINE'){
      var verts3: Point3[] = [];
      var polyLayer = dxfGet(e,8); if (polyLayer===undefined) polyLayer = '0';
      var j = i+1;
      while (j<entities.length && entities[j].type==='VERTEX'){
        var ve = entities[j];
        var vx = parseFloat(dxfGet(ve,10)), vy = parseFloat(dxfGet(ve,20));
        var vzRaw = dxfGet(ve,30);
        var vz = vzRaw!==undefined ? parseFloat(vzRaw) : 0;
        if (!isNaN(vx) && !isNaN(vy)) verts3.push({x:vx, y:vy, z:isNaN(vz)?0:vz, layer:polyLayer});
        j++;
      }
      i = j - 1; // consume VERTEX (and stop before SEQEND, the outer loop's i++ will skip it)
      if (verts3.length >= 2){
        var anyNonZero = false;
        for (var k=0;k<verts3.length;k++){ if (Math.abs(verts3[k].z) > 1e-9) { anyNonZero = true; break; } }
        polylines.push({vertices: verts3, flat: !anyNonZero, layer:polyLayer});
      }
    }
  }
  return {points: dedupeExactPoints(points), polylines: polylines, faceCount: faceCount};
}

// Per-layer point counts, sorted by name — feeds both a fresh DXF load's
// layer-filter checklist (main.ts) and a reloaded project file's (jobs.ts),
// so the two never compute this breakdown two different ways.
export function computeLayerBreakdown(points: Point3[]): PointLayer[] {
  var layerCounts: Record<string, number> = {};
  for (var i=0;i<points.length;i++){
    var ly = points[i].layer || '0';
    layerCounts[ly] = (layerCounts[ly]||0) + 1;
  }
  return Object.keys(layerCounts).sort().map(function(name){ return {layer:name, count:layerCounts[name]}; });
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
