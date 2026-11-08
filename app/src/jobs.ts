// Save / reload a job (PLAN.md Stage 3) — the "Job" sidebar section's own
// buttons and File System Access API wiring, kept in its own module and
// self-wiring its own listeners at the bottom, same pattern driveway.ts
// uses for its panel's buttons rather than centralizing them in main.ts.
//
// Deliberately uses the browser's own native Save/Open dialogs
// (showSaveFilePicker/showOpenFilePicker) rather than an in-app "Jobs
// folder" browser — the user can navigate to any folder they want, same
// as saving/opening a file in any other desktop app. Falls back to a
// plain download / hidden <input type=file> on Firefox/Safari, which
// don't implement the File System Access API yet.
import { $ } from './dom.ts';
import { state } from './state.ts';
import { serializeProject, applyProjectData, gzipSupported, gzipCompress, gzipDecompress, looksGzipped } from './project.ts';
import { saveFileViaBlobLink } from './export.ts';
import { computeLayerBreakdown } from './dxf.ts';
import { rebuildFromRaw, renderLayerFilterUI, renderAlignmentSelector } from './pipeline.ts';
import { switchView } from './viewstate.ts';
import type { ProjectDomSettings, ViewName, FileSystemFileHandleLike } from './types.ts';

// Kept for repeat "Save" within the same session; a fresh page load
// always starts with no handle (nothing to silently overwrite yet).
var activeHandle: FileSystemFileHandleLike | null = null;
var activeFileName: string | null = null;

function setJobStatus(text: string){
  $('job-status').textContent = text;
  $('job-status').classList.add('loaded');
}

// ------------------------------------------------------------
// Gather/apply the DOM-only settings a project file also needs (view
// toggles, filters, datum) — project.ts's own serialize/deserialize
// stays DOM-free; this is the one place that touches these inputs.
// ------------------------------------------------------------
// Exported for settings.ts (PLAN.md Appendix B item 1, 2026-09-26) —
// session/settings persistence beyond the project file reuses these
// exact same ~15-field DOM read/write functions rather than keeping its
// own "which inputs matter" list that could drift from this one.
export function gatherDomSettings(): ProjectDomSettings {
  return {
    filters: {
      ignoreZero: $<HTMLInputElement>('chk-ignore-zero').checked,
      ignoreFar: $<HTMLInputElement>('chk-ignore-far').checked,
      farLimit: parseFloat($<HTMLInputElement>('far-limit').value) || 0,
      useBreaklines: $<HTMLInputElement>('chk-breaklines').checked
    },
    datum: {
      enabled: $<HTMLInputElement>('chk-datum').checked,
      rl: parseFloat($<HTMLInputElement>('datum-rl').value) || 0
    },
    view: {
      currentView: state.currentView,
      verticalExaggeration: state.verticalExaggeration,
      wireframe: $<HTMLInputElement>('chk-wireframe').checked,
      points: $<HTMLInputElement>('chk-points').checked,
      alignment: $<HTMLInputElement>('chk-alignment').checked,
      breaklines: $<HTMLInputElement>('chk-show-breaklines').checked,
      profileTrueScale: $<HTMLInputElement>('chk-profile-true-scale').checked,
      sampleInterval: parseFloat($<HTMLInputElement>('sample-interval').value) || 2,
      gradeBreakTolerance: parseFloat($<HTMLInputElement>('grade-break-tolerance').value) || 0.05,
      chainageIntervalEnabled: $<HTMLInputElement>('chk-chainage-interval').checked,
      chainageIntervalValue: parseFloat($<HTMLInputElement>('chainage-interval-value').value) || 10
    }
  };
}

// Applied BEFORE rebuildFromRaw()/rebuildAll() run, since the pipeline's
// filters (chk-ignore-zero/-far/far-limit) and the 3D view's own
// wireframe/points/alignment toggles are read live off these same
// elements at rebuild time (see pipeline.ts, view3d.ts) rather than
// cached in `state` — setting them first means the very first rebuild
// after a project load already reflects the restored settings, instead
// of needing a second rebuild once the user touches something.
export function applyDomSettings(settings: ProjectDomSettings){
  $<HTMLInputElement>('chk-ignore-zero').checked = settings.filters.ignoreZero;
  $<HTMLInputElement>('chk-ignore-far').checked = settings.filters.ignoreFar;
  $<HTMLInputElement>('far-limit').value = String(settings.filters.farLimit);
  // Missing in files/settings saved before breaklines existed: default on.
  $<HTMLInputElement>('chk-breaklines').checked = settings.filters.useBreaklines !== false;
  $<HTMLInputElement>('chk-datum').checked = settings.datum.enabled;
  $<HTMLInputElement>('datum-rl').value = String(settings.datum.rl);
  $<HTMLInputElement>('chk-wireframe').checked = settings.view.wireframe;
  $<HTMLInputElement>('chk-points').checked = settings.view.points;
  $<HTMLInputElement>('chk-alignment').checked = settings.view.alignment;
  $<HTMLInputElement>('chk-show-breaklines').checked = settings.view.breaklines !== false;
  $<HTMLInputElement>('chk-profile-true-scale').checked = settings.view.profileTrueScale;
  $<HTMLInputElement>('sample-interval').value = String(settings.view.sampleInterval);
  $<HTMLInputElement>('grade-break-tolerance').value = String(settings.view.gradeBreakTolerance);
  $<HTMLInputElement>('chk-chainage-interval').checked = settings.view.chainageIntervalEnabled;
  $<HTMLInputElement>('chainage-interval-value').value = String(settings.view.chainageIntervalValue);
  $<HTMLInputElement>('ve-slider').value = String(settings.view.verticalExaggeration);
  $('ve-val').textContent = settings.view.verticalExaggeration.toFixed(1) + '×';
}

// ------------------------------------------------------------
// Save
// ------------------------------------------------------------
async function buildFileBytes(): Promise<Uint8Array | string> {
  var project = serializeProject(state, gatherDomSettings());
  var json = JSON.stringify(project);
  if (gzipSupported()) return gzipCompress(json);
  return json; // plain JSON fallback — looksGzipped() sniffs which this is on load
}

async function writeToHandle(handle: FileSystemFileHandleLike, data: Uint8Array | string){
  var writable = await handle.createWritable();
  await writable.write(data as BufferSource | string);
  await writable.close();
}

export async function saveProjectAs(){
  var data = await buildFileBytes();
  if (typeof window.showSaveFilePicker === 'function'){
    var handle: FileSystemFileHandleLike;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: activeFileName || 'job.gradeline',
        types: [{description: 'GradeLine job', accept: {'application/octet-stream': ['.gradeline']}}]
      });
    } catch (err: unknown){
      return; // user cancelled the picker — nothing to report
    }
    try {
      await writeToHandle(handle, data);
    } catch (err: unknown){
      alert('Could not save the job file — the location may be locked, deleted, or on a disconnected drive.');
      return;
    }
    activeHandle = handle;
    activeFileName = handle.name;
    setJobStatus('Saved: ' + activeFileName);
    return;
  }
  // Fallback (Firefox/Safari): an ordinary download, same helper the
  // DXF/CSV/PDF exports already use outside the hosted Artifact page.
  var fileName = (activeFileName || 'job.gradeline');
  saveFileViaBlobLink(fileName, data);
  activeFileName = fileName;
  setJobStatus('Downloaded: ' + fileName);
}

// Plain "Save": overwrite the handle from the last Save/Save As/Open in
// this session if there is one; otherwise identical to Save As (there is
// nothing yet to overwrite).
export async function saveProject(){
  if (!activeHandle){
    await saveProjectAs();
    return;
  }
  var data = await buildFileBytes();
  try {
    await writeToHandle(activeHandle, data);
  } catch (err: unknown){
    alert('Could not save "' + activeFileName + '" — the file may be locked, deleted, or on a disconnected drive. Use "Save As" to pick a new location.');
    return;
  }
  setJobStatus('Saved: ' + activeFileName);
}

// ------------------------------------------------------------
// Open
// ------------------------------------------------------------
// Exported for pwa.ts's desktop-app launch (a double-clicked .gradeline),
// so a file-associated launch sets the active "Save" target the same way
// opening the file manually would.
export function setActiveHandle(handle: FileSystemFileHandleLike | null){
  activeHandle = handle;
}

// Exported for pwa.ts's desktop-app launch — a double-clicked
// .gradeline goes through the exact same
// load/rebuild/switchView pipeline as a manual Open, not a parallel copy.
export async function loadProjectBytes(bytes: Uint8Array, fileName: string){
  // Wrapped end-to-end, not just around JSON.parse: gzipDecompress() (a
  // truncated/corrupted file with valid gzip magic bytes) and
  // applyProjectData() (a structurally-incomplete file, e.g. an older or
  // future format missing a field) can both throw too — without this,
  // either becomes an unhandled rejection with no feedback at all, for the
  // one feature that exists to protect the user's saved work.
  try {
    var json = looksGzipped(bytes) ? await gzipDecompress(bytes) : new TextDecoder().decode(bytes);
    var project = JSON.parse(json);
    var domSettings = applyProjectData(project);
    applyDomSettings(domSettings);

    // Same derived-state rebuild a fresh DXF load performs (see main.ts):
    // the layer breakdown is recomputed from the restored raw points, not
    // itself stored in the project file.
    state.pointLayers = computeLayerBreakdown(state.rawPoints || [], state.rawBreaklines,
      (state.rawAlignments || []).flatMap(function(a){ return a.vertices; }));
    renderLayerFilterUI();
    renderAlignmentSelector();

    $('dxf-filename').textContent = fileName;
    $('dxf-filename').classList.add('loaded');
    $('dxf-notice').style.display = 'none';

    rebuildFromRaw();
    switchView(domSettings.view.currentView as ViewName);

    activeFileName = fileName;
    setJobStatus('Loaded: ' + fileName);
  } catch (err: unknown){
    alert('Could not read "' + fileName + '" — it doesn’t look like a valid GradeLine job file.');
  }
}

export async function openProjectFile(){
  if (typeof window.showOpenFilePicker === 'function'){
    var handles: FileSystemFileHandleLike[];
    try {
      handles = await window.showOpenFilePicker({
        types: [{description: 'GradeLine job', accept: {'application/octet-stream': ['.gradeline']}}],
        multiple: false
      });
    } catch (err: unknown){
      return; // user cancelled
    }
    var handle = handles[0];
    var file = await handle.getFile();
    var bytes = new Uint8Array(await file.arrayBuffer());
    activeHandle = handle; // subsequent "Save" overwrites the opened file
    await loadProjectBytes(bytes, handle.name);
    return;
  }
  // Fallback (Firefox/Safari): hidden <input type=file>, same pattern as
  // the DXF upload input.
  $('input-project').click();
}

$<HTMLInputElement>('input-project').addEventListener('change', function(this: HTMLInputElement){
  var file = this.files ? this.files[0] : null;
  if (!file) return;
  activeHandle = null; // no real handle to re-save into via this path
  file.arrayBuffer().then(function(buf){
    loadProjectBytes(new Uint8Array(buf), file!.name);
  });
  this.value = '';
});

$('btn-job-save').addEventListener('click', saveProject);
$('btn-job-save-as').addEventListener('click', saveProjectAs);
$('btn-job-open').addEventListener('click', openProjectFile);
