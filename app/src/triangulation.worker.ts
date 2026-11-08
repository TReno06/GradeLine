// Triangulation Web Worker (PLAN.md Stage 1, moved here from the
// Blob-URL-built-from-a-DOM-<script>-tag approach as part of the Stage 2
// port — that trick existed only because the pre-build-step app had no
// other way to get delaunator's source into a worker. Vite's native
// `?worker&inline` import does the same job properly: bundles this
// file's own import, and inlines the whole worker as a data: URI in the
// single-file build, so the single self-contained HTML file guarantee
// (CLAUDE.md's Design decisions) still holds.
// (2026-11-08) Runs geometry/constrain.ts's shared routine, so breakline
// edges are forced in here exactly as on the main-thread fallback.
import { triangulateCoords } from './geometry/constrain.ts';

// Typed as the DedicatedWorkerGlobalScope this file actually runs as
// (Vite bundles it as a Worker via the `?worker&inline` import in
// triangulation.ts) — cast once here rather than pulling in the
// "webworker" lib project-wide, which would conflict with the "DOM"
// lib every other file in this tsconfig needs.
var ctx = self as unknown as { onmessage: (e: MessageEvent) => void; postMessage: (msg: unknown, transfer?: Transferable[]) => void };

ctx.onmessage = function(e: MessageEvent){
  var id = e.data.id;
  try {
    var r = triangulateCoords(e.data.coords, e.data.edges || null);
    var tris = r.triangles;
    ctx.postMessage({id: id, triangles: tris, failed: r.failed}, [tris.buffer]);
  } catch (err) {
    ctx.postMessage({id: id, error: String(err instanceof Error ? err.message : err)});
  }
};
