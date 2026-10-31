// Save/reload project files (PLAN.md Stage 3, §4). Pure logic only — no
// DOM, no `state` singleton mutation happens by reading `$()` directly in
// here; callers (jobs.ts) hand in/receive plain data so this stays
// unit-testable the same way driveway/profile.ts etc. are. The three
// known traps from PLAN.md §4.2 are all handled in this one place:
//
// 1. `activePointLayers` is a Set — serialized as an array (or null),
//    rebuilt into a Set (or null) on the way back in.
// 2. `state.driveway` is an ALIAS into `state.drivewayByAlignment` — it
//    is never itself part of a ProjectFile; applyProjectData restores
//    `drivewayByAlignment` and `activeAlignmentIndex` first, then
//    re-establishes the alias via `drivewayStateFor()`, exactly like
//    every other place the active alignment changes.
// 3. Compression uses CompressionStream('gzip')/DecompressionStream
//    ('gzip') directly, not makeZip() (export.ts's zip helper is
//    store-only, no compression). A file's format (gzip vs. plain JSON,
//    for browsers without the Compression Streams API) is detected by
//    sniffing the gzip magic bytes, not a separate flag, so files always
//    load regardless of which browser saved them.
import { state, drivewayStateFor } from './state.ts';
import type { AppState, ProjectFile, ProjectDomSettings } from './types.ts';

export function gzipSupported(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  var reader = stream.getReader();
  var chunks: Uint8Array[] = []; var total = 0;
  for (;;){
    var r = await reader.read();
    if (r.done) break;
    chunks.push(r.value); total += r.value.length;
  }
  var out = new Uint8Array(total), pos = 0;
  for (var i=0;i<chunks.length;i++){ out.set(chunks[i], pos); pos += chunks[i].length; }
  return out;
}

export async function gzipCompress(text: string): Promise<Uint8Array> {
  var cs = new CompressionStream('gzip');
  var writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(text) as BufferSource); writer.close();
  return streamToBytes(cs.readable);
}

export async function gzipDecompress(bytes: Uint8Array): Promise<string> {
  var ds = new DecompressionStream('gzip');
  var writer = ds.writable.getWriter();
  writer.write(bytes as BufferSource); writer.close();
  var out = await streamToBytes(ds.readable);
  return new TextDecoder().decode(out);
}

// Gzip's fixed 2-byte magic header (RFC 1952 §2.3.1) — enough to tell a
// compressed project file apart from a plain-JSON fallback one (which
// always starts with '{' / whitespace, never these bytes) without a
// separate on-disk format flag.
export function looksGzipped(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

// Trap 1: Set -> array (or null through unchanged).
function serializeActiveLayers(layers: Set<string> | null): string[] | null {
  return layers ? Array.from(layers) : null;
}
function deserializeActiveLayers(layers: string[] | null): Set<string> | null {
  return layers ? new Set(layers) : null;
}

export function serializeProject(appState: AppState, domSettings: ProjectDomSettings): ProjectFile {
  return {
    formatVersion: 1,
    savedAt: new Date().toISOString(),
    rawPoints: appState.rawPoints || [],
    rawAlignments: appState.rawAlignments,
    activeAlignmentIndex: appState.activeAlignmentIndex,
    activePointLayers: serializeActiveLayers(appState.activePointLayers),
    // Deep-cloned via JSON round-trip at the call site (jobs.ts, when it
    // stringifies the whole ProjectFile) — plain data, no Sets/aliases
    // inside it, so no special handling needed here beyond never
    // including state.driveway itself (trap 2).
    drivewayByAlignment: appState.drivewayByAlignment,
    crossfall: appState.crossfall,
    filters: domSettings.filters,
    datum: domSettings.datum,
    view: domSettings.view
  };
}

// Mutates `state` in place (matching every other data-load path in this
// app — setRawDataAndBuild, clearAllData, etc. all do the same) and
// hands back the DOM-facing settings for the caller to apply to the
// actual <input>/<select> elements, which this module never touches
// directly.
export function applyProjectData(project: ProjectFile): ProjectDomSettings {
  state.rawPoints = project.rawPoints;
  state.rawAlignments = project.rawAlignments;
  state.activeAlignmentIndex = project.activeAlignmentIndex;
  state.activePointLayers = deserializeActiveLayers(project.activePointLayers);
  state.drivewayByAlignment = project.drivewayByAlignment;
  state.crossfall = project.crossfall;
  // Trap 2: re-establish the alias now that drivewayByAlignment/
  // activeAlignmentIndex are both restored — the same call every other
  // alignment-switch site makes (state.ts, pipeline.ts, main.ts).
  state.driveway = drivewayStateFor(state.activeAlignmentIndex);
  state.verticalExaggeration = project.view.verticalExaggeration;
  return { filters: project.filters, datum: project.datum, view: project.view };
}
