// AutoCAD-style orientation cube (ViewCube) for the 3D view, 2026-11-07.
//
// A tiny second scene (a labelled cube plus an N/E/S/W compass ring)
// drawn into the top-right corner of the SAME WebGL canvas as the
// terrain, after the main render, using a scissored viewport — so no
// second WebGL context, and the PDF export (which renders the main
// scene on its own just before capturing the canvas) never includes it.
//
// World axes (view3d.ts): +x = east, +y = up, -z = north (+z = south).
// Faces follow AutoCAD's naming: FRONT is the view from the south
// (looking north), BACK from the north, RIGHT from the east, LEFT from
// the west. Clicking a face, an edge or a corner snaps the camera to
// look from that direction; clicking a compass letter turns the view
// to look from that side. view3d.ts owns the actual camera/orbit and
// the click-vs-drag handling; this module only draws and hit-tests.
import * as THREE from 'three';
import { C } from './theme.ts';

export var VIEWCUBE_SIZE = 116;   // CSS px, square
export var VIEWCUBE_MARGIN_RIGHT = 14;
export var VIEWCUBE_MARGIN_TOP = 58;  // clears the 46px top bar

var scene: THREE.Scene | null = null;
var camera: THREE.OrthographicCamera | null = null;
var cube: THREE.Mesh | null = null;
var highlight: THREE.Mesh | null = null;
var ringLetters: THREE.Mesh[] = [];
var raycaster = new THREE.Raycaster();

// Edge/corner band width, as a fraction of the cube's half-size: a hit
// within this distance of an edge counts as that edge (or corner).
var EDGE_BAND = 0.3;

function labelTexture(text: string, bg: string, fg: string, size?: number): THREE.CanvasTexture {
  var c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  var g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(128,128,128,0.25)'; g.lineWidth = 4; g.strokeRect(2, 2, 124, 124);
  g.fillStyle = fg;
  g.font = '600 ' + (size || 26) + 'px system-ui, Segoe UI, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 66);
  var t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function letterTexture(text: string, color: string): THREE.CanvasTexture {
  var c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  var g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = color;
  g.font = '700 40px system-ui, Segoe UI, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  var t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function build(){
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1.55, 1.55, 1.55, -1.55, 0.1, 20);

  // BoxGeometry material order: +x, -x, +y, -y, +z, -z.
  var bg = C.cubeFace, fg = C.cubeText;
  var mats = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK'].map(function(name){
    return new THREE.MeshBasicMaterial({map: labelTexture(name, bg, fg, name.length > 5 ? 22 : 26)});
  });
  cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats);
  scene.add(cube);
  var edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({color: C.cubeEdge}));
  scene.add(edges);

  highlight = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({color: new THREE.Color(C.accent), transparent: true, opacity: 0.55, depthTest: false}));
  highlight.visible = false;
  highlight.renderOrder = 10;
  scene.add(highlight);

  // Compass ring below the cube, flat on the ground plane.
  var ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.06, 64),
    new THREE.MeshBasicMaterial({color: C.cubeRing, side: THREE.DoubleSide, transparent: true, opacity: 0.9}));
  ring.rotation.x = -Math.PI/2;
  ring.position.y = -0.62;
  scene.add(ring);
  // N/E/S/W letters sit on the ring; N in the brand orange.
  var dirs: {t: string; x: number; z: number; color: string}[] = [
    {t: 'N', x: 0, z: -1.25, color: C.accent},
    {t: 'E', x: 1.25, z: 0, color: C.cubeLetter},
    {t: 'S', x: 0, z: 1.25, color: C.cubeLetter},
    {t: 'W', x: -1.25, z: 0, color: C.cubeLetter}
  ];
  ringLetters = dirs.map(function(d){
    var m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42),
      new THREE.MeshBasicMaterial({map: letterTexture(d.t, d.color), transparent: true, side: THREE.DoubleSide, depthTest: false}));
    m.position.set(d.x, -0.62, d.z);
    m.renderOrder = 5;
    m.userData.compass = d.t;
    scene!.add(m);
    return m;
  });
}

// Drops the cube scene (disposing its GPU resources) so the next render
// rebuilds it — used when the light/dark theme changes its colours.
export function resetViewCube(){
  if (!scene) return;
  scene.traverse(function(o){
    var m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    var mat = m.material as THREE.Material | THREE.Material[] | undefined;
    var mats = mat ? (Array.isArray(mat) ? mat : [mat]) : [];
    mats.forEach(function(x){ var mm = x as THREE.MeshBasicMaterial; if (mm.map) mm.map.dispose(); x.dispose(); });
  });
  scene = null; camera = null; cube = null; highlight = null; ringLetters = [];
  lastHighlightKey = '';
}

// Draws the cube into the canvas's top-right corner, oriented to match
// `mainCamera` (same view direction and up vector, no translation).
export function renderViewCube(renderer: THREE.WebGLRenderer, mainCamera: THREE.PerspectiveCamera){
  if (!scene) build();
  var size = renderer.getSize(new THREE.Vector2());
  if (size.x < VIEWCUBE_SIZE + 40 || size.y < VIEWCUBE_SIZE + VIEWCUBE_MARGIN_TOP + 10) return;
  var dir = new THREE.Vector3();
  mainCamera.getWorldDirection(dir);
  camera!.position.copy(dir).multiplyScalar(-6);
  camera!.up.copy(mainCamera.up);
  camera!.lookAt(0, 0, 0);
  // Letters always face the viewer.
  for (var i=0;i<ringLetters.length;i++) ringLetters[i].quaternion.copy(camera!.quaternion);

  var x = size.x - VIEWCUBE_SIZE - VIEWCUBE_MARGIN_RIGHT;
  var y = size.y - VIEWCUBE_SIZE - VIEWCUBE_MARGIN_TOP; // WebGL viewport y is from the bottom
  var prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setScissor(x, y, VIEWCUBE_SIZE, VIEWCUBE_SIZE);
  renderer.setViewport(x, y, VIEWCUBE_SIZE, VIEWCUBE_SIZE);
  renderer.clearDepth();
  renderer.render(scene!, camera!);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, size.x, size.y);
  renderer.autoClear = prevAutoClear;
}

// Pointer position inside the cube's square, as normalised device
// coordinates, or null if the pointer isn't over it.
function cubeNdc(dom: HTMLElement, clientX: number, clientY: number): THREE.Vector2 | null {
  var rect = dom.getBoundingClientRect();
  var left = rect.right - VIEWCUBE_MARGIN_RIGHT - VIEWCUBE_SIZE;
  var top = rect.top + VIEWCUBE_MARGIN_TOP;
  if (rect.width < VIEWCUBE_SIZE + 40 || rect.height < VIEWCUBE_SIZE + VIEWCUBE_MARGIN_TOP + 10) return null;
  if (clientX < left || clientX > left + VIEWCUBE_SIZE || clientY < top || clientY > top + VIEWCUBE_SIZE) return null;
  return new THREE.Vector2(((clientX-left)/VIEWCUBE_SIZE)*2 - 1, -((clientY-top)/VIEWCUBE_SIZE)*2 + 1);
}

export function isOverViewCube(dom: HTMLElement, clientX: number, clientY: number): boolean {
  return cubeNdc(dom, clientX, clientY) !== null;
}

export type ViewCubeHit =
  { kind: 'cube'; dir: THREE.Vector3; region: THREE.Vector3 } |   // dir: from target toward the camera
  { kind: 'compass'; letter: string };

// Which part of the cube (face/edge/corner) or which compass letter is
// under the pointer, or null for empty space within the corner square.
export function viewCubeHitTest(dom: HTMLElement, clientX: number, clientY: number): ViewCubeHit | null {
  if (!scene) return null;
  var ndc = cubeNdc(dom, clientX, clientY);
  if (!ndc) return null;
  raycaster.setFromCamera(ndc, camera!);
  var letterHits = raycaster.intersectObjects(ringLetters);
  if (letterHits.length) return {kind: 'compass', letter: letterHits[0].object.userData.compass};
  var hits = raycaster.intersectObject(cube!);
  if (!hits.length) return null;
  var p = hits[0].point; // cube is unit-sized at the origin: coords in [-0.5, 0.5]
  var region = new THREE.Vector3();
  var axes: ('x'|'y'|'z')[] = ['x', 'y', 'z'];
  for (var i=0;i<3;i++){
    var v = p[axes[i]];
    region[axes[i]] = Math.abs(v) > 0.5 - EDGE_BAND*0.5 ? Math.sign(v) : 0;
  }
  // The face that was actually hit always counts, even if its band test
  // above came out marginal from rounding.
  var n = hits[0].face ? hits[0].face.normal : null;
  if (n){
    if (Math.abs(n.x) > 0.5) region.x = Math.sign(n.x);
    if (Math.abs(n.y) > 0.5) region.y = Math.sign(n.y);
    if (Math.abs(n.z) > 0.5) region.z = Math.sign(n.z);
  }
  return {kind: 'cube', dir: region.clone().normalize(), region: region};
}

// Highlights the face/edge/corner region under the pointer (null clears).
// Returns true if the highlight changed (so the caller re-renders).
var lastHighlightKey = '';
export function setViewCubeHighlight(hit: ViewCubeHit | null): boolean {
  if (!highlight) return false;
  var key = !hit ? '' : hit.kind === 'compass' ? 'c' + hit.letter : hit.region.toArray().join(',');
  if (key === lastHighlightKey) return false;
  lastHighlightKey = key;
  for (var i=0;i<ringLetters.length;i++) ringLetters[i].scale.setScalar(1);
  highlight.visible = false;
  if (!hit) return true;
  if (hit.kind === 'compass'){
    for (var j=0;j<ringLetters.length;j++) if (ringLetters[j].userData.compass === hit.letter) ringLetters[j].scale.setScalar(1.35);
    return true;
  }
  // A thin slab on the hit face, a bar along the hit edge, or a small
  // block at the hit corner — sized/positioned from the region signs.
  var r = hit.region, band = EDGE_BAND*0.5, thick = 0.04;
  var sx = r.x ? band : 1 - 2*band, sy = r.y ? band : 1 - 2*band, sz = r.z ? band : 1 - 2*band;
  var nonZero = (r.x?1:0) + (r.y?1:0) + (r.z?1:0);
  if (nonZero === 1){ sx = r.x ? thick : 1 - 2*band; sy = r.y ? thick : 1 - 2*band; sz = r.z ? thick : 1 - 2*band; }
  highlight.scale.set(sx, sy, sz);
  highlight.position.set(r.x*(0.5 - (nonZero===1?thick:band)/2 + 0.01), r.y*(0.5 - (nonZero===1?thick:band)/2 + 0.01), r.z*(0.5 - (nonZero===1?thick:band)/2 + 0.01));
  highlight.visible = true;
  return true;
}
