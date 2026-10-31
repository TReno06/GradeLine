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
  transitionThreshold: number;
  minTransitionLength: number;
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
  clearance: number;
  official: boolean;
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
  vehicleCheck: { enabled: boolean; model: string; sweepChainage: number | null; flipped: boolean };
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

// File Handling API (PLAN.md Stage 4's .gradeline file association) —
// also not in TypeScript's bundled DOM lib. Chromium-only, and only
// present for an installed PWA; pwa.ts always feature-detects before
// touching it.
export interface LaunchParams {
  files: FileSystemFileHandleLike[];
}
export interface LaunchQueue {
  setConsumer(consumer: (launchParams: LaunchParams) => void | Promise<void>): void;
}
declare global {
  interface Window {
    launchQueue?: LaunchQueue;
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
  pointLayers: PointLayer[] | null;
  activePointLayers: Set<string> | null;
  rawAlignments: RawAlignment[];
  activeAlignmentIndex: number;
  drivewayByAlignment: Record<string, DrivewayState>;
  crossfall: CrossfallState;
  driveway: DrivewayState;
  modelSpan?: number;
}
