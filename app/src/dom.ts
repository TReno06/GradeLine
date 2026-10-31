// Tiny DOM helpers used throughout the app (PLAN.md Stage 2 checkpoint 3
// port) — extracted verbatim from main.js, no logic changes.
// Generic so a call site touching an element-specific property (e.g.
// `.value`, `.checked`, `.getContext`) can ask for that element type —
// `$<HTMLInputElement>('foo').value` — while everything else (the
// large majority of call sites, which only ever touch
// style/classList/textContent/innerHTML, all real HTMLElement members)
// stays untyped as plain HTMLElement. This app's DOM is fixed and every
// id here is known to exist, so — unlike the null-safety
// strictNullChecks would otherwise force everywhere — asserting
// non-null here is a deliberate, documented choice, not a shortcut.
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function escapeHtml(s: unknown): string {
  var map: Record<string, string> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  return String(s).replace(/[&<>"']/g, function(c){ return map[c]; });
}
