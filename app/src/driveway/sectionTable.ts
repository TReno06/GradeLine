// Ported from section_extract.js as part of PLAN.md Stage 2 (2026-09-19).
// This module is now the single source of truth for this logic — both
// the app (main.js) and the test suite import it directly, so there is
// no longer a hand-mirrored copy to drift out of sync.

// Same algorithm as the app's computeSectionTable(), parameterized on an
// explicit existingElevationAt(chainage) lookup instead of the module-
// level TIN state, so it can be unit tested against a synthetic surface.
// driveGroundRLAt(dwProfile, chainage) is likewise injected instead of
// using the app's own driveGroundRLAt, matching this file's existing
// dependency-injection pattern (see computeCrossfallSeriesFrom).
import type { GradeBreak, DrivewayProfile, GroundRLAt, DriveGroundRLAt, SectionTable, SectionTableStation, CrossfallSeriesPoint, CrossfallTable } from '../types.ts';

export function computeSectionTableFrom(breaks: GradeBreak[], dwProfile: DrivewayProfile | null, existingElevationAt: GroundRLAt, driveGroundRLAt: DriveGroundRLAt): SectionTable {
  var stations: SectionTableStation[] = [];
  function pushStation(ch: number, existingRL: number | null | undefined, proposedRL: number | null | undefined){
    if (stations.length && Math.abs(ch - stations[stations.length-1].chainage) < 1e-6){
      var last = stations[stations.length-1];
      if (proposedRL !== null && proposedRL !== undefined) last.proposedRL = proposedRL;
      if (existingRL !== null && existingRL !== undefined && last.existingRL === null) last.existingRL = existingRL;
      return;
    }
    stations.push({chainage:ch, existingRL: existingRL as number, proposedRL: (proposedRL===undefined?null:proposedRL)});
  }
  if (!dwProfile){
    for (var i=0;i<breaks.length;i++) pushStation(breaks[i].chainage, breaks[i].elevation, null);
  } else {
    var dwStart = dwProfile.pvis[0].chainage, dwEnd = dwProfile.pvis[dwProfile.pvis.length-1].chainage;
    var candidates: {chainage: number; existingRL: number | null | undefined; proposedRL: number | null | undefined}[] = [];
    for (var b=0;b<breaks.length;b++){
      var bch = breaks[b].chainage;
      var withinDw = (bch >= dwStart - 1e-6 && bch <= dwEnd + 1e-6);
      candidates.push({chainage:bch, existingRL:breaks[b].elevation, proposedRL: withinDw ? driveGroundRLAt(dwProfile, bch) : null});
    }
    for (var p=0;p<dwProfile.pvis.length;p++){
      var pv = dwProfile.pvis[p];
      var exRL = existingElevationAt(pv.chainage);
      candidates.push({chainage:pv.chainage, existingRL: (exRL!==null && exRL!==undefined) ? exRL : pv.rl, proposedRL: pv.rl});
    }
    candidates.sort(function(a,b){ return a.chainage-b.chainage; });
    for (var c=0;c<candidates.length;c++) pushStation(candidates[c].chainage, candidates[c].existingRL, candidates[c].proposedRL);
  }
  // Existing grade is computed for every leg (ground never stops existing
  // just because a design leg overlays it); new grade is computed only
  // where both endpoints carry a design RL — so a leg under an active
  // driveway design reports both readings, not just one in place of the
  // other.
  var legs: SectionTable['legs'] = [];
  for (var k=0;k<stations.length-1;k++){
    var s0=stations[k], s1=stations[k+1];
    var run = s1.chainage - s0.chainage;
    if (run <= 1e-6) continue;
    var gradeExisting = ((s1.existingRL - s0.existingRL)/run)*100;
    var hasNew = (s0.proposedRL!==null && s1.proposedRL!==null);
    var gradeNew = hasNew ? (((s1.proposedRL as number) - (s0.proposedRL as number))/run)*100 : null;
    legs.push({from:s0, to:s1, run:run, gradeExisting:gradeExisting, gradeNew:gradeNew, isNew:hasNew});
  }
  return {stations:stations, legs:legs};
}

// The crossfall DXF export's table (PLAN.md Appendix B item 3,
// 2026-09-26): picks up to maxRows evenly-spaced-by-index stations
// (always including both ends) from an already-computed crossfall
// series — deliberately not every dense plotted sample, same "readable
// stations, not raw samples" idea as computeSectionTableFrom's own
// grade-break/PVI stations above, just index-spaced here since a
// crossfall comparison has no grade-break/PVI concept of its own to
// pick meaningful stations from. Pure and reusable regardless of which
// of crossfall.ts's two series functions (matching-chainage or
// perpendicular-projection) built the input.
export function computeCrossfallTableFrom(series: CrossfallSeriesPoint[], maxRows: number): CrossfallTable {
  if (!series.length) return {rows: []};
  if (series.length === 1){
    var only = series[0];
    return {rows: [{chainage: only.chainage, rlA: only.rlA, rlB: only.rlB, crossfallMm: Math.round(only.crossfall*1000), crossfallPct: only.crossfallPct}]};
  }
  var rows: CrossfallTable['rows'] = [];
  var n = Math.max(1, Math.min(maxRows, series.length) - 1);
  for (var i=0; i<=n; i++){
    var idx = Math.round(i * (series.length-1) / n);
    var p = series[idx];
    rows.push({chainage: p.chainage, rlA: p.rlA, rlB: p.rlB, crossfallMm: Math.round(p.crossfall*1000), crossfallPct: p.crossfallPct});
  }
  return {rows: rows};
}

// Generic 1D label decluttering: given labels {x, text}, estimates each
// label's on-plot width from its character count (charWidth per
// character, in the same units as x) and assigns each a `tier` (0-based)
// such that no two labels sharing a tier have overlapping [x-width/2,
// x+width/2] intervals — a classic greedy interval-graph coloring, swept
// left to right. Nothing is ever dropped; a label that would collide at
// tier 0 simply moves to tier 1, 2, etc. Callers turn `tier` into a
// vertical (or other) offset so same-tier labels never collide but no
// numbers are hidden. `pad` (default 0) adds extra breathing room to
// every label's estimated width before the overlap test.
import type { DeclutterLabelInput, DeclutteredLabel } from '../types.ts';

export function declutterLabelsFrom(labels: DeclutterLabelInput[], opts: {charWidth?: number; pad?: number} | undefined): DeclutteredLabel[] {
  opts = opts || {};
  var charWidth = isFinite(opts.charWidth as number) ? opts.charWidth as number : 0.6;
  var pad = isFinite(opts.pad as number) ? opts.pad as number : 0;
  var widths = labels.map(function(l){ return String(l.text).length*charWidth + pad; });
  var order = labels.map(function(_,i){ return i; }).sort(function(a,b){ return labels[a].x - labels[b].x; });
  var lastRightAtTier: number[] = [];
  var tiers: number[] = new Array(labels.length);
  for (var k=0;k<order.length;k++){
    var idx = order[k];
    var left = labels[idx].x - widths[idx]/2, right = labels[idx].x + widths[idx]/2;
    var placedTier = -1;
    for (var t=0;t<lastRightAtTier.length;t++){
      if (left >= lastRightAtTier[t] - 1e-9){ placedTier = t; break; }
    }
    if (placedTier === -1){ placedTier = lastRightAtTier.length; lastRightAtTier.push(-Infinity); }
    lastRightAtTier[placedTier] = right;
    tiers[idx] = placedTier;
  }
  return labels.map(function(l,i){ return {x:l.x, text:l.text, tier:tiers[i], width:widths[i]}; });
}

// For a CAD-style table of station columns: instead of drawing each
// column's divider at its literal (possibly very close together)
// chainage, walks left to right enforcing a minimum column width,
// pushing a station's drawn position forward only as far as needed to
// clear the previous one. A station with enough real room keeps its true
// chainage exactly; only genuinely crowded stations get nudged. Returns
// the adjusted x-position for each input chainage, same order/length.
export function layoutTableColumnsFrom(chainages: number[], minColWidth: number): number[] {
  var adjusted: number[] = [];
  for (var i=0;i<chainages.length;i++){
    if (i===0) adjusted.push(chainages[i]);
    else adjusted.push(Math.max(chainages[i], adjusted[i-1] + minColWidth));
  }
  return adjusted;
}
