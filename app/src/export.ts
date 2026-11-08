// Export — PLAN.md Stage 2 checkpoint 3 port. Extracted verbatim from
// main.js, with one structural change asked for explicitly by PLAN.md:
// exportSectionDXF (was 322 lines) is now split into named per-section
// builder functions (existing ground / datum / chainage breaks /
// chainage interval ladder / proposed driveway / CAD section table),
// each appending its own DXF entity lines and called in the same order
// the original single function computed them in — no formula changed,
// only where each block of pushes lives.
import { $ } from './dom.ts';
import { state, toWorld, currentAlignmentLabel, drivewayStateFor, activeAlignmentFileName } from './state.ts';
import {
  profileData, computeGradeBreaks, computeIntervalMarks, datumRLValue,
  centeredVertsForAlignment, cumulativeChainages, existingElevationAtChainageForVerts
} from './longsection.ts';
import {
  computeDrivewayProfile, drivewayRules, computeDrivewayCompliance, computeSectionTable,
  computeDrivewayProfileForPvis, driveGroundRLAtForVerts, alignmentSeparationAt
} from './driveway.ts';
import { legGradeChecksFrom } from './driveway/profile.ts';
import {
  declutterLabelsFrom as declutterLabels, layoutTableColumnsFrom as layoutTableColumns,
  computeCrossfallTableFrom
} from './driveway/sectionTable.ts';
import { computeCrossfallSeriesFrom, computeCrossfallSeriesPerpendicular } from './crossfall.ts';
import { pointAtChainage, chainageSquareAcross } from './geometry/chainage.ts';
import type { ProfileSample, GradeBreak, DrivewayProfile, SectionTable, DecodedPngImage, DeclutterLabelInput, CrossfallTable, GroundRLAt, FileSystemFileHandleLike } from './types.ts';

type ExportMode = 'existing' | 'proposed' | 'both';
// exportSectionDXF filters out null-elevation samples before any of
// these builders ever see them (see its own `samples` line) — this
// narrower type reflects that invariant instead of every builder
// re-guarding against a null that can't actually occur here.
type FilteredSample = ProfileSample & { elevation: number };

// Files are handed to the viewer through the platform's `downloads`
// capability rather than a direct <a download> link (the artifact
// sandbox blocks page-initiated downloads outright). That capability
// only accepts a fixed extension allowlist, which does not include
// .dxf, so DXF output is wrapped in a single-entry, uncompressed ZIP
// — a plain CRC32 + STORE-method archive, no external library needed.

interface Crc32Fn { (bytes: Uint8Array): number; table?: Uint32Array; }
var crc32 = function(bytes: Uint8Array): number {
  if (!crc32.table){
    var t = new Uint32Array(256);
    for (var n=0;n<256;n++){
      var c = n;
      for (var k=0;k<8;k++){ c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
      t[n] = c >>> 0;
    }
    crc32.table = t;
  }
  var crc = 0xFFFFFFFF;
  for (var i=0;i<bytes.length;i++){ crc = crc32.table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8); }
  return (crc ^ 0xFFFFFFFF) >>> 0;
} as Crc32Fn;

function writeU16(arr: Uint8Array, off: number, val: number){ arr[off]=val&0xFF; arr[off+1]=(val>>>8)&0xFF; }
function writeU32(arr: Uint8Array, off: number, val: number){ arr[off]=val&0xFF; arr[off+1]=(val>>>8)&0xFF; arr[off+2]=(val>>>16)&0xFF; arr[off+3]=(val>>>24)&0xFF; }

function dosDateTime(){
  var d = new Date();
  return {
    time: ((d.getHours()&0x1F)<<11) | ((d.getMinutes()&0x3F)<<5) | ((d.getSeconds()>>1)&0x1F),
    date: (((d.getFullYear()-1980)&0x7F)<<9) | (((d.getMonth()+1)&0xF)<<5) | (d.getDate()&0x1F)
  };
}

// Single-file, uncompressed ZIP archive containing one text entry.
function makeZip(filename: string, text: string): Uint8Array {
  var nameBytes = new TextEncoder().encode(filename);
  var dataBytes = new TextEncoder().encode(text);
  var crc = crc32(dataBytes);
  var dt = dosDateTime();

  var local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
  writeU32(local,0,0x04034b50);
  writeU16(local,4,20); writeU16(local,6,0); writeU16(local,8,0);
  writeU16(local,10,dt.time); writeU16(local,12,dt.date);
  writeU32(local,14,crc); writeU32(local,18,dataBytes.length); writeU32(local,22,dataBytes.length);
  writeU16(local,26,nameBytes.length); writeU16(local,28,0);
  local.set(nameBytes, 30);
  local.set(dataBytes, 30+nameBytes.length);

  var central = new Uint8Array(46 + nameBytes.length);
  writeU32(central,0,0x02014b50);
  writeU16(central,4,20); writeU16(central,6,20); writeU16(central,8,0); writeU16(central,10,0);
  writeU16(central,12,dt.time); writeU16(central,14,dt.date);
  writeU32(central,16,crc); writeU32(central,20,dataBytes.length); writeU32(central,24,dataBytes.length);
  writeU16(central,28,nameBytes.length); writeU16(central,30,0); writeU16(central,32,0);
  writeU16(central,34,0); writeU16(central,36,0); writeU32(central,38,0); writeU32(central,42,0);
  central.set(nameBytes, 46);

  var eocd = new Uint8Array(22);
  writeU32(eocd,0,0x06054b50);
  writeU16(eocd,4,0); writeU16(eocd,6,0); writeU16(eocd,8,1); writeU16(eocd,10,1);
  writeU32(eocd,12,central.length); writeU32(eocd,16,local.length); writeU16(eocd,20,0);

  var out = new Uint8Array(local.length + central.length + eocd.length);
  out.set(local,0); out.set(central, local.length); out.set(eocd, local.length+central.length);
  return out;
}

async function getDownloadsCapability(){
  if (typeof window.claude === 'undefined' || typeof window.claude.use !== 'function') return null;
  try { return await window.claude.use('downloads'); } catch (e){ return null; }
}

// Ordinary <a download> link — works when this file is saved and opened
// directly in a browser (outside the hosted artifact page), where the
// `downloads` capability doesn't exist at all.
type FileData = Uint8Array | string | Blob;

export function saveFileViaBlobLink(filename: string, data: FileData){
  var blob = (data instanceof Blob) ? data : new Blob([data as BlobPart]);
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// The Tauri desktop build (PLAN.md Stage 5) doesn't perform browser
// downloads at all — <a download> silently does nothing there — so it
// gets a native Save As dialog instead (the same File System Access API
// jobs.ts already uses for Save/Open). Everywhere else keeps the ordinary
// download link.
async function saveLocal(filename: string, data: FileData){
  if (!('__TAURI_INTERNALS__' in window) || typeof window.showSaveFilePicker !== 'function'){
    saveFileViaBlobLink(filename, data);
    return;
  }
  var handle: FileSystemFileHandleLike;
  try {
    handle = await window.showSaveFilePicker({suggestedName: filename});
  } catch (err: unknown){
    return; // user cancelled the dialog
  }
  try {
    var writable = await handle.createWritable();
    await writable.write(data as BufferSource | string | Blob);
    await writable.close();
  } catch (err: any){
    alert('Couldn’t save "' + filename + '": ' + (err && err.message ? err.message : 'unknown error'));
  }
}

export async function saveFile(filename: string, data: FileData){
  var downloads = await getDownloadsCapability();
  if (!downloads){
    // Not running inside the hosted artifact page (e.g. this file was
    // saved and opened locally) — fall back to a normal browser download.
    await saveLocal(filename, data);
    return;
  }
  try {
    await downloads.save({filename: filename, data: data});
  } catch (err: any){
    if (err && err.code === 'declined') return; // user dismissed the prompt
    alert('Couldn’t save "' + filename + '": ' + (err && err.message ? err.message : 'unknown error'));
  }
}

// DXF exports only ever needed zipping because the hosted Artifact
// preview's save dialog (the `downloads` capability) doesn't support
// .dxf as a file type directly — outside that (the standalone file,
// what's actually used for real work) an ordinary download link takes
// any extension, so this skips the zip step there and saves the .dxf
// directly. Zips only where it's actually required.
async function saveDXF(baseName: string, dxfText: string){
  var downloads = await getDownloadsCapability();
  if (!downloads){
    await saveLocal(baseName + '.dxf', dxfText);
    return;
  }
  var zipBytes = makeZip(baseName + '.dxf', dxfText);
  try {
    await downloads.save({filename: baseName + '.zip', data: zipBytes});
  } catch (err: any){
    if (err && err.code === 'declined') return;
    alert('Couldn’t save "' + baseName + '.zip": ' + (err && err.message ? err.message : 'unknown error'));
  }
}

export function exportLongSectionCSV(){
  if (!profileData) return;
  var lines = ['chainage,elevation'];
  for (var i=0;i<profileData.samples.length;i++){
    var s = profileData.samples[i];
    lines.push(s.chainage.toFixed(3) + ',' + (s.elevation===null ? '' : s.elevation.toFixed(3)));
  }
  saveFile(activeAlignmentFileName('existing') + '.csv', lines.join('\n'));
}

// Minimal but valid ASCII DXF: one SECTION/ENTITIES block + EOF, no
// HEADER/TABLES/BLOCKS/OBJECTS sections at all. Deliberately bare: a
// real HEADER declaring a modern $ACADVER (tried briefly, reverted —
// see below) tells a reader "this is a structured R13+ drawing", and
// a structured drawing is expected to actually carry the TABLES/
// BLOCKS/OBJECTS sections that version always has (layer/style
// tables, model-space block record, handle-linked owners, etc.) — a
// versioned file with only an ENTITIES section is a genuine structural
// mismatch, and that's almost certainly what made Thom's AutoCAD crash
// outright on File > Open, worse than the original silent-drop bug it
// was meant to fix. A bare, unversioned, entities-only DXF has no such
// expectation attached to it — every reader (AutoCAD included) treats
// it as the oldest, simplest, tables-optional format, which is exactly
// what this file actually is. LINE/TEXT/3DFACE already worked fine
// that way; see exportSectionDXF for how the polylines were moved onto
// the same old-style footing (POLYLINE/VERTEX/SEQEND) instead of
// LWPOLYLINE, rather than trying to hand-build a fully valid modern
// document structure around them.
function dxfWrap(entityLines: string[]): string {
  var out = ['0','SECTION','2','ENTITIES'].concat(entityLines).concat(['0','ENDSEC','0','EOF']);
  return out.join('\n');
}

// Old-style POLYLINE + VERTEX* + SEQEND — the same entity form DXF has
// used since R10/R11, decades before LWPOLYLINE (R14) or the handle/
// subclass structure that comes with it. No subclass markers, no
// handles, no owner references needed: it's just a flat run of group
// codes, exactly like the LINE/TEXT/3DFACE entities elsewhere in this
// export that have never had a colour or structure problem. `color`
// (an AutoCAD Color Index) is entirely optional and applies the same
// way it does on any entity — group 62 isn't a modern-only attribute.
function dxfPolyline(layer: string, color: number | null | undefined, vertsXY: [string, string][]): string[] {
  var out = ['0','POLYLINE','8',layer];
  if (color !== undefined && color !== null) out.push('62', String(color));
  out.push('66','1','70','0');
  for (var i=0;i<vertsXY.length;i++){
    out.push('0','VERTEX','8',layer,'10',vertsXY[i][0],'20',vertsXY[i][1]);
  }
  out.push('0','SEQEND','8',layer);
  return out;
}

// ASCII-only text for a TEXT entity's group 1. With no $ACADVER header the
// file reads as R12, whose text is single-byte in the drawing's codepage —
// UTF-8 bytes for an em-dash (e.g. from an alignment label) would show up
// in AutoCAD as mojibake. Dashes/quotes get their ASCII look-alikes,
// anything else non-ASCII becomes '?', same as pdfEscapeText.
function dxfAsciiText(str: unknown): string {
  return String(str)
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x00-\x7F]/g, '?');
}

export function exportSurfaceDXF(){
  if (!state.points.length || !state.triangles.length) return;
  var lines: string[] = [];
  for (var t=0;t<state.triangles.length;t++){
    var tri = state.triangles[t];
    var a = toWorld(state.points[tri[0]]);
    var b = toWorld(state.points[tri[1]]);
    var c = toWorld(state.points[tri[2]]);
    lines.push(
      '0','3DFACE','8','TIN_SURFACE',
      '10', a.x.toFixed(4), '20', a.y.toFixed(4), '30', a.z.toFixed(4),
      '11', b.x.toFixed(4), '21', b.y.toFixed(4), '31', b.z.toFixed(4),
      '12', c.x.toFixed(4), '22', c.y.toFixed(4), '32', c.z.toFixed(4),
      '13', c.x.toFixed(4), '23', c.y.toFixed(4), '33', c.z.toFixed(4)
    );
  }
  saveDXF('tin-surface', dxfWrap(lines));
}

// ------------------------------------------------------------
// exportSectionDXF's per-section builders (split out of one 322-line
// function per PLAN.md Stage 2 checkpoint 3 — see this file's header).
// Each appends its own DXF entity lines to `lines` (mutated in place,
// matching the original function's own repeated `lines.push(...)`
// style) and is called from exportSectionDXF in the same order the
// original computed them in. No formula below changed from the
// original single-function version — only where each block lives.
// ------------------------------------------------------------

function buildExistingGroundLines(mode: ExportMode, samples: FilteredSample[]): string[] {
  // Existing ground as an old-style POLYLINE (see dxfPolyline) rather
  // than a modern LWPOLYLINE — tried LWPOLYLINE with proper subclass
  // markers first (fixed the missing-colour bug on its own) but that
  // entity type didn't exist before R14, which needs a declared DXF
  // version to be recognised, and a declared version turned out to
  // crash real AutoCAD on a file this minimal (see dxfWrap). POLYLINE
  // has no such requirement and gets an explicit colour (7, white)
  // instead of relying on an undefined layer default, so it's never
  // accidentally the same colour as anything else.
  return (mode === 'proposed') ? [] : dxfPolyline('LONG_SECTION', 7, samples.map(function(s){
    return [s.chainage.toFixed(4), s.elevation.toFixed(4)];
  }));
}

// Manually-set datum reference line, if enabled — Thom's own chosen
// RL (GradeLine never picks it for him), drawn as a plain horizontal
// LINE the full chainage width of the section on its own DATUM layer,
// labelled at both ends. The on-screen chart draws the same line (see
// drawProfile) but only when it happens to fall within the currently
// visible elevation range at whatever zoom Thom's on; a real datum is
// usually well below the ground so it's often out of view on screen —
// this export always includes it regardless, which is the point.
function buildDatumLines(lines: string[], samples: FilteredSample[], textHeight: number){
  var datumRL = datumRLValue();
  if (datumRL === null) return;
  var dChStart = samples[0].chainage, dChEnd = samples[samples.length-1].chainage;
  lines.push('0','LINE','8','DATUM',
    '10', dChStart.toFixed(4), '20', datumRL.toFixed(4), '30','0',
    '11', dChEnd.toFixed(4), '21', datumRL.toFixed(4), '31','0');
  var datumLabelText = 'DATUM RL ' + datumRL.toFixed(3);
  lines.push('0','TEXT','8','DATUM',
    '10', dChStart.toFixed(4), '20', (datumRL + textHeight*0.4).toFixed(4), '30','0',
    '40', textHeight.toFixed(4),
    '1', datumLabelText);
  lines.push('0','TEXT','8','DATUM',
    '10', Math.max(dChStart, dChEnd - datumLabelText.length*textHeight*0.65).toFixed(4), '20', (datumRL + textHeight*0.4).toFixed(4), '30','0',
    '40', textHeight.toFixed(4),
    '1', datumLabelText);
}

// Chainage lines at the start, end, and any major grade change — same
// tolerance and points as the on-screen markers, always true scale
// (chainage vs. real elevation) regardless of the panel's display mode.
//
// Chainage-value and grade-% labels used to be drawn here, next to
// the tick marks above the plotted section — removed since the CAD-
// style section table (see buildSectionTableLines) now carries the
// same Chainage/Grade values (and the Datum caption) as its only text
// block, per the "nothing outside the table" requirement. The tick
// lines themselves stay: the table's leader lines connect back up to
// them.
function buildChainageBreakLines(lines: string[], breaks: GradeBreak[], tickBottom: number, tickTop: number){
  for (var bi=0; bi<breaks.length; bi++){
    var bch = breaks[bi].chainage;
    lines.push('0','LINE','8','CHAINAGE_MARKS',
      '10', bch.toFixed(4), '20', tickBottom.toFixed(4), '30','0',
      '11', bch.toFixed(4), '21', tickTop.toFixed(4), '31','0');
  }
}

// Regular chainage/RL reading ladder, if enabled — independent of the
// grade-break tolerance above, on its own layer below the section so
// it never clashes with the grade-break marks above it.
function buildChainageIntervalLines(lines: string[], tickBottom: number, tickTop: number, textHeight: number){
  if (!$<HTMLInputElement>('chk-chainage-interval').checked) return;
  var chIntervalVal = parseFloat($<HTMLInputElement>('chainage-interval-value').value);
  if (isNaN(chIntervalVal) || chIntervalVal <= 0) return;
  var tierStep = textHeight * 2.0;
  var intervalMarks = computeIntervalMarks(chIntervalVal).filter(function(m){ return m.elevation !== null; });
  for (var ii=0; ii<intervalMarks.length; ii++){
    var im = intervalMarks[ii];
    lines.push('0','LINE','8','CHAINAGE_INTERVALS',
      '10', im.chainage.toFixed(4), '20', tickBottom.toFixed(4), '30','0',
      '11', im.chainage.toFixed(4), '21', tickTop.toFixed(4), '31','0');
  }
  // Chainage/RL value pairs, each row decluttered independently so
  // a fine interval doesn't stack its own values onto each other.
  var intervalChLabels = declutterLabels(
    intervalMarks.map(function(m){ return {x:m.chainage, text:m.chainage.toFixed(2)}; }),
    {charWidth: textHeight*0.72, pad: textHeight*1.1});
  var intervalChTiers = intervalChLabels.length ? Math.max.apply(null, intervalChLabels.map(function(l){ return l.tier; }))+1 : 0;
  for (var icl=0; icl<intervalChLabels.length; icl++){
    lines.push('0','TEXT','8','CHAINAGE_INTERVALS',
      '10', intervalChLabels[icl].x.toFixed(4), '20', (tickBottom - textHeight*2.2 - intervalChLabels[icl].tier*tierStep).toFixed(4), '30','0',
      '40', textHeight.toFixed(4),
      '1', intervalChLabels[icl].text);
  }
  var intervalRlBaseY = tickBottom - textHeight*2.2 - intervalChTiers*tierStep - textHeight*2.0;
  var intervalRlLabels = declutterLabels(
    intervalMarks.map(function(m){ return {x:m.chainage, text:'RL ' + m.elevation.toFixed(3)}; }),
    {charWidth: textHeight*0.72, pad: textHeight*1.1});
  for (var irl=0; irl<intervalRlLabels.length; irl++){
    lines.push('0','TEXT','8','CHAINAGE_INTERVALS',
      '10', intervalRlLabels[irl].x.toFixed(4), '20', (intervalRlBaseY - intervalRlLabels[irl].tier*tierStep).toFixed(4), '30','0',
      '40', textHeight.toFixed(4),
      '1', intervalRlLabels[irl].text);
  }
}

// Proposed driveway design, if enabled — its own layer, its own
// colour (blue, matching the on-screen line) so it's never mistaken
// for existing ground, and one continuous LWPOLYLINE through all its
// PVIs (was a separate LINE per leg) so it behaves as a single
// proper polyline object in AutoCAD, same as the existing-ground
// line above. Each PVI still gets its chainage/design-RL as TEXT,
// and each leg its grade (or mm rise/run for a vertical face or a
// fixed kerb/layback leg) — both decluttered so short legs (e.g. a
// layback template's) stack onto extra tiers instead of colliding.
function buildProposedDrivewayLines(lines: string[], mode: ExportMode, dwProfileForTable: DrivewayProfile | null, elMin: number, elMax: number, samples: FilteredSample[]){
  if (!(state.driveway.enabled && mode !== 'existing')) return;
  var dwProfile = dwProfileForTable;
  if (!dwProfile) return;
  var dwRules = drivewayRules();
  var dwTextH = Math.max((elMax-elMin)*0.045, 0.045);
  var dwTierStep = dwTextH * 2.0;
  var dwChecks = legGradeChecksFrom(dwProfile.legs, dwRules);

  // Same old-style POLYLINE form as the existing-ground line above.
  lines.push.apply(lines, dxfPolyline('PROPOSED_DRIVEWAY', 5, dwProfile.pvis.map(function(p){
    return [p.chainage.toFixed(4), p.rl.toFixed(4)];
  })));

  var dwLegLabelInputs: {x: number; rl: number; text: string}[] = [];
  for (var dl=0; dl<dwProfile.legs.length; dl++){
    var dleg = dwProfile.legs[dl];
    var dMidCh = (dleg.from.chainage + dleg.to.chainage) / 2;
    var dMidRl = (dleg.from.rl + dleg.to.rl) / 2;
    var dLegText: string;
    if (dleg.isVertical){
      var dRiseMm = Math.round((dleg.to.rl - dleg.from.rl) * 1000);
      dLegText = (dRiseMm>=0?'+':'') + dRiseMm + 'mm VERTICAL FACE';
    } else if (dleg.isTemplate){
      var dLegRiseMm = Math.round((dleg.to.rl - dleg.from.rl) * 1000);
      var dLegRunMm = Math.round(dleg.run * 1000);
      dLegText = (dLegRiseMm>=0?'+':'') + dLegRiseMm + 'mm/' + dLegRunMm + 'mm LAYBACK (NOT GRADED)';
    } else {
      dLegText = (dleg.grade>=0?'+':'') + dleg.grade.toFixed(2) + '%' + (dwChecks[dl].exceeds ? ' EXCEEDS LIMIT' : '');
    }
    dwLegLabelInputs.push({x:dMidCh, rl:dMidRl, text:dLegText});
  }
  var dwLegLabels = declutterLabels(dwLegLabelInputs, {charWidth: dwTextH*0.72, pad: dwTextH*1.1});
  for (var dll=0; dll<dwLegLabels.length; dll++){
    lines.push('0','TEXT','8','PROPOSED_DRIVEWAY',
      '10', dwLegLabels[dll].x.toFixed(4), '20', (dwLegLabelInputs[dll].rl - dwTextH*2.2 - dwLegLabels[dll].tier*dwTierStep).toFixed(4), '30','0',
      '40', dwTextH.toFixed(4),
      '1', dwLegLabels[dll].text);
  }

  var dwPviLabelInputs = dwProfile.pvis.map(function(dpv){
    return {x:dpv.chainage, rl:dpv.rl, text:'Ch ' + dpv.chainage.toFixed(2) + ' RL ' + dpv.rl.toFixed(3)};
  });
  var dwPviLabels = declutterLabels(dwPviLabelInputs, {charWidth: dwTextH*0.72, pad: dwTextH*1.1});
  for (var dpl=0; dpl<dwPviLabels.length; dpl++){
    lines.push('0','TEXT','8','PROPOSED_DRIVEWAY',
      '10', dwPviLabels[dpl].x.toFixed(4), '20', (dwPviLabelInputs[dpl].rl + dwTextH*2.0 + dwPviLabels[dpl].tier*dwTierStep).toFixed(4), '30','0',
      '40', dwTextH.toFixed(4),
      '1', dwPviLabels[dpl].text);
  }

  var dwComplianceRows = computeDrivewayCompliance(dwProfile);
  var dwFlagY = elMax + Math.max((elMax-elMin)*0.15, 0.3)*2.2;
  for (var dc=0;dc<dwComplianceRows.length;dc++){
    if (dwComplianceRows[dc].cls !== 'diag-warn') continue;
    lines.push('0','TEXT','8','PROPOSED_DRIVEWAY_CHECKS',
      '10', samples[0].chainage.toFixed(4), '20', (dwFlagY + dc*dwTextH*2.4).toFixed(4), '30','0',
      '40', dwTextH.toFixed(4),
      '1', dwComplianceRows[dc].text);
  }
}

// CAD-style section table, modelled on a reference table-layout block
// Thom supplied ("GradeLine Section layout.dxf"). Existing Level /
// Proposed Level / Chainage are per-station values, drawn as a proper
// bordered grid with one column per station and the value written
// vertically (rotated 90°) beside its column line, matching that
// reference exactly. Distance and Grade are per-segment values
// (between a pair of stations, not at one), so — as in the reference —
// they're unboxed captions stacked above the grid, each one centered
// between the two columns its segment spans. Datum is a single value
// for the whole section, so it gets one caption line above those.
// This is the only text drawn for grade-break chainage/grade anywhere
// in the export (see the removed CHAINAGE_MARKS/GRADE_LABELS text
// above) — "nothing outside the table", per the brief. Units are
// metres throughout, matching every other number in this export.
// Stations are the existing-ground grade breaks outside the driveway
// design's chainage span, plus the driveway's own design points
// across its span, so a leg is only ever described once, tagged
// EXISTING or NEW.
function buildSectionTableLines(lines: string[], breaks: GradeBreak[], dwProfileForTable: DrivewayProfile | null, elMin: number, elMax: number, tickBottom: number){
  var table = computeSectionTable(breaks, dwProfileForTable);
  if (table.stations.length < 2) return;
  var rowNames = ['EXISTING LEVEL','PROPOSED LEVEL','CHAINAGE'];
  var tblTextH = Math.max((elMax-elMin)*0.045, 0.045);
  var charW = tblTextH * 0.72;

  // Column positions are decoupled from literal chainage: a minimum
  // width is enforced between adjacent stations so a run of short
  // legs (a layback template, kerb face, etc.) doesn't squeeze
  // several columns together. Station values are rotated text now
  // (see pushVerticalValue below), so the minimum only needs to
  // clear a thin vertical glyph, not a full horizontal label's width
  // — columns can sit closer together than before. A station with
  // real room to spare keeps its true chainage exactly. A thin
  // leader line ties each column back to its true position on the
  // plotted section above, so the table stays traceable even where
  // it's been nudged apart.
  var minColWidth = tblTextH * 2.2;
  var realX = table.stations.map(function(s){ return s.chainage; });
  var adjX = layoutTableColumns(realX, minColWidth);
  var chToAdjX: Record<number, number> = {};
  for (var mi=0; mi<table.stations.length; mi++) chToAdjX[table.stations[mi].chainage] = adjX[mi];

  var firstAdj = adjX[0], lastAdj = adjX[adjX.length-1];
  var labelX = firstAdj - Math.max((lastAdj-firstAdj)*0.06, 1.5);
  var gridLeft = labelX - tblTextH*0.6;
  var gridRight = lastAdj + Math.max((lastAdj-firstAdj)*0.02, 0.3);

  // Row height must fit the longest value that will be rotated into
  // it — rotated text grows along the row instead of across it — so
  // it's sized once off the longest value in any of the three rows
  // and reused for all of them, keeping the grid evenly spaced.
  var maxValueChars = 0;
  for (var mv=0; mv<table.stations.length; mv++){
    var mvs = table.stations[mv];
    maxValueChars = Math.max(maxValueChars, mvs.existingRL.toFixed(3).length, mvs.chainage.toFixed(3).length);
    if (mvs.proposedRL !== null) maxValueChars = Math.max(maxValueChars, mvs.proposedRL.toFixed(3).length);
  }
  var rowH = Math.max(tblTextH*2.6, maxValueChars*charW + tblTextH*1.4);

  // Distance/Existing Grade/New Grade/Datum captions stack above the
  // grid, closest to it first: New Grade, then Existing Grade, then
  // Distance, then Datum topmost — Datum is least tied to any one
  // station so it sits furthest away, and is only included when a
  // datum RL is actually set.
  var captionRowH = tblTextH * 1.8;
  var captions = ['NEW GRADE', 'EXISTING GRADE', 'DISTANCE'];
  var datumRLForCaption = datumRLValue();
  if (datumRLForCaption !== null) captions.push('DATUM');
  function captionY(name: string){
    return tableTop + tblTextH*0.4 + captionRowH*captions.indexOf(name);
  }

  // The table's top sits exactly on the datum line when one is set —
  // Datum's caption reads just above it, the same nudge used for the
  // datum line's own label elsewhere in this export — rather than
  // being positioned relative to the plotted section's tick marks.
  // With no datum to anchor to, that tick-relative placement is kept
  // as the fallback.
  var tableTop = (datumRLForCaption !== null)
    ? datumRLForCaption - captionRowH*(captions.length-1)
    : tickBottom - tblTextH*1.5 - captionRowH*captions.length;
  var tableBottom = tableTop - rowH*rowNames.length;

  // Row header labels, inside the grid.
  for (var rn=0; rn<rowNames.length; rn++){
    lines.push('0','TEXT','8','SECTION_TABLE',
      '10', labelX.toFixed(4), '20', (tableTop - rowH*rn - rowH*0.65).toFixed(4), '30','0',
      '40', tblTextH.toFixed(4),
      '1', rowNames[rn]);
  }
  // Grid row-separator + top/bottom lines.
  for (var hr=0; hr<=rowNames.length; hr++){
    var hy = tableTop - rowH*hr;
    lines.push('0','LINE','8','SECTION_TABLE',
      '10', gridLeft.toFixed(4), '20', hy.toFixed(4), '30','0',
      '11', gridRight.toFixed(4), '21', hy.toFixed(4), '31','0');
  }
  // Grid outer vertical borders.
  lines.push('0','LINE','8','SECTION_TABLE',
    '10', gridLeft.toFixed(4), '20', tableTop.toFixed(4), '30','0',
    '11', gridLeft.toFixed(4), '21', tableBottom.toFixed(4), '31','0');
  lines.push('0','LINE','8','SECTION_TABLE',
    '10', gridRight.toFixed(4), '20', tableTop.toFixed(4), '30','0',
    '11', gridRight.toFixed(4), '21', tableBottom.toFixed(4), '31','0');

  // Station value, rotated 90° to read bottom-to-top beside its
  // column line: TEXT rotation (group 50) is a base DXF field that's
  // existed since long before $ACADVER mattered, so this adds no new
  // entity-compatibility risk. The insertion point is nudged by half
  // a text-height so the (unrotated, default-justified) glyph body
  // ends up roughly centered on the line rather than hanging entirely
  // to one side of it, and offset vertically so the string centers
  // within its row.
  function pushVerticalValue(x: number, rowIndex: number, text: string){
    var rowTop = tableTop - rowH*rowIndex, rowBottom = rowTop - rowH;
    var rowMid = (rowTop + rowBottom) / 2;
    var textLen = String(text).length;
    lines.push('0','TEXT','8','SECTION_TABLE',
      '10', (x + tblTextH*0.5).toFixed(4), '20', (rowMid - textLen*charW/2).toFixed(4), '30','0',
      '40', tblTextH.toFixed(4), '50','90',
      '1', String(text));
  }
  for (var st=0; st<table.stations.length; st++){
    var stn = table.stations[st];
    var scx = adjX[st];
    // Leader from the station's true chainage (at the tick line
    // above) down to its possibly-nudged column position — a
    // straight vertical when unchanged, a short dog-leg when
    // compressed for room — then the column divider itself, given
    // its own colour (8, grey) so it reads as distinct from the
    // grid's other lines even though it's solid rather than the
    // dashed centerline the reference uses (a dashed linetype needs
    // a new LTYPE table entry — this export deliberately has no
    // TABLES section at all; see Design decisions).
    lines.push('0','LINE','8','SECTION_TABLE',
      '10', stn.chainage.toFixed(4), '20', tickBottom.toFixed(4), '30','0',
      '11', scx.toFixed(4), '21', tableTop.toFixed(4), '31','0');
    lines.push('0','LINE','8','SECTION_TABLE','62','8',
      '10', scx.toFixed(4), '20', tableTop.toFixed(4), '30','0',
      '11', scx.toFixed(4), '21', tableBottom.toFixed(4), '31','0');

    pushVerticalValue(scx, 0, stn.existingRL.toFixed(3));
    if (stn.proposedRL !== null) pushVerticalValue(scx, 1, stn.proposedRL.toFixed(3));
    pushVerticalValue(scx, 2, stn.chainage.toFixed(3));
  }

  // Distance/Existing Grade/New Grade captions: per-segment, so
  // centered between the pair of columns each leg spans rather than
  // aligned to either one, and decluttered independently so tightly-
  // spaced legs stack onto extra tiers instead of colliding. Existing
  // grade is drawn for every leg; new grade only for a leg that
  // actually has a design RL at both ends (an existing-only leg just
  // leaves that row blank there, same as an existing-only station
  // leaves Proposed Level blank).
  var distLabelInputs: DeclutterLabelInput[] = [], existGradeLabelInputs: DeclutterLabelInput[] = [], newGradeLabelInputs: DeclutterLabelInput[] = [];
  for (var lg=0; lg<table.legs.length; lg++){
    var tleg = table.legs[lg];
    var midCh = (chToAdjX[tleg.from.chainage] + chToAdjX[tleg.to.chainage]) / 2;
    distLabelInputs.push({x:midCh, text:tleg.run.toFixed(3)});
    existGradeLabelInputs.push({x:midCh, text:(tleg.gradeExisting>=0?'+':'') + tleg.gradeExisting.toFixed(2) + '%'});
    if (tleg.gradeNew !== null){
      newGradeLabelInputs.push({x:midCh, text:(tleg.gradeNew>=0?'+':'') + tleg.gradeNew.toFixed(2) + '%'});
    }
  }
  var distLabels = declutterLabels(distLabelInputs, {charWidth: charW, pad: tblTextH*1.1});
  var existGradeLabels = declutterLabels(existGradeLabelInputs, {charWidth: charW, pad: tblTextH*1.1});
  var newGradeLabels = declutterLabels(newGradeLabelInputs, {charWidth: charW, pad: tblTextH*1.1});
  for (var dlx=0; dlx<distLabels.length; dlx++){
    lines.push('0','TEXT','8','SECTION_TABLE',
      '10', distLabels[dlx].x.toFixed(4), '20', (captionY('DISTANCE') + distLabels[dlx].tier*captionRowH).toFixed(4), '30','0',
      '40', tblTextH.toFixed(4), '1', distLabels[dlx].text);
  }
  for (var egx=0; egx<existGradeLabels.length; egx++){
    lines.push('0','TEXT','8','SECTION_TABLE',
      '10', existGradeLabels[egx].x.toFixed(4), '20', (captionY('EXISTING GRADE') + existGradeLabels[egx].tier*captionRowH).toFixed(4), '30','0',
      '40', tblTextH.toFixed(4), '1', existGradeLabels[egx].text);
  }
  for (var ngx=0; ngx<newGradeLabels.length; ngx++){
    lines.push('0','TEXT','8','SECTION_TABLE',
      '10', newGradeLabels[ngx].x.toFixed(4), '20', (captionY('NEW GRADE') + newGradeLabels[ngx].tier*captionRowH).toFixed(4), '30','0',
      '40', tblTextH.toFixed(4), '1', newGradeLabels[ngx].text);
  }
  // Row-header captions for the unboxed rows, left-aligned under the
  // same column as the grid's own row headers.
  lines.push('0','TEXT','8','SECTION_TABLE',
    '10', labelX.toFixed(4), '20', captionY('DISTANCE').toFixed(4), '30','0',
    '40', tblTextH.toFixed(4), '1', 'DISTANCE');
  lines.push('0','TEXT','8','SECTION_TABLE',
    '10', labelX.toFixed(4), '20', captionY('EXISTING GRADE').toFixed(4), '30','0',
    '40', tblTextH.toFixed(4), '1', 'EXISTING GRADE');
  lines.push('0','TEXT','8','SECTION_TABLE',
    '10', labelX.toFixed(4), '20', captionY('NEW GRADE').toFixed(4), '30','0',
    '40', tblTextH.toFixed(4), '1', 'NEW GRADE');

  // Datum caption — one line, since it's a single constant value for
  // the whole section rather than a per-station or per-segment
  // quantity. Always reflects Thom's own entered datum RL, never a
  // placeholder.
  if (datumRLForCaption !== null){
    lines.push('0','TEXT','8','SECTION_TABLE',
      '10', labelX.toFixed(4), '20', captionY('DATUM').toFixed(4), '30','0',
      '40', tblTextH.toFixed(4), '1', 'DATUM ' + datumRLForCaption.toFixed(2));
  }
}

// mode: 'existing' | 'proposed' | 'both' — controls which plotted
// line(s) this export includes (existing ground, the driveway design,
// or both). The CAD-style section table always shows the full
// Existing/Proposed/Distance/Grade comparison regardless of mode —
// only the plotted polyline(s) and driveway labels/compliance flags
// are affected — since the table's numbers are useful reference
// whichever sheet this becomes part of.
export function exportSectionDXF(mode?: ExportMode){
  mode = mode || 'both';
  if (!profileData) return;
  var samples = profileData.samples.filter(function(s): s is FilteredSample { return s.elevation!==null; });
  if (samples.length < 2) return;

  var lines = buildExistingGroundLines(mode, samples);

  var breakTolerance = parseFloat($<HTMLInputElement>('grade-break-tolerance').value);
  if (isNaN(breakTolerance) || breakTolerance <= 0) breakTolerance = 0.05;
  var breaks = computeGradeBreaks(samples, breakTolerance);

  var elMin=Infinity, elMax=-Infinity;
  for (var ei=0; ei<samples.length; ei++){
    if (samples[ei].elevation<elMin) elMin=samples[ei].elevation;
    if (samples[ei].elevation>elMax) elMax=samples[ei].elevation;
  }
  var elMargin = Math.max((elMax-elMin)*0.15, 0.3);
  var tickTop = elMax + elMargin, tickBottom = elMin - elMargin;
  var textHeight = Math.max((elMax-elMin)*0.05, 0.05);

  buildDatumLines(lines, samples, textHeight);
  buildChainageBreakLines(lines, breaks, tickBottom, tickTop);
  buildChainageIntervalLines(lines, tickBottom, tickTop, textHeight);

  var dwProfileForTable = state.driveway.enabled ? computeDrivewayProfile() : null;
  buildProposedDrivewayLines(lines, mode, dwProfileForTable, elMin, elMax, samples);

  buildSectionTableLines(lines, breaks, dwProfileForTable, elMin, elMax, tickBottom);

  // "Alignment N Existing/Proposed/Both" — whichever button was used.
  var fileBase = activeAlignmentFileName(mode);
  saveDXF(fileBase, dxfWrap(lines));
}

// ------------------------------------------------------------
// Crossfall DXF export (PLAN.md Appendix B item 3, 2026-09-26) — the
// crossfall view previously had no dedicated export at all. Mirrors
// drawCrossfallView's own on-screen 3-panel layout (Alignment A / B's
// existing+design profile, then the crossfall-vs-chainage line) and
// respects whichever comparison method (matching-chainage or
// perpendicular-projection) is currently selected, same as the screen.
// Each panel is true to scale (1 DXF unit = 1 real metre, same
// convention as every other export here — never the on-screen chart's
// separate mm-labelled axis for the crossfall panel specifically), and
// vertically offset from the one above it by a gap at least as tall as
// whichever of the two panels' own real elevation span is larger, so
// two alignments at very different real-world RLs (the normal case —
// they're different physical locations) never visually overlap. Reuses
// the same four DXF primitives every export here already uses
// (dxfWrap, dxfPolyline, plain LINE/TEXT, saveDXF) — no new DXF-writing
// primitives needed, matching the standing guardrail against
// reintroducing modern/structured entity types (see CLAUDE.md → Design
// decisions).
// ------------------------------------------------------------

// Splits a chainage-sampled line into contiguous segments, breaking
// wherever the ground/design callback returns no data — same
// discontinuous-line behaviour drawCrossfallView's own canvas drawing
// has (a null sample resets `started`), rather than drawing a straight
// line across a gap that doesn't really exist on the ground.
function sampleCrossfallLine(rangeEnd: number, step: number, fn: GroundRLAt): {chainage: number; value: number}[][] {
  var segments: {chainage: number; value: number}[][] = [];
  var current: {chainage: number; value: number}[] = [];
  var n = Math.max(2, Math.ceil(rangeEnd/step));
  for (var i=0; i<=n; i++){
    var ch = Math.min(rangeEnd, i*step);
    var v = fn(ch);
    if (v === null || v === undefined){
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push({chainage: ch, value: v});
  }
  if (current.length) segments.push(current);
  return segments;
}

function crossfallLineDxf(layer: string, color: number, segments: {chainage: number; value: number}[][], yOffset: number): string[] {
  var lines: string[] = [];
  for (var s=0; s<segments.length; s++){
    if (segments[s].length < 2) continue;
    lines.push.apply(lines, dxfPolyline(layer, color, segments[s].map(function(p){
      return [p.chainage.toFixed(4), (p.value+yOffset).toFixed(4)] as [string, string];
    })));
  }
  return lines;
}

function segmentsRange(segments: {chainage: number; value: number}[][]): {min: number; max: number} | null {
  var min = Infinity, max = -Infinity;
  for (var s=0; s<segments.length; s++){
    for (var p=0; p<segments[s].length; p++){
      if (segments[s][p].value < min) min = segments[s][p].value;
      if (segments[s][p].value > max) max = segments[s][p].value;
    }
  }
  return min===Infinity ? null : {min: min, max: max};
}

// Chainage/RL-A/RL-B/Crossfall(mm)/Cross-slope(%) table, laid out the
// same way buildSectionTableLines' grid is (rotated values beside each
// column line, layoutTableColumns decoupling column position from
// literal chainage) but simpler: computeCrossfallTableFrom's own
// stations are already evenly spaced by index, so — unlike the
// driveway table's user-editable PVIs, which can genuinely clump —
// nudging is not expected to matter here, but layoutTableColumns is
// still used for consistency/safety rather than assuming it never will.
function buildCrossfallTableLines(lines: string[], table: CrossfallTable, gridTop: number, textHeight: number){
  if (table.rows.length < 2) return;
  var rowNames = ['CHAINAGE', 'RL A', 'RL B', 'CROSSFALL (mm)', 'CROSS-SLOPE (%)'];
  var charW = textHeight*0.72;
  var minColWidth = textHeight*2.2;
  var realX = table.rows.map(function(r){ return r.chainage; });
  var adjX = layoutTableColumns(realX, minColWidth);
  var firstAdj = adjX[0], lastAdj = adjX[adjX.length-1];
  var labelX = firstAdj - Math.max((lastAdj-firstAdj)*0.06, 1.5);
  var gridLeft = labelX - textHeight*0.6;
  var gridRight = lastAdj + Math.max((lastAdj-firstAdj)*0.02, 0.3);

  var maxValueChars = 0;
  for (var mv=0; mv<table.rows.length; mv++){
    var r = table.rows[mv];
    maxValueChars = Math.max(maxValueChars, r.chainage.toFixed(3).length, r.rlA.toFixed(3).length, r.rlB.toFixed(3).length,
      String(r.crossfallMm).length, r.crossfallPct===null ? 1 : r.crossfallPct.toFixed(1).length);
  }
  var rowH = Math.max(textHeight*2.6, maxValueChars*charW + textHeight*1.4);
  var tableTop = gridTop, tableBottom = tableTop - rowH*rowNames.length;

  for (var rn=0; rn<rowNames.length; rn++){
    lines.push('0','TEXT','8','XF_TABLE',
      '10', labelX.toFixed(4), '20', (tableTop - rowH*rn - rowH*0.65).toFixed(4), '30','0',
      '40', textHeight.toFixed(4), '1', rowNames[rn]);
  }
  for (var hr=0; hr<=rowNames.length; hr++){
    var hy = tableTop - rowH*hr;
    lines.push('0','LINE','8','XF_TABLE',
      '10', gridLeft.toFixed(4), '20', hy.toFixed(4), '30','0',
      '11', gridRight.toFixed(4), '21', hy.toFixed(4), '31','0');
  }
  lines.push('0','LINE','8','XF_TABLE',
    '10', gridLeft.toFixed(4), '20', tableTop.toFixed(4), '30','0',
    '11', gridLeft.toFixed(4), '21', tableBottom.toFixed(4), '31','0');
  lines.push('0','LINE','8','XF_TABLE',
    '10', gridRight.toFixed(4), '20', tableTop.toFixed(4), '30','0',
    '11', gridRight.toFixed(4), '21', tableBottom.toFixed(4), '31','0');

  function pushVerticalValue(x: number, rowIndex: number, text: string){
    var rowTop = tableTop - rowH*rowIndex, rowBottom = rowTop - rowH, rowMid = (rowTop+rowBottom)/2;
    var textLen = String(text).length;
    lines.push('0','TEXT','8','XF_TABLE',
      '10', (x + textHeight*0.5).toFixed(4), '20', (rowMid - textLen*charW/2).toFixed(4), '30','0',
      '40', textHeight.toFixed(4), '50','90', '1', text);
  }
  for (var st=0; st<table.rows.length; st++){
    var row = table.rows[st], scx = adjX[st];
    lines.push('0','LINE','8','XF_TABLE','62','8',
      '10', scx.toFixed(4), '20', tableTop.toFixed(4), '30','0',
      '11', scx.toFixed(4), '21', tableBottom.toFixed(4), '31','0');
    pushVerticalValue(scx, 0, row.chainage.toFixed(3));
    pushVerticalValue(scx, 1, row.rlA.toFixed(3));
    pushVerticalValue(scx, 2, row.rlB.toFixed(3));
    pushVerticalValue(scx, 3, (row.crossfallMm>=0?'+':'') + row.crossfallMm);
    pushVerticalValue(scx, 4, row.crossfallPct===null ? String.fromCharCode(8212) : ((row.crossfallPct>=0?'+':'') + row.crossfallPct.toFixed(1)));
  }
}

// mode: same three values as exportSectionDXF, applied per-alignment —
// 'existing' plots existing ground only on both A and B; 'proposed'
// plots each alignment's own driveway design only (wherever one's
// enabled — an alignment with no design turned on simply has nothing
// drawn for it in that mode, matching exportSectionDXF's own precedent
// of an empty plotted line rather than a fallback); 'both' plots
// existing+design together. The crossfall-vs-chainage panel and table
// always compare whichever line is actually "the design" on each side
// (design where enabled, existing ground otherwise) regardless of mode
// — same "the numbers are useful reference whichever sheet this becomes
// part of" reasoning exportSectionDXF's own table already uses.
export function exportCrossfallDXF(mode?: ExportMode){
  mode = mode || 'both';
  var aligns = state.rawAlignments || [];
  var idxA = state.crossfall.alignA, idxB = state.crossfall.alignB;
  if (aligns.length < 2 || !aligns[idxA] || !aligns[idxB] || idxA === idxB) return;
  var vertsA = centeredVertsForAlignment(idxA), vertsB = centeredVertsForAlignment(idxB);
  if (!vertsA || !vertsB) return;
  var cumA = cumulativeChainages(vertsA), cumB = cumulativeChainages(vertsB);
  var totalA = cumA[cumA.length-1], totalB = cumB[cumB.length-1];
  if (!(totalA > 0) || !(totalB > 0)) return;

  var dwA = drivewayStateFor(idxA), dwB = drivewayStateFor(idxB);
  var profA = dwA.enabled ? computeDrivewayProfileForPvis(dwA.pvis) : null;
  var profB = dwB.enabled ? computeDrivewayProfileForPvis(dwB.pvis) : null;

  var groundOnlyARaw = function(ch: number){ return existingElevationAtChainageForVerts(vertsA, ch); };
  var groundOnlyBRaw = function(ch: number){ return existingElevationAtChainageForVerts(vertsB, ch); };
  var designOrGroundARaw = function(ch: number){ return driveGroundRLAtForVerts(profA, vertsA, ch); };
  var designOrGroundBRaw = function(ch: number){ return driveGroundRLAtForVerts(profB, vertsB, ch); };

  // Same perpendicular-projection support as drawCrossfallView — see
  // that function's own comment for the full reasoning; kept in step
  // with it deliberately rather than sharing one implementation, same
  // as exportSectionDXF/drawProfile's own long-standing precedent of
  // each doing its own setup rather than a shared "model" object.
  var perpendicular = state.crossfall.projectionMode === 'perpendicular';
  function projectAtoB(chA: number): number {
    return chainageSquareAcross(vertsA, cumA, Math.max(0, Math.min(chA, totalA)), vertsB, cumB).chainage;
  }
  var groundOnlyB = perpendicular ? function(chA: number){ return groundOnlyBRaw(projectAtoB(chA)); } : groundOnlyBRaw;
  var designOrGroundB = perpendicular ? function(chA: number){ return designOrGroundBRaw(projectAtoB(chA)); } : designOrGroundBRaw;

  var rangeEnd = perpendicular ? totalA : Math.min(totalA, totalB);
  if (!(rangeEnd > 0)) return;
  var step = Math.max(0.05, rangeEnd/400);

  var series = perpendicular
    ? computeCrossfallSeriesPerpendicular(vertsA, cumA, vertsB, cumB, designOrGroundARaw, designOrGroundBRaw, 0, rangeEnd, step)
    : computeCrossfallSeriesFrom(designOrGroundARaw, designOrGroundB, 0, rangeEnd, step,
        function(ch: number){ return alignmentSeparationAt(vertsA, cumA, vertsB, cumB, ch); });
  if (!series.length) return;

  var lines: string[] = [];
  // Fixed rather than data-driven (unlike exportSectionDXF's own
  // elevation-span-relative textHeight) — this view's own elevation
  // spans are typically only centimetres (a driveway's crossfall),
  // where a proportional height would shrink to illegibility.
  var textHeight = 0.12;

  // Panel A keeps its own true, unmodified RLs (same as
  // exportSectionDXF's single line) — only B and the crossfall panel
  // below get pushed down to clear it.
  var aGroundSeg = (mode !== 'proposed') ? sampleCrossfallLine(rangeEnd, step, groundOnlyARaw) : [];
  var aDesignSeg = (mode !== 'existing' && profA) ? sampleCrossfallLine(rangeEnd, step, designOrGroundARaw) : [];
  lines.push.apply(lines, crossfallLineDxf('XF_A_EXISTING', 7, aGroundSeg, 0));
  lines.push.apply(lines, crossfallLineDxf('XF_A_PROPOSED', 5, aDesignSeg, 0));
  var aRange = segmentsRange(aGroundSeg.concat(aDesignSeg)) || {min: 0, max: 0};

  // Panel B is pushed down by a gap at least as tall as A's own true
  // vertical span (floor 2m) so the two panels can never visually
  // overlap regardless of how the two alignments' real RLs compare —
  // they're different physical locations, so there's no reason to
  // expect their elevations to sit anywhere near each other.
  var bGroundSeg = (mode !== 'proposed') ? sampleCrossfallLine(rangeEnd, step, groundOnlyB) : [];
  var bDesignSeg = (mode !== 'existing' && profB) ? sampleCrossfallLine(rangeEnd, step, designOrGroundB) : [];
  var bRangeRaw = segmentsRange(bGroundSeg.concat(bDesignSeg)) || {min: 0, max: 0};
  var gapAB = Math.max(2.0, aRange.max - aRange.min);
  var offsetB = aRange.min - gapAB - bRangeRaw.max;
  lines.push.apply(lines, crossfallLineDxf('XF_B_EXISTING', 7, bGroundSeg, offsetB));
  lines.push.apply(lines, crossfallLineDxf('XF_B_PROPOSED', 5, bDesignSeg, offsetB));
  var bRange = {min: bRangeRaw.min+offsetB, max: bRangeRaw.max+offsetB};

  // Crossfall panel — plotted in real metres (this export's own
  // convention throughout, unlike the on-screen chart's separate mm-
  // labelled axis for this one panel), pushed down below B the same way.
  var cfSeg = [series.map(function(p){ return {chainage: p.chainage, value: p.crossfall}; })];
  var cfRangeRaw = segmentsRange(cfSeg) || {min: 0, max: 0};
  var gapBC = Math.max(1.0, bRange.max - bRange.min);
  var offsetC = bRange.min - gapBC - cfRangeRaw.max;
  lines.push.apply(lines, crossfallLineDxf('XF_CROSSFALL', 2, cfSeg, offsetC));
  // Zero-crossfall reference line, same convention as the on-screen panel.
  lines.push('0','LINE','8','XF_CROSSFALL',
    '10','0','20', offsetC.toFixed(4), '30','0',
    '11', rangeEnd.toFixed(4), '21', offsetC.toFixed(4), '31','0');
  var cfRange = {min: cfRangeRaw.min+offsetC, max: cfRangeRaw.max+offsetC};

  // Panel labels — same "existing ground (grey) / design (blue)"
  // legend the on-screen panels caption themselves with, plus which
  // comparison method produced the crossfall panel below.
  lines.push('0','TEXT','8','XF_LABELS',
    '10','0','20', (aRange.max + textHeight*1.5).toFixed(4), '30','0',
    '40', textHeight.toFixed(4), '1', dxfAsciiText(aligns[idxA].label + ' - existing ground' + (aDesignSeg.length ? ' / design' : '')));
  lines.push('0','TEXT','8','XF_LABELS',
    '10','0','20', (bRange.max + textHeight*1.5).toFixed(4), '30','0',
    '40', textHeight.toFixed(4), '1', dxfAsciiText(aligns[idxB].label + ' - existing ground' + (bDesignSeg.length ? ' / design' : '')));
  lines.push('0','TEXT','8','XF_LABELS',
    '10','0','20', (cfRange.max + textHeight*1.5).toFixed(4), '30','0',
    '40', textHeight.toFixed(4), '1', 'Crossfall (B - A), metres - ' + (perpendicular ? 'perpendicular projection' : 'matching chainage'));

  var table = computeCrossfallTableFrom(series, 20);
  var gapTable = Math.max(1.0, cfRange.max - cfRange.min);
  buildCrossfallTableLines(lines, table, cfRange.min - gapTable, textHeight);

  var fileBase = 'crossfall' + (mode === 'both' ? '' : '-' + mode);
  saveDXF(fileBase, dxfWrap(lines));
}

// ============================================================
// PDF export — captures exactly what's on screen right now (3D,
// existing terrain, driveway design, or both panes in split view) as
// one or two PNG screenshots, then writes a real PDF file straight to
// disk: no print dialog, no bundled PDF library. The whole PDF byte
// format (header, Catalog/Pages/Page objects, Image XObjects, plain
// Helvetica text, xref table, trailer) is hand-assembled here, same
// spirit as makeZip() above. The only non-trivial part — each
// screenshot's own PNG compression — is never re-implemented by hand:
// the browser's native CompressionStream/DecompressionStream do the
// (de)compression, and PNG's own per-scanline predictor filtering is
// reversed with a small, well-known fixed algorithm (see
// decodePngForPdf) to get to raw pixel bytes, which are then
// re-deflated straight into the PDF's own Image XObject stream.
//
// A side effect: because this never calls window.print()/window.open(),
// it also works from inside the hosted Artifact's sandboxed iframe,
// where the print-dialog flow (printing.js) was permanently blocked
// (see Design decisions in CLAUDE.md). That old flow is kept only as a
// fallback for a browser without the Compression Streams API.
// ============================================================

export function pdfCompressionAvailable(){
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  var reader = stream.getReader();
  var chunks = []; var total = 0;
  for (;;){
    var r = await reader.read();
    if (r.done) break;
    chunks.push(r.value); total += r.value.length;
  }
  var out = new Uint8Array(total), pos = 0;
  for (var i=0;i<chunks.length;i++){ out.set(chunks[i], pos); pos += chunks[i].length; }
  return out;
}

async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  var ds = new DecompressionStream('deflate');
  var writer = ds.writable.getWriter();
  writer.write(bytes as BufferSource); writer.close();
  return streamToBytes(ds.readable);
}

async function deflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  var cs = new CompressionStream('deflate');
  var writer = cs.writable.getWriter();
  writer.write(bytes as BufferSource); writer.close();
  return streamToBytes(cs.readable);
}

function paethPredictor(a: number, b: number, c: number): number {
  var p = a + b - c;
  var pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
  if (pa<=pb && pa<=pc) return a;
  if (pb<=pc) return b;
  return c;
}

// Reverses PNG's per-scanline predictor filtering (spec section 9),
// the one part of PNG decoding that isn't just "inflate the bytes" —
// recovers raw interleaved pixel bytes ready to feed straight into a
// PDF Image XObject stream. Only handles 8-bit-depth, non-interlaced
// input, which is the only shape a browser's own
// canvas.toDataURL('image/png') ever produces — the only source this
// ever decodes.
function unfilterPngScanlines(filtered: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  var stride = width * bpp;
  var out = new Uint8Array(height * stride);
  var pos = 0;
  for (var y=0; y<height; y++){
    var filterType = filtered[pos++];
    var rowStart = y*stride;
    for (var x=0; x<stride; x++){
      var raw = filtered[pos++];
      var a = x>=bpp ? out[rowStart+x-bpp] : 0;
      var b = y>0 ? out[rowStart-stride+x] : 0;
      var c = (x>=bpp && y>0) ? out[rowStart-stride+x-bpp] : 0;
      var val;
      switch (filterType){
        case 0: val = raw; break;
        case 1: val = raw + a; break;
        case 2: val = raw + b; break;
        case 3: val = raw + ((a+b)>>1); break;
        case 4: val = raw + paethPredictor(a,b,c); break;
        default: throw new Error('unsupported PNG filter type ' + filterType);
      }
      out[rowStart+x] = val & 0xFF;
    }
  }
  return out;
}

// Parses a PNG byte stream down to raw pixel bytes for direct PDF
// embedding. Only supports what canvas.toDataURL('image/png') ever
// produces (8-bit depth, colour type RGB or RGBA, no interlacing) —
// throws on anything else, which the caller catches and falls back to
// the print-dialog flow for.
export async function decodePngForPdf(pngBytes: Uint8Array): Promise<DecodedPngImage> {
  var sig = [137,80,78,71,13,10,26,10];
  for (var s=0;s<8;s++){ if (pngBytes[s] !== sig[s]) throw new Error('not a PNG'); }
  var pos = 8;
  var width=0, height=0, bitDepth=0, colorType=0, interlace=0;
  var idatChunks: Uint8Array[] = [];
  var view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  while (pos < pngBytes.length){
    var len = view.getUint32(pos); pos += 4;
    var type = String.fromCharCode(pngBytes[pos], pngBytes[pos+1], pngBytes[pos+2], pngBytes[pos+3]); pos += 4;
    var data = pngBytes.subarray(pos, pos+len); pos += len;
    pos += 4; // CRC — not verified: this is our own just-rendered screenshot, not untrusted input
    if (type === 'IHDR'){
      var hv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = hv.getUint32(0); height = hv.getUint32(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT'){
      idatChunks.push(data);
    } else if (type === 'IEND'){
      break;
    }
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)){
    throw new Error('unsupported PNG format for direct PDF embedding (depth ' + bitDepth + ', colour type ' + colorType + ', interlace ' + interlace + ')');
  }
  var idatTotal = 0;
  for (var ci=0; ci<idatChunks.length; ci++) idatTotal += idatChunks[ci].length;
  var idat = new Uint8Array(idatTotal); var ip = 0;
  for (var cj=0; cj<idatChunks.length; cj++){ idat.set(idatChunks[cj], ip); ip += idatChunks[cj].length; }

  var bpp = colorType === 6 ? 4 : 3;
  var filtered = await inflateZlib(idat);
  var raw = unfilterPngScanlines(filtered, width, height, bpp);

  if (bpp === 3) return {width:width, height:height, rgb:raw, alpha:null};

  // Split interleaved RGBA into separate RGB + alpha planes — a PDF
  // Image XObject's colour stream can't itself carry alpha; alpha
  // becomes a separate grayscale SMask image instead.
  var n = width*height;
  var rgb = new Uint8Array(n*3), alpha = new Uint8Array(n);
  for (var i=0;i<n;i++){
    rgb[i*3] = raw[i*4]; rgb[i*3+1] = raw[i*4+1]; rgb[i*3+2] = raw[i*4+2];
    alpha[i] = raw[i*4+3];
  }
  return {width:width, height:height, rgb:rgb, alpha:alpha};
}

function pdfEscapeText(str: unknown): string {
  // Range U+0080-U+FFFF (any non-ASCII codepoint), not a 2/3-character
  // set — the un-embedded base-14 Helvetica font used throughout this
  // PDF can't render anything outside Latin-1/ASCII, so this catches
  // em-dashes, curly quotes, etc. and swaps them for '?' rather than
  // emitting bytes the font has no glyph for.
  return String(str).replace(/[\u0080-￿]/g, '?').replace(/([\\()])/g, '\\$1');
}

function pdfTextWidth(text: unknown, fontSize: number, bold: boolean): number {
  return String(text).length * fontSize * (bold ? 0.56 : 0.5);
}

// Assembles one complete PDF file from decoded screenshot(s): a
// Catalog, a Pages tree, one Page (+ Image XObject, + SMask if that
// screenshot had alpha) per screenshot, two standard un-embedded
// Helvetica fonts, and plain text/vector content streams for a
// consistent header (brand + subtitle + date/alignment) and footer on
// every page. Byte offsets are tracked by hand while building, for
// the closing xref table the PDF format itself requires.
export async function buildSectionPdfBytes(pageImages: DecodedPngImage[], subtitle: string): Promise<Uint8Array> {
  var now = new Date();
  var dateStr = now.toLocaleDateString('en-AU', {year:'numeric', month:'short', day:'numeric'});
  var timeStr = now.toLocaleTimeString('en-AU', {hour:'2-digit', minute:'2-digit'});
  var alignLabel = currentAlignmentLabel();

  var PAGE_W = 842, PAGE_H = 595; // A4 landscape, in points
  var MARGIN = 36, HEADER_H = 66, FOOTER_H = 26;
  var ORANGE = '0.949 0.404 0.133';

  var enc = new TextEncoder();
  var chunks: Uint8Array[] = []; var offset = 0;
  function push(bytes: Uint8Array){ chunks.push(bytes); offset += bytes.length; }
  function pushAscii(str: string){ push(enc.encode(str)); }

  var objOffsets: number[] = [];
  function beginObj(id: number){ objOffsets[id] = offset; pushAscii(id + ' 0 obj\n'); }
  function endObj(){ pushAscii('endobj\n'); }

  var FONT_REG = 1, FONT_BOLD = 2, CATALOG = 3, PAGES = 4;
  var nextId = 5;
  var n = pageImages.length;
  var pageIds: number[] = [], contentIds: number[] = [], imageIds: number[] = [], smaskIds: (number | null)[] = [];
  for (var i=0;i<n;i++){
    pageIds.push(nextId++);
    contentIds.push(nextId++);
    imageIds.push(nextId++);
    smaskIds.push(pageImages[i].alpha ? nextId++ : null);
  }

  pushAscii('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // recommended binary-file marker comment

  beginObj(FONT_REG);
  pushAscii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n');
  endObj();

  beginObj(FONT_BOLD);
  pushAscii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\n');
  endObj();

  beginObj(CATALOG);
  pushAscii('<< /Type /Catalog /Pages ' + PAGES + ' 0 R >>\n');
  endObj();

  beginObj(PAGES);
  pushAscii('<< /Type /Pages /Kids [' + pageIds.map(function(id){ return id + ' 0 R'; }).join(' ') + '] /Count ' + n + ' >>\n');
  endObj();

  for (var p=0; p<n; p++){
    var img = pageImages[p];
    var caption = img.caption || '';

    var maxW = PAGE_W - MARGIN*2, maxH = PAGE_H - MARGIN*2 - HEADER_H - FOOTER_H;
    var scale = Math.min(maxW/img.width, maxH/img.height);
    var drawW = img.width*scale, drawH = img.height*scale;
    var drawX = MARGIN + (maxW-drawW)/2;
    var drawY = MARGIN + FOOTER_H + (maxH-drawH)/2;

    var smaskId = smaskIds[p];
    if (smaskId){
      var alphaDeflated = await deflateZlib(img.alpha);
      beginObj(smaskId);
      pushAscii('<< /Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height +
        ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ' + alphaDeflated.length + ' >>\nstream\n');
      push(alphaDeflated);
      pushAscii('\nendstream\n');
      endObj();
    }
    var rgbDeflated = await deflateZlib(img.rgb);
    beginObj(imageIds[p]);
    pushAscii('<< /Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' + rgbDeflated.length +
      (smaskId ? ' /SMask ' + smaskId + ' 0 R' : '') + ' >>\nstream\n');
    push(rgbDeflated);
    pushAscii('\nendstream\n');
    endObj();

    var titleY = PAGE_H - MARGIN - 16;
    var subtitleY = titleY - 16;
    var metaY1 = PAGE_H - MARGIN - 12;
    var metaY2 = metaY1 - 13;
    var accentY = PAGE_H - MARGIN - HEADER_H + 14;
    var footerY = MARGIN + FOOTER_H - 20;

    var ops = '';
    ops += 'q\n' + ORANGE + ' rg\n' + MARGIN + ' ' + accentY.toFixed(2) + ' ' + (PAGE_W - MARGIN*2) + ' 2.4 re\nf\nQ\n';
    ops += 'BT /F2 15 Tf ' + MARGIN + ' ' + titleY + ' Td (GradeLine) Tj ET\n';
    // Per-image caption (set only in split view, e.g. "3D surface")
    // takes priority since it's more specific to this particular page;
    // otherwise every page falls back to the shared subtitle so a
    // single-image export (the common case) still gets a description
    // line, not a bare "GradeLine" heading.
    var pageSubtitle = caption || subtitle;
    if (pageSubtitle){
      ops += 'BT /F1 10 Tf ' + MARGIN + ' ' + subtitleY + ' Td (' + pdfEscapeText(pageSubtitle) + ') Tj ET\n';
    }
    var metaRight1 = pdfEscapeText(dateStr + '   ' + timeStr);
    ops += 'BT /F1 9 Tf ' + (PAGE_W - MARGIN - pdfTextWidth(metaRight1, 9, false)).toFixed(2) + ' ' + metaY1 + ' Td (' + metaRight1 + ') Tj ET\n';
    if (alignLabel){
      var metaRight2 = pdfEscapeText(alignLabel);
      ops += 'BT /F2 9 Tf ' + (PAGE_W - MARGIN - pdfTextWidth(metaRight2, 9, true)).toFixed(2) + ' ' + metaY2 + ' Td (' + metaRight2 + ') Tj ET\n';
    }
    ops += 'q\n' + drawW.toFixed(2) + ' 0 0 ' + drawH.toFixed(2) + ' ' + drawX.toFixed(2) + ' ' + drawY.toFixed(2) + ' cm /Im0 Do Q\n';
    var footerLeft = pdfEscapeText('Generated with GradeLine' + (n>1 ? ' - page ' + (p+1) + ' of ' + n : ''));
    ops += 'BT /F1 8 Tf ' + MARGIN + ' ' + footerY + ' Td (' + footerLeft + ') Tj ET\n';
    var footerRight = pdfEscapeText(dateStr);
    ops += 'BT /F1 8 Tf ' + (PAGE_W - MARGIN - pdfTextWidth(footerRight, 8, false)).toFixed(2) + ' ' + footerY + ' Td (' + footerRight + ') Tj ET\n';

    var contentBytes = enc.encode(ops);
    beginObj(contentIds[p]);
    pushAscii('<< /Length ' + contentBytes.length + ' >>\nstream\n');
    push(contentBytes);
    pushAscii('\nendstream\n');
    endObj();

    beginObj(pageIds[p]);
    pushAscii('<< /Type /Page /Parent ' + PAGES + ' 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + ']' +
      ' /Resources << /Font << /F1 ' + FONT_REG + ' 0 R /F2 ' + FONT_BOLD + ' 0 R >> /XObject << /Im0 ' + imageIds[p] + ' 0 R >> >>' +
      ' /Contents ' + contentIds[p] + ' 0 R >>\n');
    endObj();
  }

  var maxId = nextId - 1;
  var xrefOffset = offset;
  pushAscii('xref\n0 ' + (maxId+1) + '\n0000000000 65535 f \n');
  for (var id=1; id<=maxId; id++){
    var off = objOffsets[id] || 0;
    pushAscii(String(off).padStart(10,'0') + ' 00000 n \n');
  }
  pushAscii('trailer\n<< /Size ' + (maxId+1) + ' /Root ' + CATALOG + ' 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF');

  var total = 0;
  for (var k=0;k<chunks.length;k++) total += chunks[k].length;
  var out = new Uint8Array(total), wp = 0;
  for (var m=0;m<chunks.length;m++){ out.set(chunks[m], wp); wp += chunks[m].length; }
  return out;
}
