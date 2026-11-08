// Ported from section_extract.js as part of PLAN.md Stage 2 (2026-09-19).
// This module is now the single source of truth for this logic — both
// the app (main.js) and the test suite import it directly, so there is
// no longer a hand-mirrored copy to drift out of sync.

// Same algorithm as the app's computeDrivewayProfile(), parameterized on
// a plain PVI array instead of reading state.driveway.pvis, so it can be
// unit tested directly. Sorts by chainage; two points at the EXACT same
// chainage are kept as a deliberate vertical face (e.g. a kerb reveal)
// rather than floating-point noise, unless they're also identical in RL
// (a genuine redundant duplicate). Anything merely *close* in chainage
// (not exactly equal) is floating-point noise and gets merged away so a
// near-zero run can't produce a near-infinite grade. Each leg's grade is
// null when its run is ~0 (isVertical: true) rather than a graded %.
// Returns null if fewer than two usable, distinct PVIs remain.
import type { Pvi, DrivewayProfile, DrivewayLeg, DrivewayRules, ComplianceRow, LegGradeCheck } from '../types.ts';

export function computeDrivewayProfileFrom(pvis: Pvi[] | null): DrivewayProfile | null {
  var raw = (pvis||[]).filter(function(p){
    return isFinite(p.chainage) && isFinite(p.rl);
  });
  if (raw.length < 2) return null;
  var sorted = raw.slice().sort(function(a,b){ return a.chainage-b.chainage; });
  var cleaned = [sorted[0]];
  for (var i=1;i<sorted.length;i++){
    var prev = cleaned[cleaned.length-1];
    var dCh = sorted[i].chainage - prev.chainage;
    if (dCh === 0){
      if (Math.abs(sorted[i].rl - prev.rl) > 1e-9) cleaned.push(sorted[i]);
      continue;
    }
    if (dCh > 1e-6) cleaned.push(sorted[i]);
  }
  if (cleaned.length < 2) return null;
  var legs: DrivewayProfile['legs'] = [];
  for (var j=0;j<cleaned.length-1;j++){
    var p0 = cleaned[j], p1 = cleaned[j+1];
    var run = p1.chainage - p0.chainage;
    var isVertical = run < 1e-6;
    var grade = isVertical ? null : ((p1.rl - p0.rl) / run) * 100;
    // A leg is a fixed kerb/layback-template leg (never graded) only
    // when BOTH its endpoints came from the kerb or layback tools — a
    // leg with one templated end and one manual end is where the actual
    // design meets the template, and still gets checked normally.
    var isTemplate = !!(p0.template && p1.template);
    legs.push({from:p0, to:p1, run:run, grade:grade, isVertical:isVertical, isTemplate:isTemplate});
  }
  return {pvis:cleaned, legs:legs};
}

// The one place the per-leg grade-limit rule lives — the compliance
// list, the on-screen design line colouring and the DXF leg labels all
// read it, so they can't drift apart. Vertical faces and kerb/layback
// template legs are exempt, unconditionally (owner's standing
// instruction). The stricter boundary limit, when enabled, applies to
// the first *sloped, checked* leg only.
export function legGradeChecksFrom(legs: DrivewayLeg[], rules: Partial<DrivewayRules> | undefined): LegGradeCheck[] {
  rules = rules || {};
  var maxGrade = isFinite(rules.maxGrade as number) ? rules.maxGrade as number : 25;
  var applyBoundaryRule = !!rules.applyBoundaryRule;
  var maxGradeBoundary = isFinite(rules.maxGradeBoundary as number) ? rules.maxGradeBoundary as number : 5;
  var boundaryIndex = -1;
  if (applyBoundaryRule){
    for (var bi=0; bi<legs.length; bi++){
      var bLeg = legs[rules.boundaryAtEnd ? legs.length-1-bi : bi];
      if (!bLeg.isVertical && !bLeg.isTemplate){ boundaryIndex = rules.boundaryAtEnd ? legs.length-1-bi : bi; break; }
    }
  }
  return legs.map(function(leg, legIndex): LegGradeCheck {
    if (leg.isVertical || leg.isTemplate) return {checked:false, isBoundary:false, limit:null, exceeds:false};
    var isBoundary = legIndex === boundaryIndex;
    var limit = isBoundary ? maxGradeBoundary : maxGrade;
    return {checked:true, isBoundary:isBoundary, limit:limit, exceeds: Math.abs(leg.grade) > limit + 1e-9};
  });
}

// Same algorithm as the app's computeDrivewayCompliance(), parameterized
// on an explicit rules object instead of reading sidebar inputs. Vertical
// legs (isVertical) are informational only — no grade limit applies to a
// physical kerb face, and a grade-change/transition check never spans
// one, since that rule is about adjoining ramp grades. The "stricter
// limit on the first leg" (footpath/boundary) means the first *sloped*
// leg, so a vertical kerb face ahead of it doesn't count as that leg.
export function computeDrivewayComplianceFrom(profile: DrivewayProfile | null, rules: Partial<DrivewayRules> | undefined): ComplianceRow[] {
  rules = rules || {};
  var transitionThreshold = isFinite(rules.transitionThreshold as number) ? rules.transitionThreshold as number : 12.5;
  var transitionThresholdSag = isFinite(rules.transitionThresholdSag as number) ? rules.transitionThresholdSag as number : 15;
  var minTransitionLength = isFinite(rules.minTransitionLength as number) ? rules.minTransitionLength as number : 2;
  var rows: ComplianceRow[] = [];
  if (!profile) return rows;
  var checks = legGradeChecksFrom(profile.legs, rules);
  for (var i=0;i<profile.legs.length;i++){
    var leg = profile.legs[i];
    if (leg.isVertical){
      var riseMm = Math.round((leg.to.rl - leg.from.rl) * 1000);
      rows.push({cls:'diag-ok', text: 'Ch ' + leg.from.chainage.toFixed(2) + ': vertical face (' +
        (riseMm>=0?'+':'') + riseMm + 'mm) — not subject to a grade limit.'});
      continue;
    }
    if (leg.isTemplate){
      var legRiseMm = Math.round((leg.to.rl - leg.from.rl) * 1000);
      var legRunMm = Math.round(leg.run * 1000);
      rows.push({cls:'diag-ok', text: 'Ch ' + leg.from.chainage.toFixed(2) + '-' + leg.to.chainage.toFixed(2) +
        ': layback/crossover leg (' + (legRiseMm>=0?'+':'') + legRiseMm + 'mm over ' + legRunMm +
        'mm) — a fixed council detail, not checked against a grade limit.'});
      continue;
    }
    var isBoundaryLeg = checks[i].isBoundary;
    var limit = checks[i].limit;
    var label = 'Ch ' + leg.from.chainage.toFixed(1) + '-' + leg.to.chainage.toFixed(1) +
      ' (' + (leg.grade>=0?'+':'') + leg.grade.toFixed(2) + '%)';
    if (checks[i].exceeds){
      rows.push({cls:'diag-warn', text: label + ' exceeds the ' +
        (isBoundaryLeg ? 'boundary/crossover' : 'maximum') + ' grade limit of ' + limit.toFixed(1) + '%.'});
    } else {
      rows.push({cls:'diag-ok', text: label + ' is within the ' +
        (isBoundaryLeg ? 'boundary/crossover' : 'maximum') + ' grade limit of ' + limit.toFixed(1) + '%.'});
    }
  }
  for (var k=0;k<profile.legs.length-1;k++){
    var legA = profile.legs[k], legB = profile.legs[k+1];
    if (legA.isVertical || legB.isVertical || legA.isTemplate || legB.isTemplate) continue;
    // Algebraic change in the direction of travel: falling = a summit
    // (crest), rising = a sag (dip). Reversing the direction flips both
    // grades and their order, so the kind of change doesn't depend on it.
    var signed = legB.grade - legA.grade;
    var change = Math.abs(signed);
    var isSag = signed > 0;
    var threshold = isSag ? transitionThresholdSag : transitionThreshold;
    var kind = isSag ? 'sag' : 'summit';
    var pviChainage = legA.to.chainage;
    if (change > threshold + 1e-9){
      var shortLeg = Math.min(legA.run, legB.run);
      if (shortLeg < minTransitionLength - 1e-9){
        rows.push({cls:'diag-warn', text: 'Grade change of ' + change.toFixed(2) + '% (' + kind + ') at ch ' +
          pviChainage.toFixed(1) + ' exceeds the ' + threshold.toFixed(1) +
          '% ' + kind + ' transition threshold, and the shortest adjoining leg (' + shortLeg.toFixed(2) +
          'm) is under the ' + minTransitionLength.toFixed(1) +
          'm minimum - consider inserting a transition grade around ' +
          ((legA.grade+legB.grade)/2 >= 0 ? '+' : '') + ((legA.grade+legB.grade)/2).toFixed(1) + '%.'});
      } else {
        rows.push({cls:'diag-ok', text: 'Grade change of ' + change.toFixed(2) + '% (' + kind + ') at ch ' +
          pviChainage.toFixed(1) + ' exceeds the ' + kind + ' transition threshold but the adjoining leg length (' +
          shortLeg.toFixed(2) + 'm) meets the configured minimum.'});
      }
    }
  }
  var fp = footpathCheckFrom(profile, rules);
  if (fp) rows.push(fp);
  if (!rows.length){
    rows.push({cls:'diag-ok', text: 'Add at least two design points to check grades.'});
  }
  return rows;
}

// Across the footpath (AS/NZS 2890.1:2004 Cl 3.3(d), applied to domestic
// driveways by Cl 2.6.2): "the driveway grade shall be 1 in 40 (2.5%) or
// less across the footpath over a lateral distance of at least 1.0 m".
// GradeLine doesn't know where the footpath is, so it looks across the
// crossing: from the kerb (after the kerb/layback template) along the
// run of checked legs no steeper than the boundary limit — i.e. up to the
// point where the driveway starts climbing into the property — and needs
// one continuous stretch of legs at or under the footpath grade adding up
// to at least the minimum length. On a reversed alignment the road end is
// the far end, so it searches from there. Returns null when the rule is
// off or there's no checked leg to look at.
export function footpathCheckFrom(profile: DrivewayProfile | null, rules: Partial<DrivewayRules> | undefined): ComplianceRow | null {
  rules = rules || {};
  if (!profile || !rules.applyFootpathRule) return null;
  var maxFp = isFinite(rules.footpathMaxGrade as number) ? rules.footpathMaxGrade as number : 2.5;
  var minLen = isFinite(rules.footpathMinLength as number) ? rules.footpathMinLength as number : 1.0;
  var crossingLimit = isFinite(rules.maxGradeBoundary as number) ? rules.maxGradeBoundary as number : 5;
  var legs = profile.legs.slice();
  if (rules.boundaryAtEnd) legs.reverse();
  var i = 0;
  while (i < legs.length && (legs[i].isVertical || legs[i].isTemplate)) i++;
  if (i >= legs.length) return null;
  var start = i, best = 0, bestFrom = -1, bestTo = -1, runLen = 0, runFrom = -1;
  for (; i < legs.length; i++){
    var leg = legs[i];
    if (leg.isVertical || leg.isTemplate || Math.abs(leg.grade) > crossingLimit + 1e-9) break;
    if (Math.abs(leg.grade) <= maxFp + 1e-9){
      if (runFrom < 0){ runFrom = i; runLen = 0; }
      runLen += leg.run;
      if (runLen > best){ best = runLen; bestFrom = runFrom; bestTo = i; }
    } else runFrom = -1;
  }
  var end = i - 1;
  if (end < start) return {cls:'diag-warn', text: 'Across the footpath: the first leg after the kerb is steeper than ' + crossingLimit.toFixed(1) +
    '%, so there is no ' + minLen.toFixed(1) + 'm stretch at ' + maxFp.toFixed(1) + '% or flatter (AS/NZS 2890.1:2004 Cl 3.3(d)).'};
  var span = function(a: number, b: number){
    var c0 = Math.min(legs[a].from.chainage, legs[b].to.chainage), c1 = Math.max(legs[a].from.chainage, legs[b].to.chainage);
    return 'ch ' + c0.toFixed(2) + '-' + c1.toFixed(2);
  };
  if (best + 1e-9 >= minLen){
    return {cls:'diag-ok', text: 'Across the footpath: ' + best.toFixed(2) + 'm at ' + maxFp.toFixed(1) + '% or flatter (' + span(bestFrom, bestTo) +
      '), meeting the ' + minLen.toFixed(1) + 'm minimum.'};
  }
  return {cls:'diag-warn', text: 'Across the footpath (' + span(start, end) + '): ' + (best > 0 ? 'only ' + best.toFixed(2) + 'm' : 'no stretch') +
    ' at ' + maxFp.toFixed(1) + '% or flatter — AS/NZS 2890.1:2004 Cl 3.3(d) needs at least ' + minLen.toFixed(1) + 'm. Add a design point to flatten the grade where the footpath is.'};
}

// Same math as the app's applyKerbPoints(): the gutter invert and the
// top of kerb (invert + reveal) at the SAME chainage — a real vertical
// face, not a sloped leg, matching what a kerb face physically is. The
// chainage is a parameter (not assumed to be 0), since another design
// point (e.g. the alignment's seeded start) is often already there.
export function computeKerbPvisFrom(kerbChainage: number, invertRl: number, revealMm: number): [Pvi, Pvi] {
  return [
    {chainage:kerbChainage, rl:invertRl, template:'kerb'},
    {chainage:kerbChainage, rl:invertRl + revealMm/1000, template:'kerb'}
  ];
}

// Same math as the app's applyLaybackTemplate(), parameterized so it can
// be unit tested without a DOM. The layback template straddles the kerb
// invert: one leg runs BACKWARD (road-side) from the invert itself
// (beforeBase — a separate reference point from the top-of-kerb, since
// the reveal height isn't part of this leg), and the other leg runs
// FORWARD (property-side) from the top-of-kerb / frontier (afterBase) —
// matching the existing chaining behaviour when no kerb has been set.
// Both returned points are tagged template:'layback' so they (and any
// leg connecting to a template:'kerb' point) are excluded from grade
// checks entirely.
export function computeLaybackPvisFrom(beforeBase: {chainage: number; rl: number}, afterBase: {chainage: number; rl: number}, rise1mm: number, run1mm: number, rise2mm: number, run2mm: number): [Pvi, Pvi] {
  var chBefore = beforeBase.chainage - run1mm/1000;
  var rlBefore = beforeBase.rl + rise1mm/1000;
  var chAfter = afterBase.chainage + run2mm/1000;
  var rlAfter = afterBase.rl + rise2mm/1000;
  return [
    {chainage:chBefore, rl:rlBefore, template:'layback'},
    {chainage:chAfter, rl:rlAfter, template:'layback'}
  ];
}
