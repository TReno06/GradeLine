// Rendering — the long-section/crossfall canvas — PLAN.md Stage 2
// checkpoint 3 port, extracted verbatim from main.js. Only drawProfile
// is used outside this module; drawCrossfallView/niceStep/
// crossfallChainageFromEvent are internal to it, matching how they were
// only ever called from within this same area of main.js before the
// port. (interpolatedSampleAt moved to geometry/chainage.ts so it can be
// unit tested.)
import { C } from './theme.ts';
import { $, escapeHtml } from './dom.ts';
import { state, drivewayStateFor, alignmentNumberName } from './state.ts';
import { isCrossfallVisible, isProfileVisible, is3DVisible } from './viewstate.ts';
import {
  profileData, profileView, resetProfileView, triIndex,
  centeredVertsForAlignment, cumulativeChainages, existingElevationAtChainageForVerts,
  computeGradeBreaks, computeIntervalMarks, datumRLValue
} from './longsection.ts';
import {
  computeDrivewayProfile, computeDrivewayProfileForPvis, drivewayRules,
  driveGroundRLAt, driveGroundRLAtForVerts, alignmentSeparationAt, drawVehicleOutlineSilhouette, activeVehicleTemplate
} from './driveway.ts';
import { legGradeChecksFrom } from './driveway/profile.ts';
import { sweepVehicleTemplateFrom } from './driveway/vehicle.ts';
import { computeCrossfallSeriesFrom, computeCrossfallSeriesPerpendicular } from './crossfall.ts';
import { pointAtChainage, chainageSquareAcross, interpolatedSampleAt } from './geometry/chainage.ts';
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
    ctx.fillStyle = C.faint;
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

  var nameA = alignmentNumberName(idxA), nameB = alignmentNumberName(idxB);
  var captionA = nameA + ' (' + aligns[idxA].label + ')', captionB = nameB + ' (' + aligns[idxB].label + ')';
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
      ? 'Crossfall is read SQUARE ACROSS from Alignment A: at each chainage on A, a line square to A is drawn across to Alignment B and B’s level is read where it crosses — the true fall across the driveway, even on a bend (where the inside edge is shorter, so matching chainage values compare the wrong places). Past B’s ends, the nearest point on B is used. B’s chart panel is resampled onto A’s chainage axis.'
      : 'Crossfall is read at MATCHING CHAINAGE VALUE along each alignment (chainage 10.00 on A vs chainage 10.00 on B) — not a true perpendicular projection between the two lines. Only meaningful when both alignments start at a comparable point and run roughly parallel over a similar length.';
  }
  function projectAtoB(chA: number): number {
    return chainageSquareAcross(vertsA, cumA, Math.max(0, Math.min(chA, totalA)), vertsB, cumB).chainage;
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
  var padL=64, padR=20, padT=72, gap=30;
  var panelH = (canvas.height - padT - gap*2 - 24) / 3;
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
    ctx.strokeStyle = C.panelBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, top, plotW, panelH);
    ctx.fillStyle = C.panelLabel;
    ctx.font = '11px IBM Plex Mono';
    ctx.textAlign = 'left';
    ctx.fillText(label, padL, top-7);
    if (!vals.length){
      ctx.fillStyle = C.faint;
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
    ctx.strokeStyle = C.miniGround;
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
      ctx.strokeStyle = C.design;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    // Axis readout shows the panel's actual VISIBLE range at this
    // true scale (not the data's own min/max) — at 1:1 that range is
    // usually only a few centimetres tall, which is the honest point.
    var topVal = centerVal + (panelH/2)/pxPerMetre, botVal = centerVal - (panelH/2)/pxPerMetre;
    ctx.fillStyle = C.faint;
    ctx.font = '10px IBM Plex Mono';
    ctx.textAlign = 'right';
    ctx.fillText(topVal.toFixed(2), padL-6, top+10);
    ctx.fillText(botVal.toFixed(2), padL-6, top+panelH-2);
  }

  drawMiniProfile(panelTop(0), 'A: ' + captionA + ' — existing ground (grey)' + (profA ? ' / design (blue)' : '') + ' — true scale',
    groundOnlyA, profA ? designOrGroundA : null);
  drawMiniProfile(panelTop(1), 'B: ' + captionB + ' — existing ground (grey)' + (profB ? ' / design (blue)' : '') + ' — true scale',
    groundOnlyB, profB ? designOrGroundB : null);

  // ---- Cross-section at the chosen chainage (2026-11-08) ----
  // Owner: "the cross fall should just be a straight line between both
  // alignments at a perpendicular angle", picked at a driveway design
  // chainage. The bottom panel used to plot crossfall against chainage;
  // it now draws the section across the driveway at the marker's
  // chainage: a straight design line from A's level to B's level, square
  // across (or at matching chainage, if that method is picked), over the
  // existing ground along the same line.
  var summaryEl = $('xf-summary-body');
  var worst = series.reduce(function(w: typeof series[number] | null, p){ return (w===null || Math.abs(p.crossfall) > Math.abs(w.crossfall)) ? p : w; }, null);
  if (state.crossfall.markerChainage === null){
    // Default to the worst crossfall, or the start if nothing overlaps.
    state.crossfall.markerChainage = worst ? worst.chainage : 0;
  }
  var markerCh = Math.max(0, Math.min(rangeEnd, state.crossfall.markerChainage));

  // Design-chainage picker: A's design points (each chainage once).
  var pickEl = $<HTMLSelectElement>('xf-design-chainage');
  if (pickEl){
    var chs: {ch: number; tag: string}[] = [];
    (profA ? profA.pvis : []).forEach(function(p){
      if (p.chainage < -1e-9 || p.chainage > rangeEnd + 1e-9) return;
      var c = Math.round(p.chainage * 1000) / 1000;
      var hit = chs.find(function(x){ return Math.abs(x.ch - c) < 1e-6; });
      var tag = p.template === 'kerb' ? 'kerb' : (p.template === 'layback' ? 'layback' : '');
      if (hit){ if (!hit.tag) hit.tag = tag; return; }
      chs.push({ch: c, tag: tag});
    });
    chs.sort(function(x, y){ return x.ch - y.ch; });
    var optsHtml = '<option value="">' + (chs.length ? 'Pick a design chainage…' : 'No design on ' + escapeHtml(nameA) + ' — drag or type below') + '</option>' +
      chs.map(function(x){ return '<option value="' + x.ch.toFixed(3) + '">' + x.ch.toFixed(2) + ' m' + (x.tag ? ' — ' + x.tag : '') + '</option>'; }).join('');
    if (pickEl.dataset.sig !== optsHtml){ pickEl.innerHTML = optsHtml; pickEl.dataset.sig = optsHtml; }
    if (document.activeElement !== pickEl){
      var match = chs.find(function(x){ return Math.abs(x.ch - markerCh) < 0.0005; });
      pickEl.value = match ? match.ch.toFixed(3) : '';
    }
  }

  var xsTop = panelTop(2);
  ctx.strokeStyle = C.panelBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, xsTop, plotW, panelH);

  // The two ends of the section line.
  var ptA = pointAtChainage(vertsA, cumA, Math.min(markerCh, totalA));
  var chB = perpendicular ? chainageSquareAcross(vertsA, cumA, markerCh, vertsB, cumB).chainage : Math.min(markerCh, totalB);
  var ptB = pointAtChainage(vertsB, cumB, chB);
  var width = Math.hypot(ptB.x - ptA.x, ptB.y - ptA.y);
  var rlA = designOrGroundARaw(markerCh), rlB = designOrGroundBRaw(chB);
  var titleBits = 'Cross-section at chainage ' + markerCh.toFixed(2) + ' — ' + (perpendicular ? 'square across' : 'matching chainage') +
    ', A to B — ' + (profA || profB ? 'design (blue), ' : '') + 'ground (grey)';
  var readoutEl = $('xf-marker-readout');
  if (rlA === null || rlB === null || !(width > 1e-6)){
    ctx.fillStyle = C.panelLabel; ctx.font = '11px IBM Plex Mono'; ctx.textAlign = 'left';
    ctx.fillText(titleBits, padL+8, xsTop+16);
    ctx.fillStyle = C.faint; ctx.font = '12px IBM Plex Sans'; ctx.textAlign = 'center';
    ctx.fillText('No level on both alignments at this chainage.', padL+plotW/2, xsTop+panelH/2);
    if (readoutEl) readoutEl.innerHTML = 'No level on both alignments at chainage ' + markerCh.toFixed(2) + '.';
  } else {
    // Existing ground along the section line, carried 25% past each end.
    var ext = width * 0.25;
    var ux = (ptB.x - ptA.x) / width, uy = (ptB.y - ptA.y) / width;
    var line2 = [{x: ptA.x - ux*ext, y: ptA.y - uy*ext}, {x: ptB.x + ux*ext, y: ptB.y + uy*ext}];
    var groundXs: {o: number; z: number | null}[] = [];
    for (var gi = 0; gi <= 80; gi++){
      var o = -ext + (width + 2*ext) * gi / 80;
      groundXs.push({o: o, z: existingElevationAtChainageForVerts(line2, o + ext)});
    }
    var zs = [rlA, rlB];
    groundXs.forEach(function(g){ if (g.z !== null) zs.push(g.z); });
    var zMin = Math.min.apply(null, zs), zMax = Math.max.apply(null, zs);
    // Horizontal: the section fills the panel. Vertical: true scale where
    // it fits; otherwise exaggerated just enough to fit (a 3m-wide section
    // usually has only tens of mm of fall, so it's said on the chart).
    var innerL = padL + 70, innerW = plotW - 140;
    var pxPerM = innerW / (width + 2*ext);
    var usableH = panelH - 50;
    var vx = 1;
    if ((zMax - zMin) * pxPerM > usableH) vx = 1; // taller than the panel at 1:1 — shrink below instead
    var vScale = pxPerM * vx;
    if ((zMax - zMin) * vScale > usableH) vScale = usableH / Math.max(zMax - zMin, 1e-6);
    else if ((zMax - zMin) * vScale < usableH * 0.35){
      vScale = Math.min(pxPerM * 20, usableH * 0.35 / Math.max(zMax - zMin, 0.005));
    }
    var exag = vScale / pxPerM;
    var exagNote = Math.abs(exag - 1) < 0.05 ? 'true scale' : (exag > 1 ? 'vertical ×' + (exag >= 10 ? Math.round(exag) : exag.toFixed(1)) : 'vertical ×' + exag.toFixed(2));
    ctx.fillStyle = C.panelLabel; ctx.font = '11px IBM Plex Mono'; ctx.textAlign = 'left';
    // Narrower windows (the desktop app opens at 1440 wide): drop the
    // legend from the title rather than run it into the scale note.
    var titleFit = titleBits;
    if (ctx.measureText(titleFit).width + ctx.measureText(exagNote).width + 40 > plotW){
      titleFit = 'Cross-section at ch ' + markerCh.toFixed(2) + ' — ' + (perpendicular ? 'square across' : 'matching chainage') + ', A to B';
    }
    ctx.fillText(titleFit, padL+8, xsTop+16);
    ctx.textAlign = 'right';
    ctx.fillText(exagNote, padL+plotW-8, xsTop+16);
    var zMid = (zMin + zMax) / 2, yMid = xsTop + 26 + usableH / 2;
    function sx(o: number){ return innerL + (o + ext) * pxPerM; }
    function sy(z: number){ return yMid - (z - zMid) * vScale; }

    ctx.save();
    ctx.beginPath(); ctx.rect(padL, xsTop, plotW, panelH); ctx.clip();
    // Edge verticals at A and B.
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
    [0, width].forEach(function(o){ ctx.beginPath(); ctx.moveTo(sx(o), xsTop+4); ctx.lineTo(sx(o), xsTop+panelH-18); ctx.stroke(); });
    ctx.setLineDash([]);
    // Existing ground.
    ctx.beginPath();
    var gStarted = false;
    groundXs.forEach(function(g){
      if (g.z === null){ gStarted = false; return; }
      if (!gStarted){ ctx.moveTo(sx(g.o), sy(g.z)); gStarted = true; } else ctx.lineTo(sx(g.o), sy(g.z));
    });
    ctx.strokeStyle = C.miniGround; ctx.lineWidth = 1.5; ctx.stroke();
    // The crossfall: one straight line, A to B.
    ctx.beginPath(); ctx.moveTo(sx(0), sy(rlA)); ctx.lineTo(sx(width), sy(rlB));
    ctx.strokeStyle = (profA || profB) ? C.design : C.xfLine; ctx.lineWidth = 2.5; ctx.stroke();
    [[0, rlA], [width, rlB]].forEach(function(p){
      ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 4, 0, Math.PI*2); ctx.fillStyle = C.accent; ctx.fill();
    });
    ctx.restore();

    var fall = rlB - rlA, pct = fall / width * 100;
    ctx.font = '11px IBM Plex Mono';
    ctx.fillStyle = C.axisText;
    ctx.textAlign = 'right';
    ctx.fillText('A ' + rlA.toFixed(3), sx(0) - 8, sy(rlA) + 4);
    ctx.textAlign = 'left';
    ctx.fillText('B ' + rlB.toFixed(3), sx(width) + 8, sy(rlB) + 4);
    ctx.textAlign = 'center';
    ctx.font = '12px IBM Plex Mono';
    ctx.fillStyle = C.xfLine;
    ctx.fillText((fall >= 0 ? '+' : '') + Math.round(fall*1000) + 'mm  (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)', sx(width/2), Math.min(sy(rlA), sy(rlB)) - 12);
    ctx.fillStyle = C.faint;
    ctx.font = '10px IBM Plex Mono';
    ctx.fillText(width.toFixed(2) + ' m across', sx(width/2), xsTop + panelH - 6);
    ctx.textAlign = 'center';
    ctx.fillText('A', sx(0), xsTop + panelH - 6);
    ctx.fillText('B', sx(width), xsTop + panelH - 6);

    if (readoutEl){
      readoutEl.innerHTML =
        'Chainage ' + markerCh.toFixed(2) + 'm on ' + escapeHtml(nameA) + (perpendicular ? ' (square across to ' + chB.toFixed(2) + 'm on ' + escapeHtml(nameB) + ')' : '') + '<br>' +
        escapeHtml(nameA) + ' (A) RL ' + rlA.toFixed(3) + ' &nbsp;&nbsp; ' + escapeHtml(nameB) + ' (B) RL ' + rlB.toFixed(3) + '<br>' +
        'Crossfall ' + (fall>=0?'+':'') + Math.round(fall*1000) + 'mm over ' + width.toFixed(2) + 'm (' + (pct>=0?'+':'') + pct.toFixed(1) + '%)';
    }
  }

  var pctNote = (worst && worst.crossfallPct!==null) ? (' (' + worst.crossfallPct.toFixed(1) + '%)') : '';
  if (summaryEl){
    summaryEl.innerHTML = !series.length ? 'No overlapping ground data between the two alignments.' :
      'Compared over chainage 0.00–' + rangeEnd.toFixed(2) + 'm.<br>' +
      'Worst crossfall: ' + (worst ? (Math.round(worst.crossfall*1000) + 'mm' + pctNote + ' at chainage ' + worst.chainage.toFixed(2)) : '—') + '<br>' +
      (profA ? '' : escapeHtml(nameA) + ' has no driveway design enabled — using existing ground.<br>') +
      (profB ? '' : escapeHtml(nameB) + ' has no driveway design enabled — using existing ground.<br>');
  }

  // Chainage marker across the two profile panels (drag it, type a
  // chainage, or pick a design chainage); the section below follows it.
  var chainageInput = $<HTMLInputElement>('xf-marker-chainage');
  if (chainageInput){
    chainageInput.max = rangeEnd.toFixed(2);
    if (document.activeElement !== chainageInput) chainageInput.value = markerCh.toFixed(2);
  }
  var mTop = panelTop(0), mBottom = panelTop(1) + panelH;
  var mx = chX(markerCh);
  ctx.beginPath(); ctx.moveTo(mx, mTop); ctx.lineTo(mx, mBottom);
  ctx.strokeStyle = C.marker; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(mx, mTop-6, 5, 0, Math.PI*2); ctx.fillStyle = C.accent; ctx.fill();
  // Chainage ticks under B's panel, so the marker can be read off.
  var chStep = niceStep(rangeEnd/8);
  ctx.fillStyle = C.faint; ctx.font = '10px IBM Plex Mono'; ctx.textAlign = 'center';
  for (var cv = 0; cv <= rangeEnd + 1e-9; cv += chStep) ctx.fillText(cv.toFixed(chStep >= 1 - 1e-9 ? 0 : (chStep >= 0.1 - 1e-9 ? 1 : 2)), chX(cv), mBottom + 13);

  canvas._xfPlotMeta = {padL:padL, plotW:plotW, rangeEnd:rangeEnd, yMax: mBottom + 16};
}

export function drawProfile(){
  var canvas = $<HTMLCanvasElement>('profile-canvas');
  var container = $('viewport-profile');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = C.chartBg;
  ctx.fillRect(0,0,canvas.width,canvas.height);

  if (isCrossfallVisible()){
    drawCrossfallView(canvas, ctx);
    return;
  }

  if (!profileData){
    ctx.fillStyle = C.faint;
    ctx.font = '13px IBM Plex Sans';
    ctx.textAlign = 'center';
    ctx.fillText('Load survey points and an alignment to see the existing terrain.', canvas.width/2, canvas.height/2);
    return;
  }

  var samples = profileData.samples.filter(function(s){ return s.elevation!==null; });
  if (samples.length < 2){
    ctx.fillStyle = C.faint;
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
  ctx.strokeStyle = C.grid;
  ctx.fillStyle = C.axisText;
  ctx.font = '10.5px IBM Plex Mono';
  var elStep = niceStep(visibleElRange/5);
  var elStart = Math.ceil(visMinEl/elStep)*elStep;
  ctx.textAlign = 'right';
  for (var e=elStart; e<=visMaxEl; e+=elStep){
    var yy = py(e);
    if (yy < padT-0.5 || yy > padT+plotH+0.5) continue;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL+plotW, yy); ctx.stroke();
    ctx.fillText(e.toFixed(elStep >= 0.01 - 1e-12 ? 2 : 3), padL-8, yy+3);
  }
  var chStep = niceStep(visibleChRange/6);
  var chStart = Math.ceil(visMinCh/chStep)*chStep;
  ctx.textAlign = 'center';
  for (var c=chStart; c<=visMaxCh; c+=chStep){
    var xx = px(c);
    if (xx < padL-0.5 || xx > padL+plotW+0.5) continue;
    ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT+plotH); ctx.stroke();
    // Enough decimals for the tick spacing, so a zoomed-in axis reads
    // 4.5, 5.0, 5.5 rather than repeating whole metres (5, 5, 6, 6).
    ctx.fillText(c.toFixed(chStep >= 1 - 1e-9 ? 0 : (chStep >= 0.1 - 1e-9 ? 1 : 2)), xx, padT+plotH+16);
  }
  ctx.fillStyle = C.faint;
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
  ctx.fillStyle = trueScale ? C.accent : C.axisText;
  ctx.fillText(trueScale ? 'True scale (1:1)' : ('V.E. ×' + effectiveVE.toFixed(1)), padL+plotW, padT-10);
  if (zoom !== 1 || profileView.centerCh !== null || profileView.centerEl !== null){
    ctx.fillStyle = C.axisText;
    ctx.fillText('Zoom ×' + zoom.toFixed(1) + ' — double-click to reset', padL+plotW, padT+7);
  }
  if (state.driveway.enabled){
    ctx.textAlign = 'left';
    ctx.fillStyle = C.design;
    ctx.fillText('— Proposed driveway', padL, padT-10);
    if (state.driveway.vehicleCheck.enabled){
      var vcLegendW = ctx.measureText('— Proposed driveway').width;
      ctx.fillStyle = C.axisText;
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
  ctx.strokeStyle = C.gradeBreak;
  ctx.lineWidth = 1;
  for (var bi=0; bi<breaks.length; bi++){
    var bxx = px(breaks[bi].chainage);
    ctx.beginPath(); ctx.moveTo(bxx, padT); ctx.lineTo(bxx, padT+plotH); ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.strokeStyle = C.ground;
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
  ctx.fillStyle = C.groundFill;
  ctx.fill();

  // Grade-break markers on the ground line.
  ctx.fillStyle = C.accent;
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
    ctx.fillStyle = C.labelBg;
    ctx.fillRect(glx - gtw/2 - 3, gly - 20, gtw + 6, 13);
    ctx.fillStyle = C.accent;
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
      ctx.strokeStyle = C.interval;
      ctx.lineWidth = 1;
      for (var im=0; im<intervalMarks.length; im++){
        var iixx = px(intervalMarks[im].chainage);
        ctx.beginPath(); ctx.moveTo(iixx, padT); ctx.lineTo(iixx, padT+plotH); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (var im2=0; im2<intervalMarks.length; im2++){
        var im2m = intervalMarks[im2];
        var imxx = px(im2m.chainage), imyy = py(im2m.elevation);
        ctx.fillStyle = C.intervalText;
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
    ctx.strokeStyle = C.datum;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(padL, datumY);
    ctx.lineTo(padL+plotW, datumY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '10px IBM Plex Mono';
    ctx.fillStyle = C.datum;
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
        vcTemplate = activeVehicleTemplate();
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
        ctx.strokeStyle = dwBad ? C.bad : C.design;
        ctx.lineWidth = 2.5;
        ctx.moveTo(px(dleg.from.chainage), py(dleg.from.rl));
        ctx.lineTo(px(dleg.to.chainage), py(dleg.to.rl));
        ctx.stroke();
      }
      for (var dp=0; dp<dwProfile.pvis.length; dp++){
        var dpv = dwProfile.pvis[dp];
        if (dpv.chainage < visMinCh || dpv.chainage > visMaxCh) continue;
        var dpx = px(dpv.chainage), dpy = py(dpv.rl);
        ctx.fillStyle = C.design;
        ctx.beginPath(); ctx.arc(dpx, dpy, 3.5, 0, Math.PI*2); ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = C.pviStroke;
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
        ctx.fillStyle = C.labelBg;
        ctx.fillRect(dgx-dgw/2-3, dgy+6, dgw+6, 13);
        ctx.fillStyle = C.design;
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
        var vcColor = vcRes.scrapes ? C.bad : C.ok;
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
          ctx.fillStyle = C.tire;
          ctx.beginPath(); ctx.arc(px(wch), py(wrl), vcWheelR, 0, Math.PI*2); ctx.fill();
          ctx.lineWidth = 1.25; ctx.strokeStyle = vcColor; ctx.stroke();
          ctx.fillStyle = C.hub;
          ctx.beginPath(); ctx.arc(px(wch), py(wrl), vcWheelR*0.42, 0, Math.PI*2); ctx.fill();
        });
        if (vcRes.worstChainage !== null && vcRes.worstChainage >= visMinCh && vcRes.worstChainage <= visMaxCh){
          var vcLabel = (vcRes.scrapes ? 'SCRAPES ' : 'clears ') + Math.round(Math.abs(vcRes.minClearance)*1000) + 'mm';
          var vcLx = px(vcRes.worstChainage), vcLy = py(vcRes.worstUnderRL);
          ctx.font = '10px IBM Plex Mono';
          ctx.textAlign = 'center';
          var vcLw = ctx.measureText(vcLabel).width;
          ctx.fillStyle = C.labelBgStrong;
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
  ctx.fillStyle = C.accent;
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
function crossfallChainageFromEvent(e: {clientX: number; clientY?: number}): number | null {
  var canvas = $<HTMLCanvasElement>('profile-canvas');
  var meta = canvas._xfPlotMeta;
  if (!meta) return null;
  var rect = canvas.getBoundingClientRect();
  if (meta.yMax !== undefined && e.clientY !== undefined && e.clientY - rect.top > meta.yMax) return null;
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
