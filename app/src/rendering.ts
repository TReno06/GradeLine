// Rendering — the long-section/crossfall canvas — PLAN.md Stage 2
// checkpoint 3 port, extracted verbatim from main.js. Only drawProfile
// is used outside this module; drawCrossfallView/niceStep/
// crossfallChainageFromEvent are internal to it, matching how they were
// only ever called from within this same area of main.js before the
// port. (interpolatedSampleAt moved to geometry/chainage.ts so it can be
// unit tested.)
import { $, escapeHtml } from './dom.ts';
import { state, drivewayStateFor } from './state.ts';
import { isCrossfallVisible, isProfileVisible, is3DVisible } from './viewstate.ts';
import {
  profileData, profileView, resetProfileView, triIndex,
  centeredVertsForAlignment, cumulativeChainages, existingElevationAtChainageForVerts,
  computeGradeBreaks, computeIntervalMarks, datumRLValue
} from './longsection.ts';
import {
  computeDrivewayProfile, computeDrivewayProfileForPvis, drivewayRules,
  driveGroundRLAt, driveGroundRLAtForVerts, alignmentSeparationAt, drawVehicleOutlineSilhouette
} from './driveway.ts';
import { legGradeChecksFrom } from './driveway/profile.ts';
import { VEHICLE_TEMPLATES, sweepVehicleTemplateFrom } from './driveway/vehicle.ts';
import { computeCrossfallSeriesFrom, computeCrossfallSeriesPerpendicular } from './crossfall.ts';
import { pointAtChainage, chainageOfClosestPoint, interpolatedSampleAt } from './geometry/chainage.ts';
import { showHoverMarker, hideHoverMarker } from './view3d.ts';
import type { Point2, DrivewayProfile, VehicleTemplate, GradeBreak, IntervalMark } from './types.ts';

// Crossfall view: three stacked mini-panels (Alignment A's existing/
// design profile, Alignment B's, and the crossfall between them)
// rather than the single-alignment long-section renderer below. Reads
// each alignment's OWN independent driveway design via
// drivewayStateFor() — never state.driveway directly, since that alias
// only ever points at the currently ACTIVE alignment, which may be
// neither A nor B. Deliberately no pan/zoom here — a comparison view,
// not an editing one — but a draggable chainage readout marker is
// drawn as the last step below (see its own comment), since Thom
// specifically asked to keep this static chart and just add a readout
// on it, not replace it with pan/zoom or a separate picker control.
function drawCrossfallView(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D){
  var aligns = state.rawAlignments || [];
  var idxA = state.crossfall.alignA, idxB = state.crossfall.alignB;
  function fail(msg: string){
    ctx.fillStyle = '#5B6870';
    ctx.font = '13px IBM Plex Sans';
    ctx.textAlign = 'center';
    ctx.fillText(msg, canvas.width/2, canvas.height/2);
    var el = $('xf-summary-body');
    if (el) el.innerHTML = escapeHtml(msg);
  }
  if (aligns.length < 2 || !aligns[idxA] || !aligns[idxB]){
    fail('Load a surface with at least two alignments to compare crossfall.');
    return;
  }
  if (idxA === idxB){
    fail('Pick two different alignments to compare.');
    return;
  }
  var vertsA = centeredVertsForAlignment(idxA), vertsB = centeredVertsForAlignment(idxB);
  if (!vertsA || !vertsB || !triIndex){
    fail('Both alignments need a loaded surface underneath them.');
    return;
  }
  var cumA = cumulativeChainages(vertsA), cumB = cumulativeChainages(vertsB);
  var totalA = cumA[cumA.length-1], totalB = cumB[cumB.length-1];
  if (!(totalA > 0) || !(totalB > 0)){
    fail('One of the two alignments has zero length.');
    return;
  }

  var dwA = drivewayStateFor(idxA), dwB = drivewayStateFor(idxB);
  var profA = dwA.enabled ? computeDrivewayProfileForPvis(dwA.pvis) : null;
  var profB = dwB.enabled ? computeDrivewayProfileForPvis(dwB.pvis) : null;

  var groundOnlyARaw = function(ch: number){ return existingElevationAtChainageForVerts(vertsA, ch); };
  var groundOnlyBRaw = function(ch: number){ return existingElevationAtChainageForVerts(vertsB, ch); };
  var designOrGroundARaw = function(ch: number){ return driveGroundRLAtForVerts(profA, vertsA, ch); };
  var designOrGroundBRaw = function(ch: number){ return driveGroundRLAtForVerts(profB, vertsB, ch); };

  // Perpendicular-projection mode (PLAN.md Appendix B item 2, 2026-09-26):
  // an alternative to the default matching-chainage-value comparison,
  // for two alignments that aren't roughly parallel from a shared
  // chainage-0 start. Defaults to 'chainage' wherever unset (a fresh
  // session or an older saved file) — deliberately the exact original
  // behaviour, so opening an old file never silently switches algorithms.
  var perpendicular = state.crossfall.projectionMode === 'perpendicular';
  var assumptionEl = $('xf-assumption-text');
  if (assumptionEl){
    assumptionEl.textContent = perpendicular
      ? 'Crossfall is read via PERPENDICULAR PROJECTION: for each point along Alignment A, the nearest point on Alignment B’s own line is found in real X/Y space (clamped to B’s own ends) and B’s level is read there. Meaningful even when the two alignments don’t run parallel or start at a comparable point — the trade-off is that B’s own chart panel is resampled onto A’s chainage axis rather than showing B’s raw profile.'
      : 'Crossfall is read at MATCHING CHAINAGE VALUE along each alignment (chainage 10.00 on A vs chainage 10.00 on B) — not a true perpendicular projection between the two lines. Only meaningful when both alignments start at a comparable point and run roughly parallel over a similar length.';
  }
  function projectAtoB(chA: number): number {
    var ptA = pointAtChainage(vertsA, cumA, Math.max(0, Math.min(chA, totalA)));
    return chainageOfClosestPoint(vertsB, cumB, ptA).chainage;
  }
  // Every place B's own ground/design is read by "the chainage on A's
  // own axis" (both mini-profile panels share one x-axis — see chX
  // below — and the marker readout) goes through these, so the
  // projection step lives in exactly one place. Under matching-chainage
  // mode they're identical to the raw B functions (ch IS B's own
  // chainage there); under perpendicular mode they re-project first.
  var groundOnlyB = perpendicular ? function(chA: number){ return groundOnlyBRaw(projectAtoB(chA)); } : groundOnlyBRaw;
  var designOrGroundB = perpendicular ? function(chA: number){ return designOrGroundBRaw(projectAtoB(chA)); } : designOrGroundBRaw;
  var groundOnlyA = groundOnlyARaw, designOrGroundA = designOrGroundARaw;

  // Matching-chainage mode compares over the shorter of the two
  // alignments' own lengths (stated in the panel note) since beyond
  // that there's no "same chainage" on the shorter one to compare
  // against. Perpendicular mode has no such limit — chainageOfClosestPoint
  // always finds SOME closest point on B, clamped to its own ends — so
  // it compares over the whole of alignment A instead, with B's mini-
  // profile panel resampled by projection onto that same shared axis.
  var rangeEnd = perpendicular ? totalA : Math.min(totalA, totalB);
  if (!(rangeEnd > 0)){
    fail('The two alignments don’t overlap in chainage.');
    return;
  }
  var step = Math.max(0.05, rangeEnd/400);
  // widthAt (matching-chainage mode only): the straight-line ground
  // distance at the same chainage on each alignment — an approximation
  // of the true separation, which is exactly the assumption
  // perpendicular mode exists to drop; that mode gets its own, exact
  // separation for free from chainageOfClosestPoint's own offset
  // (see computeCrossfallSeriesPerpendicular), so this is never used there.
  var widthAt = function(ch: number){ return alignmentSeparationAt(vertsA, cumA, vertsB, cumB, ch); };
  // Crossfall is read off whichever line is actually "the design" on
  // each side (the driveway profile where one's enabled, existing
  // ground otherwise) — what a site crossfall check actually cares
  // about, not necessarily raw existing ground on both sides.
  var series = perpendicular
    ? computeCrossfallSeriesPerpendicular(vertsA, cumA, vertsB, cumB, designOrGroundARaw, designOrGroundBRaw, 0, rangeEnd, step)
    : computeCrossfallSeriesFrom(designOrGroundA, designOrGroundB, 0, rangeEnd, step, widthAt);

  // padT is deliberately generous (well past the 46px translucent
  // top toolbar that overlaps this canvas) since the first mini-
  // panel's label sits just above its own box, close to the canvas top.
  var padL=64, padR=20, padT=58, gap=30;
  var panelH = (canvas.height - padT - gap*2 - 16) / 3;
  var plotW = canvas.width - padL - padR;
  function panelTop(i: number){ return padT + i*(panelH+gap); }

  // True 1:1 scale (Thom's explicit request — the earlier auto-fit-
  // per-panel version stretched each panel's own small elevation
  // range to fill the whole box, which read as a dramatic hill/valley
  // for what is usually a near-flat driveway grade). One shared
  // pixels-per-metre figure, tied to the horizontal chainage scale,
  // is used for every vertical axis below (including the crossfall
  // panel, in effect just metres relabelled as mm) — same convention
  // as the "True scale (1:1)" default everywhere else in the app.
  var pxPerMetre = rangeEnd > 0 ? plotW / rangeEnd : 1;
  // Shared chainage->x mapping, identical across all three panels (and
  // used by the draggable readout marker below) — every panel scrolls
  // in lockstep since there's no per-panel pan/zoom here.
  function chX(ch: number){ return padL + (ch/rangeEnd)*plotW; }

  function drawMiniProfile(top: number, label: string, groundFn: (ch: number) => number | null, designFn: ((ch: number) => number | null) | null){
    var samples: {ch: number; ground: number | null; design: number | null}[] = [];
    var n = Math.max(2, Math.ceil(rangeEnd/step));
    for (var i=0;i<=n;i++){
      var ch = Math.min(rangeEnd, i*step);
      samples.push({ch:ch, ground: groundFn(ch), design: designFn ? designFn(ch) : null});
    }
    var vals: number[] = [];
    samples.forEach(function(s){ if (s.ground!==null) vals.push(s.ground); if (s.design!==null) vals.push(s.design); });
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, top, plotW, panelH);
    ctx.fillStyle = '#8A97A0';
    ctx.font = '11px IBM Plex Mono';
    ctx.textAlign = 'left';
    ctx.fillText(label, padL, top-7);
    if (!vals.length){
      ctx.fillStyle = '#5B6870';
      ctx.font = '11px IBM Plex Sans';
      ctx.textAlign = 'center';
      ctx.fillText('No surveyed ground under this alignment.', padL+plotW/2, top+panelH/2);
      return;
    }
    var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
    var centerVal = (vMin+vMax)/2;
    var xx = chX;
    function yy(rl: number){ return top + panelH/2 - (rl - centerVal) * pxPerMetre; }

    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, top, plotW, panelH);
    ctx.clip();

    ctx.beginPath();
    var started = false;
    samples.forEach(function(s){
      if (s.ground===null){ started=false; return; }
      var x=xx(s.ch), y=yy(s.ground);
      if (!started){ ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = 'rgba(180,190,196,0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (designFn){
      ctx.beginPath();
      started = false;
      samples.forEach(function(s){
        if (s.design===null){ started=false; return; }
        var x=xx(s.ch), y=yy(s.design);
        if (!started){ ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
      });
      ctx.strokeStyle = '#4FA8FF';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    // Axis readout shows the panel's actual VISIBLE range at this
    // true scale (not the data's own min/max) — at 1:1 that range is
    // usually only a few centimetres tall, which is the honest point.
    var topVal = centerVal + (panelH/2)/pxPerMetre, botVal = centerVal - (panelH/2)/pxPerMetre;
    ctx.fillStyle = '#5B6870';
    ctx.font = '10px IBM Plex Mono';
    ctx.textAlign = 'right';
    ctx.fillText(topVal.toFixed(2), padL-6, top+10);
    ctx.fillText(botVal.toFixed(2), padL-6, top+panelH-2);
  }

  drawMiniProfile(panelTop(0), aligns[idxA].label + ' — existing ground (grey)' + (profA ? ' / design (blue)' : ''),
    groundOnlyA, profA ? designOrGroundA : null);
  drawMiniProfile(panelTop(1), aligns[idxB].label + ' — existing ground (grey)' + (profB ? ' / design (blue)' : ''),
    groundOnlyB, profB ? designOrGroundB : null);

  var xfTop = panelTop(2);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, xfTop, plotW, panelH);
  ctx.fillStyle = '#8A97A0';
  ctx.font = '11px IBM Plex Mono';
  ctx.textAlign = 'left';
  ctx.fillText('Crossfall (B − A) — true scale, same as above', padL, xfTop-7);

  var summaryEl = $('xf-summary-body');
  if (!series.length){
    ctx.fillStyle = '#5B6870';
    ctx.font = '12px IBM Plex Sans';
    ctx.textAlign = 'center';
    ctx.fillText('No overlapping ground data between the two alignments.', padL+plotW/2, xfTop+panelH/2);
    if (summaryEl) summaryEl.innerHTML = 'No overlapping ground data between the two alignments.';
    return;
  }

  var cfVals = series.map(function(p){ return p.crossfall; });
  var cfMin = Math.min.apply(null, cfVals), cfMax = Math.max.apply(null, cfVals);
  var cfCenter = (cfMin+cfMax)/2;
  var cfx = chX;
  function cfy(v: number){ return xfTop + panelH/2 - (v - cfCenter) * pxPerMetre; }

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, xfTop, plotW, panelH);
  ctx.clip();

  // Zero-crossfall reference line, only drawn when it actually falls
  // within this panel's true-scale visible range.
  var zeroY = cfy(0);
  if (zeroY >= xfTop && zeroY <= xfTop+panelH){
    ctx.beginPath();
    ctx.moveTo(padL, zeroY); ctx.lineTo(padL+plotW, zeroY);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.setLineDash([4,3]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  series.forEach(function(p, i){
    var x = cfx(p.chainage), y = cfy(p.crossfall);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.strokeStyle = '#F2A722';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  var cfTopVal = cfCenter + (panelH/2)/pxPerMetre, cfBotVal = cfCenter - (panelH/2)/pxPerMetre;
  ctx.fillStyle = '#5B6870';
  ctx.font = '10px IBM Plex Mono';
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(cfTopVal*1000)+'mm', padL-6, xfTop+10);
  ctx.fillText(Math.round(cfBotVal*1000)+'mm', padL-6, xfTop+panelH-2);

  var worst = series.reduce(function(w,p){ return (w===null || Math.abs(p.crossfall) > Math.abs(w.crossfall)) ? p : w; }, null);
  var pctNote = (worst && worst.crossfallPct!==null) ? (' (' + worst.crossfallPct.toFixed(1) + '%)') : '';
  if (summaryEl){
    summaryEl.innerHTML =
      'Compared over chainage 0.00–' + rangeEnd.toFixed(2) + 'm.<br>' +
      'Worst crossfall: ' + (worst ? (Math.round(worst.crossfall*1000) + 'mm' + pctNote + ' at chainage ' + worst.chainage.toFixed(2)) : '—') + '<br>' +
      (profA ? '' : escapeHtml(aligns[idxA].label) + ' has no driveway design enabled — using existing ground.<br>') +
      (profB ? '' : escapeHtml(aligns[idxB].label) + ' has no driveway design enabled — using existing ground.<br>');
  }

  // Draggable chainage readout marker (§5.4 Stage 0c item 10) — kept
  // deliberately as an added overlay on the existing static 3-panel
  // chart rather than pan/zoom or a standalone chainage picker, per
  // Thom's own framing of the request (see PLAN.md §5.1). Defaults to
  // the worst-crossfall chainage the first time this view is drawn
  // (same convenience as the vehicle scrape check's own default), then
  // stays wherever it's dragged. Drawn last so it overlays all three
  // panels; the exact value at its chainage is read directly from
  // designOrGroundA/B (not sampled from `series`), so it's precise
  // regardless of the chart's fixed sampling step.
  var xfMarkerTop = panelTop(0), xfMarkerBottom = xfTop + panelH;
  if (state.crossfall.markerChainage === null && worst){
    state.crossfall.markerChainage = worst.chainage;
  }
  var markerCh = state.crossfall.markerChainage;
  var readoutEl = $('xf-marker-readout');
  // Keep the typed-chainage box in sync with wherever the marker
  // actually is — dragging updates the box, typing moves the marker
  // (see its own 'change' listener below) — but never while the user
  // currently has focus in it, so their own typing isn't clobbered
  // mid-edit by a redraw triggered from elsewhere.
  var chainageInput = $<HTMLInputElement>('xf-marker-chainage');
  if (chainageInput){
    chainageInput.max = rangeEnd.toFixed(2);
    if (document.activeElement !== chainageInput){
      chainageInput.value = markerCh !== null ? markerCh.toFixed(2) : '';
    }
  }
  if (markerCh !== null && markerCh >= 0 && markerCh <= rangeEnd){
    var mx = chX(markerCh);
    ctx.beginPath();
    ctx.moveTo(mx, xfMarkerTop);
    ctx.lineTo(mx, xfMarkerBottom);
    ctx.strokeStyle = 'rgba(245,243,238,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, xfMarkerTop-6, 5, 0, Math.PI*2);
    ctx.fillStyle = '#F26722';
    ctx.fill();

    var mRlA = designOrGroundA(markerCh), mRlB = designOrGroundB(markerCh);
    if (readoutEl){
      if (mRlA === null || mRlB === null){
        readoutEl.innerHTML = 'No ground data for both alignments at chainage ' + markerCh.toFixed(2) + '.';
      } else {
        var mCrossfall = mRlB - mRlA;
        // Perpendicular mode already knows the true separation (the
        // projection's own offset) — the straight-line widthAt() is
        // only an approximation of that, which is exactly what this
        // mode exists to drop, so it's never used here in that case.
        var mWidth = perpendicular
          ? chainageOfClosestPoint(vertsB, cumB, pointAtChainage(vertsA, cumA, markerCh)).offset
          : widthAt(markerCh);
        var mPctNote = (mWidth !== null && mWidth > 1e-6) ? (' (' + ((mCrossfall/mWidth)*100).toFixed(1) + '%)') : '';
        readoutEl.innerHTML =
          'Chainage ' + markerCh.toFixed(2) + 'm<br>' +
          escapeHtml(aligns[idxA].label) + ' RL ' + mRlA.toFixed(3) + ' &nbsp;&nbsp; ' +
          escapeHtml(aligns[idxB].label) + ' RL ' + mRlB.toFixed(3) + '<br>' +
          'Crossfall ' + (mCrossfall>=0?'+':'') + Math.round(mCrossfall*1000) + 'mm' + mPctNote;
      }
    }
  } else if (readoutEl){
    readoutEl.innerHTML = 'Drag the marker on the chart to read a chainage.';
  }

  canvas._xfPlotMeta = {padL:padL, plotW:plotW, rangeEnd:rangeEnd};
}

export function drawProfile(){
  var canvas = $<HTMLCanvasElement>('profile-canvas');
  var container = $('viewport-profile');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#12181C';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  if (isCrossfallVisible()){
    drawCrossfallView(canvas, ctx);
    return;
  }

  if (!profileData){
    ctx.fillStyle = '#5B6870';
    ctx.font = '13px IBM Plex Sans';
    ctx.textAlign = 'center';
    ctx.fillText('Load survey points and an alignment to see the existing terrain.', canvas.width/2, canvas.height/2);
    return;
  }

  var samples = profileData.samples.filter(function(s){ return s.elevation!==null; });
  if (samples.length < 2){
    ctx.fillStyle = '#5B6870';
    ctx.font = '13px IBM Plex Sans';
    ctx.textAlign = 'center';
    ctx.fillText('Alignment does not cross the surveyed surface.', canvas.width/2, canvas.height/2);
    return;
  }

  var padL=64, padR=28, padT=26, padB=90;
  var plotW = canvas.width-padL-padR, plotH = canvas.height-padT-padB;

  var minCh=0, maxCh=profileData.total;
  var dataMinEl=Infinity, dataMaxEl=-Infinity;
  for (var i=0;i<samples.length;i++){
    if (samples[i].elevation<dataMinEl) dataMinEl=samples[i].elevation;
    if (samples[i].elevation>dataMaxEl) dataMaxEl=samples[i].elevation;
  }
  var elPad = Math.max((dataMaxEl-dataMinEl)*0.15, 0.5);
  var paddedRange = (dataMaxEl-dataMinEl) + 2*elPad;
  var dataMidCh = (minCh+maxCh)/2;
  var dataMidEl = (dataMinEl+dataMaxEl)/2;

  // Horizontal scale fits the whole section at zoom=1; the vertical scale
  // either matches it exactly (true 1:1, same as the exported DXF/CSV) or
  // auto-fits the data at zoom=1 for readability — which is an
  // exaggeration, so the ratio is always shown on the chart rather than
  // left for the eye to misjudge. profileView.zoom scales both axes
  // together (so true scale stays true scale at any zoom level) and lets
  // the user zoom past what fits — handy in split view, where the pane
  // is short enough that true scale alone can cut off part of the section.
  var trueScale = $<HTMLInputElement>('chk-profile-true-scale').checked;
  var zoom = profileView.zoom;
  var fitPxPerUnitX = plotW / ((maxCh-minCh) || 1);
  var fitPxPerUnitY = plotH / (paddedRange || 1);
  var pxPerUnitX = fitPxPerUnitX * zoom;
  var pxPerUnitY = (trueScale ? fitPxPerUnitX : fitPxPerUnitY) * zoom;
  var centerCh = (profileView.centerCh !== null) ? profileView.centerCh : dataMidCh;
  var centerEl = (profileView.centerEl !== null) ? profileView.centerEl : dataMidEl;
  var visibleChRange = plotW / pxPerUnitX;
  var visMinCh = centerCh - visibleChRange/2, visMaxCh = centerCh + visibleChRange/2;
  var visibleElRange = plotH / pxPerUnitY;
  var visMinEl = centerEl - visibleElRange/2, visMaxEl = centerEl + visibleElRange/2;
  var effectiveVE = pxPerUnitY / pxPerUnitX;

  function px(ch: number){ return padL + plotW/2 + (ch-centerCh)*pxPerUnitX; }
  function py(el: number){ return padT + plotH/2 - (el-centerEl)*pxPerUnitY; }

  // grid + axis labels
  ctx.strokeStyle = '#212B30';
  ctx.fillStyle = '#8A9AA3';
  ctx.font = '10.5px IBM Plex Mono';
  var elStep = niceStep(visibleElRange/5);
  var elStart = Math.ceil(visMinEl/elStep)*elStep;
  ctx.textAlign = 'right';
  for (var e=elStart; e<=visMaxEl; e+=elStep){
    var yy = py(e);
    if (yy < padT-0.5 || yy > padT+plotH+0.5) continue;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL+plotW, yy); ctx.stroke();
    ctx.fillText(e.toFixed(2), padL-8, yy+3);
  }
  var chStep = niceStep(visibleChRange/6);
  var chStart = Math.ceil(visMinCh/chStep)*chStep;
  ctx.textAlign = 'center';
  for (var c=chStart; c<=visMaxCh; c+=chStep){
    var xx = px(c);
    if (xx < padL-0.5 || xx > padL+plotW+0.5) continue;
    ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT+plotH); ctx.stroke();
    ctx.fillText(c.toFixed(0), xx, padT+plotH+16);
  }
  ctx.fillStyle = '#5B6870';
  ctx.textAlign = 'center';
  ctx.fillText('Chainage', padL+plotW/2, canvas.height-8);
  ctx.save();
  ctx.translate(16, padT+plotH/2);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('Elevation', 0, 0);
  ctx.restore();

  // Always disclose how exaggerated the on-screen shape is relative to
  // the true (1:1) geometry that gets exported to CSV/DXF.
  ctx.textAlign = 'right';
  ctx.font = '11px IBM Plex Mono';
  ctx.fillStyle = trueScale ? '#F26722' : '#8A9AA3';
  ctx.fillText(trueScale ? 'True scale (1:1)' : ('V.E. ×' + effectiveVE.toFixed(1)), padL+plotW, padT-10);
  if (zoom !== 1 || profileView.centerCh !== null || profileView.centerEl !== null){
    ctx.fillStyle = '#8A9AA3';
    ctx.fillText('Zoom ×' + zoom.toFixed(1) + ' — double-click to reset', padL+plotW, padT+7);
  }
  if (state.driveway.enabled){
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4FA8FF';
    ctx.fillText('— Proposed driveway', padL, padT-10);
    if (state.driveway.vehicleCheck.enabled){
      var vcLegendW = ctx.measureText('— Proposed driveway').width;
      ctx.fillStyle = '#8A9AA3';
      ctx.fillText('  ┄ vehicle underside (green = clear, red = scrapes)', padL + vcLegendW, padT-10);
    }
  }

  // Grade-break chainage lines — always at the start and end of the
  // section, plus anywhere the ground deviates from a straight grade by
  // more than the configured tolerance. Dashed verticals first (behind
  // the ground line); markers + labels are added after it's drawn. Only
  // the ones inside the current zoomed/panned window are worth drawing;
  // everything but the bottom chainage labels is clipped to the plot
  // rectangle too, since once zoomed or panned these can otherwise run
  // past the visible window and bleed into the axis-label margins.
  var breakTolerance = parseFloat($<HTMLInputElement>('grade-break-tolerance').value);
  if (isNaN(breakTolerance) || breakTolerance <= 0) breakTolerance = 0.05;
  var allBreaks = computeGradeBreaks(samples, breakTolerance);
  var breaks = allBreaks.filter(function(b){ return b.chainage>=visMinCh && b.chainage<=visMaxCh; });

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();

  ctx.setLineDash([4,3]);
  ctx.strokeStyle = 'rgba(242,103,34,0.55)';
  ctx.lineWidth = 1;
  for (var bi=0; bi<breaks.length; bi++){
    var bxx = px(breaks[bi].chainage);
    ctx.beginPath(); ctx.moveTo(bxx, padT); ctx.lineTo(bxx, padT+plotH); ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.strokeStyle = '#D9D6CF';
  ctx.lineWidth = 2;
  var started = false;
  for (var i2=0;i2<profileData.samples.length;i2++){
    var s = profileData.samples[i2];
    if (s.elevation===null){ started=false; continue; }
    var X = px(s.chainage), Y = py(s.elevation);
    if (!started){ ctx.moveTo(X,Y); started=true; } else { ctx.lineTo(X,Y); }
  }
  ctx.stroke();

  // fill under line
  ctx.lineTo(px(samples[samples.length-1].chainage), padT+plotH);
  ctx.lineTo(px(samples[0].chainage), padT+plotH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(217,214,207,0.07)';
  ctx.fill();

  // Grade-break markers on the ground line.
  ctx.fillStyle = '#F26722';
  for (var bm=0; bm<breaks.length; bm++){
    var mx = px(breaks[bm].chainage), my = py(breaks[bm].elevation);
    ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI*2); ctx.fill();
  }

  // Grade % between each pair of consecutive grade breaks (existing
  // ground only — a design/proposed surface, if any, is handled in
  // AutoCAD, not here). Uses the full break list (not just the ones
  // whose midpoint happens to be on screen) so segments spanning the
  // edge of the visible window still get labelled.
  ctx.font = '10.5px IBM Plex Mono';
  ctx.textAlign = 'center';
  for (var gi=0; gi<allBreaks.length-1; gi++){
    var gb0 = allBreaks[gi], gb1 = allBreaks[gi+1];
    var gRun = gb1.chainage - gb0.chainage;
    if (gRun <= 1e-6) continue;
    var gMidCh = (gb0.chainage + gb1.chainage) / 2;
    if (gMidCh < visMinCh || gMidCh > visMaxCh) continue;
    var gradePct = ((gb1.elevation - gb0.elevation) / gRun) * 100;
    var gLabel = (gradePct >= 0 ? '+' : '') + gradePct.toFixed(2) + '%';
    var glx = px(gMidCh), gly = py((gb0.elevation + gb1.elevation) / 2);
    var gtw = ctx.measureText(gLabel).width;
    ctx.fillStyle = 'rgba(14,14,16,0.72)';
    ctx.fillRect(glx - gtw/2 - 3, gly - 20, gtw + 6, 13);
    ctx.fillStyle = '#F26722';
    ctx.fillText(gLabel, glx, gly - 10);
  }

  // Regular chainage/RL interval marks — a separate, user-set reading
  // ladder (e.g. every 10m), independent of where the real grade
  // breaks are. Neutral gray so it reads as reference grid rather than
  // competing with the orange grade-break annotations.
  if ($<HTMLInputElement>('chk-chainage-interval').checked){
    var intervalVal = parseFloat($<HTMLInputElement>('chainage-interval-value').value);
    if (!isNaN(intervalVal) && intervalVal > 0){
      var intervalMarks = computeIntervalMarks(intervalVal).filter(function(m){
        return m.elevation !== null && m.chainage >= visMinCh && m.chainage <= visMaxCh;
      });
      var showIntervalLabels = (pxPerUnitX * intervalVal) > 46;
      ctx.setLineDash([2,2]);
      ctx.strokeStyle = 'rgba(154,154,158,0.4)';
      ctx.lineWidth = 1;
      for (var im=0; im<intervalMarks.length; im++){
        var iixx = px(intervalMarks[im].chainage);
        ctx.beginPath(); ctx.moveTo(iixx, padT); ctx.lineTo(iixx, padT+plotH); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (var im2=0; im2<intervalMarks.length; im2++){
        var im2m = intervalMarks[im2];
        var imxx = px(im2m.chainage), imyy = py(im2m.elevation);
        ctx.fillStyle = '#C7C5C0';
        ctx.beginPath(); ctx.arc(imxx, imyy, 2, 0, Math.PI*2); ctx.fill();
        if (showIntervalLabels){
          ctx.font = '9px IBM Plex Mono';
          ctx.textAlign = 'center';
          ctx.fillText(im2m.chainage.toFixed(0), imxx, imyy+16);
          ctx.fillText(im2m.elevation.toFixed(2), imxx, imyy+27);
        }
      }
    }
  }

  // Manually-set datum reference line, if enabled — Thom's own chosen
  // RL (never computed by the app), drawn right across the section and
  // labelled, same convention as a datum line on a council long-section
  // drawing. Clipped to the plot rectangle like everything else here —
  // if the chosen datum sits well outside the currently visible
  // elevation range (common: a datum is usually well below the ground),
  // it simply doesn't show until zoomed/panned to it. The DXF export
  // (see exportSectionDXF) always includes it regardless of on-screen
  // visibility, which is what actually matters for Thom's drawings.
  var datumRL = datumRLValue();
  if (datumRL !== null){
    var datumY = py(datumRL);
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, plotW, plotH);
    ctx.clip();
    ctx.setLineDash([4,3]);
    ctx.strokeStyle = '#8A8A90';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(padL, datumY);
    ctx.lineTo(padL+plotW, datumY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '10px IBM Plex Mono';
    ctx.fillStyle = '#8A8A90';
    ctx.textAlign = 'left';
    ctx.fillText('DATUM RL ' + datumRL.toFixed(3), padL+4, datumY-4);
    ctx.restore();
  }

  // Proposed driveway design overlay, if enabled — a distinct blue so
  // it's never mistaken for surveyed existing ground; any leg or PVI
  // that fails the configured grade/transition checks below is picked
  // out in red instead.
  if (state.driveway.enabled){
    var dwProfile = computeDrivewayProfile();
    if (dwProfile){
      var dwRules = drivewayRules();

      // Vehicle outline silhouette computed and drawn here, before the
      // design line/PVIs/grade labels below, so it sits underneath all
      // of them (drawVehicleOutlineSilhouette itself explains why).
      // vcTemplate/vcRes are reused by the underside-line block further
      // down instead of being recomputed there.
      var vcTemplate = null, vcRes = null;
      if (state.driveway.vehicleCheck.enabled && state.driveway.vehicleCheck.sweepChainage !== null){
        vcTemplate = VEHICLE_TEMPLATES[state.driveway.vehicleCheck.model];
        vcRes = sweepVehicleTemplateFrom(vcTemplate, state.driveway.vehicleCheck.sweepChainage,
          function(ch){ return driveGroundRLAt(dwProfile, ch); }, undefined, state.driveway.vehicleCheck.flipped);
        if (vcRes){
          drawVehicleOutlineSilhouette(ctx, px, py, pxPerUnitX, pxPerUnitY, vcTemplate, vcRes,
            state.driveway.vehicleCheck.sweepChainage, state.driveway.vehicleCheck.flipped);
        }
      }

      var dwChecks = legGradeChecksFrom(dwProfile.legs, dwRules);
      for (var dl=0; dl<dwProfile.legs.length; dl++){
        var dleg = dwProfile.legs[dl];
        var dwBad = dwChecks[dl].exceeds;
        ctx.beginPath();
        ctx.strokeStyle = dwBad ? '#E0574A' : '#4FA8FF';
        ctx.lineWidth = 2.5;
        ctx.moveTo(px(dleg.from.chainage), py(dleg.from.rl));
        ctx.lineTo(px(dleg.to.chainage), py(dleg.to.rl));
        ctx.stroke();
      }
      for (var dp=0; dp<dwProfile.pvis.length; dp++){
        var dpv = dwProfile.pvis[dp];
        if (dpv.chainage < visMinCh || dpv.chainage > visMaxCh) continue;
        var dpx = px(dpv.chainage), dpy = py(dpv.rl);
        ctx.fillStyle = '#4FA8FF';
        ctx.beginPath(); ctx.arc(dpx, dpy, 3.5, 0, Math.PI*2); ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#0d0d0f';
        ctx.stroke();
      }
      ctx.font = '10px IBM Plex Mono';
      ctx.textAlign = 'center';
      for (var dg=0; dg<dwProfile.legs.length; dg++){
        var gleg = dwProfile.legs[dg];
        var gMid = (gleg.from.chainage + gleg.to.chainage) / 2;
        if (gMid < visMinCh || gMid > visMaxCh) continue;
        var dgy = py((gleg.from.rl + gleg.to.rl) / 2);
        var dgx = px(gMid);
        var dglabel;
        if (gleg.isVertical){
          var gRiseMm = Math.round((gleg.to.rl - gleg.from.rl) * 1000);
          dglabel = (gRiseMm>=0?'+':'') + gRiseMm + 'mm vert.';
        } else if (gleg.isTemplate){
          var gLegRiseMm = Math.round((gleg.to.rl - gleg.from.rl) * 1000);
          var gLegRunMm = Math.round(gleg.run * 1000);
          dglabel = (gLegRiseMm>=0?'+':'') + gLegRiseMm + 'mm/' + gLegRunMm + 'mm';
        } else {
          dglabel = (gleg.grade>=0?'+':'') + gleg.grade.toFixed(2) + '%';
        }
        var dgw = ctx.measureText(dglabel).width;
        ctx.fillStyle = 'rgba(14,14,16,0.72)';
        ctx.fillRect(dgx-dgw/2-3, dgy+6, dgw+6, 13);
        ctx.fillStyle = '#4FA8FF';
        ctx.fillText(dglabel, dgx, dgy+16);
      }
    }

    // Vehicle scrape check overlay — an indicative car silhouette
    // (NOT to scale — a real 1.4-1.8m-tall car would be imperceptible
    // next to a chart spanning tens of metres of chainage at true
    // scale) sitting on the rigid underside line at the current slider
    // position, green when clear, red where it scrapes, with the two
    // wheel-contact points marked. Drawn on the same profile the
    // driveway design line uses, so it always reads against the
    // design, not the raw existing ground.
    if (vcRes){
        var vcColor = vcRes.scrapes ? '#E0574A' : '#3ECF8E';
        var vcN = vcRes.samples.length;
        // Not necessarily "front"/"rear" — which physical wheel sits at
        // sweepChainage vs. sweepChainage+wheelbase depends on
        // state.driveway.vehicleCheck.flipped (see driveway/vehicle.ts);
        // both are drawn identically below regardless.
        var vcWheelACh = state.driveway.vehicleCheck.sweepChainage;
        var vcWheelBCh = vcWheelACh + vcTemplate.wheelbase;
        var vcWheelR = 7; // overridden below once the icon's screen scale is known
        // No car body/roofline drawn any more — tried a full silhouette,
        // then a simplified outline, and Thom asked to drop the "top of
        // the car" outline entirely (it was reading as visual clutter
        // overlapping the design line and kerb/layback labels in busy
        // areas of the chart). What's left is exactly what matters for
        // the check: the underside line below (the real, ground-
        // clearance-accurate swept profile) plus the wheel-contact
        // markers — the readout text and compliance summary are the
        // reliable source of truth regardless.
        if (vcN > 1){
          var vcFx0 = px(vcRes.samples[0].chainage), vcFy0 = py(vcRes.samples[0].rl);
          var vcFxN = px(vcRes.samples[vcN-1].chainage), vcFyN = py(vcRes.samples[vcN-1].rl);
          var vcBodyLenPx = Math.hypot(vcFxN-vcFx0, vcFyN-vcFy0);
          vcWheelR = Math.max(5, Math.min(9, Math.max(26, Math.min(60, vcBodyLenPx * 0.38)) * 0.22));
        }
        ctx.beginPath();
        ctx.strokeStyle = vcColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([6,3]);
        var vcStarted = false;
        for (var vi=0; vi<vcRes.samples.length; vi++){
          var vsx = px(vcRes.samples[vi].chainage), vsy = py(vcRes.samples[vi].rl);
          if (!vcStarted){ ctx.moveTo(vsx, vsy); vcStarted = true; } else { ctx.lineTo(vsx, vsy); }
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // Wheel-contact markers — dark tire with a small lighter hub,
        // sized off the same indicative scale as the body so it reads
        // as one consistent icon at any zoom.
        [vcWheelACh, vcWheelBCh].forEach(function(wch){
          var wrl = driveGroundRLAt(dwProfile, wch);
          if (wrl === null) return;
          ctx.fillStyle = '#1a1a1c';
          ctx.beginPath(); ctx.arc(px(wch), py(wrl), vcWheelR, 0, Math.PI*2); ctx.fill();
          ctx.lineWidth = 1.25; ctx.strokeStyle = vcColor; ctx.stroke();
          ctx.fillStyle = '#5a5a60';
          ctx.beginPath(); ctx.arc(px(wch), py(wrl), vcWheelR*0.42, 0, Math.PI*2); ctx.fill();
        });
        if (vcRes.worstChainage !== null && vcRes.worstChainage >= visMinCh && vcRes.worstChainage <= visMaxCh){
          var vcLabel = (vcRes.scrapes ? 'SCRAPES ' : 'clears ') + Math.round(Math.abs(vcRes.minClearance)*1000) + 'mm';
          var vcLx = px(vcRes.worstChainage), vcLy = py(vcRes.worstUnderRL);
          ctx.font = '10px IBM Plex Mono';
          ctx.textAlign = 'center';
          var vcLw = ctx.measureText(vcLabel).width;
          ctx.fillStyle = 'rgba(14,14,16,0.78)';
          ctx.fillRect(vcLx-vcLw/2-3, vcLy-30, vcLw+6, 13);
          ctx.fillStyle = vcColor;
          ctx.fillText(vcLabel, vcLx, vcLy-20);
        }
    }
  }

  ctx.restore();

  // Break chainage values, rotated vertically below the axis so
  // closely-spaced breaks don't overlap — these live in the bottom
  // margin, outside the plot rectangle, so they're drawn unclipped.
  ctx.font = '10px IBM Plex Mono';
  ctx.fillStyle = '#F26722';
  for (var bl=0; bl<breaks.length; bl++){
    var lx = px(breaks[bl].chainage);
    ctx.save();
    ctx.translate(lx, padT+plotH+26);
    ctx.rotate(Math.PI/2);
    ctx.textAlign = 'left';
    ctx.fillText(breaks[bl].chainage.toFixed(2), 0, 3);
    ctx.restore();
  }

  canvas._plotMeta = {
    px:px, py:py, padL:padL, padT:padT, plotW:plotW, plotH:plotH,
    pxPerUnitX:pxPerUnitX, pxPerUnitY:pxPerUnitY, centerCh:centerCh, centerEl:centerEl
  };
}

function niceStep(rough: number): number {
  if (rough<=0) return 1;
  var mag = Math.pow(10, Math.floor(Math.log10(rough)));
  var norm = rough/mag;
  var step: number;
  if (norm < 1.5) step=1; else if (norm<3) step=2; else if (norm<7) step=5; else step=10;
  return step*mag;
}

$<HTMLCanvasElement>('profile-canvas').addEventListener('mousemove', function(e){
  if (isCrossfallVisible()) return; // owned by the crossfall marker handlers below
  if (profileDragging){ profileDragMoved = true; return; } // drag handled by the window-level pointermove below
  var canvas = $<HTMLCanvasElement>('profile-canvas');
  var meta = canvas._plotMeta;
  var tip = $('profile-tooltip');
  if (!meta || !profileData){ tip.style.display='none'; hideHoverMarker(); return; }
  var rect = canvas.getBoundingClientRect();
  var mx = e.clientX-rect.left;
  if (mx<meta.padL || mx>meta.padL+meta.plotW){ tip.style.display='none'; hideHoverMarker(); return; }
  var ch = meta.centerCh + (mx - meta.padL - meta.plotW/2) / meta.pxPerUnitX;
  var hoverPt = interpolatedSampleAt(profileData.samples, ch);
  if (!hoverPt || hoverPt.elevation===null){ tip.style.display='none'; hideHoverMarker(); return; }
  tip.style.display = 'block';
  tip.style.left = (mx+16)+'px';
  tip.style.top = (e.clientY-rect.top-10)+'px';
  tip.innerHTML = '<span class="mono">Ch ' + hoverPt.chainage.toFixed(2) + '&nbsp;&nbsp;El ' + hoverPt.elevation.toFixed(3) + '</span>';
  if (is3DVisible()) showHoverMarker(hoverPt.x, hoverPt.y, hoverPt.elevation); else hideHoverMarker();
});
$<HTMLCanvasElement>('profile-canvas').addEventListener('mouseleave', function(){
  if (!profileDragging) $('profile-tooltip').style.display='none';
  if (!profileDragging) hideHoverMarker();
});

// ------------------------------------------------------------
// Long section pan (drag) + zoom (wheel) + reset (double-click).
// Mirrors the 3D view's own orbit/zoom conventions: drag to pan,
// scroll to zoom (toward the cursor), double-click to reset.
// ------------------------------------------------------------
var profileDragging = false, profileDragMoved = false, profileDragLastX = 0, profileDragLastY = 0;
var crossfallMarkerDragging = false;

$<HTMLCanvasElement>('profile-canvas').addEventListener('pointerdown', function(e){
  if (isCrossfallVisible()) return; // owned by the crossfall marker handlers below
  var meta = $<HTMLCanvasElement>('profile-canvas')._plotMeta;
  if (!meta) return;
  profileDragging = true;
  profileDragMoved = false;
  profileDragLastX = e.clientX;
  profileDragLastY = e.clientY;
  $('profile-tooltip').style.display = 'none';
  hideHoverMarker();
});
window.addEventListener('pointermove', function(e){
  if (!profileDragging) return;
  var meta = $<HTMLCanvasElement>('profile-canvas')._plotMeta;
  if (!meta) return;
  var dx = e.clientX-profileDragLastX, dy = e.clientY-profileDragLastY;
  profileDragLastX = e.clientX;
  profileDragLastY = e.clientY;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) profileDragMoved = true;
  profileView.centerCh = meta.centerCh - dx/meta.pxPerUnitX;
  profileView.centerEl = meta.centerEl + dy/meta.pxPerUnitY;
  drawProfile();
});
window.addEventListener('pointerup', function(){ profileDragging = false; });

$<HTMLCanvasElement>('profile-canvas').addEventListener('wheel', function(e){
  if (isCrossfallVisible()) return;
  var canvas = $<HTMLCanvasElement>('profile-canvas');
  var meta = canvas._plotMeta;
  if (!meta || !profileData) return;
  e.preventDefault();
  var rect = canvas.getBoundingClientRect();
  var mx = e.clientX-rect.left, my = e.clientY-rect.top;
  // World point currently under the cursor, before the zoom changes.
  var chUnder = meta.centerCh + (mx - meta.padL - meta.plotW/2) / meta.pxPerUnitX;
  var elUnder = meta.centerEl - (my - meta.padT - meta.plotH/2) / meta.pxPerUnitY;
  var factor = Math.exp(-e.deltaY * 0.0015);
  var newZoom = Math.max(0.15, Math.min(60, profileView.zoom * factor));
  var ratio = newZoom / profileView.zoom;
  var newPxPerUnitX = meta.pxPerUnitX * ratio, newPxPerUnitY = meta.pxPerUnitY * ratio;
  profileView.zoom = newZoom;
  profileView.centerCh = chUnder - (mx - meta.padL - meta.plotW/2) / newPxPerUnitX;
  profileView.centerEl = elUnder + (my - meta.padT - meta.plotH/2) / newPxPerUnitY;
  drawProfile();
}, {passive:false});

$<HTMLCanvasElement>('profile-canvas').addEventListener('dblclick', function(){
  if (isCrossfallVisible()) return;
  resetProfileView();
  drawProfile();
});

// ------------------------------------------------------------
// Crossfall view: draggable chainage readout marker (§5.4 Stage 0c
// item 10). Separate from the pan/zoom handlers above, guarded the
// other way (only act when the crossfall view IS showing) so the two
// sets of handlers on this shared canvas never both act on the same
// gesture. Uses canvas._xfPlotMeta (set at the end of
// drawCrossfallView) rather than _plotMeta, which belongs to the
// regular long-section view and isn't kept current while this view
// is showing.
// ------------------------------------------------------------
function crossfallChainageFromEvent(e: {clientX: number}): number | null {
  var canvas = $<HTMLCanvasElement>('profile-canvas');
  var meta = canvas._xfPlotMeta;
  if (!meta) return null;
  var rect = canvas.getBoundingClientRect();
  var mx = e.clientX - rect.left;
  var ch = ((mx - meta.padL) / meta.plotW) * meta.rangeEnd;
  return Math.max(0, Math.min(meta.rangeEnd, ch));
}
$<HTMLCanvasElement>('profile-canvas').addEventListener('pointerdown', function(e){
  if (!isCrossfallVisible()) return;
  var ch = crossfallChainageFromEvent(e);
  if (ch === null) return;
  crossfallMarkerDragging = true;
  state.crossfall.markerChainage = ch;
  drawProfile();
});
window.addEventListener('pointermove', function(e){
  if (!crossfallMarkerDragging) return;
  var ch = crossfallChainageFromEvent(e);
  if (ch === null) return;
  state.crossfall.markerChainage = ch;
  drawProfile();
});
window.addEventListener('pointerup', function(){ crossfallMarkerDragging = false; });
