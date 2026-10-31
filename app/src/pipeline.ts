// Pipeline: recompute everything after data changes — PLAN.md Stage 2
// checkpoint 3 port, extracted verbatim from main.js.
import { $, escapeHtml } from './dom.ts';
import { state, drivewayStateFor } from './state.ts';
import { buildTriIndex } from './geometry/tin.ts';
import { triangulateAsync, cancelTriangulation } from './triangulation.ts';
import { setTriIndex, clearTriIndex, resetProfileView, recomputeProfileData, setProfileData, profileData } from './longsection.ts';
import { rampCSSGradient } from './colorramp.ts';
import { three, clearGroup, rebuildTerrainMesh, hidePointInspector } from './view3d.ts';
import { runDiagnostics } from './diagnostics.ts';
import { drawProfile } from './rendering.ts';
import { is3DVisible, isProfileVisible } from './viewstate.ts';
import { renderDrivewayUI } from './driveway.ts';
import type { Point3, Point2, Triangle } from './types.ts';

interface CancelledError extends Error { cancelled?: boolean; }

// Bumped on every rebuildAll() call; a triangulateAsync() result is
// only applied if this hasn't moved on since — i.e. no newer rebuild
// (a filter toggle, a new file, clearAllData) has superseded it. This
// is what makes a stale/slow response harmless rather than a race.
var rebuildGeneration = 0;

// The point set (flattened x,y,z, in order) and triangles from the last
// triangulation that finished. Switching alignment — or a filter toggle
// that excludes nothing new — rebuilds with exactly the same points, so
// rebuildAll() reuses these triangles instead of re-triangulating, and
// skips re-running diagnostics (which depend only on points+triangles).
// Compared coordinate-by-coordinate, never hashed, so a match is exact.
var lastSurface: { coords: Float64Array; triangles: Triangle[] } | null = null;

function flattenPoints(points: Point3[]): Float64Array {
  var out = new Float64Array(points.length * 3);
  for (var i=0;i<points.length;i++){
    out[i*3] = points[i].x; out[i*3+1] = points[i].y; out[i*3+2] = points[i].z;
  }
  return out;
}

function sameCoords(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (var i=0;i<a.length;i++) if (a[i] !== b[i]) return false;
  return true;
}

// Triangulates off the main thread (see ./triangulation.js) and
// continues the rest of the rebuild once it resolves. Every caller of
// rebuildFromRaw()/rebuildAll() already treats it as fire-and-forget
// (none read a return value or assume synchronous completion — checked
// before this change), so becoming async needed no changes at any
// call site. myGeneration guards against a slow/queued request from an
// earlier call landing AFTER a newer one already finished — e.g. two
// filter toggles in quick succession — by simply discarding it rather
// than letting it clobber newer state.
export function rebuildAll(){
  if (!state.points.length) return;
  var myGeneration = ++rebuildGeneration;
  var coords = flattenPoints(state.points);

  $('empty-state').style.display = 'none';
  if (lastSurface && sameCoords(coords, lastSurface.coords)){
    // Supersedes any in-flight triangulation too, via the generation bump above.
    $('triangulating-overlay').style.display = 'none';
    finishRebuildAll(lastSurface.triangles, true);
    return;
  }
  $('triangulating-count').textContent = String(state.points.length);
  $('triangulating-overlay').style.display = 'flex';

  triangulateAsync(state.points).then(function(triangles){
    if (myGeneration !== rebuildGeneration) return; // superseded — discard
    $('triangulating-overlay').style.display = 'none';
    lastSurface = {coords: coords, triangles: triangles};
    finishRebuildAll(triangles, false);
  }, function(err: CancelledError){
    if (myGeneration !== rebuildGeneration) return;
    $('triangulating-overlay').style.display = 'none';
    if (err && err.cancelled) return; // user hit Cancel — leave the previous surface as-is
    console.error('Triangulation failed:', err);
    alert('Triangulation failed: ' + (err && err.message ? err.message : err));
  });
}

// Cancels an in-flight triangulation outright and invalidates its
// generation so a late result can never land — used by the "Cancel"
// button on the triangulating overlay.
export function handleCancelTriangulation(){
  rebuildGeneration++; // belt-and-braces: also ignore this generation if it somehow still resolves
  cancelTriangulation();
  $('triangulating-overlay').style.display = 'none';
  // rebuildFromRaw() already pointed state.points/polyline at the new
  // (filtered) data before this triangulation started — state.triangles
  // and the triIndex still belong to whatever the last-finished rebuild
  // produced, which is now a different point array. Clear them instead of
  // leaving that stale pairing in place, which would silently mis-index
  // (wrong/garbage elevations, out-of-bounds lookups) anything that reads
  // points and triangles together afterward.
  state.triangles = [];
  clearTriIndex();
  setProfileData(null);
  rebuildTerrainMesh();
  if (isProfileVisible()) drawProfile();
  updateStatsAndLegend();
}

// The rest of the old synchronous rebuildAll(), run once triangles are
// ready (from the worker, or from triangulateAsync's own synchronous
// fallback) — unchanged from before this stage except for no longer
// triangulating itself. `sameSurface` means the points and triangles are
// identical to the last finished rebuild's, so the diagnostics panel
// already shows the right result.
function finishRebuildAll(triangles: Triangle[], sameSurface: boolean){
  state.triangles = triangles;
  setTriIndex(buildTriIndex(state.points, state.triangles));

  var zMin=Infinity, zMax=-Infinity;
  for (var i=0;i<state.points.length;i++){
    if (state.points[i].z<zMin) zMin=state.points[i].z;
    if (state.points[i].z>zMax) zMax=state.points[i].z;
  }
  state.zMin = zMin; state.zMax = zMax;

  hidePointInspector();
  rebuildTerrainMesh();
  resetProfileView();
  recomputeProfileData();
  if (isProfileVisible()) drawProfile();
  updateStatsAndLegend();
  if (!sameSurface) runDiagnostics();
  $('empty-state').style.display = 'none';
}

export function updateStatsAndLegend(){
  $('section-stats').style.display = 'block';
  $('stat-points').textContent = String(state.points.length);
  $('stat-triangles').textContent = String(state.triangles.length);
  $('stat-elev').textContent = state.zMin.toFixed(2)+' – '+state.zMax.toFixed(2);
  if (profileData){
    $('stat-length').textContent = profileData.total.toFixed(2);
    $('section-export').style.display = 'block';
  } else {
    $('stat-length').textContent = '—';
    $('section-export').style.display = 'none';
  }
  $('section-export-surface').style.display = state.triangles.length ? 'block' : 'none';
  renderDrivewayUI();
  $('legend').style.display = is3DVisible() ? 'block' : 'none';
  $('legend-bar').style.background = rampCSSGradient();
  $('legend-min').textContent = state.zMin.toFixed(2);
  $('legend-max').textContent = state.zMax.toFixed(2);
}

function centerData(points: Point3[], polyline: Point2[] | null){
  var minX=Infinity, minY=Infinity;
  for (var i=0;i<points.length;i++){
    if (points[i].x<minX) minX=points[i].x;
    if (points[i].y<minY) minY=points[i].y;
  }
  if (polyline){
    for (var j=0;j<polyline.length;j++){
      if (polyline[j].x<minX) minX=polyline[j].x;
      if (polyline[j].y<minY) minY=polyline[j].y;
    }
  }
  state.offsetX = minX; state.offsetY = minY;
  for (var k=0;k<points.length;k++){ points[k].x -= minX; points[k].y -= minY; }
  if (polyline){
    for (var m=0;m<polyline.length;m++){ polyline[m].x -= minX; polyline[m].y -= minY; }
  }
}

// ============================================================
// Raw-data pipeline: re-derive state.points/polyline from the last
// loaded (unfiltered, uncentered) data whenever a filter toggle changes,
// without needing to re-upload the file.
// ============================================================
function filterZeroElevation(pts: Point3[]): Point3[] {
  if (!$<HTMLInputElement>('chk-ignore-zero').checked) return pts;
  return pts.filter(function(p){ return p.z !== 0; });
}

// Drops outlier points far from the survey origin — a mismatched grid,
// a stray control point, a digitizing slip — that would otherwise get
// stitched into the main surface by Delaunay triangulation, which has
// no notion of "too far apart" and connects every point regardless.
// Applied on raw (uncentered) coordinates, before centerData runs.
function filterFarPoints(pts: Point3[]): Point3[] {
  if (!$<HTMLInputElement>('chk-ignore-far').checked) return pts;
  var limit = parseFloat($<HTMLInputElement>('far-limit').value);
  if (isNaN(limit) || limit <= 0) return pts;
  return pts.filter(function(p){ return Math.abs(p.x) <= limit && Math.abs(p.y) <= limit; });
}

// Only active once a real DXF layer breakdown has been computed
// (state.activePointLayers is a Set); sample data has no layer info
// and passes straight through.
function filterByLayer(pts: Point3[]): Point3[] {
  if (!state.activePointLayers) return pts;
  return pts.filter(function(p){ return (state.activePointLayers as Set<string>).has(p.layer || '0'); });
}

export function setRawDataAndBuild(rawPoints: Point3[]): boolean {
  state.rawPoints = rawPoints;
  return rebuildFromRaw();
}

export function rebuildFromRaw(): boolean {
  if (!state.rawPoints || !state.rawPoints.length) return false;
  var rawCopy = state.rawPoints.map(function(p){ return {x:p.x, y:p.y, z:p.z, layer:p.layer}; });
  var pts = filterFarPoints(filterZeroElevation(filterByLayer(rawCopy)));

  if (pts.length < 3){
    alert('After filtering, fewer than 3 valid points remain — try unchecking a filter above, re-enabling a point layer, or raising/unchecking the coordinate limit.');
    $('filter-notice').style.display = 'none';
    return false;
  }

  var excluded = state.rawPoints.length - pts.length;
  if (excluded > 0){
    $('filter-notice').textContent = excluded + ' of ' + state.rawPoints.length + ' loaded points excluded by the filters above (' + pts.length + ' used).';
    $('filter-notice').style.display = 'block';
  } else {
    $('filter-notice').style.display = 'none';
  }

  var activeAlign = (state.activeAlignmentIndex >= 0 && state.rawAlignments[state.activeAlignmentIndex])
    ? state.rawAlignments[state.activeAlignmentIndex] : null;
  var poly = activeAlign ? activeAlign.vertices.map(function(v){ return {x:v.x, y:v.y}; }) : null;
  state.points = pts;
  state.polyline = poly;
  centerData(state.points, state.polyline);
  rebuildAll();
  return true;
}

// Clears any DXF-derived point-layer filter state and hides that section
// — called whenever the currently loaded points stop being DXF-sourced
// (the generated sample terrain, or a full clear), since only a real
// DXF load tags points with a layer.
export function resetPointLayerFilter(){
  state.pointLayers = null;
  state.activePointLayers = null;
  renderLayerFilterUI();
}

export function renderLayerFilterUI(){
  var container = $('layer-filter-list');
  if (!state.pointLayers || state.pointLayers.length < 2){
    $('section-layer-filter').style.display = 'none';
    container.innerHTML = '';
    return;
  }
  $('section-layer-filter').style.display = 'block';
  var html = '';
  for (var i=0;i<state.pointLayers.length;i++){
    var l = state.pointLayers[i];
    var checked = state.activePointLayers && state.activePointLayers.has(l.layer) ? 'checked' : '';
    html += '<label class="checkrow layer-row"><input type="checkbox" class="layer-chk" data-layer="' +
      escapeHtml(l.layer) + '" ' + checked + '> ' + escapeHtml(l.layer) +
      '<span class="layer-count">(' + l.count + ')</span></label>';
  }
  container.innerHTML = html;
  var boxes = container.querySelectorAll<HTMLInputElement>('.layer-chk');
  for (var b=0;b<boxes.length;b++){
    boxes[b].addEventListener('change', function(this: HTMLInputElement){
      var ly = this.getAttribute('data-layer') as string;
      if (this.checked) (state.activePointLayers as Set<string>).add(ly); else (state.activePointLayers as Set<string>).delete(ly);
      if (state.rawPoints && state.rawPoints.length) rebuildFromRaw();
    });
  }
}

export function renderAlignmentSelector(){
  var sec = $('section-alignment-select');
  var sel = $<HTMLSelectElement>('select-alignment');
  if (!state.rawAlignments || !state.rawAlignments.length){
    sec.style.display = 'none';
    sel.innerHTML = '';
    renderCrossfallUI();
    return;
  }
  sec.style.display = 'block';
  var html = '';
  for (var i=0;i<state.rawAlignments.length;i++){
    html += '<option value="' + i + '"' + (i===state.activeAlignmentIndex?' selected':'') + '>' +
      escapeHtml(state.rawAlignments[i].label) + '</option>';
  }
  sel.innerHTML = html;
  renderCrossfallUI();
}

// The crossfall view compares two alignments, each with its own fully
// independent driveway design (state.drivewayByAlignment, aliased via
// state.driveway when that alignment is the active one — see the state
// block at the top of this script). This just keeps the two picker
// dropdowns in sync with the current alignment list; it doesn't touch
// state.activeAlignmentIndex or state.driveway itself.
export function renderCrossfallUI(){
  var selA = $<HTMLSelectElement>('xf-align-a'), selB = $<HTMLSelectElement>('xf-align-b');
  var aligns = state.rawAlignments || [];
  if (!selA || !selB) return;
  if (aligns.length < 2){
    selA.innerHTML = ''; selB.innerHTML = '';
    $('xf-no-profile').style.display = 'block';
    $('xf-body').style.display = 'none';
    return;
  }
  if (state.crossfall.alignA >= aligns.length || state.crossfall.alignA < 0) state.crossfall.alignA = 0;
  if (state.crossfall.alignB >= aligns.length || state.crossfall.alignB < 0 || state.crossfall.alignB === state.crossfall.alignA){
    state.crossfall.alignB = (state.crossfall.alignA === 1) ? 0 : 1;
  }
  function optionsHtml(selectedIdx: number){
    var html = '';
    for (var i=0;i<aligns.length;i++){
      html += '<option value="' + i + '"' + (i===selectedIdx?' selected':'') + '>' +
        escapeHtml(aligns[i].label) + '</option>';
    }
    return html;
  }
  selA.innerHTML = optionsHtml(state.crossfall.alignA);
  selB.innerHTML = optionsHtml(state.crossfall.alignB);
  $<HTMLSelectElement>('xf-projection-mode').value = state.crossfall.projectionMode || 'chainage';
  $('xf-no-profile').style.display = 'none';
  $('xf-body').style.display = 'block';

  // "Proposed"/"Both" need at least one side to actually have a design
  // enabled — same disabled-not-hidden convention renderDrivewayUI uses
  // for the driveway panel's own section-export buttons — so it's clear
  // they exist but need a driveway turned on (on either alignment) first.
  var hasEitherDesign = drivewayStateFor(state.crossfall.alignA).enabled || drivewayStateFor(state.crossfall.alignB).enabled;
  $<HTMLButtonElement>('btn-export-crossfall-proposed').disabled = !hasEitherDesign;
  $<HTMLButtonElement>('btn-export-crossfall-both').disabled = !hasEitherDesign;
}

export function clearAllData(){
  rebuildGeneration++; // invalidate any in-flight triangulation result
  lastSurface = null; // the diagnostics panel is cleared below, so never reuse past it
  $('triangulating-overlay').style.display = 'none';
  state.points = [];
  state.triangles = [];
  state.polyline = null;
  state.rawPoints = null;
  state.pointLayers = null;
  state.activePointLayers = null;
  state.rawAlignments = [];
  state.activeAlignmentIndex = -1;
  state.drivewayByAlignment = {}; // full clear — every alignment's design goes with it
  state.driveway = drivewayStateFor(state.activeAlignmentIndex);
  state.zMin = 0; state.zMax = 0;
  state.offsetX = 0; state.offsetY = 0;
  clearTriIndex();
  setProfileData(null);

  clearGroup(three.terrainMesh); three.terrainMesh = null;
  clearGroup(three.wireMesh); three.wireMesh = null;
  clearGroup(three.pointsMesh); three.pointsMesh = null;
  clearGroup(three.alignmentLine); three.alignmentLine = null;
  hidePointInspector();

  $('dxf-filename').textContent = 'No file loaded';
  $('dxf-filename').classList.remove('loaded');
  $('dxf-notice').style.display = 'none';
  $('dxf-notice').textContent = '';
  $('filter-notice').style.display = 'none';
  $('filter-notice').textContent = '';
  $<HTMLInputElement>('input-dxf').value = '';

  renderLayerFilterUI();
  renderAlignmentSelector();

  $('section-stats').style.display = 'none';
  $('section-export').style.display = 'none';
  $('section-export-surface').style.display = 'none';
  $('section-diagnostics').style.display = 'none';
  $('diagnostics-body').innerHTML = '';
  $('legend').style.display = 'none';
  $('empty-state').style.display = 'flex';

  renderDrivewayUI();
  if (isProfileVisible()) drawProfile();
}

// ============================================================
// Sample data generator
// ============================================================
export function loadSampleData(){
  var pts: Point3[] = [];
  var n = 34;
  for (var i=0;i<n;i++){
    for (var j=0;j<n;j++){
      var x = i*8 + (Math.sin(i*3.1+j)*1.2);
      var y = j*8 + (Math.cos(j*2.3+i)*1.2);
      var z = 22
        + 5.5*Math.sin(x*0.045)*Math.cos(y*0.035)
        + 3.0*Math.sin(x*0.02 + y*0.015)
        + (Math.abs(x-132)<28 && Math.abs(y-132)<10 ? -3.2 : 0); // a shallow valley/road cut
      pts.push({x:x, y:y, z:z});
    }
  }
  var poly = [
    {x: -6, y: 20},
    {x: 60, y: 55},
    {x: 130, y: 130},
    {x: 200, y: 150},
    {x: 262, y: 240}
  ];
  resetPointLayerFilter();
  state.rawAlignments = [{label:'sample-alignment', layer:null, vertices:poly}];
  state.activeAlignmentIndex = 0;
  state.driveway = drivewayStateFor(state.activeAlignmentIndex);
  renderAlignmentSelector();
  setRawDataAndBuild(pts);
  $('dxf-filename').textContent = 'sample-terrain.dxf';
  $('dxf-filename').classList.add('loaded');
}
