// Shared domain types for the TypeScript port (PLAN.md Stage 2
// checkpoint 4). Centralised here since almost every module touches
// several of these — a survey point's shape, a PVI, the driveway
// profile — rather than each module re-declaring its own.

// A surveyed/derived point in the TIN. `layer`/`source` are only ever
// set for DXF-sourced points (see dxf.ts); the sample-data generator
// and centered/derived copies omit them.
export interface Point3 {
  x: number;
  y: number;
  z: number;
  layer?: string;
  source?: string;
}

// A 2D point — an alignment vertex, or a point projected onto plan view.
export interface Point2 {
  x: number;
  y: number;
}

// Indices into the points array for one triangulated face.
export type Triangle = [number, number, number];

// Uniform grid spatial index over triangles (geometry/tin.ts).
export interface TriIndex {
  minX: number;
  minY: number;
  cw: number;
  ch: number;
  grid: Record<string, number[]>;
}

export interface Barycentric {
  u: number;
  v: number;
  w: number;
}

export interface TriangleHit {
  index: number;
  bc: Barycentric;
  a: Point3;
  b: Point3;
  c: Point3;
}

// A candidate/selectable long-section alignment, as surfaced by DXF
// parsing (dxf.ts) and stored in state.rawAlignments.
export interface RawAlignment {
  label: string;
  layer: string | null;
  vertices: Point2[];
  // True once the user has reversed this alignment's direction (its
  // vertices are stored already reversed — this flag is for display and
  // for which end the boundary grade rule applies to).
  reversed?: boolean;
}

// One design point (PVI) in a driveway design. `template` tags a point
// stamped in by the kerb/layback tools, exempting the leg(s) it forms
// from grade checks (see driveway.ts/driveway/profile.ts).
export interface Pvi {
  chainage: number;
  rl: number;
  template?: 'kerb' | 'layback';
}

export interface DrivewayLeg {
  from: Pvi;
  to: Pvi;
  run: number;
  grade: number | null;
  isVertical: boolean;
  isTemplate: boolean;
}

export interface DrivewayProfile {
  pvis: Pvi[];
  legs: DrivewayLeg[];
}

export interface DrivewayRules {
  maxGrade: number;
  applyBoundaryRule: boolean;
  maxGradeBoundary: number;
  transitionThreshold: number;      // summit (crest) grade change needing a transition, %
  transitionThresholdSag?: number;  // sag (dip) grade change needing a transition, % (2004: 15)
  minTransitionLength: number;
  // Across the footpath (AS/NZS 2890.1:2004 Cl 3.3(d), via Cl 2.6.2): a
  // stretch at most footpathMaxGrade, at least footpathMinLength long.
  applyFootpathRule?: boolean;
  footpathMaxGrade?: number;
  footpathMinLength?: number;
  // The stricter boundary limit normally applies to the FIRST sloped
  // leg (road end at chainage 0). On a reversed alignment the road end
  // is the far end, so it applies to the LAST sloped leg instead.
  boundaryAtEnd?: boolean;
}

// Per-leg grade-limit verdict from legGradeChecksFrom(). `checked` is
// false for an exempt leg (vertical face or kerb/layback template leg),
// in which case `limit` is null and `exceeds` is always false.
export interface LegGradeCheck {
  checked: boolean;
  isBoundary: boolean;
  limit: number | null;
  exceeds: boolean;
}

export interface ComplianceRow {
  cls: 'diag-ok' | 'diag-warn';
  text: string;
}

// One survey sample along the long section (existing-ground chainage/
// elevation, plus the plan-view point it was taken at).
export interface ProfileSample {
  chainage: number;
  elevation: number | null;
  x: number;
  y: number;
}

export interface ProfileData {
  samples: ProfileSample[];
  total: number;
}

export interface GradeBreak {
  chainage: number;
  elevation: number;
}

export interface IntervalMark {
  chainage: number;
  elevation: number | null;
  x: number;
  y: number;
}

export interface VehicleTemplate {
  key: string;
  label: string;
  wheelbase: number;
  frontOverhang: number;
  rearOverhang: number;
  rearFlatLeadIn: number;
  rampAngleDeg: number;
  // Front overhang approach angle (degrees); 0/absent = flat front.
  frontRampAngleDeg?: number;
  clearance: number;
  official: boolean;
  // Set by effectiveVehicleTemplate when the user has edited any dimension.
  customised?: boolean;
}

export interface VehicleSweepSample {
  chainage: number;
  rl: number;
  u: number;
}

// A ground/RL lookup callback: existingElevationAtChainage,
// driveGroundRLAt, etc. all have this shape.
export type GroundRLAt = (chainage: number) => number | null | undefined;

export interface VehicleSweepResult {
  samples: VehicleSweepSample[];
  scrapes: boolean;
  minClearance: number;
  worstChainage: number | null;
  worstGroundRL: number | null;
  worstUnderRL: number | null;
  cosA: number;
  sinA: number;
  rlFront: number;
}

export interface VehicleSweepRange {
  start: number;
  end: number;
}

export interface SectionTableStation {
  chainage: number;
  existingRL: number;
  proposedRL: number | null;
}

export interface SectionTableLeg {
  from: SectionTableStation;
  to: SectionTableStation;
  run: number;
  gradeExisting: number;
  gradeNew: number | null;
  isNew: boolean;
}

export interface SectionTable {
  stations: SectionTableStation[];
  legs: SectionTableLeg[];
}

export interface CutFillResult {
  cutVolume: number;
  fillVolume: number;
  netVolume: number;
  length: number;
}

export interface CrossfallSeriesPoint {
  chainage: number;
  rlA: number;
  rlB: number;
  crossfall: number;
  crossfallPct: number | null;
}

// widthAt's shape (the optional horizontal-separation callback).
export type WidthAt = (chainage: number) => number | null | undefined;

// The crossfall DXF export's table (PLAN.md Appendix B item 3,
// 2026-09-26) — Chainage/RL-A/RL-B/Crossfall/Cross-slope rows picked
// from a CrossfallSeriesPoint[] (see computeCrossfallTableFrom).
export interface CrossfallTableRow {
  chainage: number;
  rlA: number;
  rlB: number;
  crossfallMm: number;
  crossfallPct: number | null;
}
export interface CrossfallTable {
  rows: CrossfallTableRow[];
}

export interface DeclutterLabelInput {
  x: number;
  text: string;
  [key: string]: unknown;
}

export interface DeclutteredLabel {
  x: number;
  text: string;
  tier: number;
  width: number;
}

// driveGroundRLAt's shape (driveway.ts) — unlike GroundRLAt, it also
// takes the driveway profile to fall back to existing ground with.
export type DriveGroundRLAt = (dwProfile: DrivewayProfile | null, chainage: number) => number | null | undefined;

// One alignment's fully independent driveway design (state.drivewayByAlignment).
export interface DrivewayState {
  enabled: boolean;
  pvis: Pvi[];
  frontier: { chainage: number; rl: number } | null;
  kerbInvert: { chainage: number; rl: number } | null;
  // `dims`: per-model user overrides of the vehicle dimensions (absent =
  // the built-in defaults), saved with the design in the .gradeline file.
  vehicleCheck: { enabled: boolean; model: string; sweepChainage: number | null; flipped: boolean;
    dims?: Record<string, Partial<Record<'wheelbase' | 'frontOverhang' | 'rearOverhang' | 'clearance' | 'frontRampAngleDeg' | 'rampAngleDeg', number>>> };
  cutFillCorridorWidth: number | null;
}

// decodePngForPdf's output (export.ts) — buildSectionPdfBytes's own
// caller (printing.ts) bolts `caption` on afterward, per screenshot.
export interface DecodedPngImage {
  width: number;
  height: number;
  rgb: Uint8Array;
  alpha: Uint8Array | null;
  caption?: string | null;
}

export interface PointLayer {
  layer: string;
  count: number;
  lines?: number; // breaklines on this layer (2026-11-08)
  // Set when the layer sits away from the rest of the survey (findOffsiteLayers).
  offsite?: OffsiteLayer;
}

export interface OffsiteLayer {
  distance: number;  // metres, layer centroid to the main survey's centroid
  direction: string; // 8-point compass, e.g. "W" — which way the layer lies from the main survey
}

// DXF parsing's output shape (dxf.ts).
export interface DxfPolyline {
  vertices: Point3[];
  flat: boolean;
  layer: string;
}

export interface DxfGeometry {
  points: Point3[];
  polylines: DxfPolyline[];
  faceCount: number;
  breaklines: Breakline[];
}

// A breakline (2026-11-08): a 3D string the TIN's triangles must follow —
// read from DXF LINE/ARC entities and 3D POLYLINEs with varying levels
// (dxf.ts). Raw, uncentered coordinates, like rawPoints. Used only when
// its layer is ticked in the layer list, same as that layer's points.
export interface Breakline {
  layer: string;
  vertices: Point3[];
}

// What the last rebuild did with the breaklines, for the sidebar notice.
export interface BreaklineStats {
  segments: number;        // constraint segments sent to the triangulation
  skippedCrossing: number; // dropped before triangulating: crossed an earlier one
  failed: number;          // couldn't be forced in by the triangulation itself
}

// Plot metadata the profile/crossfall canvases stash on themselves
// (canvas._plotMeta = {...}) so mouse handlers on a later event can
// read back exactly what was last drawn — an expando property on the
// live DOM element, not part of this app's own data model, hence the
// global augmentation rather than a plain interface.
export interface PlotMeta {
  px: (ch: number) => number;
  py: (el: number) => number;
  padL: number;
  padT: number;
  plotW: number;
  plotH: number;
  pxPerUnitX: number;
  pxPerUnitY: number;
  centerCh: number;
  centerEl: number;
}
export interface XfPlotMeta {
  padL: number;
  plotW: number;
  rangeEnd: number;
  yMax?: number; // canvas y below which clicks don't move the marker (the cross-section panel)
}
declare global {
  interface HTMLCanvasElement {
    _plotMeta?: PlotMeta;
    _xfPlotMeta?: XfPlotMeta;
  }
}

// The hosted Artifact page's optional platform capability bridge
// (window.claude.use('downloads')) — not present outside that hosted
// page, hence the whole `typeof window.claude === 'undefined'` guard
// everywhere it's used. Loosely typed (`use` returns `any`): this is an
// external platform boundary the app treats defensively at every call
// site anyway, not part of the app's own data model.
declare global {
  interface Window {
    claude?: { use: (name: string) => Promise<any> };
  }
}

// Minimal File System Access API surface this app actually uses
// (jobs.ts) — not in TypeScript's bundled DOM lib as of this project's
// pinned TS version, so declared by hand rather than pulling in a whole
// @types package for three methods. Chrome/Edge only; jobs.ts always
// feature-detects before calling either picker and falls back to a plain
// download / <input type=file> otherwise.
export interface FileSystemWritableFileStreamLike {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}
export interface FileSystemFileHandleLike {
  name: string;
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
  getFile(): Promise<File>;
}
export interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}
declare global {
  interface Window {
    showSaveFilePicker?: (options?: {suggestedName?: string; types?: FilePickerAcceptType[]}) => Promise<FileSystemFileHandleLike>;
    showOpenFilePicker?: (options?: {types?: FilePickerAcceptType[]; multiple?: boolean}) => Promise<FileSystemFileHandleLike[]>;
  }
}


// Tauri desktop build's global API (app.withGlobalTauri in
// desktop/src-tauri/tauri.conf.json) — only `core.invoke` is used, for
// the double-clicked .gradeline launch (see pwa.ts, desktop main.rs).
declare global {
  interface Window {
    __TAURI__?: { core: { invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> } };
  }
}

export type ViewName = '3d' | 'profile' | 'split' | 'driveway' | 'crossfall';

// The DOM-only settings a project file also needs to save/restore
// (project.ts's serializeProject/applyProjectData are pure — these are
// read from/written to actual <input> elements by jobs.ts, never read
// from the DOM inside project.ts itself, so the round-trip logic stays
// unit-testable without one).
export interface ProjectFilterSettings {
  ignoreZero: boolean;
  ignoreFar: boolean;
  farLimit: number;
  useBreaklines?: boolean; // 2026-11-08; missing = on
}
export interface ProjectDatumSettings {
  enabled: boolean;
  rl: number;
}
export interface ProjectViewSettings {
  currentView: ViewName;
  verticalExaggeration: number;
  wireframe: boolean;
  points: boolean;
  alignment: boolean;
  breaklines?: boolean; // 3D "show breaklines" toggle, 2026-11-08; missing = on
  profileTrueScale: boolean;
  sampleInterval: number;
  gradeBreakTolerance: number;
  chainageIntervalEnabled: boolean;
  chainageIntervalValue: number;
}
export interface ProjectDomSettings {
  filters: ProjectFilterSettings;
  datum: ProjectDatumSettings;
  view: ProjectViewSettings;
}

// Which two alignments the crossfall view compares, the draggable
// readout marker's chainage, and (2026-09-26) which of the two ways it
// projects B onto A's chainage axis — see crossfall.ts. `projectionMode`
// defaults to 'chainage' wherever it's missing (an older saved
// `.gradeline` file, or a fresh session), deliberately matching the
// exact behaviour that existed before this field did, so an old file
// never silently switches algorithms just by being reopened.
export type CrossfallProjectionMode = 'chainage' | 'perpendicular';
export interface CrossfallState {
  alignA: number;
  alignB: number;
  markerChainage: number | null;
  projectionMode?: CrossfallProjectionMode;
}

// One saved job (.gradeline file), gzip-compressed JSON on disk (see
// project.ts). state.points/triangles/polyline are deliberately excluded
// — they're derived and rebuilt on load, same as any fresh DXF load.
export interface ProjectFile {
  formatVersion: 1;
  savedAt: string;
  rawPoints: Point3[];
  rawAlignments: RawAlignment[];
  activeAlignmentIndex: number;
  activePointLayers: string[] | null;
  drivewayByAlignment: Record<string, DrivewayState>;
  crossfall: CrossfallState;
  filters: ProjectFilterSettings;
  datum: ProjectDatumSettings;
  view: ProjectViewSettings;
  // Added 2026-11-08; absent from files saved before breaklines existed
  // (those load with none, exactly as they were built then).
  rawBreaklines?: Breakline[];
}

// The app's one big shared mutable state object (state.ts).
export interface AppState {
  points: Point3[];
  triangles: Triangle[];
  polyline: Point2[] | null;
  zMin: number;
  zMax: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  verticalExaggeration: number;
  currentView: ViewName;
  rawPoints: Point3[] | null;
  rawBreaklines: Breakline[] | null;
  constraintEdges: number[] | null;   // breakline edges of the current TIN, indices into points
  breaklineStats: BreaklineStats | null;
  pointLayers: PointLayer[] | null;
  activePointLayers: Set<string> | null;
  rawAlignments: RawAlignment[];
  activeAlignmentIndex: number;
  drivewayByAlignment: Record<string, DrivewayState>;
  crossfall: CrossfallState;
  driveway: DrivewayState;
  modelSpan?: number;
}
