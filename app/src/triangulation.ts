// Triangulation off the main thread (PLAN.md Stage 1, second half) —
// PLAN.md Stage 2 checkpoint 3 port, extracted verbatim from main.js.
// Runs the same delaunator code inside a Web Worker so a large survey no
// longer freezes the tab while it triangulates. Built via Vite's native
// `?worker&inline` import (see triangulation.worker.js) — inlined as a
// data: URI in the single-file build, so it stays inside the one served
// HTML file per CLAUDE.md's Design decisions. One persistent worker is
// reused across requests — recreated only after an explicit cancel
// (Worker.terminate() can't be reused). Multiple in-flight requests queue
// naturally (the worker is itself single-threaded) and are routed back
// to the right caller by id; discarding a *stale* result (a newer
// rebuild superseded it) is the caller's job (see pipeline.js's
// rebuildGeneration guard), not this layer's — this layer only
// guarantees each request's own promise settles, once, with that
// request's own result.
import TriangulationWorker from './triangulation.worker?worker&inline';
import { triangulateConstrained, trianglesFromFlat } from './geometry/tin.ts';
import type { Point3, Triangle } from './types.ts';

interface CancelledError extends Error { cancelled?: boolean; }
interface PendingEntry { resolve: (tris: ArrayLike<number>, failed: number) => void; reject: (err: unknown) => void; }

// `failed`: breakline edges that couldn't be forced in (geometry/constrain.ts).
export interface TriangulateResult { triangles: Triangle[]; failed: number; }

var triangulationWorker: Worker | null = null;
var triangulationNextId = 1;
var triangulationPending: Record<number, PendingEntry> = {}; // id -> {resolve, reject}

export function triangulationWorkerSupported(): boolean {
  return typeof Worker !== 'undefined';
}

function getTriangulationWorker(): Worker {
  if (triangulationWorker) return triangulationWorker;
  var w = new TriangulationWorker();
  w.onmessage = function(e: MessageEvent){
    var id = e.data.id;
    var p = triangulationPending[id];
    if (!p) return; // cancelled/unknown — nothing to resolve
    delete triangulationPending[id];
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.triangles, e.data.failed || 0);
  };
  w.onerror = function(err){
    // A worker-level error (e.g. a syntax error building the blob) can't
    // be tied to one request id — fail everything currently waiting on
    // this worker instance rather than hang forever.
    var pending = triangulationPending;
    triangulationPending = {};
    Object.keys(pending).forEach(function(id){ pending[Number(id)].reject(err); });
  };
  triangulationWorker = w;
  return w;
}

// Kills the active worker outright (whatever it's doing is discarded,
// not just ignored) and fails every request currently queued on it, so
// their callers' .catch() can clean up instead of hanging. A fresh
// worker is created lazily next time one's needed, since a terminated
// Worker can't be reused.
export function cancelTriangulation(){
  if (!triangulationWorker) return;
  triangulationWorker.terminate();
  triangulationWorker = null;
  var pending = triangulationPending;
  triangulationPending = {};
  var err: CancelledError = new Error('cancelled');
  err.cancelled = true;
  Object.keys(pending).forEach(function(id){ pending[Number(id)].reject(err); });
}

// Promise-returning triangulate(). Falls back to the synchronous
// main-thread version if Workers aren't available (a restrictive
// embed context, an ancient browser) or fail to construct (e.g. a
// strict CSP blocking blob: workers) — never a hard failure just
// because the fast path isn't available.
export function triangulateAsync(points: Point3[], edges?: ArrayLike<number> | null): Promise<TriangulateResult> {
  var n = points.length;
  var edgeList = edges && edges.length ? edges : null;
  if (n < 3) return Promise.resolve({triangles: [], failed: 0});
  if (!triangulationWorkerSupported()){
    return Promise.resolve(triangulateConstrained(points, edgeList));
  }
  return new Promise(function(resolve, reject){
    var worker: Worker;
    try { worker = getTriangulationWorker(); }
    catch (err) { resolve(triangulateConstrained(points, edgeList)); return; }
    var coords = new Float64Array(n*2);
    for (var i=0;i<n;i++){ coords[2*i]=points[i].x; coords[2*i+1]=points[i].y; }
    var edgeArr = edgeList ? Uint32Array.from(edgeList) : null;
    var id = triangulationNextId++;
    triangulationPending[id] = {
      resolve: function(tris, failed){ resolve({triangles: trianglesFromFlat(tris), failed: failed}); },
      reject: reject
    };
    var transfer: Transferable[] = [coords.buffer];
    if (edgeArr) transfer.push(edgeArr.buffer);
    worker.postMessage({id: id, coords: coords, edges: edgeArr}, transfer);
  });
}
