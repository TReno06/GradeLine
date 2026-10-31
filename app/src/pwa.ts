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

registerServiceWorker();
consumeLaunchFiles();
