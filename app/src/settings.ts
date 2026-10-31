// Session/settings persistence beyond the project file (PLAN.md Appendix
// B item 1, 2026-09-26) — remembers the sidebar's view/filter/datum
// settings across browser sessions via localStorage, so reopening the
// app without loading a .gradeline job restores it the way it was left.
// Deliberately NOT project data: rawPoints/rawAlignments/
// drivewayByAlignment/crossfall picks are excluded on purpose — a
// .gradeline file is still the only way to persist actual survey/design
// data. Reuses jobs.ts's own gatherDomSettings/applyDomSettings rather
// than keeping a second "which inputs matter" list that could drift
// from it.
//
// Wrapped in try/catch throughout and fails silently (matching pwa.ts's
// own precedent for platform APIs that can throw — a private window,
// storage disabled, quota exceeded, or a future/foreign format sitting
// in localStorage from a different build) — this is a convenience, never
// something the app depends on to function.
import { state } from './state.ts';
import { gatherDomSettings, applyDomSettings } from './jobs.ts';
import { switchView } from './viewstate.ts';
import type { ProjectDomSettings } from './types.ts';

var STORAGE_KEY = 'gradeline.lastSettings.v1';

export function saveLastSettings(){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gatherDomSettings()));
  } catch (err: unknown){ /* private window, disabled storage, quota — fine either way */ }
}

function loadLastSettings(): ProjectDomSettings | null {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProjectDomSettings;
  } catch (err: unknown){ return null; }
}

// Restores the last-saved settings (if any) and switches to whichever
// view was last showing — called once at startup in place of main.ts's
// own switchView('3d'). Safe with no data loaded: switchView()'s own
// callees already handle the empty-data case, the same path taken
// whenever someone clicks a tab before loading anything. Falls back to
// the ordinary 3D-view startup on anything unexpected (a malformed or
// future-format blob in localStorage), rather than letting a corrupt
// settings blob block the app from starting at all.
export function restoreLastSettings(){
  var last = loadLastSettings();
  if (!last){ switchView('3d'); return; }
  try {
    applyDomSettings(last);
    state.verticalExaggeration = last.view.verticalExaggeration;
    switchView(last.view.currentView);
  } catch (err: unknown){
    switchView('3d');
  }
}

window.addEventListener('beforeunload', saveLastSettings);
