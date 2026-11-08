// Printing / direct PDF export orchestration — PLAN.md Stage 2
// checkpoint 3 port, extracted verbatim from main.js.
import { $, escapeHtml } from './dom.ts';
import { state, currentAlignmentLabel, activeAlignmentFileName } from './state.ts';
import { three, requestRender } from './view3d.ts';
import { profileData } from './longsection.ts';
import { drawProfile } from './rendering.ts';
import { pdfCompressionAvailable, decodePngForPdf, buildSectionPdfBytes, saveFile } from './export.ts';
import { is3DVisible, isProfileVisible } from './viewstate.ts';

interface PageImage { dataUrl: string; caption: string | null; }

// Same artwork as the favicon (long-section ground line + datum
// marker) — reused here so the sidebar header and the print/PDF
// output both carry the mark without embedding it twice by hand.
var LOGO_DATA_URI = 'data:image/png;base64,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';

function openPrintWindow(bodyHtml: string, title: string){
  var w: Window | null;
  try { w = window.open('', '_blank'); } catch (e){ w = null; }
  if (!w){
    alert('Your browser blocked the print tab — please allow pop-ups for this page and try again.');
    return;
  }
  var doc = '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>' +
    '<style>' +
    '*{box-sizing:border-box;}' +
    'body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;background:#fff;color:#1a1a1a;margin:0;padding:34px 38px;}' +
    '.gl-head{display:flex;justify-content:space-between;align-items:center;padding-bottom:16px;}' +
    '.gl-brand{display:flex;align-items:center;gap:11px;}' +
    '.gl-logo{width:36px;height:36px;border-radius:8px;display:block;flex-shrink:0;}' +
    '.gl-name{font-size:21px;font-weight:800;letter-spacing:0.2px;color:#111;line-height:1.15;}' +
    '.gl-sub{font-size:12.5px;color:#666;margin-top:3px;}' +
    '.gl-meta{text-align:right;font-size:11px;color:#777;line-height:1.6;}' +
    '.gl-meta b{color:#222;font-weight:600;}' +
    '.gl-accent{height:3px;background:#F26722;border-radius:2px;margin-bottom:26px;}' +
    '.gl-section{margin-bottom:24px;}' +
    '.gl-section:last-of-type{margin-bottom:0;}' +
    '.gl-cap{font-size:11px;font-weight:700;color:#F26722;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:9px;}' +
    '.gl-card{background:#0d0d0f;border-radius:11px;padding:12px;box-shadow:0 1px 6px rgba(0,0,0,0.16);}' +
    '.gl-card img{width:100%;display:block;border-radius:6px;}' +
    '.gl-footer{margin-top:26px;padding-top:12px;border-top:1px solid #e8e8e8;font-size:10px;color:#999;display:flex;justify-content:space-between;}' +
    '@media print { body{padding:16px 20px;} .gl-card{box-shadow:none;border:1px solid #222;} }' +
    '</style></head><body>' + bodyHtml + '</body></html>';
  w.document.open();
  w.document.write(doc);
  w.document.close();
  var printed = false;
  function doPrint(){
    if (printed) return;
    printed = true;
    try { w.focus(); w.print(); } catch (e){}
  }
  w.onload = doPrint;
  setTimeout(doPrint, 400);
}

function printBodyHtml(subtitle: string, images: PageImage[]): string {
  var now = new Date();
  var dateStr = now.toLocaleDateString('en-AU', {year:'numeric', month:'short', day:'numeric'});
  var timeStr = now.toLocaleTimeString('en-AU', {hour:'2-digit', minute:'2-digit'});
  var alignLabel = currentAlignmentLabel();
  var html = '<div class="gl-head">' +
    '<div class="gl-brand"><img class="gl-logo" alt="" src="' + LOGO_DATA_URI + '">' +
    '<div><div class="gl-name">GradeLine</div>' +
    '<div class="gl-sub">' + escapeHtml(subtitle) + '</div></div></div>' +
    '<div class="gl-meta">' + dateStr + ' &middot; ' + timeStr +
    (alignLabel ? '<br><b>' + escapeHtml(alignLabel) + '</b>' : '') + '</div>' +
    '</div><div class="gl-accent"></div>';
  for (var i=0;i<images.length;i++){
    html += '<div class="gl-section">';
    if (images[i].caption) html += '<div class="gl-cap">' + escapeHtml(images[i].caption) + '</div>';
    html += '<div class="gl-card"><img src="' + images[i].dataUrl + '"></div></div>';
  }
  html += '<div class="gl-footer"><span>Generated with GradeLine — existing-terrain tool</span><span>' + dateStr + '</span></div>';
  return html;
}

// Captures whatever is actually on screen right now — 3D, long
// section, or (in split view) both panes together — rather than
// switching views to grab something else. That's what makes this
// work correctly in split view instead of only ever printing one
// pane or the other.
export function printCurrentScreen(){
  var view = state.currentView;
  if (is3DVisible()){
    if (!state.points.length){ alert('Load a surface first.'); return; }
  }
  if (isProfileVisible()){
    if (!profileData){ alert('Load a surface and alignment first.'); return; }
  }
  var images: PageImage[] = [];
  if (is3DVisible()){
    three.renderer.render(three.scene, three.camera);
    images.push({dataUrl: three.renderer.domElement.toDataURL('image/png'), caption: view==='split' ? '3D surface' : null});
    requestRender(); // redraw with the orientation cube, which the capture above leaves out
  }
  if (isProfileVisible()){
    drawProfile();
    images.push({dataUrl: $<HTMLCanvasElement>('profile-canvas').toDataURL('image/png'), caption: view==='split' ? 'Existing terrain' : null});
  }
  if (!images.length){ alert('Load a surface first.'); return; }
  var subtitle = view === 'split' ? 'Split view — 3D surface & existing terrain'
    : view === 'profile' ? 'Existing terrain'
    : view === 'driveway' ? 'Driveway design'
    : view === 'crossfall' ? 'Crossfall comparison'
    : 'TIN surface — 3D view';

  if (!pdfCompressionAvailable()){
    // No Compression Streams API in this browser — fall back to the
    // print-dialog flow (needs "Save as PDF" as the destination).
    openPrintWindow(printBodyHtml(subtitle, images), 'GradeLine — ' + subtitle);
    return;
  }

  Promise.all(images.map(function(entry){
    var base64 = entry.dataUrl.slice(entry.dataUrl.indexOf(',')+1);
    var bin = atob(base64);
    var bytes = new Uint8Array(bin.length);
    for (var i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    return decodePngForPdf(bytes).then(function(decoded){
      decoded.caption = entry.caption;
      return decoded;
    });
  })).then(function(decoded){
    return buildSectionPdfBytes(decoded, subtitle);
  }).then(function(pdfBytes){
    // Long-section views save as "Alignment N Existing" (the existing-
    // terrain view, or a driveway/split view with no design showing) or
    // "Alignment N Both" (a driveway design is drawn over the ground).
    // The 3D-only view and crossfall (two alignments) keep their names.
    var designShown = (view === 'driveway' || view === 'split') && state.driveway.enabled && state.driveway.pvis.length >= 2;
    var pdfName = (view === 'profile' || view === 'driveway' || view === 'split')
      ? activeAlignmentFileName(designShown ? 'both' : 'existing') : 'gradeline-' + view;
    saveFile(pdfName + '.pdf', pdfBytes);
  }).catch(function(err){
    console.error('Direct PDF export failed, falling back to the print dialog:', err);
    openPrintWindow(printBodyHtml(subtitle, images), 'GradeLine — ' + subtitle);
  });
}
