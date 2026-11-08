// Ported from section_extract.js as part of PLAN.md Stage 2 (2026-09-19).
// This module is now the single source of truth for this logic — both
// the app (main.js) and the test suite import it directly, so there is
// no longer a hand-mirrored copy to drift out of sync.

// Crossfall between two independent driveway designs (or existing-ground
// profiles), read at MATCHING CHAINAGE VALUE along each alignment — a
// stated simplification, not a perpendicular/spatial projection between
// the two alignments, so it's only meaningful when both alignments start
// at a comparable point and run roughly parallel. groundRLAtA/B are
// callbacks (chainage -> RL or null); widthAt is an optional callback
// (chainage -> the real horizontal separation between the two
// alignments there) that, when supplied, also expresses the crossfall
// as a cross-slope percentage rather than just a raw level difference.
// Chainages where either side has no data are skipped rather than
// producing a bogus zero-crossfall point.
import { chainageSquareAcross } from './geometry/chainage.ts';
import type { GroundRLAt, WidthAt, CrossfallSeriesPoint, Point2 } from './types.ts';

export function computeCrossfallSeriesFrom(groundRLAtA: GroundRLAt, groundRLAtB: GroundRLAt, rangeStart: number, rangeEnd: number, step: number, widthAt: WidthAt | undefined): CrossfallSeriesPoint[] {
  var out: CrossfallSeriesPoint[] = [];
  if (!(rangeEnd > rangeStart) || !(step > 0)) return out;
  var n = Math.max(1, Math.round((rangeEnd - rangeStart) / step));
  for (var i=0; i<=n; i++){
    var ch = rangeStart + (rangeEnd - rangeStart) * i / n;
    var rlA = groundRLAtA(ch);
    var rlB = groundRLAtB(ch);
    if (rlA === null || rlA === undefined || rlB === null || rlB === undefined) continue;
    var crossfall = rlB - rlA;
    var crossfallPct: number | null = null;
    if (typeof widthAt === 'function'){
      var width = widthAt(ch);
      if (width !== null && width !== undefined && width > 1e-6){
        crossfallPct = (crossfall / width) * 100;
      }
    }
    out.push({chainage: ch, rlA: rlA, rlB: rlB, crossfall: crossfall, crossfallPct: crossfallPct});
  }
  return out;
}

// The perpendicular-projection alternative (PLAN.md Appendix B item 2)
// to the matching-chainage-value comparison above: samples chainage
// along alignment A only, and for each sample projects the actual
// spatial point onto alignment B via chainageOfClosestPoint — the true
// nearest point on B's own line, not B's value at the same chainage
// NUMBER — then reads B's RL there instead. Meaningful for two
// alignments that aren't roughly parallel from a shared chainage-0
// start (matching-chainage's own stated limitation), at the cost of
// needing both alignments' full vertex/cumulative-chainage geometry
// (vertsA/cumA/vertsB/cumB), not just an RL-at-chainage callback for
// each — the projection has to work in real X/Y space, an RL lookup
// alone can't do it. `chainage` in the returned points is always A's
// own chainage (what the crossfall view's shared x-axis is drawn
// against), never B's projected one. The projection's own offset
// distance doubles as the true perpendicular separation between the two
// alignments at that point, so crossfallPct falls out of it directly —
// no separate widthAt callback needed here, unlike the matching-
// chainage version above (alignmentSeparationAt's straight-line
// distance is only an approximation of that separation, not the real
// one, which is exactly the assumption this mode exists to drop).
export function computeCrossfallSeriesPerpendicular(vertsA: Point2[], cumA: number[], vertsB: Point2[], cumB: number[], groundRLAtA: GroundRLAt, groundRLAtB: GroundRLAt, rangeStart: number, rangeEnd: number, step: number): CrossfallSeriesPoint[] {
  var out: CrossfallSeriesPoint[] = [];
  if (!(rangeEnd > rangeStart) || !(step > 0)) return out;
  if (vertsA.length < 2 || vertsB.length < 2) return out;
  var n = Math.max(1, Math.round((rangeEnd - rangeStart) / step));
  for (var i=0; i<=n; i++){
    var chA = rangeStart + (rangeEnd - rangeStart) * i / n;
    var rlA = groundRLAtA(chA);
    if (rlA === null || rlA === undefined) continue;
    var proj = chainageSquareAcross(vertsA, cumA, chA, vertsB, cumB);
    var rlB = groundRLAtB(proj.chainage);
    if (rlB === null || rlB === undefined) continue;
    var crossfall = rlB - rlA;
    var crossfallPct = proj.offset > 1e-6 ? (crossfall / proj.offset) * 100 : null;
    out.push({chainage: chA, rlA: rlA, rlB: rlB, crossfall: crossfall, crossfallPct: crossfallPct});
  }
  return out;
}
