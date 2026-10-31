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
  var maxGrade = isFinite(rules.maxGrade as number) ? rules.maxGrade as number : 20;
  var applyBoundaryRule = !!rules.applyBoundaryRule;
  var maxGradeBoundary = isFinite(rules.maxGradeBoundary as number) ? rules.maxGradeBoundary as number : 5;
  var slopedLegsSeen = 0;
  return legs.map(function(leg): LegGradeCheck {
    if (leg.isVertical || leg.isTemplate) return {checked:false, isBoundary:false, limit:null, exceeds:false};
    var isBoundary = applyBoundaryRule && slopedLegsSeen===0;
    slopedLegsSeen++;
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
    var change = Math.abs(legB.grade - legA.grade);
    var pviChainage = legA.to.chainage;
    if (change > transitionThreshold + 1e-9){
      var shortLeg = Math.min(legA.run, legB.run);
      if (shortLeg < minTransitionLength - 1e-9){
        rows.push({cls:'diag-warn', text: 'Grade change of ' + change.toFixed(2) + '% at ch ' +
          pviChainage.toFixed(1) + ' exceeds the ' + transitionThreshold.toFixed(1) +
          '% transition threshold, and the shortest adjoining leg (' + shortLeg.toFixed(2) +
          'm) is under the ' + minTransitionLength.toFixed(1) +
          'm minimum - consider inserting a transition grade around ' +
          ((legA.grade+legB.grade)/2 >= 0 ? '+' : '') + ((legA.grade+legB.grade)/2).toFixed(1) + '%.'});
      } else {
        rows.push({cls:'diag-ok', text: 'Grade change of ' + change.toFixed(2) + '% at ch ' +
          pviChainage.toFixed(1) + ' exceeds the transition threshold but the adjoining leg length (' +
          shortLeg.toFixed(2) + 'm) meets the configured minimum.'});
      }
    }
  }
  if (!rows.length){
    rows.push({cls:'diag-ok', text: 'Add at least two design points to check grades.'});
  }
  return rows;
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
