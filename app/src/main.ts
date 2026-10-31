// PLAN.md Stage 2 checkpoint 3 (the UI/rendering/DOM-wiring port): the
// rest of the app's logic that used to live in this one file has now
// moved into its own module per functional area (mirroring CLAUDE.md's
// "Software architecture" section) — DXF parsing (dxf.js), TIN
// triangulation off the main thread (triangulation.js), the long
// section/chainage model (longsection.js), the three.js 3D view
// (view3d.js), canvas rendering (rendering.js), driveway design
// (driveway.js), diagnostics (diagnostics.js), the data pipeline
// (pipeline.js), export incl. DXF/CSV/PDF (export.js), printing
// (printing.js), and view-tab state (viewstate.js). This file is now
// only what's left: the app's shared `state`/`$`/color-ramp imports
// used directly here, and the DOM event wiring that ties the sidebar
// controls to the functions those modules export — the same
// distribution of event listeners across files that existed before
// this port (e.g. the driveway panel's own listeners live in
// driveway.js beside the render functions they trigger, not
// centralized here), not a new convention invented for this port.
import { $ } from './dom.ts';
import { state, drivewayStateFor } from './state.ts';
import { parseDXFFile, pickAlignmentCandidates, buildAlignmentEntries, computeLayerBreakdown } from './dxf.ts';
import { initThree, rebuildTerrainMesh, buildPointsMesh, rebuildAlignmentLine, clearGroup, three, hidePointInspector, requestRender } from './view3d.ts';
import { computeLongSection, setProfileData } from './longsection.ts';
import { drawProfile } from './rendering.ts';
import {
  setRawDataAndBuild, rebuildFromRaw, renderAlignmentSelector,
  renderLayerFilterUI, updateStatsAndLegend, clearAllData, loadSampleData, handleCancelTriangulation
} from './pipeline.ts';
import { exportLongSectionCSV, exportSectionDXF, exportSurfaceDXF, exportCrossfallDXF } from './export.ts';
import { printCurrentScreen } from './printing.ts';
import { isProfileVisible, isCrossfallVisible, switchView } from './viewstate.ts';
import type { Point3, DxfPolyline } from './types.ts';
import './jobs.ts'; // self-wires the Job section's Save/Save As/Open buttons
import './pwa.ts'; // self-wires service-worker registration + .gradeline file-launch handling
import { restoreLastSettings } from './settings.ts';

// ============================================================
// DXF load
// ============================================================
$('tab-3d').addEventListener('click', function(){ switchView('3d'); });
$('tab-profile').addEventListener('click', function(){ switchView('profile'); });
$('tab-split').addEventListener('click', function(){ switchView('split'); });
$('tab-driveway').addEventListener('click', function(){ switchView('driveway'); });
$('tab-crossfall').addEventListener('click', function(){ switchView('crossfall'); });

$('btn-load-dxf').addEventListener('click', function(){ $('input-dxf').click(); });

$<HTMLInputElement>('input-dxf').addEventListener('change', function(this: HTMLInputElement){
  var file = this.files ? this.files[0] : null;
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev: ProgressEvent<FileReader>){
    var geo;
    try {
      geo = parseDXFFile(ev.target?.result as string);
    } catch (err: unknown){
      alert('Could not parse that DXF: ' + (err instanceof Error ? err.message : err));
      return;
    }

    var cutCandidates: DxfPolyline[] = [], contours: DxfPolyline[] = [];
    for (var i=0;i<geo.polylines.length;i++){
      var pl = geo.polylines[i];
      if (pl.flat) cutCandidates.push(pl); else contours.push(pl);
    }

    var pts = geo.points.slice(); // POINT entities + deduped 3DFACE corners, already layer-tagged
    for (var c=0;c<contours.length;c++){
      for (var v=0;v<contours[c].vertices.length;v++) pts.push(contours[c].vertices[v]);
    }

    if (pts.length < 3){
      alert('No usable POINT/3DFACE entities (or elevated contour polylines) found in this DXF. Survey points need real X,Y,Z — check the layer they’re on and that they’re true POINT or 3DFACE entities, not text or blocks.');
      return;
    }

    var notices: string[] = [];
    var faceNote = geo.faceCount ? (' incl. ' + geo.faceCount + ' 3D face' + (geo.faceCount>1?'s':'')) : '';
    notices.push(geo.points.length + ' survey point' + (geo.points.length===1?'':'s') + faceNote +
      (contours.length ? ' + ' + contours.length + ' contour line' + (contours.length>1?'s':'') + ' (' + (pts.length-geo.points.length) + ' vertices folded in)' : ''));

    // Per-layer breakdown of every point that could feed the TIN, so the
    // layer-filter checklist can replace manually stripping the DWG.
    state.pointLayers = computeLayerBreakdown(pts);
    var layerNames = state.pointLayers.map(function(l){ return l.layer; });
    // Only force a deliberate per-layer choice when there's actually a
    // choice to make; a single-layer DXF has no filter UI to make it in
    // (see renderLayerFilterUI), so it must stay implicitly active.
    state.activePointLayers = layerNames.length > 1 ? new Set() : new Set(layerNames);
    renderLayerFilterUI();
    if (layerNames.length > 1){
      notices.push(layerNames.length + ' layers — untick any that aren’t survey data below instead of cleaning the DWG by hand');
    }

    // Alignment candidates: prefer a layer named like "alignment"; fall
    // back to every zero-elevation polyline (previous behaviour) if none
    // match. Typically yields one or two selectable alignments.
    var alignCandidates = pickAlignmentCandidates(cutCandidates);
    var alignEntries = buildAlignmentEntries(alignCandidates);
    state.rawAlignments = alignEntries;
    state.activeAlignmentIndex = alignEntries.length ? 0 : -1;
    state.drivewayByAlignment = {}; // a new file's alignment indices mean something new
    state.driveway = drivewayStateFor(state.activeAlignmentIndex);
    renderAlignmentSelector();

    if (alignEntries.length){
      notices.push(alignEntries.length + ' alignment' + (alignEntries.length>1?'s':'') + ' found (' +
        alignEntries.map(function(a){return a.label;}).join('; ') + ')' +
        (alignEntries.length>1 ? ' — pick one below' : ''));
    } else {
      notices.push('no zero-elevation polyline found for an alignment — upload one separately if you need the existing terrain along it');
    }

    // Shown regardless of whether the initial build finds usable points —
    // with layers defaulting to none-checked (see above), a multi-layer
    // file legitimately has zero active points until the user ticks one,
    // and this notice/filename is what tells them layers are waiting.
    $('dxf-filename').textContent = file.name;
    $('dxf-filename').classList.add('loaded');
    $('dxf-notice').textContent = notices.join(' — ');
    $('dxf-notice').style.display = 'block';

    setRawDataAndBuild(pts);
  };
  reader.readAsText(file);
});

$('btn-sample').addEventListener('click', loadSampleData);
$('btn-export-csv').addEventListener('click', exportLongSectionCSV);
$('btn-export-section-existing').addEventListener('click', function(){ exportSectionDXF('existing'); });
$('btn-export-section-proposed').addEventListener('click', function(){ exportSectionDXF('proposed'); });
$('btn-export-section-both').addEventListener('click', function(){ exportSectionDXF('both'); });
$('btn-export-surface-dxf').addEventListener('click', exportSurfaceDXF);
$('btn-export-crossfall-existing').addEventListener('click', function(){ exportCrossfallDXF('existing'); });
$('btn-export-crossfall-proposed').addEventListener('click', function(){ exportCrossfallDXF('proposed'); });
$('btn-export-crossfall-both').addEventListener('click', function(){ exportCrossfallDXF('both'); });
$('btn-print-view').addEventListener('click', printCurrentScreen);
$('btn-clear-data').addEventListener('click', clearAllData);
$('btn-cancel-triangulation').addEventListener('click', handleCancelTriangulation);

$('chk-ignore-zero').addEventListener('change', function(){
  if (state.rawPoints && state.rawPoints.length) rebuildFromRaw();
});
$('chk-ignore-far').addEventListener('change', function(){
  if (state.rawPoints && state.rawPoints.length) rebuildFromRaw();
});
$('far-limit').addEventListener('change', function(){
  if (state.rawPoints && state.rawPoints.length) rebuildFromRaw();
});

$('ve-slider').addEventListener('input', function(this: HTMLInputElement){
  state.verticalExaggeration = parseFloat(this.value);
  $('ve-val').textContent = state.verticalExaggeration.toFixed(1)+'×';
  if (state.points.length) rebuildTerrainMesh();
});

$('sample-interval').addEventListener('change', function(){
  setProfileData(computeLongSection());
  updateStatsAndLegend();
  if (isProfileVisible()) drawProfile();
});

$('chk-profile-true-scale').addEventListener('change', function(){
  if (isProfileVisible()) drawProfile();
});

$('grade-break-tolerance').addEventListener('change', function(){
  if (isProfileVisible()) drawProfile();
});

$('chk-chainage-interval').addEventListener('change', function(){
  if (isProfileVisible()) drawProfile();
});
$('chainage-interval-value').addEventListener('change', function(){
  if (isProfileVisible()) drawProfile();
});

$('chk-datum').addEventListener('change', function(){
  if (isProfileVisible()) drawProfile();
});
$('datum-rl').addEventListener('change', function(){
  if (isProfileVisible()) drawProfile();
});

$('chk-wireframe').addEventListener('change', function(this: HTMLInputElement){
  if (three.wireMesh) three.wireMesh.visible = this.checked;
  requestRender();
});
$('chk-points').addEventListener('change', function(this: HTMLInputElement){
  if (this.checked) buildPointsMesh(); else clearGroup(three.pointsMesh);
});
$('chk-alignment').addEventListener('change', function(){
  rebuildAlignmentLine();
});

$('btn-layers-all').addEventListener('click', function(){
  if (!state.pointLayers) return;
  state.activePointLayers = new Set(state.pointLayers.map(function(l){ return l.layer; }));
  renderLayerFilterUI();
  if (state.rawPoints && state.rawPoints.length) rebuildFromRaw();
});
$('btn-layers-none').addEventListener('click', function(){
  if (!state.pointLayers) return;
  state.activePointLayers = new Set();
  renderLayerFilterUI();
  if (state.rawPoints && state.rawPoints.length) rebuildFromRaw();
});

$('select-alignment').addEventListener('change', function(this: HTMLSelectElement){
  state.activeAlignmentIndex = parseInt(this.value, 10);
  state.driveway = drivewayStateFor(state.activeAlignmentIndex);
  if (state.rawPoints && state.rawPoints.length) rebuildFromRaw();
  if (isCrossfallVisible()) drawProfile();
});

$('xf-align-a').addEventListener('change', function(this: HTMLSelectElement){
  state.crossfall.alignA = parseInt(this.value, 10);
  state.crossfall.markerChainage = null; // re-default to the new pair's own worst point
  if (isCrossfallVisible()) drawProfile();
});
$('xf-align-b').addEventListener('change', function(this: HTMLSelectElement){
  state.crossfall.alignB = parseInt(this.value, 10);
  state.crossfall.markerChainage = null;
  if (isCrossfallVisible()) drawProfile();
});
$('xf-projection-mode').addEventListener('change', function(this: HTMLSelectElement){
  state.crossfall.projectionMode = this.value as 'chainage' | 'perpendicular';
  state.crossfall.markerChainage = null; // re-default to the new mode's own worst point
  if (isCrossfallVisible()) drawProfile();
});
$('xf-marker-chainage').addEventListener('change', function(this: HTMLInputElement){
  var v = parseFloat(this.value);
  if (!isFinite(v)) return;
  var meta = $<HTMLCanvasElement>('profile-canvas')._xfPlotMeta;
  if (meta) v = Math.max(0, Math.min(meta.rangeEnd, v));
  this.value = v.toFixed(2); // reflect any clamping immediately, even while still focused
  state.crossfall.markerChainage = v;
  if (isCrossfallVisible()) drawProfile();
});

$('point-inspector-close').addEventListener('click', hidePointInspector);

// ============================================================
// Init
// ============================================================
initThree();
restoreLastSettings();
