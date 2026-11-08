// Three.js 3D view — PLAN.md Stage 2 checkpoint 3 port, extracted
// verbatim from main.js.
import * as THREE from 'three';
import { $ } from './dom.ts';
import { state, toWorld } from './state.ts';
import { rampColor } from './colorramp.ts';
import { elevationAt } from './geometry/tin.ts';
import { triIndex, cumulativeChainages } from './longsection.ts';
import { pointAtChainage } from './geometry/chainage.ts';
import { isProfileVisible, is3DVisible } from './viewstate.ts';
import { drawProfile } from './rendering.ts';
import { C, onThemeChange } from './theme.ts';
import { resetViewCube, renderViewCube, viewCubeHitTest, setViewCubeHighlight, isOverViewCube, VIEWCUBE_SIZE, VIEWCUBE_MARGIN_RIGHT, VIEWCUBE_MARGIN_TOP } from './viewcube.ts';

// Post three.js version bump (PLAN.md Stage 2 checkpoint 5, this
// session): newer three.js defaults ColorManagement.enabled to true,
// which reinterprets vertex/material colors as sRGB-encoded scene
// light values and converts them — rampColor()'s raw 0-255 ramp was
// authored as plain display output, not scene-linear light, so with
// color management on the whole elevation ramp rendered visibly
// washed out/desaturated compared to the pre-bump app (confirmed by a
// direct screenshot diff). Disabling it restores the exact old
// pipeline: colors are used as given, no space conversion — verified
// pixel-identical to the pre-bump build afterward.
THREE.ColorManagement.enabled = false;

// three.js object handles the app tracks — all of geometry/material
// disposal (clearGroup) needs is that a mesh-like object *might* carry
// its own geometry/material, so that part is typed loosely rather than
// enumerating every three.js mesh subtype the app happens to use.
type Disposable3D = THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
interface ThreeState {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  terrainMesh: THREE.Mesh | null;
  wireMesh: THREE.LineSegments | null;
  pointsMesh: THREE.Points | null;
  breaklineMesh: THREE.LineSegments | null;
  alignmentLine: THREE.Group | null;
  hoverMarker: THREE.Group | null;
}

export var three: ThreeState = { scene:null, camera:null, renderer:null, terrainMesh:null, wireMesh:null, pointsMesh:null, breaklineMesh:null, alignmentLine:null, hoverMarker:null };
var orbit = { radius: 100, theta: Math.PI/4, phi: Math.PI/3.2, target: new THREE.Vector3(0,0,0) };
var dragging = false, panning = false, lastX=0, lastY=0, downX=0, downY=0, downOnCanvas=false;
var raycaster = new THREE.Raycaster();

var haloMatRef: THREE.MeshBasicMaterial | null = null;

// Light/dark theme switch: recolour the scene in place (no rebuild).
onThemeChange(function(){
  if (!three.scene) return;
  three.scene.background = new THREE.Color(C.sceneBg);
  if (three.wireMesh) (three.wireMesh.material as THREE.LineBasicMaterial).color.setHex(C.wire);
  if (three.pointsMesh) (three.pointsMesh.material as THREE.PointsMaterial).color.setHex(C.points);
  if (three.breaklineMesh) (three.breaklineMesh.material as THREE.LineBasicMaterial).color.setHex(C.breakline);
  if (haloMatRef) haloMatRef.color.setHex(C.halo);
  resetViewCube();
  requestRender();
});

export function initThree(){
  var container = $('viewport-3d');
  three.scene = new THREE.Scene();
  three.scene.background = new THREE.Color(C.sceneBg);

  three.camera = new THREE.PerspectiveCamera(45, container.clientWidth/container.clientHeight, 0.1, 100000);
  updateCameraFromOrbit();

  three.renderer = new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true});
  three.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  three.renderer.setPixelRatio(window.devicePixelRatio || 1);
  three.renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(three.renderer.domElement);

  // Light intensities multiplied by Math.PI here (only here — the
  // *authored* numbers stay 0.55/0.75/0.25) to compensate for
  // `useLegacyLights` being removed entirely in this three.js version
  // (it defaulted true in r128, briefly toggleable, then fully removed
  // r165+): irradiance from every light type is now divided by the
  // "artist-friendly" PI normalization factor that used to be baked
  // in, so the exact same intensity numbers render roughly 1/PI as
  // bright as before. Confirmed empirically, not just from the
  // migration notes: sampling matching pixels pre- and post-bump
  // showed a near-constant ~0.31 brightness ratio (1/PI = 0.318) across
  // very differently-lit points on the terrain, and reapplying PI here
  // reproduced the pre-bump screenshot pixel-for-pixel (see this
  // session's verification).
  var ambient = new THREE.AmbientLight(0xffffff, 0.55 * Math.PI);
  three.scene.add(ambient);
  var dir = new THREE.DirectionalLight(0xffffff, 0.75 * Math.PI);
  dir.position.set(1, 1.4, 0.8);
  three.scene.add(dir);
  var dir2 = new THREE.DirectionalLight(0x88aacc, 0.25 * Math.PI);
  dir2.position.set(-1, 0.6, -0.6);
  three.scene.add(dir2);

  // Hover marker — lit up on the surface while the cursor is over the
  // long section (split view), showing where that chainage sits in
  // real 3D space. A dark halo behind a bright orange core keeps it
  // visible against any terrain color; depthTest is off on both so it
  // always reads through the terrain rather than getting buried in it.
  // Created once (as a group, scaled as a unit), hidden until first used.
  var haloGeo = new THREE.SphereGeometry(1.4, 16, 12);
  var haloMat = new THREE.MeshBasicMaterial({color:C.halo, depthTest:false, transparent:true, opacity:0.55});
  haloMatRef = haloMat;
  var halo = new THREE.Mesh(haloGeo, haloMat);
  var coreGeo = new THREE.SphereGeometry(1, 18, 14);
  var coreMat = new THREE.MeshBasicMaterial({color:0xF26722, depthTest:false});
  var core = new THREE.Mesh(coreGeo, coreMat);
  three.hoverMarker = new THREE.Group();
  three.hoverMarker.add(halo, core);
  three.hoverMarker.renderOrder = 999;
  three.hoverMarker.visible = false;
  three.scene.add(three.hoverMarker);

  var dom = three.renderer.domElement;
  dom.addEventListener('pointerdown', function(e: PointerEvent){
    dragging = true; panning = e.shiftKey || e.button===2;
    lastX = e.clientX; lastY = e.clientY;
    downX = e.clientX; downY = e.clientY;
    downOnCanvas = true;
  });
  window.addEventListener('pointerup', function(e: PointerEvent){
    if (dragging && downOnCanvas){
      var moved = Math.sqrt(Math.pow(e.clientX-downX,2) + Math.pow(e.clientY-downY,2));
      if (moved < 4){
        var cubeHit = viewCubeHitTest(three.renderer.domElement, e.clientX, e.clientY);
        if (cubeHit) handleViewCubeClick(cubeHit);
        else if (!isOverViewCube(three.renderer.domElement, e.clientX, e.clientY)) handleTerrainClick(e);
      }
    }
    dragging = false;
    downOnCanvas = false;
  });
  dom.addEventListener('pointermove', function(e: PointerEvent){
    if (dragging) return;
    var hit = state.points.length ? viewCubeHitTest(dom, e.clientX, e.clientY) : null;
    dom.style.cursor = hit ? 'pointer' : '';
    if (setViewCubeHighlight(hit)) requestRender();
  });
  dom.addEventListener('pointerleave', function(){
    dom.style.cursor = '';
    if (setViewCubeHighlight(null)) requestRender();
  });
  window.addEventListener('pointermove', function(e: PointerEvent){
    if (!dragging) return;
    cancelOrbitAnimation();
    var dx = e.clientX-lastX, dy = e.clientY-lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (panning){
      var panSpeed = orbit.radius * 0.0015;
      var forward = new THREE.Vector3();
      three.camera.getWorldDirection(forward);
      var right = new THREE.Vector3().crossVectors(forward, three.camera.up).normalize();
      var up = new THREE.Vector3().crossVectors(right, forward).normalize();
      orbit.target.addScaledVector(right, -dx*panSpeed);
      orbit.target.addScaledVector(up, dy*panSpeed);
    } else {
      orbit.theta -= dx * 0.006;
      orbit.phi -= dy * 0.006;
      orbit.phi = Math.max(SNAP_EPS, Math.min(Math.PI-SNAP_EPS, orbit.phi));
    }
    updateCameraFromOrbit();
  });
  dom.addEventListener('wheel', function(e: WheelEvent){
    e.preventDefault();
    cancelOrbitAnimation();
    orbit.radius *= (1 + e.deltaY*0.0012);
    orbit.radius = Math.max(1, Math.min(100000, orbit.radius));
    updateCameraFromOrbit();
  }, {passive:false});
  dom.addEventListener('contextmenu', function(e: Event){ e.preventDefault(); });

  window.addEventListener('resize', onResize);
  buildViewButtons(container);
  requestRender();
}

// Home (default 3/4 view, whole surface) and Zoom extents (whole surface,
// current viewing angle) — small buttons under the orientation cube.
function buildViewButtons(container: HTMLElement){
  var wrap = document.createElement('div');
  wrap.id = 'view3d-buttons';
  wrap.style.cssText = 'position:absolute;display:none;gap:6px;z-index:4;justify-content:center;' +
    'top:' + (VIEWCUBE_MARGIN_TOP + VIEWCUBE_SIZE + 4) + 'px;right:' + VIEWCUBE_MARGIN_RIGHT + 'px;width:' + VIEWCUBE_SIZE + 'px;';
  function mk(id: string, title: string, svg: string, onClick: () => void){
    var b = document.createElement('button');
    b.id = id; b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.className = 'view3d-btn';
    b.innerHTML = svg;
    b.addEventListener('click', onClick);
    wrap.appendChild(b);
  }
  mk('btn-view-home', 'Home view (3/4 view of the whole surface)',
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
    function(){ animateToFit(DEFAULT_THETA, DEFAULT_PHI); });
  mk('btn-view-extents', 'Centre the whole surface in view (zoom extents)',
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2.2"/></svg>',
    function(){ animateToFit(orbit.theta, orbit.phi); });
  container.appendChild(wrap);
}

var DEFAULT_THETA = Math.PI/4, DEFAULT_PHI = Math.PI/3.2;

// Smoothly moves the camera to a new orbit (angles, and optionally
// radius/target). The shorter way round is taken for theta. Any user
// drag/scroll cancels it.
var orbitAnim: number | null = null;
function cancelOrbitAnimation(){
  if (orbitAnim !== null){ cancelAnimationFrame(orbitAnim); orbitAnim = null; }
}
function animateOrbitTo(theta: number, phi: number, radius?: number, target?: THREE.Vector3){
  cancelOrbitAnimation();
  var t0 = performance.now(), dur = 320;
  var th0 = orbit.theta, ph0 = orbit.phi, r0 = orbit.radius, tg0 = orbit.target.clone();
  var dTh = theta - th0;
  dTh = Math.atan2(Math.sin(dTh), Math.cos(dTh));
  var r1 = radius === undefined ? r0 : radius;
  var tg1 = target ? target.clone() : tg0.clone();
  function step(now: number){
    var k = Math.min(1, (now - t0)/dur);
    var e = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2)/2; // ease in-out
    orbit.theta = th0 + dTh*e;
    orbit.phi = ph0 + (phi - ph0)*e;
    orbit.radius = r0 + (r1 - r0)*e;
    orbit.target.lerpVectors(tg0, tg1, e);
    updateCameraFromOrbit();
    orbitAnim = k < 1 ? requestAnimationFrame(step) : null;
  }
  orbitAnim = requestAnimationFrame(step);
}
function animateToFit(theta: number, phi: number){
  if (!state.points.length) return;
  var fit = computeFit();
  animateOrbitTo(theta, phi, fit.radius, fit.target);
}

// Orientation-cube click: face/edge/corner -> look from that direction;
// compass letter -> look from that side, keeping the current tilt.
var SNAP_EPS = 1e-3;
function handleViewCubeClick(hit: import('./viewcube.ts').ViewCubeHit){
  if (hit.kind === 'compass'){
    var th = hit.letter === 'N' ? Math.PI : hit.letter === 'E' ? Math.PI/2 : hit.letter === 'W' ? -Math.PI/2 : 0;
    var ph = Math.max(0.05, Math.min(Math.PI/2, orbit.phi));
    animateOrbitTo(th, ph);
    return;
  }
  var d = hit.dir; // from target toward the camera, in world axes
  var phi = Math.acos(Math.max(-1, Math.min(1, d.y)));
  phi = Math.max(SNAP_EPS, Math.min(Math.PI - SNAP_EPS, phi));
  // Straight down/up: keep north at the top of the screen.
  var theta = (Math.abs(d.x) < 1e-9 && Math.abs(d.z) < 1e-9) ? 0 : Math.atan2(d.x, d.z);
  animateOrbitTo(theta, phi);
}

function updateCameraFromOrbit(){
  var r = orbit.radius;
  three.camera.position.x = orbit.target.x + r*Math.sin(orbit.phi)*Math.sin(orbit.theta);
  three.camera.position.y = orbit.target.y + r*Math.cos(orbit.phi);
  three.camera.position.z = orbit.target.z + r*Math.sin(orbit.phi)*Math.cos(orbit.theta);
  three.camera.lookAt(orbit.target);
  requestRender();
}

export function onResize(){
  var container = $('viewport-3d');
  if (container.clientWidth===0) return;
  three.camera.aspect = container.clientWidth/container.clientHeight;
  three.camera.updateProjectionMatrix();
  three.renderer.setSize(container.clientWidth, container.clientHeight);
  requestRender();
  if (isProfileVisible()) drawProfile();
}

// Render on demand rather than every frame: the scene is static between
// user actions, and a continuous loop kept the GPU busy (and laptop fans
// spinning) while the app sat idle. Anything that changes the camera or
// scene calls this; repeated calls within one frame coalesce into a single
// render. preserveDrawingBuffer keeps the last frame on the canvas between
// renders.
var renderQueued = false;
export function requestRender(){
  if (renderQueued || !three.renderer) return;
  renderQueued = true;
  requestAnimationFrame(function(){
    renderQueued = false;
    three.renderer.render(three.scene, three.camera);
    var hasData = state.points.length > 0;
    if (hasData) renderViewCube(three.renderer, three.camera);
    var btns = document.getElementById('view3d-buttons');
    if (btns) btns.style.display = hasData ? 'flex' : 'none';
  });
}

export function clearGroup(obj: Disposable3D | null){
  if (!obj) return;
  if (obj.parent) obj.parent.remove(obj);
  // A group (e.g. the alignment line's solid + dashed runs) owns its
  // children's GPU resources too.
  for (var ci=obj.children.length-1; ci>=0; ci--) clearGroup(obj.children[ci] as Disposable3D);
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material){
    if (Array.isArray(obj.material)) obj.material.forEach(function(m: THREE.Material){ m.dispose(); });
    else obj.material.dispose();
  }
  requestRender();
}

export function rebuildTerrainMesh(){
  clearGroup(three.terrainMesh);
  clearGroup(three.wireMesh);
  clearGroup(three.pointsMesh);
  clearGroup(three.breaklineMesh); three.breaklineMesh = null;
  if (!state.points.length || !state.triangles.length) return;

  var ve = state.verticalExaggeration;
  var geo = new THREE.BufferGeometry();
  var positions = new Float32Array(state.points.length*3);
  var colors = new Float32Array(state.points.length*3);
  var zRange = (state.zMax-state.zMin) || 1;

  for (var i=0;i<state.points.length;i++){
    var p = state.points[i];
    positions[i*3+0] = p.x;
    positions[i*3+1] = (p.z - state.zMin) * ve;
    positions[i*3+2] = -p.y;
    var col = rampColor((p.z-state.zMin)/zRange);
    colors[i*3+0] = col[0]/255;
    colors[i*3+1] = col[1]/255;
    colors[i*3+2] = col[2]/255;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
  var indices: number[] = [];
  for (var t=0;t<state.triangles.length;t++){
    indices.push(state.triangles[t][0], state.triangles[t][1], state.triangles[t][2]);
  }
  geo.setIndex(indices);
  geo.computeVertexNormals();

  var mat = new THREE.MeshStandardMaterial({vertexColors:true, side:THREE.DoubleSide, roughness:0.85, metalness:0.05});
  three.terrainMesh = new THREE.Mesh(geo, mat);
  three.scene.add(three.terrainMesh);

  var wireGeo = new THREE.WireframeGeometry(geo);
  var wireMat = new THREE.LineBasicMaterial({color:C.wire, transparent:true, opacity:0.55});
  three.wireMesh = new THREE.LineSegments(wireGeo, wireMat);
  three.wireMesh.visible = $<HTMLInputElement>('chk-wireframe').checked;
  three.scene.add(three.wireMesh);

  if ($<HTMLInputElement>('chk-points').checked) buildPointsMesh();

  fitCameraToData();
  buildBreaklineMesh(); // after fitCameraToData, which sets state.modelSpan
  rebuildAlignmentLine();
}

// The breakline edges actually built into the current surface
// (state.constraintEdges, 2026-11-08), drawn as lines lifted a hair off
// it so they don't z-fight with the triangles they're edges of.
export function buildBreaklineMesh(){
  clearGroup(three.breaklineMesh); three.breaklineMesh = null;
  var edges = state.constraintEdges;
  if (!edges || !edges.length || !state.points.length || !$<HTMLInputElement>('chk-show-breaklines').checked) return;
  var ve = state.verticalExaggeration;
  var lift = Math.max((state.modelSpan || 100) * 0.0003, 0.01);
  var positions = new Float32Array(edges.length*3);
  for (var i=0;i<edges.length;i++){
    var p = state.points[edges[i]];
    if (!p) return; // edges belong to a different point set — never draw garbage
    positions[i*3+0] = p.x;
    positions[i*3+1] = (p.z - state.zMin)*ve + lift;
    positions[i*3+2] = -p.y;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  var mat = new THREE.LineBasicMaterial({color:C.breakline, transparent:true, opacity:0.45}); // subtle: reads as linework, not a highlight
  three.breaklineMesh = new THREE.LineSegments(geo, mat);
  three.breaklineMesh.renderOrder = 2;
  three.scene.add(three.breaklineMesh);
  requestRender();
}

export function buildPointsMesh(){
  clearGroup(three.pointsMesh);
  var ve = state.verticalExaggeration;
  var geo = new THREE.BufferGeometry();
  var positions = new Float32Array(state.points.length*3);
  for (var i=0;i<state.points.length;i++){
    var p = state.points[i];
    positions[i*3+0] = p.x;
    positions[i*3+1] = (p.z-state.zMin)*ve + 0.02;
    positions[i*3+2] = -p.y;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  var mat = new THREE.PointsMaterial({color:C.points, size:2.2, sizeAttenuation:false});
  three.pointsMesh = new THREE.Points(geo, mat);
  three.scene.add(three.pointsMesh);
  requestRender();
}

export function rebuildAlignmentLine(){
  clearGroup(three.alignmentLine);
  three.alignmentLine = null;
  if (!state.polyline || state.polyline.length < 2 || !$<HTMLInputElement>('chk-alignment').checked || !triIndex) return;
  var ve = state.verticalExaggeration;
  // A fixed +0.05 offset z-fights against the terrain once the model span
  // is large relative to it (depth-buffer precision at typical camera
  // distances), so scale it off the model's own span instead; depthTest
  // is also disabled and renderOrder bumped so the alignment always reads
  // on top, regardless of view angle.
  var span = state.modelSpan || 100;
  var offset = Math.max(span * 0.0005, 0.02);
  // Draped along the whole alignment, not just joined vertex to vertex:
  // every vertex plus a dense run of samples in between, each read off
  // the TIN, so the line follows the ground through bends instead of
  // cutting straight chords through (or floating over) it. Stretches
  // that leave the triangulated surface used to be dropped — and the
  // vertices either side joined straight across the gap, which is what
  // made the line look broken at corners sitting off the edge of the
  // survey. They're now drawn too, dashed, held at the nearest known
  // ground level, so the alignment's full extent always shows.
  var verts = state.polyline;
  var cum = cumulativeChainages(verts);
  var total = cum[cum.length-1];
  if (total <= 0) return;
  var step = Math.max(0.1, total/4000);
  var chs: number[] = cum.slice();
  for (var c=step; c<total; c+=step) chs.push(c);
  chs.sort(function(a,b){ return a-b; });
  var pts: {x: number; y: number; z: number | null}[] = [];
  var lastCh = -Infinity;
  for (var i=0;i<chs.length;i++){
    if (chs[i]-lastCh < 1e-6) continue;
    lastCh = chs[i];
    var p = pointAtChainage(verts, cum, chs[i]);
    pts.push({x:p.x, y:p.y, z: elevationAt(p.x, p.y, state.points, state.triangles, triIndex)});
  }
  // Fill unknown levels from the nearest known one (forward, then back).
  var filled: number[] = new Array(pts.length);
  var known: number | null = null;
  for (var f=0; f<pts.length; f++){ if (pts[f].z !== null) known = pts[f].z; filled[f] = known === null ? NaN : known; }
  known = null;
  for (var g=pts.length-1; g>=0; g--){ if (pts[g].z !== null) known = pts[g].z; if (isNaN(filled[g])) filled[g] = known === null ? state.zMin : known; }

  var group = new THREE.Group();
  group.renderOrder = 999;
  var solidMat = new THREE.LineBasicMaterial({color:0xF26722, linewidth:2, depthTest:false});
  var dashMat = new THREE.LineDashedMaterial({color:0xF26722, depthTest:false, transparent:true, opacity:0.6,
    dashSize: Math.max(span*0.006, 0.2), gapSize: Math.max(span*0.004, 0.12)});
  function toV(k: number){ return new THREE.Vector3(pts[k].x, (filled[k]-state.zMin)*ve + offset, -pts[k].y); }
  // Split into runs of on-surface / off-surface samples; adjoining runs
  // share their boundary sample so the line stays continuous.
  var runStart = 0;
  for (var k=1; k<=pts.length; k++){
    var onPrev = pts[k-1].z !== null;
    if (k < pts.length && (pts[k].z !== null) === onPrev) continue;
    var end = Math.min(k, pts.length-1);
    if (end > runStart){
      var runPts: THREE.Vector3[] = [];
      for (var r=runStart; r<=end; r++) runPts.push(toV(r));
      var geo = new THREE.BufferGeometry().setFromPoints(runPts);
      var line = new THREE.Line(geo, onPrev ? solidMat : dashMat);
      if (!onPrev) line.computeLineDistances();
      line.renderOrder = 999;
      group.add(line);
    }
    runStart = end;
  }
  three.alignmentLine = group;
  three.scene.add(group);
  requestRender();
}

// The camera target/radius that frames the whole surface.
function computeFit(): {target: THREE.Vector3; radius: number; span: number} {
  var minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (var i=0;i<state.points.length;i++){
    var p = state.points[i];
    if (p.x<minX) minX=p.x; if (p.x>maxX) maxX=p.x;
    if (-p.y<minZ) minZ=-p.y; if (-p.y>maxZ) maxZ=-p.y;
  }
  var cx = (minX+maxX)/2, cz=(minZ+maxZ)/2;
  var span = Math.max(maxX-minX, maxZ-minZ, 10);
  return {target: new THREE.Vector3(cx, (state.zMax-state.zMin)*state.verticalExaggeration*0.15, cz), radius: span*1.3, span: span};
}

export function fitCameraToData(){
  var fit = computeFit();
  state.modelSpan = fit.span; // reused to size the hover marker sensibly regardless of survey coordinate scale
  orbit.target.copy(fit.target);
  orbit.radius = fit.radius;
  updateCameraFromOrbit();
}

// ============================================================
// Point inspection — click a survey point on the 3D surface (as opposed
// to dragging to orbit) to read off its real-world X,Y,Z.
// ============================================================
function handleTerrainClick(e: PointerEvent){
  if (!is3DVisible() || !three.terrainMesh) return;
  var rect = three.renderer.domElement.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
  var mx = ((e.clientX-rect.left)/rect.width)*2 - 1;
  var my = -((e.clientY-rect.top)/rect.height)*2 + 1;
  raycaster.setFromCamera(new THREE.Vector2(mx, my), three.camera);
  var hits = raycaster.intersectObject(three.terrainMesh);
  if (!hits.length){ hidePointInspector(); return; }

  var hit = hits[0];
  var face = hit.face as THREE.Face;
  var idxs = [face.a, face.b, face.c];
  var posAttr = three.terrainMesh.geometry.attributes.position;
  var best = -1, bestDist = Infinity;
  for (var k=0;k<3;k++){
    var vi = idxs[k];
    var vx = posAttr.getX(vi), vy = posAttr.getY(vi), vz = posAttr.getZ(vi);
    var d = (vx-hit.point.x)*(vx-hit.point.x) + (vy-hit.point.y)*(vy-hit.point.y) + (vz-hit.point.z)*(vz-hit.point.z);
    if (d < bestDist){ bestDist = d; best = vi; }
  }
  if (best < 0 || !state.points[best]) { hidePointInspector(); return; }
  showPointInspector(toWorld(state.points[best]));
}

function showPointInspector(w: {x: number; y: number; z: number}){
  $('point-inspector-body').innerHTML =
    'X&nbsp;&nbsp;' + w.x.toFixed(3) + '<br>' +
    'Y&nbsp;&nbsp;' + w.y.toFixed(3) + '<br>' +
    'Z&nbsp;&nbsp;' + w.z.toFixed(3);
  $('point-inspector').style.display = 'block';
}

export function hidePointInspector(){
  $('point-inspector').style.display = 'none';
}

// ============================================================
// Hover marker — mirrors a hovered long-section chainage onto the
// real 3D surface, mainly useful in split view.
// ============================================================
export function showHoverMarker(x: number, y: number, z: number){
  if (!three.hoverMarker) return;
  var ve = state.verticalExaggeration;
  var span = state.modelSpan || 100;
  var worldY = (z - state.zMin) * ve;
  // Sized off the camera's current distance to the marker (not a fixed
  // world size) so it stays a sensible, roughly constant size on screen
  // whether the 3D view is zoomed in close or pulled right out — bounded
  // by the model's own span so it can't vanish or balloon at extremes.
  var dist = three.camera ? three.camera.position.distanceTo(new THREE.Vector3(x, worldY, -y)) : span;
  var radius = Math.max(span * 0.0008, Math.min(span * 0.05, dist * 0.022));
  three.hoverMarker.scale.setScalar(radius);
  three.hoverMarker.position.set(x, worldY + radius, -y);
  three.hoverMarker.visible = true;
  requestRender();
}

export function hideHoverMarker(){
  if (three.hoverMarker && three.hoverMarker.visible){
    three.hoverMarker.visible = false;
    requestRender();
  }
}
