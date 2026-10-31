// PWA platform integration (PLAN.md Stage 4) — service worker
// registration and the .gradeline file-association launch consumer.
// Self-wires at the bottom, same pattern jobs.ts uses, imported once
// from main.ts for its side effects.
//
// Everything here is feature/protocol-detected and wrapped defensively:
// this same bundled index.html is still opened directly as a local
// file:// document (the existing offline distribution, tinviewer.html)
// where none of this applies — service workers can't register on
// file://, and window.launchQueue only exists for an installed PWA. Both
// must no-op silently there, never throw or log a console error.
import { loadProjectBytes, setActiveHandle } from './jobs.ts';

function registerServiceWorker(){
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  // The Tauri desktop build (PLAN.md Stage 5) serves these same files from
  // http://tauri.localhost — a service worker there would only cache an
  // app that's already local, and could keep serving the old version after
  // an installer update.
  if ('__TAURI_INTERNALS__' in window) return;
  try {
    navigator.serviceWorker.register('./sw.js').catch(function(){ /* offline first load, or unsupported — fine either way */ });
  } catch (err: unknown){ /* never let PWA plumbing break the app itself */ }
}

function consumeLaunchFiles(){
  if (!('launchQueue' in window) || !window.launchQueue) return;
  try {
    window.launchQueue.setConsumer(async function(launchParams){
      if (!launchParams.files || !launchParams.files.length) return;
      var handle = launchParams.files[0];
      var file = await handle.getFile();
      var bytes = new Uint8Array(await file.arrayBuffer());
      setActiveHandle(handle); // a "Save" after this launch overwrites the same file
      await loadProjectBytes(bytes, handle.name);
    });
  } catch (err: unknown){ /* never let PWA plumbing break the app itself */ }
}

// Desktop-app equivalent of consumeLaunchFiles: Windows passes a
// double-clicked .gradeline file's path on the command line, and the Rust
// side (desktop/src-tauri/src/main.rs) hands over its name and bytes.
// There's no FileSystemFileHandle for a command-line path, so a later
// "Save" goes through the Save As dialog rather than overwriting in place.
function consumeTauriLaunchFile(){
  var tauri = window.__TAURI__;
  if (!tauri || !tauri.core) return;
  tauri.core.invoke<string | null>('launch_file_name').then(async function(name){
    if (!name) return;
    var buf = await tauri.core.invoke<ArrayBuffer>('launch_file_bytes');
    setActiveHandle(null);
    await loadProjectBytes(new Uint8Array(buf), name);
  }).catch(function(){ /* never let launch plumbing break the app itself */ });
}

registerServiceWorker();
consumeLaunchFiles();
consumeTauriLaunchFile();
