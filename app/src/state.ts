// App-wide mutable state (PLAN.md Stage 2 checkpoint 3 port) — extracted
// verbatim from main.js. Every other module reads/writes properties on
// the same `state` object exported here; nothing reassigns the binding
// itself, so a plain live import (`import { state } from './state.ts'`)
// stays correct everywhere.
import type { AppState, DrivewayState, Point3 } from './types.ts';

// `driveway` is assigned immediately below (drivewayStateFor's own call
// needs the rest of `state` to already exist) — the cast lets the
// literal omit it for that one line without every other field losing
// its real type.
export var state = {
  points: [],        // {x,y,z} centered
  triangles: [],      // [i0,i1,i2]
  polyline: null,      // [{x,y}] centered — derived from the active raw alignment
  zMin: 0, zMax: 0,
  offsetX: 0, offsetY: 0, offsetZ: 0,
  verticalExaggeration: 1.0,
  currentView: '3d',
  rawPoints: null,
  rawBreaklines: null,    // last-loaded breaklines (types.ts Breakline), unfiltered, uncentered
  constraintEdges: null,  // breakline edges actually sent with state.points to the triangulation
  breaklineStats: null,    // last-loaded points, unfiltered, uncentered — kept so filters can be re-applied
  pointLayers: null,       // [{layer,count}] among rawPoints — only set for DXF-sourced loads
  activePointLayers: null, // Set<layerName> currently included, or null = no layer filtering
  rawAlignments: [],       // [{label, layer, vertices:[{x,y}]}] candidate alignment polylines
  activeAlignmentIndex: -1, // index into rawAlignments currently used for the long section
  // Each alignment gets its own, fully independent driveway design —
  // its own PVIs, kerb/layback frontier, vehicle check — keyed by
  // alignment index (as a string; -1 for "no alignment"). `driveway`
  // below is always an ALIAS pointing at the entry for the currently
  // active alignment (see drivewayStateFor()); every place the active
  // alignment changes must repoint it. This is what lets the crossfall
  // view compare two alignments' designs independently, and lets every
  // existing bit of UI/export code go on reading/writing `state.driveway`
  // unchanged, oblivious to the fact that it's now per-alignment.
  drivewayByAlignment: {},
  // Which two alignments the crossfall view is currently comparing, and
  // the chainage the draggable readout marker is currently sitting at
  // (null until first drawn, when it defaults to the worst-crossfall
  // point — see drawCrossfallView). `projectionMode` defaults to
  // 'perpendicular' (square across the alignments — owner's request,
  // 2026-11-08). A saved job with no projectionMode (pre-v41) still opens
  // as 'chainage', its original behaviour (anything but 'perpendicular' is
  // read as chainage).
  crossfall: { alignA: 0, alignB: 1, markerChainage: null, projectionMode: 'perpendicular' }
} as AppState;

export function defaultDrivewayState(): DrivewayState {
  return {
    enabled: false,
    // Ordered list of design points (PVIs) along the same alignment/
    // chainage as the existing-ground long section: {chainage, rl}.
    // Grade between consecutive PVIs is derived, not stored.
    pvis: [],
    // Where the next "apply template" action (kerb points, layback
    // legs) should attach: {chainage, rl}, or null to fall back to the
    // first (lowest-chainage) existing point. Deliberately a plain
    // coordinate, not a reference into pvis, since pvis can be freely
    // edited/reordered/deleted by hand between template applications —
    // it only anchors the *next* template stamp, not the design itself.
    frontier: null,
    // The kerb invert's own {chainage, rl}, set by applyKerbPoints() —
    // separate from `frontier` (which tracks the top-of-kerb) because
    // the layback template's road-side leg needs the invert itself as
    // its own reference point, independent of the reveal height.
    kerbInvert: null,
    // Vehicle ground-clearance (scrape) check — sweeps a design
    // vehicle's underside along the driveway design. `sweepChainage` is
    // the chainage of the wheel currently shown (the REAR wheel by
    // default — the vehicle faces toward increasing chainage/right
    // without ticking "reversing"; null = not yet positioned, set to
    // the automatically-found worst point the first time the check is
    // turned on, or the model is changed). `flipped` = vehicle
    // reversing (front wheel at `sweepChainage` instead, vehicle faces
    // left) — see driveway/vehicle.ts.
    // B85 by default: AS/NZS 2890.1:2004 Figure C1(b) is the template "for
    // domestic driveways only" — GradeLine's main use (2026-11-08).
    vehicleCheck: { enabled: false, model: 'b85', sweepChainage: null, flipped: false },
    // Approximate cut/fill volume (§5.4 Stage 0c item 9) — a single
    // corridor width (m) the user enters; null until they do, so the
    // readout prompts for it rather than showing a volume against an
    // arbitrary default width.
    cutFillCorridorWidth: null
  };
}

// Returns the driveway design for a given alignment index, creating a
// fresh (empty) one the first time that index is asked for.
export function drivewayStateFor(alignIndex: number): DrivewayState {
  var key = String(alignIndex);
  if (!state.drivewayByAlignment[key]) state.drivewayByAlignment[key] = defaultDrivewayState();
  return state.drivewayByAlignment[key];
}
state.driveway = drivewayStateFor(state.activeAlignmentIndex);

// Real-world (un-centered) coordinates for a stored point.
export function toWorld(p: Point3): Point3 {
  return {x: p.x + state.offsetX, y: p.y + state.offsetY, z: p.z};
}

// "Alignment N" (1-based, in alignment-dropdown order) — the name every
// long-section export (CSV, DXF, PDF) is saved under, and the prefix
// shown in the alignment dropdown so the number is visible there too.
export function alignmentNumberName(i: number): string {
  return 'Alignment ' + (i + 1);
}
// `content` names what the file holds — "Alignment 1 Existing",
// "Alignment 1 Proposed" or "Alignment 1 Both" (owner's request, 2026-11-07).
export function activeAlignmentFileName(content: 'existing' | 'proposed' | 'both'): string {
  var base = state.activeAlignmentIndex >= 0 ? alignmentNumberName(state.activeAlignmentIndex) : 'Long section';
  return base + ' ' + (content === 'existing' ? 'Existing' : content === 'proposed' ? 'Proposed' : 'Both');
}

export function currentAlignmentLabel(): string {
  if (state.rawAlignments && state.rawAlignments.length && state.activeAlignmentIndex >= 0){
    var a = state.rawAlignments[state.activeAlignmentIndex];
    if (a && a.label) return a.label;
  }
  return '';
}
