// Ported from section_extract.js as part of PLAN.md Stage 2 (2026-09-19).
// This module is now the single source of truth for this logic — both
// the app (main.js) and the test suite import it directly, so there is
// no longer a hand-mirrored copy to drift out of sync.

// Approximate cut/fill volume: integrates (design RL - existing RL) along
// the driveway design's own chainage span (its first to last PVI) via the
// trapezoidal rule, evaluated at every real breakpoint of either line -
// exact TIN-crossing chainages from the existing-ground samples, plus
// every design PVI - so the integral is exact for the actual piecewise-
// linear shapes, not just sampled at a coarse interval. Multiplies the
// resulting area by a single corridor width to turn it into a volume.
// Sign convention matches the app's own per-point cut/fill column: depth
// = design - existing, positive = fill. A stated approximation (see the
// app's own UI label), not a true surface-to-surface volume - a segment
// where ground and design cross is attributed whole to whichever side
// its trapezoidal average falls on, not root-found to the exact crossing
// point. Same dependency-injection pattern as computeSectionTableFrom.
// Returns null if there's no design, it has zero length, or there's no
// ground data anywhere along it.
import type { ProfileSample, DrivewayProfile, GroundRLAt, DriveGroundRLAt, CutFillResult } from '../types.ts';

export function computeCutFillVolumeFrom(existingSamples: ProfileSample[], dwProfile: DrivewayProfile | null, corridorWidth: number, existingElevationAt: GroundRLAt, driveGroundRLAt: DriveGroundRLAt): CutFillResult | null {
  if (!dwProfile || !dwProfile.pvis || dwProfile.pvis.length < 2) return null;
  var pvis = dwProfile.pvis;
  var dwStart = pvis[0].chainage, dwEnd = pvis[pvis.length-1].chainage;
  if (dwEnd - dwStart < 1e-9) return null;

  var chainages: number[] = [dwStart, dwEnd];
  for (var i=0;i<existingSamples.length;i++){
    var ch = existingSamples[i].chainage;
    if (ch > dwStart + 1e-9 && ch < dwEnd - 1e-9) chainages.push(ch);
  }
  for (var p=0;p<pvis.length;p++){
    var pch = pvis[p].chainage;
    if (pch > dwStart + 1e-9 && pch < dwEnd - 1e-9) chainages.push(pch);
  }
  chainages.sort(function(a,b){ return a-b; });
  var merged: number[] = [];
  for (var m=0;m<chainages.length;m++){
    if (merged.length && chainages[m]-merged[merged.length-1] < 1e-6) continue;
    merged.push(chainages[m]);
  }

  var cutArea = 0, fillArea = 0, haveAny = false;
  var prevCh: number | null = null, prevDepth: number | null = null;
  for (var k=0;k<merged.length;k++){
    var ch2 = merged[k];
    var existingRL = existingElevationAt(ch2);
    var designRL = driveGroundRLAt(dwProfile, ch2);
    var depth = (existingRL!==null && existingRL!==undefined && designRL!==null && designRL!==undefined)
      ? (designRL - existingRL) : null;
    if (prevCh !== null && prevDepth !== null && depth !== null){
      var run = ch2 - prevCh;
      var area = (prevDepth + depth) / 2 * run;
      if (area >= 0) fillArea += area; else cutArea += -area;
      haveAny = true;
    }
    prevCh = ch2; prevDepth = depth;
  }
  if (!haveAny) return null;
  return {
    cutVolume: cutArea * corridorWidth,
    fillVolume: fillArea * corridorWidth,
    netVolume: (fillArea - cutArea) * corridorWidth,
    length: dwEnd - dwStart
  };
}
