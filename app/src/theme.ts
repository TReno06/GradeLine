// Light / dark theme (2026-11-07). GradeLine was dark-only; this adds a
// light theme, toggled from the top bar and remembered per browser
// (localStorage — a viewer preference, never part of a .gradeline job).
//
// The DOM side is CSS custom properties, overridden under
// html[data-theme="light"] in index.html. The canvas charts and the 3D
// scene can't read CSS, so their colours come from `C` below: one object
// whose values are swapped in place by applyTheme(), so drawing code
// just reads C.<role> at draw time and every redraw picks up the theme.
// Data colours (the elevation ramp) are deliberately the same in both.

var DARK = {
  chartBg: '#12181C',
  grid: '#212B30',
  axisText: '#8A9AA3',
  faint: '#5B6870',
  panelLabel: '#8A97A0',
  panelBorder: 'rgba(255,255,255,0.14)',
  zeroLine: 'rgba(255,255,255,0.32)',
  ground: '#D9D6CF',
  groundFill: 'rgba(217,214,207,0.07)',
  miniGround: 'rgba(180,190,196,0.75)',
  labelBg: 'rgba(14,14,16,0.72)',
  labelBgStrong: 'rgba(14,14,16,0.78)',
  accent: '#F26722',
  gradeBreak: 'rgba(242,103,34,0.55)',
  design: '#4FA8FF',
  bad: '#E0574A',
  ok: '#3ECF8E',
  xfLine: '#F2A722',
  marker: 'rgba(245,243,238,0.85)',
  interval: 'rgba(154,154,158,0.4)',
  intervalText: '#C7C5C0',
  datum: '#8A8A90',
  pviStroke: '#0d0d0f',
  tire: '#1a1a1c',
  hub: '#5a5a60',
  silhouette: '#AEB8BF',
  // 3D scene (numbers for three.js)
  sceneBg: 0x0E0E10,
  wire: 0x0c1113,
  points: 0xE8E3D8,
  breakline: 0xD8D4CC,
  halo: 0x0E0E10,
  // orientation cube
  cubeFace: '#2A2E33',
  cubeText: '#E8E3D8',
  cubeEdge: 0x8A949B,
  cubeRing: 0x5C666D,
  cubeLetter: '#E8E3D8'
};

var LIGHT: typeof DARK = {
  chartBg: '#FAF9F6',
  grid: '#E4E2DD',
  axisText: '#56636B',
  faint: '#7D878E',
  panelLabel: '#56636B',
  panelBorder: 'rgba(0,0,0,0.16)',
  zeroLine: 'rgba(0,0,0,0.38)',
  ground: '#3B3B40',
  groundFill: 'rgba(40,40,46,0.06)',
  miniGround: 'rgba(70,76,82,0.8)',
  labelBg: 'rgba(255,255,255,0.86)',
  labelBgStrong: 'rgba(255,255,255,0.92)',
  accent: '#D9560F',
  gradeBreak: 'rgba(217,86,15,0.6)',
  design: '#1E6FD0',
  bad: '#C42E1F',
  ok: '#13845A',
  xfLine: '#BD7400',
  marker: 'rgba(25,25,30,0.8)',
  interval: 'rgba(90,90,98,0.35)',
  intervalText: '#4A4A52',
  datum: '#6A6A72',
  pviStroke: '#FAF9F6',
  tire: '#2A2A2E',
  hub: '#A0A0A8',
  silhouette: '#5F6A72',
  sceneBg: 0xF3F2EE,
  wire: 0x2A3034,
  points: 0x1E2226,
  breakline: 0x3A3F44,
  halo: 0xFAF9F6,
  cubeFace: '#ECEAE5',
  cubeText: '#2A2E33',
  cubeEdge: 0x8A949B,
  cubeRing: 0xA7AFB4,
  cubeLetter: '#2A2E33'
};

export type ThemeName = 'dark' | 'light';
export var C: typeof DARK = Object.assign({}, DARK);
var current: ThemeName = 'dark';
var STORAGE_KEY = 'gradeline.theme';
var listeners: (() => void)[] = [];

export function currentTheme(): ThemeName { return current; }

// Registers a callback run after every theme change (e.g. view3d.ts
// recolouring the scene, rendering.ts redrawing the chart).
export function onThemeChange(fn: () => void){ listeners.push(fn); }

export function applyTheme(name: ThemeName){
  current = name;
  Object.assign(C, name === 'light' ? LIGHT : DARK);
  document.documentElement.setAttribute('data-theme', name);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', name === 'light' ? '#F3F2EE' : '#0E0E10');
  try { localStorage.setItem(STORAGE_KEY, name); } catch (e){ /* convenience only */ }
  for (var i=0;i<listeners.length;i++){ try { listeners[i](); } catch (e){ console.error(e); } }
}

// The saved choice, else dark (GradeLine's long-standing look).
export function savedTheme(): ThemeName {
  try { return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'; } catch (e){ return 'dark'; }
}
