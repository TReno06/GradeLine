// Reversing an alignment (2026-11-07): the alignment's vertex order is
// flipped, so chainage 0 moves to what used to be its far end and the
// long section reads the other way. A driveway design already laid on
// that alignment must stay on the same physical ground, so every stored
// chainage c becomes (total - c). Pure: takes and returns plain data.
import type { DrivewayState, Pvi } from '../types.ts';

function mirrorCh(total: number, ch: number): number {
  // Round-trip safe: reversing twice must give back the exact same
  // numbers (no slow float drift), so snap to 1e-9m.
  return Math.round((total - ch) * 1e9) / 1e9;
}

export function mirrorDrivewayState(dw: DrivewayState, total: number): DrivewayState {
  // Reverse first, then map: the array goes from ascending to ascending
  // in the new chainage, and the two points of a vertical face (same
  // chainage, e.g. kerb invert then top of kerb) swap order, which is
  // exactly right since the direction of travel has flipped too.
  var pvis: Pvi[] = dw.pvis.slice().reverse().map(function(p){
    var q: Pvi = {chainage: mirrorCh(total, p.chainage), rl: p.rl};
    if (p.template) q.template = p.template;
    return q;
  });
  return {
    enabled: dw.enabled,
    pvis: pvis,
    frontier: dw.frontier ? {chainage: mirrorCh(total, dw.frontier.chainage), rl: dw.frontier.rl} : null,
    kerbInvert: dw.kerbInvert ? {chainage: mirrorCh(total, dw.kerbInvert.chainage), rl: dw.kerbInvert.rl} : null,
    // The vehicle keeps driving the same physical way, which now points
    // toward decreasing chainage, so its chart orientation flips. Its
    // position is re-found (worst point) under the new orientation.
    vehicleCheck: Object.assign({}, dw.vehicleCheck, {sweepChainage: null, flipped: !dw.vehicleCheck.flipped}),
    cutFillCorridorWidth: dw.cutFillCorridorWidth
  };
}
