// Ported from section_extract.js as part of PLAN.md Stage 2 (2026-09-19).
// This module is now the single source of truth for this logic — both
// the app (main.js) and the test suite import it directly, so there is
// no longer a hand-mirrored copy to drift out of sync.

// Vehicle ground-clearance templates (AS 2890.1 Appendix D style): a rigid
// underside shape checked against the ground profile at any longitudinal
// "sweep" position, by resting two wheel-contact points on the ground and
// rotating the whole rigid template to match the resulting chord — exactly
// the physical method Appendix D itself specifies ("apply the template to
// the longitudinal section plot so the two knife edges... sit on the
// plot"). AS 2890.1's Appendix D (Figure D1, 1993 edition) publishes an
// official B99 template (wheelbase 3.07m, 800mm front overhang, 1100mm
// rear overhang) but is explicitly B99-only, so B85 has never had an
// official equivalent. Both templates below instead use the same 2004
// vehicle-dimension reference sheets Thom supplied for each (wheelbase/
// overhang/min-clearance figures) — B85 always did; B99 was switched from
// the Appendix D figures to match, by Thom's explicit choice (confirmed
// 2026-09-19: these are what he uses day to day), not because Appendix D
// is wrong. `official:true` on B99 reflects that AS 2890.1 does publish a
// template for this vehicle class, not that these numbers are copied from
// it. Neither 2004 sheet gives a rear flat lead-in, so both ramps start
// right at the rear wheel.
import type { VehicleTemplate, GroundRLAt, VehicleSweepResult, VehicleSweepRange } from '../types.ts';

export var VEHICLE_TEMPLATES: Record<string, VehicleTemplate> = {
  b99: {
    key: 'b99', label: 'B99', official: true,
    wheelbase: 3.050, frontOverhang: 0.950, rearOverhang: 1.200,
    rearFlatLeadIn: 0, rampAngleDeg: 8, clearance: 0.120
  },
  b85: {
    key: 'b85', label: 'B85', official: false,
    wheelbase: 2.800, frontOverhang: 0.920, rearOverhang: 1.190,
    rearFlatLeadIn: 0, rampAngleDeg: 8, clearance: 0.120
  }
};

// Local-frame underside height v(u) for a distance u (metres) measured
// from the front wheel contact point, positive toward the rear. Flat
// (v=0, the worst-case/no-clearance-margin baseline) from the front
// extremity through both wheels and the rear's flat lead-in, then rises
// at rampAngleDeg for the rest of the rear overhang. A completely flat,
// level road grazes this baseline everywhere (clearance exactly 0, a
// pass) — the check exists to catch a hump, dip or grade change that
// pushes the actual ground above this line anywhere along it.
// Height of the underside above the wheel-to-wheel chord line at local
// position u. The flat sections sit at the vehicle's actual minimum
// ground clearance throughout (not flush with the wheels) — that's what
// "min ground clearance" means — and the rear ramp rises further above
// that baseline.
export function templateUndersideLocal(template: VehicleTemplate, u: number): number {
  var rampStart = template.wheelbase + template.rearFlatLeadIn;
  if (u <= rampStart) return template.clearance;
  return template.clearance + (u - rampStart) * Math.tan(template.rampAngleDeg * Math.PI/180);
}

// Sweeps the rigid template so the wheel at chainage `sweepChainage`
// (u=0) rests exactly on groundRLAt(), together with the other wheel at
// `sweepChainage + wheelbase`, and the whole template is rotated to
// match the resulting chord slope (a proper 2D rotation, not a
// small-angle approximation, so it stays correct on steep grades).
// Returns the underside as a list of {chainage, rl} samples (low-
// chainage extremity to high-chainage extremity) plus the worst
// (minimum) clearance found against groundRLAt() and where it occurs.
// groundRLAt(chainage) must return a number, or null/undefined where
// the ground is unknown (those chainages are skipped for the clearance
// search but still sampled for drawing). Returns null if either wheel's
// own ground RL is unavailable (can't rest the template).
//
// By default (`flipped` false/omitted) the vehicle faces toward
// increasing chainage — the wheel at `sweepChainage` (u=0) is the REAR
// wheel, the front wheel and its overhang sit at higher chainage, so
// the front of the vehicle points right on a normally-drawn chart
// (chainage increasing left to right). `flipped` models the vehicle
// reversing instead (rear leads in the direction of travel, so the
// front points left, i.e. trails) — real use case: checking a car
// reversing out of a garage down a steep driveway vs. driving in
// normally. frontOverhang and rearOverhang are asymmetric (so is the
// underside shape: templateUndersideLocal's ramp is tied to the
// physical rear overhang only, never the front), so which end leads
// changes the actual computed clearance, not just the picture. Rather
// than special-casing templateUndersideLocal itself (whose own u=0 is
// always the front wheel), the ramp is kept exactly where it physically
// belongs (the rear) by mirroring the u coordinate fed to it around the
// wheelbase midpoint whenever the front wheel ISN'T at this function's
// own u=0: templateUndersideLocal(template, wheelbase-u) reads the
// *rear's* shape at this function's u=0, since wheelbase-0=wheelbase
// sits exactly at templateUndersideLocal's own flat-vs-ramp boundary
// and mirrors correctly at both overhang tips (verified: u=-rearOverhang
// maps to wheelbase+rearOverhang, templateUndersideLocal's own rear-tip
// u value; u=wheelbase+frontOverhang maps to -frontOverhang, its own
// front-tip value).
export function sweepVehicleTemplateFrom(template: VehicleTemplate, sweepChainage: number, groundRLAt: GroundRLAt, sampleStep?: number, flipped?: boolean): VehicleSweepResult | null {
  sampleStep = sampleStep || 0.02;
  var rlFront = groundRLAt(sweepChainage);
  var rlRear = groundRLAt(sweepChainage + template.wheelbase);
  if (rlFront === null || rlFront === undefined || rlRear === null || rlRear === undefined) return null;
  var chordAngle = Math.atan2(rlRear - rlFront, template.wheelbase);
  var cosA = Math.cos(chordAngle), sinA = Math.sin(chordAngle);
  // Low-chainage-side (uStart) and high-chainage-side (uEnd) overhangs.
  // Default: low side = rear (wheel at sweepChainage is the rear wheel),
  // high side = front — vehicle faces right. Flipped: swapped — faces left.
  var lowOverhang = flipped ? template.frontOverhang : template.rearOverhang;
  var highOverhang = flipped ? template.rearOverhang : template.frontOverhang;
  var uStart = -lowOverhang, uEnd = template.wheelbase + highOverhang;
  var samples: {chainage: number; rl: number; u: number}[] = [];
  var minClearance = Infinity, worstChainage: number | null = null, worstGroundRL: number | null = null, worstUnderRL: number | null = null;
  var n = Math.max(2, Math.ceil((uEnd-uStart)/sampleStep));
  for (var i=0;i<=n;i++){
    var u = uStart + (uEnd-uStart)*i/n;
    // Front wheel sits at this function's u=0 only when flipped; when
    // it doesn't (the default), mirror so templateUndersideLocal (whose
    // own u=0 is always the front wheel) still reads the right shape.
    var v = templateUndersideLocal(template, flipped ? u : (template.wheelbase - u));
    var dx = u*cosA - v*sinA, dy = u*sinA + v*cosA;
    var ch = sweepChainage + dx, rl = rlFront + dy;
    samples.push({chainage:ch, rl:rl, u:u});
    var groundRL = groundRLAt(ch);
    if (groundRL !== null && groundRL !== undefined){
      var clearance = rl - groundRL;
      if (clearance < minClearance){
        minClearance = clearance; worstChainage = ch; worstGroundRL = groundRL; worstUnderRL = rl;
      }
    }
  }
  if (minClearance === Infinity) return null;
  return {samples:samples, minClearance:minClearance, worstChainage:worstChainage,
    worstGroundRL:worstGroundRL, worstUnderRL:worstUnderRL, scrapes: minClearance < -1e-6,
    rlFront:rlFront, cosA:cosA, sinA:sinA};
}

// Searches sweep positions (the chainage of the wheel at
// sweepVehicleTemplateFrom's own u=0 — see its own comment for which
// physical wheel that is) from rangeStart to rangeEnd for the worst
// (most negative) clearance, returning that sweep's own
// sweepVehicleTemplateFrom() result plus the sweep chainage itself as
// `sweepChainage`. Returns null if no valid sweep position was found
// anywhere in the range (e.g. ground unknown everywhere).
export function findWorstVehicleSweepFrom(template: VehicleTemplate, rangeStart: number, rangeEnd: number, groundRLAt: GroundRLAt, sweepStep?: number, sampleStep?: number, flipped?: boolean): (VehicleSweepResult & {sweepChainage: number}) | null {
  sweepStep = sweepStep || 0.05;
  var best: VehicleSweepResult | null = null, bestS: number | null = null;
  for (var s=rangeStart; s<=rangeEnd+1e-9; s+=sweepStep){
    var res = sweepVehicleTemplateFrom(template, s, groundRLAt, sampleStep, flipped);
    if (res && (best === null || res.minClearance < best.minClearance)){
      best = res; bestS = s;
    }
  }
  if (best === null || bestS === null) return null;
  return Object.assign(best, {sweepChainage: bestS});
}

// The allowed range for the sweep position (the chainage of the wheel at
// this function's own u=0 — the rear wheel by default, the front wheel
// when `flipped`), given the design's first/last chainage. The low-
// chainage-side overhang may hang out past the start (a real car's
// overhang is out over the kerb/footpath before its wheels reach the
// design), but the far end is capped so the whole vehicle - including
// the high-chainage-side overhang - stops at the design's last point
// instead of driving its back half off into whatever ground happens to
// continue beyond it. `flipped` swaps which overhang (front vs. rear)
// sits on which side, matching sweepVehicleTemplateFrom's own convention.
export function vehicleSweepRangeFrom(template: VehicleTemplate, firstChainage: number, lastChainage: number, flipped?: boolean): VehicleSweepRange {
  var lowOverhang = flipped ? template.frontOverhang : template.rearOverhang;
  var highOverhang = flipped ? template.rearOverhang : template.frontOverhang;
  var start = firstChainage - lowOverhang;
  var end = lastChainage - template.wheelbase - highOverhang;
  if (end < start) end = start;
  return {start: start, end: end};
}
