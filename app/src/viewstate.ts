// View state — which tab is showing, and what that implies for which
// panes/fields are visible. PLAN.md Stage 2 checkpoint 3 port, extracted
// verbatim from main.js. Deliberately its own small module (rather than
// folded into main.js) since view3d.js, rendering.js, driveway.js and
// pipeline.js all need to ask "is the 3D/profile/crossfall pane visible
// right now" — putting these three predicates here, instead of in any
// one of those modules, is what breaks the four-way dependency into a
// star instead of a knot.
import { $ } from './dom.ts';
import { state } from './state.ts';
import { hidePointInspector, hideHoverMarker, onResize } from './view3d.ts';
import { drawProfile } from './rendering.ts';
import { renderCrossfallUI } from './pipeline.ts';
import { renderDrivewayUI } from './driveway.ts';
import type { ViewName } from './types.ts';

// 'split' shows the 3D surface and the long section stacked in one
// screen at once, so both helpers below treat it the same as the
// view's own dedicated tab everywhere visibility/interaction matters.
export function is3DVisible(){ return state.currentView==='3d' || state.currentView==='split'; }
export function isProfileVisible(){ return state.currentView==='profile' || state.currentView==='split' || state.currentView==='driveway' || state.currentView==='crossfall'; }
export function isCrossfallVisible(){ return state.currentView==='crossfall'; }

export function switchView(view: ViewName){
  state.currentView = view;
  $('tab-3d').classList.toggle('active', view==='3d');
  $('tab-profile').classList.toggle('active', view==='profile');
  $('tab-split').classList.toggle('active', view==='split');
  $('tab-driveway').classList.toggle('active', view==='driveway');
  $('tab-crossfall').classList.toggle('active', view==='crossfall');
  $('main').classList.toggle('split-mode', view==='split');
  $('main').classList.toggle('driveway-mode', view==='driveway');
  $('main').classList.toggle('crossfall-mode', view==='crossfall');
  $('viewport-3d').style.display = is3DVisible() ? 'block' : 'none';
  $('viewport-profile').style.display = isProfileVisible() ? 'block' : 'none';
  $('viewport-3d').classList.toggle('pane-top', view==='split');
  $('viewport-profile').classList.toggle('pane-bottom', view==='split');
  $('viewport-profile').classList.toggle('pane-left', view==='driveway' || view==='crossfall');
  $('field-sample-interval').style.display = (isProfileVisible() && !isCrossfallVisible()) ? 'block' : 'none';
  $('field-profile-scale').style.display = (isProfileVisible() && !isCrossfallVisible()) ? 'block' : 'none';
  $('field-grade-break').style.display = (isProfileVisible() && !isCrossfallVisible()) ? 'block' : 'none';
  $('row-chk-alignment').style.display = is3DVisible() ? 'flex' : 'none';
  $('view-title').textContent = view==='3d' ? '3D surface' : (view==='profile' ? 'Existing terrain' : (view==='split' ? 'Split view' : (view==='crossfall' ? 'Crossfall' : 'Driveway design')));
  $('view-hint').textContent = view==='split'
    ? 'Hover the section to locate it on the surface · drag/scroll each pane to pan/zoom it · double-click the section to reset it'
    : (view==='3d' ? 'Drag to orbit · scroll to zoom · shift-drag to pan · click a point to inspect it'
      : (view==='driveway' ? 'Design the driveway on the right · hover the chart to read chainage / elevation · drag to pan · scroll to zoom'
        : (view==='crossfall' ? 'Pick Alignment A and B on the right · each keeps its own independent driveway design'
          : 'Hover to read chainage / elevation · drag to pan · scroll to zoom · double-click to reset')));
  $('legend').style.display = (is3DVisible() && state.points.length) ? 'block' : 'none';
  hidePointInspector();
  hideHoverMarker();
  if (is3DVisible()) onResize();
  if (view==='crossfall') renderCrossfallUI();
  if (isProfileVisible()) drawProfile();
  renderDrivewayUI();
}
