// Consolidated test suite (PLAN.md Stage 2): replaces the 5 separate
// run_tests{5,6,7,8,10}.js runners that accumulated one-per-session against
// section_extract.js (a hand-mirrored copy of the app's pure logic). This
// file imports the REAL modules directly — no mirror, no drift possible.
// Run with: node test/run_tests.mjs (from the app/ directory)

import { buildTriIndex, elevationAt, triangleIndexAt, triangulate } from '../src/geometry/tin.ts';
import { computeExactBreakChainages, computeIntervalMarksFrom, pointAtChainage, chainageOfClosestPoint, interpolatedSampleAt } from '../src/geometry/chainage.ts';
import { computeDrivewayComplianceFrom, computeDrivewayProfileFrom, computeKerbPvisFrom, computeLaybackPvisFrom, legGradeChecksFrom } from '../src/driveway/profile.ts';
import { VEHICLE_TEMPLATES, findWorstVehicleSweepFrom, sweepVehicleTemplateFrom, templateUndersideLocal, vehicleSweepRangeFrom } from '../src/driveway/vehicle.ts';
import { computeSectionTableFrom, declutterLabelsFrom, layoutTableColumnsFrom, computeCrossfallTableFrom } from '../src/driveway/sectionTable.ts';
import { computeCutFillVolumeFrom } from '../src/driveway/cutfill.ts';
import { computeCrossfallSeriesFrom, computeCrossfallSeriesPerpendicular } from '../src/crossfall.ts';
import { computeLayerBreakdown } from '../src/dxf.ts';
import { state } from '../src/state.ts';
import { serializeProject, applyProjectData, gzipCompress, gzipDecompress, looksGzipped } from '../src/project.ts';
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond){
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', name); }
}
function approx(a, b, eps){ return Math.abs(a-b) < (eps===undefined?1e-6:eps); }

// ======= from run_tests5.js =======

// Manually-built TIN: a flat plain (z=10) with a sharp pyramidal valley
// (apex z=2) centered at (5.5, 0.5), fan-triangulated from that apex.
// This mirrors computeLongSection()'s merge logic (exact crossings +
// evenly-spaced interval samples) without needing the DOM.
const points = [
  {x:0, y:0, z:10}, {x:0, y:1, z:10},   // 0,1
  {x:5, y:0, z:10}, {x:5, y:1, z:10},   // 2,3
  {x:6, y:0, z:10}, {x:6, y:1, z:10},   // 4,5
  {x:10,y:0, z:10}, {x:10,y:1, z:10},   // 6,7
  {x:5.5, y:0.5, z:2}                   // 8 (valley apex)
];
const triangles = [
  [0,1,3], [0,3,2],   // left flat quad
  [2,3,8], [3,5,8], [5,4,8], [4,2,8], // fan around the valley
  [4,5,7], [4,7,6]    // right flat quad
];
const index = buildTriIndex(points, triangles);

function simulateLongSection(interval){
  const verts = [{x:0,y:0.5}, {x:10,y:0.5}];
  const cum = [0, 10];
  const total = 10;
  const exactChainages = computeExactBreakChainages(verts, cum, total, points, triangles, index);
  const nSamples = Math.max(2, Math.ceil(total/interval));
  let allChainages = [0, total].concat(exactChainages);
  for (let s=0; s<=nSamples; s++) allChainages.push(Math.min(total, s*interval));
  allChainages.sort((a,b)=>a-b);
  const mergeEps = Math.max(total*1e-6, 1e-4);
  const merged = [];
  for (const ch of allChainages){
    if (merged.length && (ch - merged[merged.length-1]) < mergeEps) continue;
    merged.push(ch);
  }
  return merged.map(ch => {
    const pt = pointAtChainage(verts, cum, ch);
    return {chainage: ch, elevation: elevationAt(pt.x, pt.y, points, triangles, index)};
  });
}

// --- the exact crossing near the valley apex is found regardless of interval ---
{
  const samples1 = simulateLongSection(1);
  const samples2 = simulateLongSection(2);
  const samples5 = simulateLongSection(5);

  const min1 = Math.min(...samples1.map(s=>s.elevation));
  const min2 = Math.min(...samples2.map(s=>s.elevation));
  const min5 = Math.min(...samples5.map(s=>s.elevation));

  check('min elevation stable across interval=1 vs 2', Math.abs(min1-min2) < 1e-6);
  check('min elevation stable across interval=1 vs 5', Math.abs(min1-min5) < 1e-6);
  check('min elevation actually reaches the true valley floor (~2)', Math.abs(min1-2) < 1e-4);

  // sanity: interval=5 alone (0,5,10) would NEVER sample the valley without
  // the exact-crossing fix — confirms the fix is doing real work, not a
  // no-op coincidence.
  const naiveInterval5 = [0,5,10].map(ch => {
    const pt = pointAtChainage([{x:0,y:0.5},{x:10,y:0.5}], [0,10], ch);
    return elevationAt(pt.x, pt.y, points, triangles, index);
  });
  check('naive fixed-interval=5 alone would miss the valley (sanity check)', Math.min(...naiveInterval5) > 9);
}

// --- computeExactBreakChainages finds the crossing near chainage 5.5 ---
{
  const verts = [{x:0,y:0.5}, {x:10,y:0.5}];
  const cum = [0, 10];
  const breaks = computeExactBreakChainages(verts, cum, 10, points, triangles, index);
  check('at least one exact break found', breaks.length >= 1);
  const nearApex = breaks.some(ch => Math.abs(ch-5.5) < 0.05);
  check('an exact break lands within 5cm of the true valley apex (5.5)', nearApex);
}

// --- triangleIndexAt / locateTriangle basic correctness ---
{
  check('triangleIndexAt finds a triangle in the flat region', triangleIndexAt(2, 0.5, points, triangles, index) >= 0);
  check('triangleIndexAt returns -1 outside all triangles', triangleIndexAt(-50, -50, points, triangles, index) === -1);
  check('elevationAt matches locateTriangle-derived value in flat region', elevationAt(2, 0.5, points, triangles, index) === 10);
  check('elevationAt at the valley apex itself is exactly 2', Math.abs(elevationAt(5.5, 0.5, points, triangles, index) - 2) < 1e-9);
}

// ======= from run_tests6.js =======

// --- computeIntervalMarksFrom: flat plain, interval divides evenly ---
{
  const points = [{x:0,y:0,z:10},{x:0,y:1,z:10},{x:10,y:0,z:10},{x:10,y:1,z:10}];
  const triangles = [[0,1,2],[1,3,2]];
  const index = buildTriIndex(points, triangles);
  const verts = [{x:0,y:0.5}, {x:10,y:0.5}];
  const marks = computeIntervalMarksFrom(verts, points, triangles, index, 2);
  check('interval=2 over length 10 gives 6 marks (0,2,4,6,8,10)', marks.length === 6);
  check('first mark is at chainage 0', Math.abs(marks[0].chainage - 0) < 1e-9);
  check('last mark is clamped exactly to the total length (10)', Math.abs(marks[marks.length-1].chainage - 10) < 1e-9);
  check('all elevations on the flat plain read exactly 10', marks.every(m => Math.abs(m.elevation-10) < 1e-9));
}

// --- computeIntervalMarksFrom: interval does NOT divide the length evenly ---
{
  const points = [{x:0,y:0,z:5},{x:0,y:1,z:5},{x:10,y:0,z:5},{x:10,y:1,z:5}];
  const triangles = [[0,1,2],[1,3,2]];
  const index = buildTriIndex(points, triangles);
  const verts = [{x:0,y:0.5}, {x:10,y:0.5}];
  const marks = computeIntervalMarksFrom(verts, points, triangles, index, 3);
  const chs = marks.map(m => +m.chainage.toFixed(6));
  check('uneven interval=3 over length 10 gives 0,3,6,9,10 (final one clamped, not skipped)',
    chs.length === 5 && chs[0]===0 && chs[1]===3 && chs[2]===6 && chs[3]===9 && chs[4]===10);
}

// --- computeIntervalMarksFrom picks up real terrain variation (valley fixture, same as run_tests5) ---
{
  const points = [
    {x:0, y:0, z:10}, {x:0, y:1, z:10},
    {x:5, y:0, z:10}, {x:5, y:1, z:10},
    {x:6, y:0, z:10}, {x:6, y:1, z:10},
    {x:10,y:0, z:10}, {x:10,y:1, z:10},
    {x:5.5, y:0.5, z:2}
  ];
  const triangles = [
    [0,1,3], [0,3,2],
    [2,3,8], [3,5,8], [5,4,8], [4,2,8],
    [4,5,7], [4,7,6]
  ];
  const index = buildTriIndex(points, triangles);
  const verts = [{x:0,y:0.5}, {x:10,y:0.5}];
  // 1m spacing lands exactly on the flat-plain vertices either side of the
  // apex (chainage 5 and 6), so it's expected to miss a apex that narrow —
  // that's the whole reason grade-break detection exists separately. A
  // 0.5m spacing does land exactly on the apex (chainage 5.5) and should
  // catch it.
  const marks1 = computeIntervalMarksFrom(verts, points, triangles, index, 1);
  check('marks away from the valley stay on the flat plain (10)', Math.abs(marks1[0].elevation - 10) < 1e-9);

  const marksHalf = computeIntervalMarksFrom(verts, points, triangles, index, 0.5);
  const atValley = marksHalf.find(m => Math.abs(m.chainage-5.5) < 1e-9);
  check('a finer 0.5m ladder that lands exactly on the apex chainage catches the dip',
    !!atValley && atValley.elevation < 9);
}

// --- computeIntervalMarksFrom: alignment extends beyond the triangulated
// surface (a real case — e.g. the sample alignment runs a bit further
// than the survey extent). Marks outside the TIN must come back with
// elevation === null rather than throwing, so the caller can filter them
// out before calling .toFixed() on them (this was a real bug: a null
// elevation reaching ctx.fillText()/DXF TEXT export crashed both). ---
{
  const points = [{x:0,y:0,z:5},{x:0,y:1,z:5},{x:6,y:0,z:5},{x:6,y:1,z:5}];
  const triangles = [[0,1,2],[1,3,2]];
  const index = buildTriIndex(points, triangles);
  const verts = [{x:0,y:0.5}, {x:10,y:0.5}]; // alignment runs to 10, surface only to x=6
  const marks = computeIntervalMarksFrom(verts, points, triangles, index, 2);
  const inside = marks.filter(m => m.elevation !== null);
  const outside = marks.filter(m => m.elevation === null);
  check('marks within the TIN (chainage <= 6) get a real elevation', inside.length > 0 && inside.every(m => m.chainage <= 6 + 1e-9));
  check('marks beyond the TIN extent come back as null, not a thrown error', outside.length > 0 && outside.every(m => m.chainage > 6 - 1e-9));
}

// --- edge cases ---
{
  check('zero interval returns no marks', computeIntervalMarksFrom([{x:0,y:0},{x:10,y:0}], [], [], null, 0).length === 0);
  check('negative interval returns no marks', computeIntervalMarksFrom([{x:0,y:0},{x:10,y:0}], [], [], null, -5).length === 0);
  check('empty alignment returns no marks', computeIntervalMarksFrom([], [], [], null, 5).length === 0);
}

// --- grade % formula (mirrors the inline calc in drawProfile/exportSectionDXF:
//     gradePct = (rise/run) * 100, formatted with an explicit '+' sign when >= 0) ---
function gradePctLabel(b0, b1){
  const run = b1.chainage - b0.chainage;
  const pct = ((b1.elevation - b0.elevation) / run) * 100;
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}
{
  check('rising grade over 100m by 2m reads +2.00%',
    gradePctLabel({chainage:0, elevation:10}, {chainage:100, elevation:12}) === '+2.00%');
  check('falling grade over 50m by 1m reads -2.00%',
    gradePctLabel({chainage:0, elevation:10}, {chainage:50, elevation:9}) === '-2.00%');
  check('flat grade reads +0.00% (zero treated as non-negative)',
    gradePctLabel({chainage:0, elevation:10}, {chainage:20, elevation:10}) === '+0.00%');
  check('steep short rise (5m rise over 20m run) reads +25.00%',
    gradePctLabel({chainage:0, elevation:0}, {chainage:20, elevation:5}) === '+25.00%');
}

// ======= from run_tests7.js =======

// --- computeDrivewayProfileFrom: basic two-point profile ---
{
  const profile = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:20, rl:8}]);
  check('two-point profile has 1 leg', profile.legs.length === 1);
  check('grade of a 2m drop over 20m reads -10%', Math.abs(profile.legs[0].grade - (-10)) < 1e-9);
}

// --- computeDrivewayProfileFrom: sorts out-of-order input ---
{
  const profile = computeDrivewayProfileFrom([{chainage:20, rl:8}, {chainage:0, rl:10}]);
  check('out-of-order PVIs are sorted by chainage', profile.pvis[0].chainage === 0 && profile.pvis[1].chainage === 20);
}

// --- computeDrivewayProfileFrom: fewer than 2 usable points returns null ---
{
  check('single point returns null', computeDrivewayProfileFrom([{chainage:0, rl:10}]) === null);
  check('empty array returns null', computeDrivewayProfileFrom([]) === null);
  check('a non-finite RL is dropped, leaving <2 usable points -> null',
    computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:5, rl:NaN}]) === null);
}

// --- computeDrivewayProfileFrom: near-duplicate chainages are merged (no infinite grade) ---
{
  const profile = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:0.0000001, rl:99}, {chainage:20, rl:8}]);
  check('near-duplicate chainage collapsed to 2 PVIs', profile.pvis.length === 2);
  check('resulting grade is finite, not Infinity', isFinite(profile.legs[0].grade));
}

// --- computeDrivewayProfileFrom: multi-leg grade-per-segment ---
{
  const profile = computeDrivewayProfileFrom([
    {chainage:0, rl:10}, {chainage:10, rl:9}, {chainage:12, rl:8.5}, {chainage:22, rl:8.5}
  ]);
  check('3-leg profile has 3 legs', profile.legs.length === 3);
  check('leg 1 grade -10%', Math.abs(profile.legs[0].grade - (-10)) < 1e-9);
  check('leg 2 (transition) grade -25%', Math.abs(profile.legs[1].grade - (-25)) < 1e-9);
  check('leg 3 grade 0% (flat run-out)', Math.abs(profile.legs[2].grade - 0) < 1e-9);
}

// --- computeDrivewayComplianceFrom: within limits everywhere ---
{
  const profile = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:100, rl:9}]);
  const rows = computeDrivewayComplianceFrom(profile, {maxGrade:25, applyBoundaryRule:false});
  check('a gentle 1% grade produces no warn rows', rows.every(r => r.cls !== 'diag-warn'));
}

// --- computeDrivewayComplianceFrom: exceeds max grade ---
{
  const profile = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:10, rl:7}]); // -30%
  const rows = computeDrivewayComplianceFrom(profile, {maxGrade:25, applyBoundaryRule:false});
  check('a -30% leg against a 25% max limit is flagged', rows.some(r => r.cls === 'diag-warn' && /exceeds the maximum grade limit/.test(r.text)));
}

// --- computeDrivewayComplianceFrom: boundary rule applies stricter limit to first leg only ---
{
  // First leg -20% (exceeds a 16.7% boundary limit), second leg -20% too but
  // boundary rule shouldn't apply to it (only the general 25% max applies).
  const profile = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:10, rl:8}, {chainage:20, rl:6}]);
  const rows = computeDrivewayComplianceFrom(profile, {maxGrade:25, applyBoundaryRule:true, maxGradeBoundary:16.7});
  check('first leg flagged against the stricter boundary limit', rows[0].cls === 'diag-warn' && /boundary\/crossover/.test(rows[0].text));
  check('second leg passes against the general (non-boundary) limit', rows[1].cls === 'diag-ok');
}

// --- computeDrivewayComplianceFrom: grade-change/transition check ---
{
  // -2% then -20% at ch10 = 18% change, adjoining legs both 10m long.
  const profileOk = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:10, rl:9.8}, {chainage:20, rl:7.8}]);
  const rowsOk = computeDrivewayComplianceFrom(profileOk, {maxGrade:25, applyBoundaryRule:false, transitionThreshold:12.5, minTransitionLength:2});
  check('big grade change with long adjoining legs (>= min transition length) passes',
    rowsOk.some(r => /Grade change/.test(r.text) && r.cls === 'diag-ok'));

  // Same grade change, but the second leg is only 1m long (< 2m minimum).
  const profileBad = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:10, rl:9.8}, {chainage:11, rl:9.6}]);
  const rowsBad = computeDrivewayComplianceFrom(profileBad, {maxGrade:25, applyBoundaryRule:false, transitionThreshold:12.5, minTransitionLength:2});
  check('big grade change with a too-short adjoining leg is flagged as needing a transition',
    rowsBad.some(r => /Grade change/.test(r.text) && r.cls === 'diag-warn' && /consider inserting a transition/.test(r.text)));
}

// --- computeDrivewayComplianceFrom: small grade change never triggers the transition rule ---
{
  const profile = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:10, rl:9}, {chainage:11, rl:8.9}]);
  const rows = computeDrivewayComplianceFrom(profile, {maxGrade:25, applyBoundaryRule:false, transitionThreshold:12.5, minTransitionLength:2});
  check('no "Grade change" row when the change is under the threshold', !rows.some(r => /Grade change/.test(r.text)));
}

// --- computeDrivewayComplianceFrom: null profile / defaults ---
{
  check('null profile returns empty rows', computeDrivewayComplianceFrom(null, {}).length === 0);
  const profile = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:10, rl:9}]);
  const rows = computeDrivewayComplianceFrom(profile); // no rules object at all -> defaults
  check('missing rules object falls back to sane defaults without throwing', Array.isArray(rows) && rows.length > 0);
}

// --- interpolatedSampleAt: binary search matches the original linear scan ---
{
  // The pre-binary-search implementation, verbatim, as the reference.
  function linearRef(samples, ch){
    if (!samples || samples.length < 2) return null;
    if (ch <= samples[0].chainage) return samples[0].elevation===null ? null : samples[0];
    const lastS = samples[samples.length-1];
    if (ch >= lastS.chainage) return lastS.elevation===null ? null : lastS;
    let i = 0;
    while (i < samples.length-2 && samples[i+1].chainage < ch) i++;
    const a = samples[i], b = samples[i+1];
    if (a.elevation===null || b.elevation===null) return null;
    const span = b.chainage - a.chainage;
    const f = span > 1e-9 ? (ch-a.chainage)/span : 0;
    return {chainage: ch, x: a.x + (b.x-a.x)*f, y: a.y + (b.y-a.y)*f, elevation: a.elevation + (b.elevation-a.elevation)*f};
  }
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let mismatches = 0, comparisons = 0;
  for (let trial=0; trial<40; trial++){
    const n = 2 + Math.floor(rnd()*60);
    const samples = []; let ch = rnd()*5;
    for (let i=0;i<n;i++){
      // Occasional repeated chainage (zero-length segment) and null gaps.
      if (i > 0 && rnd() > 0.85) { /* same chainage */ } else ch += rnd()*3;
      samples.push({chainage: ch, x: rnd()*100, y: rnd()*100, elevation: rnd() > 0.9 ? null : 10 + rnd()*5});
    }
    for (let q=0; q<50; q++){
      const qch = samples[0].chainage - 1 + rnd()*(samples[n-1].chainage - samples[0].chainage + 2);
      const got = interpolatedSampleAt(samples, qch), want = linearRef(samples, qch);
      comparisons++;
      const same = (got === null && want === null) ||
        (got && want && got.chainage === want.chainage && got.x === want.x && got.y === want.y && got.elevation === want.elevation);
      if (!same) mismatches++;
    }
    // Exact sample chainages too (segment boundaries are the edge case).
    for (const s of samples){
      const got = interpolatedSampleAt(samples, s.chainage), want = linearRef(samples, s.chainage);
      comparisons++;
      const same = (got === null && want === null) ||
        (got && want && got.chainage === want.chainage && got.x === want.x && got.y === want.y && got.elevation === want.elevation);
      if (!same) mismatches++;
    }
  }
  check('interpolatedSampleAt matches the linear-scan reference exactly (' + comparisons + ' queries)', mismatches === 0);
  check('interpolatedSampleAt: fewer than 2 samples returns null', interpolatedSampleAt([{chainage:0, x:0, y:0, elevation:1}], 0) === null && interpolatedSampleAt(null, 0) === null);
  const two = [{chainage:0, x:0, y:0, elevation:10}, {chainage:10, x:10, y:0, elevation:12}];
  const mid = interpolatedSampleAt(two, 2.5);
  check('interpolatedSampleAt: interpolates midway along a segment', approx(mid.elevation, 10.5) && approx(mid.x, 2.5));
}

// --- legGradeChecksFrom: the shared exemption + boundary-leg rule ---
{
  // Kerb face (vertical, exempt), a 50% kerb->layback template leg (exempt
  // however steep), then the first manual leg (the boundary leg, 4.44%),
  // then a 40% leg that exceeds the general 20% max.
  const profile = computeDrivewayProfileFrom([
    {chainage:0, rl:10, template:'kerb'}, {chainage:0, rl:10.15, template:'kerb'},
    {chainage:0.5, rl:10.4, template:'layback'}, {chainage:5, rl:10.6}, {chainage:10, rl:12.6}
  ]);
  const rules = {maxGrade:20, applyBoundaryRule:true, maxGradeBoundary:5};
  const checks = legGradeChecksFrom(profile.legs, rules);
  check('legGradeChecksFrom returns one verdict per leg', checks.length === profile.legs.length && checks.length === 4);
  check('vertical kerb face is exempt', !checks[0].checked && checks[0].limit === null && !checks[0].exceeds);
  check('50% template leg is exempt, never exceeds', !checks[1].checked && !checks[1].exceeds);
  check('boundary limit applies to the first sloped CHECKED leg, after the template legs',
    checks[2].checked && checks[2].isBoundary && checks[2].limit === 5 && !checks[2].exceeds);
  check('later leg uses the general limit and is flagged at 40%',
    checks[3].checked && !checks[3].isBoundary && checks[3].limit === 20 && checks[3].exceeds);
  const rows = computeDrivewayComplianceFrom(profile, rules);
  check('compliance warn rows agree with legGradeChecksFrom',
    rows.filter(r => r.cls === 'diag-warn' && /grade limit/.test(r.text)).length === checks.filter(c => c.exceeds).length);
  const noBoundary = legGradeChecksFrom(profile.legs, {maxGrade:20, applyBoundaryRule:false});
  check('boundary rule off: no leg is a boundary leg', noBoundary.every(c => !c.isBoundary));
  const defaults = legGradeChecksFrom(profile.legs, undefined);
  check('no rules object: falls back to the 20% default max', defaults[3].limit === 20);
}

// ======= from run_tests8.js =======

// Mirrors the app's own driveGroundRLAt: the driveway's design RL at any
// chainage within its span, linearly interpolated along whichever PVI-to-
// PVI leg contains it. Used to feed computeSectionTableFrom, which now
// needs this for every existing-ground break inside the driveway's span,
// not just at its own PVIs.
function driveGroundRLAt(dwProfile, ch){
  const pvis = dwProfile.pvis;
  for (let i=0;i<pvis.length-1;i++){
    const a = pvis[i], b = pvis[i+1];
    if (ch >= a.chainage - 1e-9 && ch <= b.chainage + 1e-9){
      if (b.chainage - a.chainage < 1e-9) return b.rl;
      const f = (ch - a.chainage)/(b.chainage-a.chainage);
      return a.rl + (b.rl-a.rl)*f;
    }
  }
  return pvis[pvis.length-1].rl;
}

// --- computeLaybackPvisFrom: straddles the invert - one leg BEFORE (road-side,
// running backward from beforeBase), one leg AFTER (property-side, running
// forward from afterBase) ---
{
  const beforeBase = {chainage:4.20, rl:25.000}; // kerb invert
  const afterBase = {chainage:4.20, rl:25.030};  // top of kerb (frontier)
  const pvis = computeLaybackPvisFrom(beforeBase, afterBase, 25, 450, 70, 450);
  check('2 new PVIs produced', pvis.length === 2);
  check('before-leg sits 450mm BEFORE the invert chainage (4.20 - 0.45 = 3.75)',
    Math.abs(pvis[0].chainage - 3.75) < 1e-9);
  check('before-leg rl = invert + 25mm rise (rises away from invert) = 25.025',
    Math.abs(pvis[0].rl - 25.025) < 1e-9);
  check('after-leg sits 450mm AFTER the top-of-kerb chainage (4.20 + 0.45 = 4.65)',
    Math.abs(pvis[1].chainage - 4.65) < 1e-9);
  check('after-leg rl = top of kerb + 70mm = 25.100', Math.abs(pvis[1].rl - 25.100) < 1e-9);
  check('both PVIs tagged template:\'layback\'',
    pvis[0].template === 'layback' && pvis[1].template === 'layback');
}

// --- computeLaybackPvisFrom: asymmetric legs, both bases the same point (no kerb set) ---
{
  const base = {chainage:0, rl:10.000};
  const pvis = computeLaybackPvisFrom(base, base, 30, 300, 100, 600);
  check('before-leg sits 300mm before base (0 - 0.3 = -0.3)', Math.abs(pvis[0].chainage - (-0.3)) < 1e-9);
  check('before-leg rl = base + 30mm = 10.030', Math.abs(pvis[0].rl - 10.030) < 1e-9);
  check('after-leg sits 600mm after base (0 + 0.6 = 0.6)', Math.abs(pvis[1].chainage - 0.6) < 1e-9);
  check('after-leg rl = base + 100mm = 10.100', Math.abs(pvis[1].rl - 10.100) < 1e-9);
}

// --- computeLaybackPvisFrom: continues on from a non-zero base chainage ---
// (e.g. chaining onto a top-of-kerb point set by computeKerbPvisFrom, no
// separate kerb-invert reference - both bases the same point)
{
  const base = {chainage:0.15, rl:25.150};
  const pvis = computeLaybackPvisFrom(base, base, 25, 450, 70, 450);
  check('before-leg chainage = base - 0.45 = -0.30m', Math.abs(pvis[0].chainage - (-0.30)) < 1e-9);
  check('after-leg chainage = base + 0.45 = 0.60m', Math.abs(pvis[1].chainage - 0.60) < 1e-9);
  check('after-leg rl continues from base rl (25.150 + 0.070 = 25.220)', Math.abs(pvis[1].rl - 25.220) < 1e-9);
}

// --- computeKerbPvisFrom: invert + top-of-kerb points (vertical face) ---
{
  const pvis = computeKerbPvisFrom(0, 25.000, 30);
  check('2 PVIs produced', pvis.length === 2);
  check('both at chainage 0 (a vertical face, not a sloped leg)',
    pvis[0].chainage === 0 && pvis[1].chainage === 0);
  check('PVI0 rl = invert', pvis[0].rl === 25.000);
  check('PVI1 rl = invert + 30mm reveal = 25.030', Math.abs(pvis[1].rl - 25.030) < 1e-9);
  check('both PVIs tagged template:\'kerb\'', pvis[0].template === 'kerb' && pvis[1].template === 'kerb');
}

// --- computeKerbPvisFrom: an arbitrary (non-zero) kerb chainage ---
// (Thom's request: the kerb chainage must be settable, not assumed to be
// 0, since a seeded design point is often already sitting there.)
{
  const pvis = computeKerbPvisFrom(4.20, 25.000, 30);
  check('both PVIs placed at the given chainage, not 0',
    pvis[0].chainage === 4.20 && pvis[1].chainage === 4.20);
  check('RLs unaffected by the chainage', pvis[0].rl === 25.000 && Math.abs(pvis[1].rl - 25.030) < 1e-9);
}

// --- computeDrivewayProfileFrom: a kerb reveal produces a real vertical leg ---
{
  const kerbPvis = computeKerbPvisFrom(0, 25.000, 30);
  const profile = computeDrivewayProfileFrom(kerbPvis);
  check('both PVIs survive (not deduped away)', profile.pvis.length === 2);
  check('single leg, run ~ 0', profile.legs.length === 1 && profile.legs[0].run < 1e-6);
  check('leg is flagged vertical', profile.legs[0].isVertical === true);
  check('grade is null for a vertical leg (not a % figure)', profile.legs[0].grade === null);
}

// --- computeDrivewayProfileFrom: isTemplate is true only when BOTH ends are templated ---
{
  const kerbPvis = computeKerbPvisFrom(0, 25.000, 30); // both template:'kerb'
  const topOfKerb = kerbPvis[1];
  const laybackPvis = computeLaybackPvisFrom(topOfKerb, topOfKerb, 25, 450, 70, 450); // both template:'layback'
  const manualPoint = {chainage: 2.0, rl: 26.0}; // no template tag - the user's actual design
  const full = [kerbPvis[0], kerbPvis[1], laybackPvis[1], manualPoint]; // drop the before-leg (negative chainage) to keep this linear
  const profile = computeDrivewayProfileFrom(full);
  check('4 points -> 3 legs', profile.legs.length === 3);
  check('leg 0 (kerb invert -> top of kerb): both templated -> isTemplate true', profile.legs[0].isTemplate === true);
  check('leg 1 (top of kerb -> layback after-point): both templated -> isTemplate true', profile.legs[1].isTemplate === true);
  check('leg 2 (layback after-point -> manual design point): one end untemplated -> isTemplate false',
    profile.legs[2].isTemplate === false);
}

// --- computeDrivewayComplianceFrom: a vertical leg is informational, not a grade check ---
{
  const kerbPvis = computeKerbPvisFrom(0, 25.000, 30);
  const profile = computeDrivewayProfileFrom(kerbPvis);
  const rows = computeDrivewayComplianceFrom(profile, {maxGrade: 20});
  check('one informational row, not a grade violation', rows.length === 1 && rows[0].cls === 'diag-ok');
  check('row text mentions the vertical face and its rise', /vertical face/i.test(rows[0].text) && rows[0].text.includes('30mm'));
}

// --- computeDrivewayComplianceFrom: a template leg is informational, never a %-grade check ---
// (Thom: "we dont need to show a grade for the layback ever")
{
  const beforeBase = {chainage:4.20, rl:25.000};
  const afterBase = {chainage:4.20, rl:25.030};
  const kerbPvis = computeKerbPvisFrom(4.20, 25.000, 30);
  const laybackPvis = computeLaybackPvisFrom(beforeBase, afterBase, 25, 450, 70, 450);
  const full = kerbPvis.concat(laybackPvis).sort((a,b) => a.chainage - b.chainage);
  const profile = computeDrivewayProfileFrom(full);
  const rows = computeDrivewayComplianceFrom(profile, {maxGrade: 5, applyBoundaryRule: true, maxGradeBoundary: 2});
  check('every leg is a template/vertical leg -> every row is informational, none is a grade violation',
    rows.every(r => r.cls === 'diag-ok'));
  check('no row shows a percentage grade (only mm rise/run labels)',
    rows.every(r => !/%\)/.test(r.text)));
  check('at least one row mentions "layback/crossover leg"', rows.some(r => /layback\/crossover leg/i.test(r.text)));
}

// --- Kerb points chained straight into the layback template (no separate invert base) ---
{
  const kerbPvis = computeKerbPvisFrom(0, 25.000, 30);
  const base = kerbPvis[kerbPvis.length - 1];
  const laybackPvis = computeLaybackPvisFrom(base, base, 25, 450, 70, 450);
  const full = kerbPvis.concat(laybackPvis).sort((a,b) => a.chainage - b.chainage);
  check('4-point chain: before-leg, invert, top of kerb, after-leg', full.length === 4);
  check('before-leg chainage = 0 - 0.45 = -0.45', Math.abs(full[0].chainage - (-0.45)) < 1e-9);
  check('after-leg chainage = 0 + 0.45 = 0.45', Math.abs(full[3].chainage - 0.45) < 1e-9);
  const profile = computeDrivewayProfileFrom(full);
  check('every leg in an all-template chain is flagged isTemplate (or isVertical)',
    profile.legs.every(l => l.isTemplate === true || l.isVertical === true));
}

// --- Kerb points at a non-zero chainage chained into the layback template ---
// (confirms the layback legs still position themselves relative to the
// kerb chainage wherever it is, not hard-coded to start at/near 0)
{
  const kerbPvis = computeKerbPvisFrom(4.20, 25.000, 30);
  const invertBase = kerbPvis[0], topOfKerbBase = kerbPvis[1];
  const laybackPvis = computeLaybackPvisFrom(invertBase, topOfKerbBase, 25, 450, 70, 450);
  check('before-leg at 4.20 - 0.45 = 3.75', Math.abs(laybackPvis[0].chainage - 3.75) < 1e-9);
  check('after-leg at 4.20 + 0.45 = 4.65', Math.abs(laybackPvis[1].chainage - 4.65) < 1e-9);
}

// --- computeDrivewayComplianceFrom: the "boundary leg" is the first SLOPED,
// non-template leg, not index 0 ---
// (a vertical kerb face or a layback template ahead of the design shouldn't
// be treated as the footpath crossing)
{
  const kerbPvis = computeKerbPvisFrom(0, 25.000, 30);
  const topOfKerb = kerbPvis[1];
  const laybackPvis = computeLaybackPvisFrom(topOfKerb, topOfKerb, 25, 450, 70, 450);
  const manualPoint = {chainage: 5.0, rl: 25.100 + 0.25}; // a real, checked design leg after the template
  const full = kerbPvis.concat([laybackPvis[1]]).concat([manualPoint]);
  const profile = computeDrivewayProfileFrom(full);
  const rows = computeDrivewayComplianceFrom(profile, {maxGrade: 20, applyBoundaryRule: true, maxGradeBoundary: 3});
  const checkedRows = rows.filter(r => /%\)/.test(r.text));
  check('exactly one genuinely graded row (the manual design leg)', checkedRows.length === 1);
  check('that row is checked against the boundary limit (first non-template/non-vertical sloped leg)',
    checkedRows[0].text.includes('boundary/crossover'));
}

// --- computeSectionTableFrom: no driveway -> pure existing-ground table ---
{
  const breaks = [{chainage:0, elevation:10}, {chainage:20, elevation:9}, {chainage:50, elevation:8}];
  const table = computeSectionTableFrom(breaks, null, () => null, driveGroundRLAt);
  check('3 stations, 2 legs when no driveway', table.stations.length === 3 && table.legs.length === 2);
  check('every leg is tagged existing (isNew=false)', table.legs.every(l => l.isNew === false));
  check('every station has a null proposedRL', table.stations.every(s => s.proposedRL === null));
  check('leg 1 existing grade is -5% (1m drop over 20m)', Math.abs(table.legs[0].gradeExisting - (-5)) < 1e-9);
  check('leg 1 has no new grade (no driveway)', table.legs[0].gradeNew === null);
}

// --- computeSectionTableFrom: driveway spanning the whole alignment ---
{
  const breaks = [{chainage:0, elevation:10}, {chainage:100, elevation:8}];
  const dwProfile = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:100, rl:8}]);
  const existingAt = (ch) => 10 - ch*0.02; // matches the breaks' straight-line existing ground
  const table = computeSectionTableFrom(breaks, dwProfile, existingAt, driveGroundRLAt);
  check('driveway spanning the whole alignment: only 2 stations (start/end), both from the design',
    table.stations.length === 2);
  check('both stations carry a proposed level', table.stations.every(s => s.proposedRL !== null));
  check('the single leg is tagged new', table.legs.length === 1 && table.legs[0].isNew === true);
  check('leg has both an existing and a new grade (-2% each, by construction)',
    Math.abs(table.legs[0].gradeExisting - (-2)) < 1e-9 && Math.abs(table.legs[0].gradeNew - (-2)) < 1e-9);
}

// --- computeSectionTableFrom: driveway covering only part of the alignment ---
{
  // Existing ground breaks at 0, 5 (boundary), 50 (far end); driveway only
  // designs the first 5m (kerb to boundary) via 2 PVIs.
  const breaks = [{chainage:0, elevation:10}, {chainage:5, elevation:9.7}, {chainage:50, elevation:5}];
  const dwProfile = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:5, rl:9.7}]);
  const existingAt = (ch) => {
    if (ch <= 5) return 10 - ch*0.06;
    return 9.7 - (ch-5)*(4.7/45);
  };
  const table = computeSectionTableFrom(breaks, dwProfile, existingAt, driveGroundRLAt);
  // Expect stations: 0 (from dwProfile, dedup with existing break at 0), 5 (dedup), 50 (existing tail)
  check('3 stations total (design span + remaining existing tail)', table.stations.length === 3);
  check('first leg (0-5) is tagged new', table.legs[0].isNew === true);
  check('second leg (5-50) is tagged existing', table.legs[1].isNew === false);
  check('first leg has a new grade, second leg has none', table.legs[0].gradeNew !== null && table.legs[1].gradeNew === null);
  check('every leg always has an existing grade regardless of isNew', table.legs.every(l => l.gradeExisting !== null));
  check('station at chainage 50 has a null proposed level (outside design span)',
    table.stations[2].proposedRL === null);
  check('no duplicate station at chainage 5 (dedup worked)',
    table.stations.filter(s => Math.abs(s.chainage-5)<1e-6).length === 1);
}

// --- computeSectionTableFrom: existing-ground break strictly INSIDE the
// driveway's own span must still become its own station. Regression test
// for a real bug: such a break used to be silently dropped (only the
// driveway's own PVIs were stations), so a driveway spanning nearly the
// whole alignment left the table showing only its start and end chainage
// no matter how many real grade breaks sat between them. ---
{
  const breaks = [{chainage:0, elevation:10}, {chainage:50, elevation:9.5}, {chainage:100, elevation:8}];
  const dwProfile = computeDrivewayProfileFrom([{chainage:0, rl:10}, {chainage:100, rl:8}]);
  const existingAt = (ch) => {
    if (ch <= 50) return 10 - ch*0.01;
    return 9.5 - (ch-50)*0.03;
  };
  const table = computeSectionTableFrom(breaks, dwProfile, existingAt, driveGroundRLAt);
  check('interior existing-ground break becomes its own station (not dropped)',
    table.stations.length === 3);
  check('interior station keeps its real existing level (9.5)',
    Math.abs(table.stations[1].existingRL - 9.5) < 1e-9);
  check('interior station gets the design RL interpolated along the single design leg (9.0), not null',
    table.stations[1].proposedRL !== null && Math.abs(table.stations[1].proposedRL - 9.0) < 1e-9);
  check('both legs tagged new (every station has a design RL, since the whole span is designed)',
    table.legs.length === 2 && table.legs.every(l => l.isNew === true));
  check('leg 0-50: existing grade -1%, new (design) grade -2% — genuinely different values',
    Math.abs(table.legs[0].gradeExisting - (-1)) < 1e-9 && Math.abs(table.legs[0].gradeNew - (-2)) < 1e-9);
  check('leg 50-100: existing grade -3%, new (design) grade -2% — genuinely different values',
    Math.abs(table.legs[1].gradeExisting - (-3)) < 1e-9 && Math.abs(table.legs[1].gradeNew - (-2)) < 1e-9);
}

// ======= from run_tests10.js =======

// --- Vehicle templates: sanity-check the published/supplied dimensions ---
{
  const b99 = VEHICLE_TEMPLATES.b99, b85 = VEHICLE_TEMPLATES.b85;
  check('B99 wheelbase matches the 2004 reference sheet (3.050m)', b99.wheelbase === 3.050);
  check('B99 front overhang matches the 2004 reference sheet (0.950m)', b99.frontOverhang === 0.950);
  check('B99 rear overhang matches the 2004 reference sheet (1.200m, no flat lead-in)', b99.rearOverhang === 1.200);
  check('B99 is flagged official (AS 2890.1 Appendix D publishes a template for this vehicle class, even though these numbers are Thom\'s own 2004-sheet figures, not copied from it)', b99.official === true);
  check('B85 wheelbase matches supplied reference (2.800m)', b85.wheelbase === 2.800);
  check('B85 rear overhang = overall length - wheelbase - front overhang (4.910-2.800-0.920=1.190)',
    approx(b85.rearOverhang, 1.190));
  check('B85 is flagged NOT official (approximation, no AS 2890.1 template)', b85.official === false);
}

// --- templateUndersideLocal: sits at the vehicle's real min ground
// clearance throughout the flat sections (NOT flush with the wheels/road
// - that's what "min ground clearance" means), then an 8-degree ramp
// rises further above that baseline over the rear overhang ---
{
  const b99 = VEHICLE_TEMPLATES.b99;
  check('front overhang sits at the vehicle\'s min ground clearance (u=-0.5)',
    templateUndersideLocal(b99, -0.5) === b99.clearance);
  check('front wheel sits at min ground clearance (u=0)',
    templateUndersideLocal(b99, 0) === b99.clearance);
  check('rear wheel sits at min ground clearance (u=wheelbase)',
    templateUndersideLocal(b99, b99.wheelbase) === b99.clearance);
  check('B99\'s 2004 sheet has no rear flat lead-in, so the ramp starts immediately past the rear wheel',
    templateUndersideLocal(b99, b99.wheelbase+0.05) > b99.clearance);
  const heightAtRearExtremity = templateUndersideLocal(b99, b99.wheelbase + b99.rearOverhang);
  check('rear extremity is the min clearance plus the ramp\'s own rise (1.200m * tan(8deg) ~= 0.1686m)',
    approx(heightAtRearExtremity - b99.clearance, 1.200*Math.tan(8*Math.PI/180), 1e-4));
}

// --- sweepVehicleTemplateFrom: perfectly flat, level ground never scrapes ---
// (a flat road keeps the vehicle's full real clearance beneath it - the
// check exists to catch humps/grade changes eating into that clearance,
// not flat travel)
{
  const flat = () => 10.000;
  const res = sweepVehicleTemplateFrom(VEHICLE_TEMPLATES.b99, 5.0, flat);
  check('flat ground: does not scrape', res.scrapes === false);
  check('flat ground: worst clearance is the vehicle\'s full min ground clearance (120mm), not 0',
    approx(res.minClearance, VEHICLE_TEMPLATES.b99.clearance, 1e-6));
}

// --- sweepVehicleTemplateFrom: a hump between the wheels causes a scrape ---
// only once it eats past the vehicle's real min ground clearance (120mm)
{
  // Ground rises 160mm in a narrow bump centred between the front and rear
  // wheel of a sweep starting at chainage 0 (wheelbase 3.05m -> bump at ~1.525m)
  // - bigger than B99's 120mm clearance, so ~40mm of that bump actually scrapes.
  const groundRLAt = (ch) => {
    const bumpCentre = 1.525, bumpHeight = 0.16, bumpHalfWidth = 0.3;
    const base = 10.0;
    if (Math.abs(ch - bumpCentre) < bumpHalfWidth){
      return base + bumpHeight * (1 - Math.abs(ch-bumpCentre)/bumpHalfWidth);
    }
    return base;
  };
  const res = sweepVehicleTemplateFrom(VEHICLE_TEMPLATES.b99, 0, groundRLAt);
  check('a hump taller than the vehicle\'s clearance scrapes', res.scrapes === true);
  check('worst clearance is roughly -40mm (160mm bump minus 120mm clearance)', approx(res.minClearance, -0.04, 0.01));
  check('the worst point sits near the bump centre (~1.525m)', approx(res.worstChainage, 1.525, 0.2));
}

// --- sweepVehicleTemplateFrom: a hump SMALLER than the vehicle's real
// clearance does not scrape at all - confirms the baseline offset is
// actually being applied, not just the ramp geometry ---
{
  const groundRLAt = (ch) => {
    const bumpCentre = 1.525, bumpHeight = 0.05, bumpHalfWidth = 0.3;
    const base = 10.0;
    if (Math.abs(ch - bumpCentre) < bumpHalfWidth){
      return base + bumpHeight * (1 - Math.abs(ch-bumpCentre)/bumpHalfWidth);
    }
    return base;
  };
  const res = sweepVehicleTemplateFrom(VEHICLE_TEMPLATES.b99, 0, groundRLAt);
  check('a 50mm hump stays within the vehicle\'s 120mm clearance and does not scrape', res.scrapes === false);
  check('remaining clearance is roughly 70mm (120mm clearance minus the 50mm bump)', approx(res.minClearance, 0.07, 0.01));
}

// --- sweepVehicleTemplateFrom: a sag then rise behind the rear overhang scrapes ---
// (a steep-enough grade change right behind the rear wheel outruns the
// rear overhang's 8-degree ramp allowance). The rear overhang sits
// beyond the high-chainage wheel only when `flipped` (default now faces
// the OTHER way - front on the high-chainage side, see the vehicle-
// facing-default tests below) - pass flipped:true here specifically to
// exercise the ramp, matching this test's own stated scenario.
{
  // Ground: flat until chainage 3.05 (low-chainage wheel at 0, high-
  // chainage/rear wheel at 3.05 - B99's 2004 sheet has no flat lead-in,
  // so the ramp starts right at the rear wheel), then rises steeply (20
  // degrees, well beyond the template's 8-degree ramp) for the rest of
  // the rear overhang - the ramp can't keep up, so the ground pokes
  // through it.
  const kink = 3.05;
  const groundRLAt = (ch) => {
    if (ch <= kink) return 10.0;
    return 10.0 + (ch-kink)*Math.tan(20*Math.PI/180);
  };
  const res = sweepVehicleTemplateFrom(VEHICLE_TEMPLATES.b99, 0, groundRLAt, undefined, true);
  check('a grade change steeper than the rear ramp scrapes under the rear overhang', res.scrapes === true);
  check('the worst point is in the rear-overhang zone (beyond the rear wheel)', res.worstChainage > 3.05);
}

// --- sweepVehicleTemplateFrom: returns null when a wheel's ground RL is unknown ---
{
  const partial = (ch) => (ch < 2 ? 10.0 : null);
  const res = sweepVehicleTemplateFrom(VEHICLE_TEMPLATES.b99, 0, partial); // rear wheel at 3.05, unknown
  check('null when the rear wheel has no ground data', res === null);
}

// --- sweepVehicleTemplateFrom: default vehicle facing (front points
// toward increasing chainage, i.e. right on a normally-drawn chart) ---
// (2026-09-26: the default was deliberately set so the vehicle faces
// right without ticking "reversing" - the wheel at sweepChainage is the
// REAR wheel by default, with the ramped rear-overhang tip on the LOW-
// chainage side and the flat front-overhang tip on the HIGH-chainage
// side, so the front is the one pointing toward higher chainage/right)
{
  const b99 = VEHICLE_TEMPLATES.b99;
  const flat = () => 10.000;
  const res = sweepVehicleTemplateFrom(b99, 5.0, flat);
  check('default, flat ground: does not scrape', res.scrapes === false);
  check('default, flat ground: worst clearance is still the vehicle\'s full min ground clearance',
    approx(res.minClearance, b99.clearance, 1e-6));

  // On flat ground cosA=1/sinA=0, so each sample's rl is exactly
  // rlFront + templateUndersideLocal at that sample's *mirrored* u -
  // letting these two extremities directly confirm the ramp sits on the
  // low-chainage (rear) side by default and the high-chainage (front)
  // side is genuinely flat, not just that scrapes/clearance came out
  // unchanged.
  const lowHeight = res.samples[0].rl - res.rlFront;
  const highHeight = res.samples[res.samples.length-1].rl - res.rlFront;
  const rearTipHeight = templateUndersideLocal(b99, b99.wheelbase + b99.rearOverhang);
  check('default: the LOW-chainage extremity carries the rear\'s ramp height (rear faces left)',
    approx(lowHeight, rearTipHeight, 1e-6));
  check('default: the HIGH-chainage extremity is flat at min clearance (front faces right, never ramps)',
    approx(highHeight, b99.clearance, 1e-6));
  check('default: low-chainage extremity sits higher than high-chainage (the ramp only exists on the rear/low side)',
    lowHeight > highHeight);
}

// --- sweepVehicleTemplateFrom(flipped): vehicle reversing (rear leads
// in the direction of travel, so the front trails and points left) ---
// (Appendix B item: real use case is checking a car reversing down a
// steep driveway, where front/rear overhangs swap which end leads and
// the ramp - tied to the physical rear only - has to move with it. The
// default above already covers the forward-facing case, so flipped is
// exactly its mirror image.)
{
  const b99 = VEHICLE_TEMPLATES.b99;
  const flat = () => 10.000;
  const res = sweepVehicleTemplateFrom(b99, 5.0, flat, undefined, true);
  check('flipped, flat ground: does not scrape', res.scrapes === false);
  check('flipped, flat ground: worst clearance is still the vehicle\'s full min ground clearance',
    approx(res.minClearance, b99.clearance, 1e-6));

  const lowHeight = res.samples[0].rl - res.rlFront;
  const highHeight = res.samples[res.samples.length-1].rl - res.rlFront;
  const rearTipHeight = templateUndersideLocal(b99, b99.wheelbase + b99.rearOverhang);
  check('flipped: the HIGH-chainage extremity now carries the rear\'s ramp height (rear faces right)',
    approx(highHeight, rearTipHeight, 1e-6));
  check('flipped: the LOW-chainage extremity is now flat at min clearance (front faces left, never ramps)',
    approx(lowHeight, b99.clearance, 1e-6));
  check('flipped: high-chainage extremity sits higher than low-chainage (mirror image of the default)',
    highHeight > lowHeight);
}

// --- findWorstVehicleSweepFrom: locates a known bump as the worst sweep ---
// (bump height 200mm, bigger than B99's 120mm clearance, so it actually scrapes)
{
  const groundRLAt = (ch) => {
    const bumpCentre = 4.0, bumpHeight = 0.20, bumpHalfWidth = 0.25;
    const base = 20.0;
    if (Math.abs(ch - bumpCentre) < bumpHalfWidth){
      return base + bumpHeight * (1 - Math.abs(ch-bumpCentre)/bumpHalfWidth);
    }
    return base;
  };
  const worst = findWorstVehicleSweepFrom(VEHICLE_TEMPLATES.b99, 0, 6, groundRLAt, 0.05);
  check('worst-case search finds a scrape', worst.scrapes === true);
  check('the worst sweep chainage places the bump somewhere across the vehicle length',
    worst.worstChainage > worst.sweepChainage - 1.0 && worst.worstChainage < worst.sweepChainage + 4.5);
  check('worst clearance is roughly -80mm (200mm bump minus 120mm clearance)', approx(worst.minClearance, -0.08, 0.015));
}

// --- findWorstVehicleSweepFrom: an all-flat road is never worse than ~0 ---
{
  const flat = () => 5.0;
  const worst = findWorstVehicleSweepFrom(VEHICLE_TEMPLATES.b99, 0, 4, flat, 0.1);
  check('flat road worst case still does not scrape', worst.scrapes === false);
}

// --- vehicleSweepRangeFrom: default faces right (front on the high-
// chainage side), so the vehicle stops at the end of the driveway
// instead of driving its front overhang off the far end ---
{
  const b99 = VEHICLE_TEMPLATES.b99;
  const range = vehicleSweepRangeFrom(b99, 0, 100);
  check('default: rear overhang (on the low-chainage side by default) may hang out past the start',
    approx(range.start, -b99.rearOverhang));
  check('default: the far end is pulled back by the wheelbase + front overhang, so the front\'s own overhang tip lands exactly on the last design point',
    approx(range.end, 100 - b99.wheelbase - b99.frontOverhang));
  check('default: at the range end, the whole vehicle (front extremity) sits exactly at the driveway\'s last chainage',
    approx(range.end + b99.wheelbase + b99.frontOverhang, 100));
}

// --- vehicleSweepRangeFrom: a driveway shorter than the vehicle itself
// still returns a usable (non-inverted) range rather than end < start ---
{
  const b99 = VEHICLE_TEMPLATES.b99;
  const range = vehicleSweepRangeFrom(b99, 0, 1.0); // much shorter than wheelbase+overhangs
  check('a too-short driveway does not invert the range', range.end >= range.start);
}

// --- vehicleSweepRangeFrom(flipped): mirrors the default - reversing
// swaps which overhang (front vs. rear) sits on which side ---
// (B99's front/rear overhangs are different, so this isn't cosmetic -
// a flipped range genuinely covers different chainages than the
// default one)
{
  const b99 = VEHICLE_TEMPLATES.b99;
  const range = vehicleSweepRangeFrom(b99, 0, 100, true);
  check('flipped: the front overhang (not rear) may hang out past the start', approx(range.start, -b99.frontOverhang));
  check('flipped: the far end is pulled back by the wheelbase + REAR overhang',
    approx(range.end, 100 - b99.wheelbase - b99.rearOverhang));
  check('flipped range genuinely differs from the default range (front != rear overhang for B99)',
    Math.abs(range.start - vehicleSweepRangeFrom(b99, 0, 100).start) > 1e-6);
}

// --- declutterLabelsFrom: well-separated labels all get tier 0 ---
{
  const labels = [{x:0, text:'0.00'}, {x:5, text:'5.00'}, {x:10, text:'10.00'}];
  const out = declutterLabelsFrom(labels, {charWidth:0.05});
  check('well-spaced labels all sit at tier 0', out.every(l => l.tier === 0));
}

// --- declutterLabelsFrom: tightly packed labels spread across tiers, nothing dropped ---
{
  const labels = [{x:0, text:'-77.06%'}, {x:0.19, text:'+84.24%'}, {x:0.39, text:'-23.14%'}, {x:0.58, text:'-8.65%'}];
  const out = declutterLabelsFrom(labels, {charWidth:0.03, pad:0.005});
  check('every label is still present (nothing dropped)', out.length === 4);
  check('at least two distinct tiers were used (labels really do overlap at tier 0)',
    new Set(out.map(l => l.tier)).size >= 2);
  // No two labels sharing the same tier should have overlapping intervals.
  let anyOverlap = false;
  for (let t = 0; t < 5; t++){
    const sameTier = out.filter(l => l.tier === t).sort((a,b) => a.x - b.x);
    for (let i = 1; i < sameTier.length; i++){
      if (sameTier[i].x - sameTier[i].width/2 < sameTier[i-1].x + sameTier[i-1].width/2 - 1e-9) anyOverlap = true;
    }
  }
  check('no two same-tier labels overlap', !anyOverlap);
}

// --- layoutTableColumnsFrom: well-spaced stations keep their true chainage ---
{
  const adjusted = layoutTableColumnsFrom([0, 5, 10, 15], 1.0);
  check('well-spaced stations are left at their real chainage', adjusted.every((v,i) => v === [0,5,10,15][i]));
}

// --- layoutTableColumnsFrom: crowded stations get pushed apart, in order, first pinned ---
{
  const real = [0, 0.19, 0.39, 0.58, 8.0];
  const adjusted = layoutTableColumnsFrom(real, 1.0);
  check('first station keeps its true chainage', adjusted[0] === 0);
  check('every adjusted station is at least minColWidth apart from the previous',
    adjusted.every((v,i) => i===0 || v - adjusted[i-1] >= 1.0 - 1e-9));
  check('adjusted positions stay in the same order as the input (monotonic increasing)',
    adjusted.every((v,i) => i===0 || v > adjusted[i-1]));
  check('a station with plenty of real room (8.0, far beyond the crowd) is unaffected',
    adjusted[4] === 8.0);
}

// --- computeCrossfallTableFrom: picks evenly-spaced-by-index stations,
// always including both ends, without ever exceeding maxRows ---
{
  const series = [];
  for (let i=0;i<=100;i++) series.push({chainage:i*0.1, rlA:10, rlB:10.2, crossfall:0.2, crossfallPct:5});
  const table = computeCrossfallTableFrom(series, 11);
  check('never exceeds maxRows', table.rows.length <= 11);
  check('always includes the first station', table.rows[0].chainage === series[0].chainage);
  check('always includes the last station', table.rows[table.rows.length-1].chainage === series[series.length-1].chainage);
  check('crossfallMm is the crossfall value rounded to whole millimetres', table.rows.every(r => r.crossfallMm === 200));
}

// --- computeCrossfallTableFrom: a series shorter than maxRows returns
// every station, not padded or truncated ---
{
  const series = [{chainage:0, rlA:1, rlB:2, crossfall:1, crossfallPct:null},
                  {chainage:5, rlA:1, rlB:1.5, crossfall:0.5, crossfallPct:null}];
  const table = computeCrossfallTableFrom(series, 20);
  check('returns exactly the input length when shorter than maxRows', table.rows.length === 2);
}

// --- computeCrossfallTableFrom: a single-point series returns exactly
// one row rather than a degenerate duplicate ---
{
  const series = [{chainage:3, rlA:10, rlB:10.1, crossfall:0.1, crossfallPct:2}];
  const table = computeCrossfallTableFrom(series, 20);
  check('single-point series yields exactly one row', table.rows.length === 1);
  check('that row carries the one point\'s own values', table.rows[0].chainage === 3 && table.rows[0].crossfallMm === 100);
}

// --- computeCrossfallSeriesFrom: constant-offset ground gives a
// constant raw crossfall (rlB - rlA) at every sampled chainage ---
{
  const groundA = (ch) => 10.0 + ch*0.01;   // A rises gently
  const groundB = (ch) => 10.2 + ch*0.01;   // B is always 200mm higher than A
  const series = computeCrossfallSeriesFrom(groundA, groundB, 0, 20, 2);
  check('produces a point at every step across the range', series.length === 11);
  check('crossfall is rlB - rlA everywhere (constant 0.2m offset)',
    series.every(p => approx(p.crossfall, 0.2, 1e-9)));
  check('rlA/rlB are read straight from the two callbacks',
    approx(series[0].rlA, 10.0) && approx(series[0].rlB, 10.2));
  check('no width callback supplied: crossfallPct stays null',
    series.every(p => p.crossfallPct === null));
}

// --- computeCrossfallSeriesFrom: a width callback turns the raw level
// difference into a cross-slope percentage ---
{
  const groundA = () => 10.0;
  const groundB = () => 10.5; // 500mm higher
  const widthAt = () => 5.0;  // 5m apart -> 0.5/5 = 10% cross-slope
  const series = computeCrossfallSeriesFrom(groundA, groundB, 0, 10, 5, widthAt);
  check('crossfallPct reflects the supplied separation (10%)',
    series.every(p => approx(p.crossfallPct, 10, 1e-6)));
}

// --- computeCrossfallSeriesFrom: chainages where either side has no
// ground data are skipped, not zero-filled ---
{
  const groundA = (ch) => 10.0;
  const groundB = (ch) => (ch > 6 ? null : 10.3); // B runs out partway through
  const series = computeCrossfallSeriesFrom(groundA, groundB, 0, 10, 2);
  check('only chainages where both sides have data are included', series.every(p => p.chainage <= 6 + 1e-9));
  check('the out-of-range chainages are dropped, not returned as zero-crossfall points', series.length < 6);
}

// --- computeCrossfallSeriesFrom: a degenerate/inverted range returns
// an empty series rather than throwing ---
{
  check('rangeEnd <= rangeStart yields no points', computeCrossfallSeriesFrom(()=>1, ()=>1, 5, 5, 1).length === 0);
}

// --- chainageOfClosestPoint: parallel line offset laterally - the
// closest point sits at the same chainage, offset by the parallel gap ---
{
  const vertsB = [{x:0,y:2},{x:10,y:2}], cumB = [0,10];
  const r = chainageOfClosestPoint(vertsB, cumB, {x:5,y:0});
  check('parallel line: closest chainage matches straight across', approx(r.chainage, 5));
  check('parallel line: offset is the perpendicular gap (2m)', approx(r.offset, 2));
}

// --- chainageOfClosestPoint: a line running perpendicular to the probe
// point still finds the correct clamped foot, not just an endpoint ---
{
  const vertsB = [{x:-3,y:5},{x:-3,y:-5}], cumB = [0,10]; // vertical, chainage 0 at y=5
  const r = chainageOfClosestPoint(vertsB, cumB, {x:0,y:0});
  check('perpendicular line: foot lands at the midpoint (y=0 -> chainage 5)', approx(r.chainage, 5));
  check('perpendicular line: offset is the horizontal gap (3m)', approx(r.offset, 3));
}

// --- chainageOfClosestPoint: a point beyond either end of the polyline
// clamps to that end instead of extrapolating past it ---
{
  const vertsB = [{x:0,y:0},{x:10,y:0}], cumB = [0,10];
  const rBefore = chainageOfClosestPoint(vertsB, cumB, {x:-5,y:1});
  check('clamps to chainage 0 when the point is off the start', approx(rBefore.chainage, 0));
  check('offset is the straight distance to that clamped endpoint (sqrt(25+1))', approx(rBefore.offset, Math.sqrt(26)));
  const rAfter = chainageOfClosestPoint(vertsB, cumB, {x:15,y:0});
  check('clamps to chainage = total when the point is off the end', approx(rAfter.chainage, 10));
}

// --- computeCrossfallSeriesPerpendicular: B doesn't start at a chainage
// comparable to A's (real motivating case) - the projected chainage on
// B genuinely differs from A's own raw chainage, unlike matching-
// chainage mode which would just reuse it ---
{
  // A: straight line along y=0, chainage 0..10.
  const vertsA = [{x:0,y:0},{x:10,y:0}], cumA = [0,10];
  // B: parallel to A (offset +2 in y) but shifted sideways so its own
  // chainage-0 start (x=5) doesn't line up with A's chainage-0 (x=0).
  const vertsB = [{x:5,y:2},{x:15,y:2}], cumB = [0,10];
  const groundA = () => 0;
  const groundB = (chB) => chB; // B's RL equals its own chainage, so the projected chainage is directly checkable
  const series = computeCrossfallSeriesPerpendicular(vertsA, cumA, vertsB, cumB, groundA, groundB, 0, 10, 5);
  check('produces a point at every step across A\'s own range', series.length === 3);
  check('A chainage 0 projects (clamped) onto B chainage 0, not 0 by coincidence of matching values',
    approx(series[0].rlB, 0));
  check('A chainage 5 also clamps onto B chainage 0 (B starts further along in space)',
    approx(series[1].rlB, 0));
  check('A chainage 10 projects onto B chainage 5 - genuinely different from A\'s own raw chainage (10)',
    approx(series[2].rlB, 5));
  check('crossfallPct is derived from the projection\'s own true offset, not a separate widthAt callback',
    series[2].crossfallPct !== null && approx(series[2].crossfallPct, (series[2].crossfall/2)*100, 1e-6));
}

// --- computeCrossfallSeriesPerpendicular: a degenerate/inverted range,
// or a too-short polyline on either side, returns an empty series
// rather than throwing ---
{
  const vertsA = [{x:0,y:0},{x:10,y:0}], cumA = [0,10];
  const vertsB = [{x:0,y:2},{x:10,y:2}], cumB = [0,10];
  check('rangeEnd <= rangeStart yields no points',
    computeCrossfallSeriesPerpendicular(vertsA, cumA, vertsB, cumB, ()=>1, ()=>1, 5, 5, 1).length === 0);
  check('a single-vertex alignment yields no points, not a thrown error',
    computeCrossfallSeriesPerpendicular(vertsA, cumA, [{x:0,y:2}], [0], ()=>1, ()=>1, 0, 10, 2).length === 0);
}

// --- computeCutFillVolumeFrom: constant fill depth over a flat span ---
// (design 0.5m above flat existing ground everywhere -> pure fill, no cut)
{
  const samples = [{chainage:0}, {chainage:10}];
  const dwProfile = {pvis: [{chainage:0, rl:10.5}, {chainage:10, rl:10.5}]};
  const vol = computeCutFillVolumeFrom(samples, dwProfile, 2, () => 10.0, () => 10.5);
  check('pure-fill case: fillVolume = depth * length * width (0.5*10*2=10)', approx(vol.fillVolume, 10, 1e-6));
  check('pure-fill case: cutVolume is zero', approx(vol.cutVolume, 0, 1e-6));
  check('pure-fill case: netVolume equals fillVolume', approx(vol.netVolume, 10, 1e-6));
  check('length is the design span (10m)', approx(vol.length, 10, 1e-6));
}

// --- computeCutFillVolumeFrom: constant cut depth over a flat span ---
{
  const samples = [{chainage:0}, {chainage:10}];
  const dwProfile = {pvis: [{chainage:0, rl:10.0}, {chainage:10, rl:10.0}]};
  const vol = computeCutFillVolumeFrom(samples, dwProfile, 2, () => 10.5, () => 10.0);
  check('pure-cut case: cutVolume = depth * length * width (0.5*10*2=10)', approx(vol.cutVolume, 10, 1e-6));
  check('pure-cut case: fillVolume is zero', approx(vol.fillVolume, 0, 1e-6));
  check('pure-cut case: netVolume is negative (fill-cut)', approx(vol.netVolume, -10, 1e-6));
}

// --- computeCutFillVolumeFrom: ground crosses a flat design exactly at
// an existing-ground sample chainage - the merged breakpoints split the
// integral cleanly into a fill triangle and a cut triangle either side ---
{
  const samples = [{chainage:0}, {chainage:5}, {chainage:10}]; // sample at the crossing
  const dwProfile = {pvis: [{chainage:0, rl:10}, {chainage:10, rl:10}]}; // flat design at RL10
  const groundAt = (ch) => 9.0 + ch*0.2; // 9.0 at ch0, 10.0 at ch5, 11.0 at ch10
  const vol = computeCutFillVolumeFrom(samples, dwProfile, 3, groundAt, () => 10);
  check('symmetric crossing: cut and fill areas are equal (2.5m^2 each before width)',
    approx(vol.cutVolume, 7.5, 1e-6) && approx(vol.fillVolume, 7.5, 1e-6));
  check('symmetric crossing: net volume is zero', approx(vol.netVolume, 0, 1e-6));
}

// --- computeCutFillVolumeFrom: a gap in ground data is skipped, not
// zero-filled - only the segments with real data on both ends count ---
{
  const samples = [{chainage:0}, {chainage:2}, {chainage:4}, {chainage:6}, {chainage:8}, {chainage:10}];
  const groundAt = (ch) => (ch === 4 || ch === 6) ? null : 10.0; // no data at these two breakpoints
  const dwProfile = {pvis: [{chainage:0, rl:11}, {chainage:10, rl:11}]}; // flat design, +1m fill where known
  const vol = computeCutFillVolumeFrom(samples, dwProfile, 1, groundAt, () => 11);
  check('only the two segments clear of the gap contribute (0-2 and 8-10: 1*2 + 1*2 = 4)',
    approx(vol.fillVolume, 4, 1e-6));
  check('the segments touching the gap (2-4, 4-6, 6-8) are excluded, not assumed zero-depth',
    approx(vol.cutVolume, 0, 1e-6));
}

// --- computeCutFillVolumeFrom: null-returning edge cases ---
{
  const flatSamples = [{chainage:0}, {chainage:10}];
  check('no ground data anywhere returns null, not a zero volume',
    computeCutFillVolumeFrom(flatSamples, {pvis:[{chainage:0,rl:10},{chainage:10,rl:10}]}, 2, () => null, () => 10) === null);
  check('no driveway profile returns null',
    computeCutFillVolumeFrom(flatSamples, null, 2, () => 10, () => 10) === null);
  check('a driveway profile with fewer than 2 PVIs returns null',
    computeCutFillVolumeFrom(flatSamples, {pvis:[{chainage:0,rl:10}]}, 2, () => 10, () => 10) === null);
  check('a zero-length design (both PVIs at the same chainage) returns null',
    computeCutFillVolumeFrom(flatSamples, {pvis:[{chainage:5,rl:10},{chainage:5,rl:11}]}, 2, () => 10, () => 10) === null);
}

// --- computeCutFillVolumeFrom: corridor width scales the volume linearly ---
{
  const samples = [{chainage:0}, {chainage:10}];
  const dwProfile = {pvis: [{chainage:0, rl:10.5}, {chainage:10, rl:10.5}]};
  const volNarrow = computeCutFillVolumeFrom(samples, dwProfile, 1, () => 10.0, () => 10.5);
  const volWide = computeCutFillVolumeFrom(samples, dwProfile, 4, () => 10.0, () => 10.5);
  check('doubling/quadrupling the corridor width scales fillVolume linearly',
    approx(volWide.fillVolume, volNarrow.fillVolume * 4, 1e-6));
}

// --- triangulate(): triangle count matches the standard Delaunay/Euler
// identity 2n-2-h (h = convex hull point count) on random point sets ---
// (PLAN.md Stage 1: verifies the delaunator swap against an invariant
// that's true for ANY full triangulation of a point set's convex hull,
// independent of which algorithm produced it - not just re-checking
// delaunator against itself. mulberry32 per Appendix A's own note: a
// naive LCG can overflow float64 and emit duplicate points, which
// produces a misleading triangle-count anomaly that isn't a real bug.)
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Independent convex hull implementation (Andrew's monotone chain) used
// only to compute h for the identity above - deliberately not reusing
// anything from delaunator itself, so this isn't circular.
function convexHullSize(points){
  const pts = points.slice().sort((a,b) => a.x - b.x || a.y - b.y);
  const cross = (o,a,b) => (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x);
  function half(arr){
    const h = [];
    for (const p of arr){
      while (h.length >= 2 && cross(h[h.length-2], h[h.length-1], p) <= 0) h.pop();
      h.push(p);
    }
    return h;
  }
  const lower = half(pts);
  const upper = half(pts.slice().reverse());
  return lower.length + upper.length - 2; // each half re-includes both endpoints
}
{
  const rand = mulberry32(42);
  for (const n of [10, 50, 200, 1000, 4000]){
    const points = [];
    for (let i=0;i<n;i++) points.push({x: rand()*1000, y: rand()*1000});
    const tris = triangulate(points);
    const h = convexHullSize(points);
    const expected = 2*n - 2 - h;
    check(`triangle count matches 2n-2-h for n=${n} random points (h=${h})`, tris.length === expected);

    const seen = new Set();
    let anyDegenerate = false;
    for (const t of tris){
      if (t[0]===t[1] || t[1]===t[2] || t[0]===t[2]) anyDegenerate = true;
      t.forEach(idx => seen.add(idx));
    }
    check(`n=${n}: no triangle has a repeated vertex index`, !anyDegenerate);
    check(`n=${n}: every input point is used by at least one triangle`, seen.size === n);
  }
}

// ======= Stage 3: save/reload (project.ts) =======

{
  const breakdown = computeLayerBreakdown([
    {x:0,y:0,z:1,layer:'SURVEY'}, {x:1,y:0,z:1,layer:'SURVEY'}, {x:2,y:0,z:1,layer:'TEXT'}, {x:3,y:0,z:1}
  ]);
  check('computeLayerBreakdown sorts by layer name and counts each',
    breakdown.length===3 &&
    breakdown[0].layer==='0' && breakdown[0].count===1 && // untagged point defaults to layer "0"
    breakdown[1].layer==='SURVEY' && breakdown[1].count===2 &&
    breakdown[2].layer==='TEXT' && breakdown[2].count===1);
}

{
  // Two independent alignments, each with its own driveway design — the
  // shape PLAN.md §6 Stage 3's verification section explicitly requires
  // a round trip to preserve (not just the data, but trap 2's alias).
  const fakeAppState = {
    points: [], triangles: [], polyline: null,
    zMin: 0, zMax: 0, offsetX: 0, offsetY: 0, offsetZ: 0,
    verticalExaggeration: 2.5, currentView: 'driveway',
    rawPoints: [{x:0,y:0,z:10,layer:'SURVEY'}, {x:10,y:0,z:11,layer:'SURVEY'}, {x:5,y:5,z:9,layer:'TEXT'}],
    pointLayers: null,
    activePointLayers: new Set(['SURVEY']),
    rawAlignments: [
      {label:'A', layer:null, vertices:[{x:0,y:0},{x:100,y:0}]},
      {label:'B', layer:null, vertices:[{x:0,y:0},{x:100,y:0}]}
    ],
    activeAlignmentIndex: 0,
    drivewayByAlignment: {
      '0': {enabled:true, pvis:[{chainage:0,rl:10},{chainage:20,rl:10.4}], frontier:null, kerbInvert:null, vehicleCheck:{enabled:false,model:'b99',sweepChainage:null}, cutFillCorridorWidth:3},
      '1': {enabled:true, pvis:[{chainage:0,rl:8},{chainage:15,rl:8.6}], frontier:null, kerbInvert:null, vehicleCheck:{enabled:false,model:'b85',sweepChainage:null}, cutFillCorridorWidth:4}
    },
    crossfall: {alignA:0, alignB:1, markerChainage:12.5},
    driveway: null // never read by serializeProject — see trap 2
  };
  const domSettings = {
    filters: {ignoreZero:true, ignoreFar:false, farLimit:500},
    datum: {enabled:true, rl:5.25},
    view: {
      currentView:'driveway', verticalExaggeration:2.5, wireframe:true, points:false, alignment:true,
      profileTrueScale:false, sampleInterval:1.5, gradeBreakTolerance:0.1,
      chainageIntervalEnabled:true, chainageIntervalValue:5
    }
  };

  const project = serializeProject(fakeAppState, domSettings);
  check('serializeProject omits state.driveway itself (trap 2 input)', !('driveway' in project));
  check('serializeProject stores activePointLayers as a plain array (trap 1)',
    Array.isArray(project.activePointLayers) && project.activePointLayers.length===1 && project.activePointLayers[0]==='SURVEY');

  // JSON round-trip, same as an actual file write/read.
  const roundTripped = JSON.parse(JSON.stringify(project));
  const restoredDom = applyProjectData(roundTripped);

  check('applyProjectData restores activePointLayers as a real Set',
    state.activePointLayers instanceof Set && state.activePointLayers.has('SURVEY') && state.activePointLayers.size===1);
  check('applyProjectData restores both alignments’ driveway designs',
    state.drivewayByAlignment['0'].pvis.length===2 && state.drivewayByAlignment['1'].pvis.length===2);
  check('applyProjectData restores the active alignment index', state.activeAlignmentIndex === 0);
  check('applyProjectData restores crossfall settings', state.crossfall.alignB===1 && state.crossfall.markerChainage===12.5);
  check('applyProjectData returns the DOM settings unchanged', restoredDom.datum.rl===5.25 && restoredDom.filters.farLimit===500);

  // The trap-2 regression test itself: state.driveway must be a live
  // ALIAS into drivewayByAlignment[activeAlignmentIndex], not an
  // independent copy — mutating one must mutate the other, and must
  // NOT bleed into the other alignment's own design.
  check('state.driveway re-aliased to the active alignment (0) after load',
    state.driveway === state.drivewayByAlignment['0']);
  state.driveway.pvis.push({chainage: 40, rl: 11.0});
  check('mutating state.driveway mutates drivewayByAlignment (trap 2 regression)',
    state.drivewayByAlignment['0'].pvis.length === 3);
  check('the OTHER alignment’s design is untouched by that mutation',
    state.drivewayByAlignment['1'].pvis.length === 2);
}

{
  const sample = JSON.stringify({hello:'world', n:12345, arr:[1,2,3]});
  const compressed = await gzipCompress(sample);
  check('gzipCompress produces real gzip-magic-byte output', looksGzipped(compressed));
  const restored = await gzipDecompress(compressed);
  check('gzipCompress/gzipDecompress round-trip is lossless', restored === sample);
  check('looksGzipped rejects plain JSON text bytes', !looksGzipped(new TextEncoder().encode(sample)));
}

// ======= Stage 4: PWA manifest sanity check =======
// Cheap regression guard: a typo here silently breaks installability
// (Chrome just declines to offer "Install", with no error anywhere
// obvious) rather than throwing, so it's worth a direct check.
{
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/manifest.json', import.meta.url)));
  check('manifest.json has the required installability fields',
    typeof manifest.name === 'string' && manifest.name.length > 0 &&
    typeof manifest.start_url === 'string' &&
    manifest.display === 'standalone' &&
    Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  check('manifest.json declares a 512x512 icon (required for install prompts)',
    manifest.icons.some(i => i.sizes === '512x512'));
  check('manifest.json’s icon files all exist in public/',
    manifest.icons.every(i => fs.existsSync(new URL('../public/' + i.src, import.meta.url))));
  check('manifest.json declares the .gradeline file handler',
    Array.isArray(manifest.file_handlers) &&
    manifest.file_handlers.some(h => Object.values(h.accept || {}).some(exts => exts.includes('.gradeline'))));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
