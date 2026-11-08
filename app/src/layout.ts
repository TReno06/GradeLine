// Screen layout (2026-11-07): resizable split view, the driveway toolbox
// in split view, a resizable/collapsible right-hand tool panel, a
// collapsible sidebar, and collapsible menu sections.
//
// All of it is plain CSS custom properties/classes on #app and #main,
// set from here:
//   --split       where split view's 3D/profile divider sits (from the top)
//   --panel-w     the right-hand tool panel's width
//   --pane-right  how much of the right edge the panel currently takes
//                 (0 when no panel is showing) — both viewports end there
// Layout preferences are a per-viewer convenience kept in localStorage
// (never in .gradeline job files), and every read/write is guarded so a
// private window or blocked storage just falls back to the defaults.
import { $ } from './dom.ts';
import { state } from './state.ts';
import { onResize } from './view3d.ts';
import { drawProfile } from './rendering.ts';
import { is3DVisible, isProfileVisible } from './viewstate.ts';

var STORAGE_KEY = 'gradeline.layout';
var PANEL_MIN = 300, PANEL_MAX_FRACTION = 0.6, SPLIT_MIN = 0.15, SPLIT_MAX = 0.85;

var layout = {
  split: 0.55,          // fraction of #main's height given to the 3D pane in split view
  panelW: 380,          // px
  toolsOpen: true,      // right-hand tool panel shown (driveway/crossfall/split views)
  sidebarCollapsed: false,
  // Sections the user has opened. Every section starts collapsed (owner's
  // request, 2026-11-08); this replaced a `collapsedSections` list, which
  // is simply ignored now so everyone starts from the all-collapsed default.
  openSections: [] as string[]
};

function load(){
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var v = JSON.parse(raw);
    if (typeof v.split === 'number' && v.split >= SPLIT_MIN && v.split <= SPLIT_MAX) layout.split = v.split;
    if (typeof v.panelW === 'number' && v.panelW >= PANEL_MIN && v.panelW < 4000) layout.panelW = v.panelW;
    if (typeof v.toolsOpen === 'boolean') layout.toolsOpen = v.toolsOpen;
    if (typeof v.sidebarCollapsed === 'boolean') layout.sidebarCollapsed = v.sidebarCollapsed;
    if (Array.isArray(v.openSections)) layout.openSections = v.openSections.filter(function(s: unknown){ return typeof s === 'string'; });
  } catch (e){ /* defaults */ }
}
function save(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch (e){ /* convenience only */ }
}

// Which right-hand panel the current view shows, if any.
function panelForView(): 'driveway' | 'crossfall' | null {
  var v = state.currentView;
  if (v === 'driveway' || v === 'split') return 'driveway';
  if (v === 'crossfall') return 'crossfall';
  return null;
}

function clampPanelW(w: number): number {
  var mainW = $('main').clientWidth || window.innerWidth;
  return Math.max(PANEL_MIN, Math.min(w, Math.max(PANEL_MIN, mainW * PANEL_MAX_FRACTION)));
}

// Re-applies every layout variable/class for the current view. Called
// by switchView() and after any resize/collapse.
export function applyLayout(){
  var main = $('main');
  var panel = panelForView();
  var showPanel = !!panel && layout.toolsOpen;
  var w = clampPanelW(layout.panelW);
  main.style.setProperty('--split', (layout.split*100).toFixed(2) + '%');
  main.style.setProperty('--panel-w', w + 'px');
  main.style.setProperty('--pane-right', showPanel ? w + 'px' : '0px');
  main.classList.toggle('tools-open', showPanel);
  $('app').classList.toggle('sidebar-collapsed', layout.sidebarCollapsed);
  var toolsBtn = $('btn-toggle-tools');
  toolsBtn.style.display = panel ? 'inline-flex' : 'none';
  toolsBtn.classList.toggle('active', showPanel);
  toolsBtn.title = showPanel ? 'Hide the tool panel' : 'Show the tool panel';
  $('btn-toggle-tools-label').textContent = panel === 'crossfall' ? 'Crossfall tools' : 'Driveway tools';
  var sbBtn = $('btn-toggle-sidebar');
  sbBtn.classList.toggle('active', !layout.sidebarCollapsed);
  sbBtn.title = layout.sidebarCollapsed ? 'Show the sidebar' : 'Hide the sidebar';
}

// Re-fits both canvases to their (possibly new) pane sizes, at most
// once per frame while dragging.
var refitQueued = false;
function refit(){
  if (refitQueued) return;
  refitQueued = true;
  requestAnimationFrame(function(){
    refitQueued = false;
    if (is3DVisible()) onResize();
    else if (isProfileVisible()) drawProfile();
  });
}

function relayout(){ applyLayout(); refit(); save(); }

// Drag helper: calls onMove(clientX, clientY) until the pointer is released.
function startDrag(e: PointerEvent, cursor: string, onMove: (x: number, y: number) => void){
  e.preventDefault();
  var target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  document.body.style.cursor = cursor;
  document.body.classList.add('layout-dragging');
  function move(ev: PointerEvent){ onMove(ev.clientX, ev.clientY); }
  function up(ev: PointerEvent){
    target.releasePointerCapture(ev.pointerId);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    document.body.style.cursor = '';
    document.body.classList.remove('layout-dragging');
    save();
  }
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

// ---- collapsible menu sections ----
// Every .section with its own heading, in the sidebar and in both tool
// panels, folds shut by clicking the heading. All start collapsed; the ones
// the user opens are remembered, keyed by panel + heading text.
function sectionKey(sec: HTMLElement, h2: HTMLElement): string {
  var host = sec.closest('#sidebar, #driveway-panel, #crossfall-panel');
  return (host ? host.id : '') + '|' + (h2.textContent || '').trim();
}
function initCollapsibleSections(){
  var secs = document.querySelectorAll<HTMLElement>('#sidebar .section, #driveway-panel .section, #crossfall-panel .section');
  secs.forEach(function(sec){
    var h2 = sec.querySelector<HTMLElement>(':scope > h2');
    if (!h2) return;
    var key = sectionKey(sec, h2);
    h2.classList.add('collapsible');
    h2.setAttribute('role', 'button');
    h2.setAttribute('tabindex', '0');
    function setCollapsed(c: boolean){
      sec.classList.toggle('collapsed', c);
      h2!.setAttribute('aria-expanded', c ? 'false' : 'true');
    }
    setCollapsed(layout.openSections.indexOf(key) < 0);
    function toggle(){
      var c = !sec.classList.contains('collapsed');
      setCollapsed(c);
      var i = layout.openSections.indexOf(key);
      if (!c && i < 0) layout.openSections.push(key);
      if (c && i >= 0) layout.openSections.splice(i, 1);
      save();
    }
    h2.addEventListener('click', toggle);
    h2.addEventListener('keydown', function(ev: KeyboardEvent){
      if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); toggle(); }
    });
  });
}

export function initLayout(){
  load();

  $('split-divider').addEventListener('pointerdown', function(e: PointerEvent){
    startDrag(e, 'row-resize', function(_x, y){
      var r = $('main').getBoundingClientRect();
      layout.split = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, (y - r.top) / r.height));
      applyLayout(); refit();
    });
  });
  $('split-divider').addEventListener('dblclick', function(){ layout.split = 0.55; relayout(); });

  $('panel-resizer').addEventListener('pointerdown', function(e: PointerEvent){
    startDrag(e, 'col-resize', function(x){
      var r = $('main').getBoundingClientRect();
      layout.panelW = clampPanelW(r.right - x);
      applyLayout(); refit();
    });
  });
  $('panel-resizer').addEventListener('dblclick', function(){ layout.panelW = 380; relayout(); });

  $('btn-toggle-tools').addEventListener('click', function(){ layout.toolsOpen = !layout.toolsOpen; relayout(); });
  $('btn-toggle-sidebar').addEventListener('click', function(){ layout.sidebarCollapsed = !layout.sidebarCollapsed; relayout(); });

  window.addEventListener('resize', function(){ applyLayout(); });
  initCollapsibleSections();
  applyLayout();
}
