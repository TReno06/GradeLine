// Three.js 3D view — PLAN.md Stage 2 checkpoint 3 port, extracted
// verbatim from main.js.
import * as THREE from 'three';
import { $ } from './dom.ts';
import { state, toWorld } from './state.ts';
import { rampColor } from './colorramp.ts';
import { elevationAt } from './geometry/tin.ts';
import { triIndex } from './longsection.ts';
import { isProfileVisible, is3DVisible } from './viewstate.ts';
import { drawProfile } from './rendering.ts';

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
  alignmentLine: THREE.Line | null;
  hoverMarker: THREE.Group | null;
}

export var three: ThreeState = { scene:null, camera:null, renderer:null, terrainMesh:null, wireMesh:null, pointsMesh:null, alignmentLine:null, hoverMarker:null };
var orbit = { radius: 100, theta: Math.PI/4, phi: Math.PI/3.2, target: new THREE.Vector3(0,0,0) };
var dragging = false, panning = false, lastX=0, lastY=0, downX=0, downY=0, downOnCanvas=false;
var raycaster = new THREE.Raycaster();

export function initThree(){
  var container = $('viewport-3d');
  three.scene = new THREE.Scene();
  three.scene.background = new THREE.Color(0x0E0E10);

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
  var haloMat = new THREE.MeshBasicMaterial({color:0x0E0E10, depthTest:false, transparent:true, opacity:0.55});
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
      if (moved < 4) handleTerrainClick(e);
    }
    dragging = false;
    downOnCanvas = false;
  });
  window.addEventListener('pointermove', function(e: PointerEvent){
    if (!dragging) return;
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
      orbit.phi = Math.max(0.05, Math.min(Math.PI-0.05, orbit.phi));
    }
    updateCameraFromOrbit();
  });
  dom.addEventListener('wheel', function(e: WheelEvent){
    e.preventDefault();
    orbit.radius *= (1 + e.deltaY*0.0012);
    orbit.radius = Math.max(1, Math.min(100000, orbit.radius));
    updateCameraFromOrbit();
  }, {passive:false});
  dom.addEventListener('contextmenu', function(e: Event){ e.preventDefault(); });

  window.addEventListener('resize', onResize);
  requestRender();
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
  });
}

export function clearGroup(obj: Disposable3D | null){
  if (!obj) return;
  if (obj.parent) obj.parent.remove(obj);
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
  var wireMat = new THREE.LineBasicMaterial({color:0x0c1113, transparent:true, opacity:0.55});
  three.wireMesh = new THREE.LineSegments(wireGeo, wireMat);
  three.wireMesh.visible = $<HTMLInputElement>('chk-wireframe').checked;
  three.scene.add(three.wireMesh);

  if ($<HTMLInputElement>('chk-points').checked) buildPointsMesh();

  fitCameraToData();
  rebuildAlignmentLine();
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
  var mat = new THREE.PointsMaterial({color:0xE8E3D8, size:2.2, sizeAttenuation:false});
  three.pointsMesh = new THREE.Points(geo, mat);
  three.scene.add(three.pointsMesh);
  requestRender();
}

export function rebuildAlignmentLine(){
  clearGroup(three.alignmentLine);
  if (!state.polyline || !$<HTMLInputElement>('chk-alignment').checked || !triIndex) return;
  var ve = state.verticalExaggeration;
  // A fixed +0.05 offset z-fights against the terrain once the model span
  // is large relative to it (depth-buffer precision at typical camera
  // distances), so scale it off the model's own span instead; depthTest
  // is also disabled and renderOrder bumped so the alignment always reads
  // on top, regardless of view angle.
  var span = state.modelSpan || 100;
  var offset = Math.max(span * 0.0005, 0.02);
  var pts: THREE.Vector3[] = [];
  for (var i=0;i<state.polyline.length;i++){
    var v = state.polyline[i];
    var z = elevationAt(v.x, v.y, state.points, state.triangles, triIndex);
    if (z===null) continue;
    pts.push(new THREE.Vector3(v.x, (z-state.zMin)*ve + offset, -v.y));
  }
  if (pts.length < 2) return;
  var geo = new THREE.BufferGeometry().setFromPoints(pts);
  var mat = new THREE.LineBasicMaterial({color:0xF26722, linewidth:2, depthTest:false});
  three.alignmentLine = new THREE.Line(geo, mat);
  three.alignmentLine.renderOrder = 999;
  three.scene.add(three.alignmentLine);
  requestRender();
}

export function fitCameraToData(){
  var minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (var i=0;i<state.points.length;i++){
    var p = state.points[i];
    if (p.x<minX) minX=p.x; if (p.x>maxX) maxX=p.x;
    if (-p.y<minZ) minZ=-p.y; if (-p.y>maxZ) maxZ=-p.y;
  }
  var cx = (minX+maxX)/2, cz=(minZ+maxZ)/2;
  var span = Math.max(maxX-minX, maxZ-minZ, 10);
  state.modelSpan = span; // reused to size the hover marker sensibly regardless of survey coordinate scale
  orbit.target.set(cx, (state.zMax-state.zMin)*state.verticalExaggeration*0.15, cz);
  orbit.radius = span * 1.3;
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
