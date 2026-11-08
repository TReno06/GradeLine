// Platform integration: the desktop app's .gradeline double-click launch,
// and clean-up after the old installable website. Self-wires at the
// bottom, imported once from main.ts for its side effects.
//
// 2026-11-08 (owner's decision): the Windows desktop app comes only from
// the Tauri installer; the GitHub Pages site stays as a plain website. Its
// web app manifest is gone (so browsers no longer offer "Install"), and
// the service worker that made it installable/offline is retired. Anyone
// who installed the old site as an app still has that worker and its
// cache, so on the website this unregisters every worker for this origin
// and deletes GradeLine's caches. public/sw.js is now a self-removing
// worker too, for installs that never open the page again. Everything is
// guarded so file:// (the standalone HTML) and the desktop app no-op.
import { loadProjectBytes, setActiveHandle } from './jobs.ts';

function retireOldServiceWorker(){
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if ('__TAURI_INTERNALS__' in window) return;
  try {
    if ('serviceWorker' in navigator){
      navigator.serviceWorker.getRegistrations().then(function(regs){
        regs.forEach(function(r){ r.unregister(); });
      }).catch(function(){ /* nothing to clean up */ });
    }
    if ('caches' in window){
      caches.keys().then(function(keys){
        keys.filter(function(k){ return /^gradeline-/.test(k); }).forEach(function(k){ caches.delete(k); });
      }).catch(function(){ /* nothing to clean up */ });
    }
  } catch (err: unknown){ /* never let clean-up break the app itself */ }
}

// Desktop app: Windows passes a
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

retireOldServiceWorker();
consumeTauriLaunchFile();
