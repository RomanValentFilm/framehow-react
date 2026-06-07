// PDF Import Adjustment Tool
// Shows PDF pages with draggable rectangles over detected images (green),
// text areas (blue), and label areas (red). User adjusts rectangles to
// correct the extraction, then re-extracts with the adjusted positions.

import * as pdfjsLib from 'pdfjs-dist';
import { showToast } from './modals';
import { testExtractPDF, getTextItems, matchLabel, matchText } from './pdf';
import type { TestFrame, ExtractedFrame, TextItem } from './pdf';
// @ts-ignore
import { createWorker } from 'tesseract.js';
import { COLORS, state, useStore, resetStoryboardState } from '../store/state';
import { getCurrentProject } from './currentProject';
import { updateFrameBadge } from './helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdjustRect {
  id: string;
  type: 'image' | 'text' | 'label';
  x: number; y: number; w: number; h: number; // relative to page (0–1)
  pageIdx: number;
  adjusted?: boolean; // true if user moved/resized this rect
}

interface PageData {
  pageNum: number;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  rects: AdjustRect[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _overlay: HTMLElement | null = null;
let _pages: PageData[] = [];
let _pdfDoc: any = null;
let _currentFile: File | null = null;
let _extractedFrames: TestFrame[] = [];
let _activeRect: AdjustRect | null = null;
let _dragHandle: string | null = null; // 'move' | 'nw' | 'ne' | 'sw' | 'se'
let _dragStartX = 0;
let _dragStartY = 0;
let _dragStartRect = { x: 0, y: 0, w: 0, h: 0 };

const RECT_COLORS = {
  image: 'rgba(0, 200, 80, 0.35)',
  text: 'rgba(60, 130, 255, 0.35)',
  label: 'rgba(255, 60, 60, 0.35)',
};
const RECT_BORDERS = {
  image: '#00c850',
  text: '#3c82ff',
  label: '#ff3c3c',
};

// ---------------------------------------------------------------------------
// Persist rect overlay per project + PDF filename (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'pdfAdjustRects_';

function storageKey(fileName: string, pid?: string): string {
  const id = pid ?? getCurrentProject().projectId ?? 'local';
  return `${STORAGE_PREFIX}${id}_${fileName}`;
}

function saveRectsForFile(): void {
  if (!_currentFile || _pages.length === 0) return;
  const cp = getCurrentProject();
  const key = storageKey(_currentFile.name);
  const data = _pages.map(p => ({
    pageNum: p.pageNum,
    rects: p.rects.map(r => ({ id: r.id, type: r.type, x: r.x, y: r.y, w: r.w, h: r.h, adjusted: r.adjusted })),
  }));
  try {
    localStorage.setItem(key, JSON.stringify(data));
    // If project now has an ID but data was previously under 'local', clean up old key
    if (cp.projectId) {
      const oldKey = storageKey(_currentFile.name, 'local');
      if (localStorage.getItem(oldKey)) localStorage.removeItem(oldKey);
    }
    console.log(`[pdfAdjust] Saved ${data.reduce((s, p) => s + p.rects.length, 0)} rects → "${key}"`);
  } catch { /* quota exceeded — silent */ }
}

function loadRectsForFile(fileName: string): { pageNum: number; rects: AdjustRect[] }[] | null {
  const cp = getCurrentProject();
  // Try project-specific key first
  let key = storageKey(fileName);
  let raw = localStorage.getItem(key);

  // Fallback: if project has an ID but no data, check 'local' (pre-save state)
  if (!raw && cp.projectId) {
    const localKey = storageKey(fileName, 'local');
    raw = localStorage.getItem(localKey);
    if (raw) {
      // Migrate: move from 'local' to project key
      localStorage.setItem(key, raw);
      localStorage.removeItem(localKey);
      console.log(`[pdfAdjust] Migrated rects from "local" → "${key}"`);
    }
  }

  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { pageNum: number; rects: any[] }[];
    if (!Array.isArray(data) || data.length === 0) return null;
    for (const page of data) {
      if (!Array.isArray(page.rects)) return null;
    }
    console.log(`[pdfAdjust] Restored ${data.reduce((s, p) => s + p.rects.length, 0)} rects for "${fileName}"`);
    return data;
  } catch {
    return null;
  }
}

/** Remove all saved rect data for a given project (call on project delete) */
export function clearRectsForProject(projectId: string): void {
  const prefix = `${STORAGE_PREFIX}${projectId}_`;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) toRemove.push(k);
  }
  for (const k of toRemove) localStorage.removeItem(k);
  if (toRemove.length > 0) console.log(`[pdfAdjust] Cleared ${toRemove.length} saved rect entries for project ${projectId}`);
}

// ---------------------------------------------------------------------------
// Live counter: image + number rects across all pages
// ---------------------------------------------------------------------------

function updateRectCounts(): void {
  const imageCount = _pages.reduce((sum, p) => sum + p.rects.filter(r => r.type === 'image').length, 0);
  const labelCount = _pages.reduce((sum, p) => sum + p.rects.filter(r => r.type === 'label').length, 0);
  const el = document.getElementById('pdfAdjustCounter');
  if (el) {
    el.innerHTML =
      `<span style="color:#00c850">${imageCount}</span> Image${imageCount !== 1 ? 's' : ''}` +
      `  ·  ` +
      `<span style="color:#ff3c3c">${labelCount}</span> Number${labelCount !== 1 ? 's' : ''}`;
  }
}

// ---------------------------------------------------------------------------
// Open the adjustment overlay
// ---------------------------------------------------------------------------

export function openPdfAdjust(): void {
  if (_overlay) return;

  const overlay = document.createElement('div');
  overlay.id = 'pdfAdjustOverlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:100000;background:#111;' +
    'display:flex;flex-direction:column;overflow:hidden;';

  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#1a1a1a;border-bottom:1px solid #333;flex-shrink:0;">
      <span style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;font-weight:600;color:#fff;">Adjust PDF Import</span>
      <span id="pdfAdjustCounter" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;color:#888;flex:1;text-align:center;"></span>
      <div style="display:flex;gap:8px;">
        <button id="pdfAdjustAddImage" style="padding:5px 12px;border-radius:6px;border:1px solid #00c850;background:transparent;color:#00c850;font-size:12px;cursor:pointer;">+ Image</button>
        <button id="pdfAdjustAddText" style="padding:5px 12px;border-radius:6px;border:1px solid #3c82ff;background:transparent;color:#3c82ff;font-size:12px;cursor:pointer;">+ Text</button>
        <button id="pdfAdjustAddLabel" style="padding:5px 12px;border-radius:6px;border:1px solid #ff3c3c;background:transparent;color:#ff3c3c;font-size:12px;cursor:pointer;">+ Number</button>
        <button id="pdfAdjustApply" style="padding:5px 16px;border-radius:6px;border:none;background:#c94432;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Apply</button>
        <button id="pdfAdjustClose" style="padding:5px 12px;border-radius:6px;border:1px solid #555;background:transparent;color:#ccc;font-size:12px;cursor:pointer;">Close</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:center;padding:12px;background:#1a1a1a;border-bottom:1px solid #333;flex-shrink:0;">
      <label style="display:flex;align-items:center;gap:8px;padding:8px 20px;border-radius:8px;border:2px dashed #555;cursor:pointer;color:#aaa;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
        <span id="pdfAdjustFileName">Select a PDF file</span>
        <input type="file" accept=".pdf" id="pdfAdjustFileInput" style="display:none;">
      </label>
    </div>
    <div style="display:flex;gap:8px;padding:8px 16px;background:#1a1a1a;flex-shrink:0;">
      <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#00c850;">◼ Image</span>
      <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#3c82ff;">◼ Text</span>
      <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#ff3c3c;">◼ Number</span>
      <span style="font-size:11px;color:#666;margin-left:8px;">Drag corners to resize. Drag middle to move. Tap to select, Delete to remove.</span>
    </div>
    <div id="pdfAdjustPages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:24px;align-items:center;"></div>
  `;

  document.body.appendChild(overlay);
  _overlay = overlay;

  // Wire events
  document.getElementById('pdfAdjustClose')!.addEventListener('click', closePdfAdjust);
  document.getElementById('pdfAdjustFileInput')!.addEventListener('change', onFileSelect);
  document.getElementById('pdfAdjustApply')!.addEventListener('click', onApply);
  document.getElementById('pdfAdjustAddImage')!.addEventListener('click', () => addRectToCurrentPage('image'));
  document.getElementById('pdfAdjustAddText')!.addEventListener('click', () => addRectToCurrentPage('text'));
  document.getElementById('pdfAdjustAddLabel')!.addEventListener('click', () => addRectToCurrentPage('label'));

  // Global key handler for delete
  document.addEventListener('keydown', onKeyDown);
}

/**
 * Open the Adjust window with pre-extracted frames (called from handlePDF after extraction).
 * This skips the file picker and extraction — goes straight to showing results.
 */
export async function openPdfAdjustWithResults(file: File, frames: ExtractedFrame[]): Promise<void> {
  // Cast ExtractedFrame[] to work as our internal format
  _extractedFrames = frames.map(f => ({
    src: f.src, label: f.label, textContent: f.textContent,
    cropW: f.cropW, cropH: f.cropH, pageIdx: f.pageIdx || 0,
    pageW: f.pageW, pageH: f.pageH,
    imgX: f.imgX, imgY: f.imgY, imgW: f.imgW, imgH: f.imgH,
    labelX: f.labelX, labelY: f.labelY, labelW: f.labelW, labelH: f.labelH,
    textX: f.textX, textY: f.textY, textW: f.textW, textH: f.textH,
  })) as any;
  _currentFile = file;

  // Open the overlay UI
  openPdfAdjust();

  // Load the PDF for page rendering
  try {
    const ab = await file.arrayBuffer();
    _pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
    document.getElementById('pdfAdjustFileName')!.textContent = file.name;
    await renderPagesWithPreExtractedFrames();
  } catch (err) {
    showToast('Could not render PDF pages');
    console.error('[pdfAdjust]', err);
  }
}

/** Render pages using pre-extracted frame positions (no re-extraction needed) */
async function renderPagesWithPreExtractedFrames(): Promise<void> {
  const container = document.getElementById('pdfAdjustPages')!;
  container.innerHTML = '';
  _pages = [];

  for (let p = 1; p <= _pdfDoc.numPages; p++) {
    const page = await _pdfDoc.getPage(p);
    const vp = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;

    const pageData: PageData = {
      pageNum: p, canvas,
      width: canvas.width, height: canvas.height,
      rects: [],
    };
    _pages.push(pageData);

    // Build rectangles from pre-extracted frame positions
    const pageIdx = p - 1;
    const pageFrames = (_extractedFrames as any[]).filter((f: any) => f.pageIdx === pageIdx);
    let rectId = 0;
    for (const f of pageFrames) {
      if (f.imgX != null && f.imgW != null && f.pageW && f.pageH) {
        const pw = f.pageW, ph = f.pageH;
        pageData.rects.push({ id: `p${p}_img_${rectId++}`, type: 'image', pageIdx, x: f.imgX / pw, y: f.imgY / ph, w: f.imgW / pw, h: f.imgH / ph });
        if (f.labelX != null && f.labelW != null) {
          pageData.rects.push({ id: `p${p}_lbl_${rectId++}`, type: 'label', pageIdx, x: f.labelX / pw, y: f.labelY / ph, w: f.labelW / pw, h: f.labelH / ph });
        }
        if (f.textX != null && f.textW != null) {
          pageData.rects.push({ id: `p${p}_txt_${rectId++}`, type: 'text', pageIdx, x: f.textX / pw, y: f.textY / ph, w: f.textW / pw, h: f.textH / ph });
        }
      }
    }

    // Build page DOM element
    const pageEl = document.createElement('div');
    pageEl.className = 'pdfAdjustPage';
    pageEl.dataset.pageIdx = String(pageIdx);
    pageEl.style.cssText = 'position:relative;display:inline-block;border:1px solid #333;';
    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;top:-20px;left:0;font-size:11px;color:#666;font-family:monospace;';
    label.textContent = `Page ${p} — ${pageFrames.length} frame${pageFrames.length !== 1 ? 's' : ''}`;
    pageEl.appendChild(label);
    canvas.style.cssText = 'display:block;max-width:90vw;height:auto;';
    pageEl.appendChild(canvas);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    svg.id = `pdfAdjustSvg_${pageIdx}`;
    pageEl.appendChild(svg);
    const interactLayer = document.createElement('div');
    interactLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;touch-action:pan-y;';
    interactLayer.dataset.pageIdx = String(pageIdx);
    wireInteraction(interactLayer, pageIdx);
    pageEl.appendChild(interactLayer);
    container.appendChild(pageEl);
    renderRectsForPage(pageIdx);
  }
  updateRectCounts();
  showToast(`${(_extractedFrames as any[]).length} frames — review and press Apply`);
}

export function closePdfAdjust(): void {
  // Save rects before closing (user can recall them later)
  saveRectsForFile();

  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _pages = [];
  _pdfDoc = null;
  _currentFile = null;
  _extractedFrames = [];
  _activeRect = null;
  document.removeEventListener('keydown', onKeyDown);
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

async function onFileSelect(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  _currentFile = file;
  document.getElementById('pdfAdjustFileName')!.textContent = file.name;
  showToast('Loading PDF…');

  try {
    const ab = await file.arrayBuffer();
    _pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
    await renderAllPages();
    showToast(`${_pdfDoc.numPages} page${_pdfDoc.numPages > 1 ? 's' : ''} loaded`);
  } catch (err) {
    showToast('Could not load PDF');
    console.error('[pdfAdjust]', err);
  }
}

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------

const RENDER_SCALE = 1.5;

async function renderAllPages(): Promise<void> {
  const container = document.getElementById('pdfAdjustPages')!;
  container.innerHTML = '';
  _pages = [];

  // Check if we have saved rects for this PDF
  const savedRects = _currentFile ? loadRectsForFile(_currentFile.name) : null;

  if (!savedRects) {
    // No saved rects — run fresh extraction
    showToast('Running extraction…');
    const result = await testExtractPDF(_currentFile!, (msg) => showToast(msg));
    _extractedFrames = result.frames;
    showToast(`${_extractedFrames.length} frames found. Rendering pages…`);
  } else {
    showToast('Restoring previous adjustments…');
  }

  // Render each PDF page
  for (let p = 1; p <= _pdfDoc.numPages; p++) {
    const page = await _pdfDoc.getPage(p);
    const vp = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;

    const pageIdx = p - 1;
    const pageData: PageData = {
      pageNum: p,
      canvas,
      width: canvas.width,
      height: canvas.height,
      rects: [],
    };
    _pages.push(pageData);

    if (savedRects) {
      // RESTORE saved rects for this page
      const savedPage = savedRects.find(sp => sp.pageNum === p);
      if (savedPage) {
        pageData.rects = savedPage.rects.map(r => ({ ...r }));
      }
    } else {
      // BUILD rects from fresh extraction results
      const pageFrames = _extractedFrames.filter(f => f.pageIdx === pageIdx);
      let rectId = 0;
      for (const f of pageFrames) {
        if (f.imgX != null && f.imgW != null && f.pageW && f.pageH) {
          const pw = f.pageW, ph = f.pageH;
          pageData.rects.push({
            id: `p${p}_img_${rectId++}`, type: 'image', pageIdx,
            x: f.imgX / pw, y: f.imgY! / ph, w: f.imgW / pw, h: f.imgH! / ph,
          });
          if (f.labelX != null && f.labelW != null) {
            pageData.rects.push({
              id: `p${p}_lbl_${rectId++}`, type: 'label', pageIdx,
              x: f.labelX / pw, y: f.labelY! / ph, w: f.labelW / pw, h: f.labelH! / ph,
            });
          }
          if (f.textX != null && f.textW != null) {
            pageData.rects.push({
              id: `p${p}_txt_${rectId++}`, type: 'text', pageIdx,
              x: f.textX / pw, y: f.textY! / ph, w: f.textW / pw, h: f.textH! / ph,
            });
          }
        }
      }
    }

    // Build page element
    const pageEl = document.createElement('div');
    pageEl.className = 'pdfAdjustPage';
    pageEl.dataset.pageIdx = String(pageIdx);
    pageEl.style.cssText = 'position:relative;display:inline-block;border:1px solid #333;';

    const totalRects = pageData.rects.filter(r => r.type === 'image').length;
    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;top:-20px;left:0;font-size:11px;color:#666;font-family:monospace;';
    label.textContent = `Page ${p} — ${totalRects} frame${totalRects !== 1 ? 's' : ''}`;
    pageEl.appendChild(label);

    canvas.style.cssText = 'display:block;max-width:90vw;height:auto;';
    pageEl.appendChild(canvas);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    svg.id = `pdfAdjustSvg_${pageIdx}`;
    pageEl.appendChild(svg);

    const interactLayer = document.createElement('div');
    interactLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;touch-action:pan-y;';
    interactLayer.dataset.pageIdx = String(pageIdx);
    wireInteraction(interactLayer, pageIdx);
    pageEl.appendChild(interactLayer);

    container.appendChild(pageEl);
    renderRectsForPage(pageIdx);
  }
  updateRectCounts();

  const totalFrames = _pages.reduce((s, p) => s + p.rects.filter(r => r.type === 'image').length, 0);
  if (savedRects) {
    showToast(`Restored ${totalFrames} frames from previous session — adjust and Apply`);
  } else {
    showToast(`Ready — ${totalFrames} frames across ${_pdfDoc.numPages} pages`);
  }
}

// (autoDetectRects removed — now uses testExtractPDF shared function)

/* REMOVED — now uses testExtractPDF shared function
async function autoDetectRects(page: any, pageData: PageData, allPageCandidates: { candidates: Candidate[]; pageW: number; pageH: number }[]): Promise<void> {
  const SCALE = 2;
  const vp = page.getViewport({ scale: SCALE });
  const pageW = Math.round(vp.width);
  const pageH = Math.round(vp.height);

  // Use the real candidate extraction
  const result = await extractCandidates(page);
  const candidates = result.candidates;

  // Store for cross-page dominant size calculation
  candidates.forEach(c => { c.rw = c.w / pageW; c.rh = c.h / pageH; });
  allPageCandidates.push({ candidates, pageW, pageH });

  // Get text items (same scale as handlePDF)
  const textItems = await getTextItems(page, SCALE);

  // Calculate dominant size across ALL pages so far (same as handlePDF)
  const allSizes = allPageCandidates.flatMap(pc => pc.candidates).map(c => ({ rw: c.rw!, rh: c.rh! }));
  let dominantRW: number | null = null, dominantRH: number | null = null;
  if (allSizes.length > 0) {
    const rws = allSizes.map(s => s.rw).sort((a, b) => a - b);
    const rhs = allSizes.map(s => s.rh).sort((a, b) => a - b);
    const medRW = rws[Math.floor(rws.length / 2)];
    const medRH = rhs[Math.floor(rhs.length / 2)];
    const TOL = 0.3;
    const matching = allSizes.filter(s => Math.abs(s.rw - medRW) / medRW < TOL && Math.abs(s.rh - medRH) / medRH < TOL);
    if (matching.length / allSizes.length > 0.35) { dominantRW = medRW; dominantRH = medRH; }
  }

  // Filter by dominant size (same as handlePDF)
  let filtered = dominantRW
    ? candidates.filter(c => Math.abs(c.rw! - dominantRW!) / dominantRW! < 0.3 && Math.abs(c.rh! - dominantRH!) / dominantRH! < 0.3)
    : candidates;

  // Aspect ratio guard
  if (dominantRW && dominantRH) {
    const domAR = dominantRW / dominantRH;
    filtered = filtered.filter(c => Math.abs(c.rw! / c.rh! - domAR) / domAR < 0.6);
  }

  // Match labels (same as handlePDF)
  const withLabels: Candidate[] = filtered.map(c => {
    const m = matchLabel(textItems, c.x, c.y, c.w, c.h, true) as { text: string; item: TextItem } | null;
    return { ...c, label: m ? m.text : '', labelItem: m ? m.item : null };
  });

  // Dedup labels (same as handlePDF)
  const labelMap = new Map<string, Candidate[]>();
  for (const c of withLabels) {
    if (!c.label) continue;
    const arr = labelMap.get(c.label) || [];
    arr.push(c);
    labelMap.set(c.label, arr);
  }
  const allAreas = withLabels.map(c => c.w * c.h).sort((a, b) => a - b);
  const medArea = allAreas[Math.floor(allAreas.length / 2)] || 1;
  for (const [, cands] of labelMap) {
    if (cands.length <= 1) continue;
    cands.sort((a, b) => Math.abs(a.w * a.h - medArea) - Math.abs(b.w * b.h - medArea));
    for (let ci = 1; ci < cands.length; ci++) {
      cands[ci].label = '';
      (cands[ci] as any).dedupedLabel = true;
    }
  }

  // Final filter: keep only candidates with labels or matching dominant size (same as handlePDF)
  const labelled = withLabels.filter(c => c.label);
  let finalCandidates = withLabels;
  if (labelled.length >= 2) {
    const lws = labelled.map(c => c.w).sort((a, b) => a - b);
    const lhs = labelled.map(c => c.h).sort((a, b) => a - b);
    const refW = lws[Math.floor(lws.length / 2)];
    const refH = lhs[Math.floor(lhs.length / 2)];
    const T = 0.35;
    const sizeOk = (c: Candidate) => Math.abs(c.w - refW) / refW < T && Math.abs(c.h - refH) / refH < T;
    finalCandidates = withLabels.filter(c => c.label || (c as any).dedupedLabel && sizeOk(c) || sizeOk(c));
  }
  if (finalCandidates.length === 0) return;

  // Match text for each final candidate (same as handlePDF)
  const rowTops = [...new Set(finalCandidates.map(c => c.y))].sort((a, b) => a - b);
  const rowClusters: number[] = [];
  for (const yt of rowTops) {
    if (rowClusters.length === 0 || yt - rowClusters[rowClusters.length - 1] > 40) rowClusters.push(yt);
  }

  let rectId = 0;
  for (const c of finalCandidates) {
    // Image rect (green)
    pageData.rects.push({
      id: `p${pageData.pageNum}_img_${rectId++}`,
      type: 'image',
      x: c.x / pageW, y: c.y / pageH, w: c.w / pageW, h: c.h / pageH,
      pageIdx: pageData.pageNum - 1,
    });

    // Label rect (red) — if the extraction found a label
    if (c.labelItem) {
      pageData.rects.push({
        id: `p${pageData.pageNum}_lbl_${rectId++}`,
        type: 'label',
        x: c.labelItem.x / pageW, y: c.labelItem.y / pageH,
        w: c.labelItem.w / pageW, h: c.labelItem.h / pageH,
        pageIdx: pageData.pageNum - 1,
      });
    }

    // Text rect (blue) — find the text area the extraction would assign
    const nextRowY = rowClusters.find(ry => ry > c.y + c.h * 0.5);
    const maxY = nextRowY !== undefined ? nextRowY : pageH;
    const txt = matchText(textItems, c.x, c.y, c.w, c.h, maxY);
    if (txt) {
      // Find bounding box of the matched text items
      const belowItems = textItems.filter(item => {
        const iy = item.y, ix = item.x;
        return iy >= c.y + c.h - 10 && iy <= maxY && ix + item.w >= c.x - 20 && ix <= c.x + c.w + 20;
      });
      const rightItems = textItems.filter(item => {
        const ix = item.x, iy = item.y;
        return ix > c.x + c.w - 10 && iy >= c.y - 20 && iy <= c.y + c.h + 20;
      });
      const matched = rightItems.length > belowItems.length ? rightItems : belowItems;
      if (matched.length > 0) {
        const tx = Math.min(...matched.map(i => i.x));
        const ty = Math.min(...matched.map(i => i.y));
        const tx2 = Math.max(...matched.map(i => i.x + i.w));
        const ty2 = Math.max(...matched.map(i => i.y + i.h));
        pageData.rects.push({
          id: `p${pageData.pageNum}_txt_${rectId++}`,
          type: 'text',
          x: tx / pageW, y: ty / pageH, w: (tx2 - tx) / pageW, h: (ty2 - ty) / pageH,
          pageIdx: pageData.pageNum - 1,
        });
      }
    }
  }
}
*/

// ---------------------------------------------------------------------------
// Rectangle rendering (SVG overlay)
// ---------------------------------------------------------------------------

function renderRectsForPage(pageIdx: number): void {
  const svg = document.getElementById(`pdfAdjustSvg_${pageIdx}`);
  if (!svg) return;
  const page = _pages[pageIdx];
  if (!page) return;

  svg.innerHTML = '';
  for (const rect of page.rects) {
    const px = rect.x * page.width;
    const py = rect.y * page.height;
    const pw = rect.w * page.width;
    const ph = rect.h * page.height;
    const isActive = _activeRect?.id === rect.id;

    // Filled rectangle
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', String(px));
    r.setAttribute('y', String(py));
    r.setAttribute('width', String(pw));
    r.setAttribute('height', String(ph));
    r.setAttribute('fill', RECT_COLORS[rect.type]);
    r.setAttribute('stroke', RECT_BORDERS[rect.type]);
    r.setAttribute('stroke-width', isActive ? '3' : '1.5');
    if (isActive) r.setAttribute('stroke-dasharray', '6,3');
    svg.appendChild(r);

    // Corner handles (only for active rect)
    if (isActive) {
      const handleSize = 8;
      for (const [hx, hy, name] of [
        [px, py, 'nw'], [px + pw, py, 'ne'],
        [px, py + ph, 'sw'], [px + pw, py + ph, 'se'],
      ] as [number, number, string][]) {
        const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        handle.setAttribute('x', String(hx - handleSize / 2));
        handle.setAttribute('y', String(hy - handleSize / 2));
        handle.setAttribute('width', String(handleSize));
        handle.setAttribute('height', String(handleSize));
        handle.setAttribute('fill', '#fff');
        handle.setAttribute('stroke', RECT_BORDERS[rect.type]);
        handle.setAttribute('stroke-width', '2');
        svg.appendChild(handle);
      }
    }

    // Type label
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(px + 4));
    text.setAttribute('y', String(py + 12));
    text.setAttribute('fill', RECT_BORDERS[rect.type]);
    text.setAttribute('font-size', '10');
    text.setAttribute('font-family', 'monospace');
    text.setAttribute('font-weight', 'bold');
    text.textContent = rect.type === 'label' ? 'NUMBER' : rect.type.toUpperCase();
    svg.appendChild(text);
  }
}

// ---------------------------------------------------------------------------
// Interaction — drag to move/resize rectangles
// ---------------------------------------------------------------------------

function wireInteraction(el: HTMLElement, pageIdx: number): void {
  let isDown = false;

  function getPos(e: MouseEvent | Touch): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function findHit(pos: { x: number; y: number }): { rect: AdjustRect; handle: string } | null {
    const page = _pages[pageIdx];
    if (!page) return null;

    // Check active rect's handles first — handle radius scales with rect size
    // so small rects (labels/numbers) are easy to grab and move, not just resize.
    if (_activeRect && _activeRect.pageIdx === pageIdx) {
      const r = _activeRect;
      const minDim = Math.min(r.w, r.h);
      const handleR = Math.max(0.005, Math.min(0.015, minDim * 0.15));
      const corners = [
        { x: r.x, y: r.y, name: 'nw' },
        { x: r.x + r.w, y: r.y, name: 'ne' },
        { x: r.x, y: r.y + r.h, name: 'sw' },
        { x: r.x + r.w, y: r.y + r.h, name: 'se' },
      ];
      for (const c of corners) {
        if (Math.abs(pos.x - c.x) < handleR && Math.abs(pos.y - c.y) < handleR) {
          return { rect: r, handle: c.name };
        }
      }
    }

    // Check if inside any rect
    for (const r of [...page.rects].reverse()) {
      if (pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h) {
        return { rect: r, handle: 'move' };
      }
    }
    return null;
  }

  function onDown(e: MouseEvent | TouchEvent): void {
    const pos = getPos('touches' in e ? e.touches[0] : e);
    const hit = findHit(pos);
    if (hit) {
      e.preventDefault(); // only prevent default when hitting a rectangle
      _activeRect = hit.rect;
      _dragHandle = hit.handle;
      _dragStartX = pos.x;
      _dragStartY = pos.y;
      _dragStartRect = { x: hit.rect.x, y: hit.rect.y, w: hit.rect.w, h: hit.rect.h };
      isDown = true;
    } else {
      _activeRect = null;
      // Don't preventDefault — let the scroll through
    }
    renderRectsForPage(pageIdx);
  }

  function onMove(e: MouseEvent | TouchEvent): void {
    if (!isDown || !_activeRect || !_dragHandle) return;
    e.preventDefault(); // only prevent default when dragging
    const pos = getPos('touches' in e ? e.touches[0] : e);
    const dx = pos.x - _dragStartX;
    const dy = pos.y - _dragStartY;

    if (_dragHandle === 'move') {
      _activeRect.x = _dragStartRect.x + dx;
      _activeRect.y = _dragStartRect.y + dy;
    } else if (_dragHandle === 'se') {
      _activeRect.w = Math.max(0.02, _dragStartRect.w + dx);
      _activeRect.h = Math.max(0.02, _dragStartRect.h + dy);
    } else if (_dragHandle === 'nw') {
      _activeRect.x = _dragStartRect.x + dx;
      _activeRect.y = _dragStartRect.y + dy;
      _activeRect.w = Math.max(0.02, _dragStartRect.w - dx);
      _activeRect.h = Math.max(0.02, _dragStartRect.h - dy);
    } else if (_dragHandle === 'ne') {
      _activeRect.y = _dragStartRect.y + dy;
      _activeRect.w = Math.max(0.02, _dragStartRect.w + dx);
      _activeRect.h = Math.max(0.02, _dragStartRect.h - dy);
    } else if (_dragHandle === 'sw') {
      _activeRect.x = _dragStartRect.x + dx;
      _activeRect.w = Math.max(0.02, _dragStartRect.w - dx);
      _activeRect.h = Math.max(0.02, _dragStartRect.h + dy);
    }
    renderRectsForPage(pageIdx);
  }

  function onUp(): void {
    if (isDown && _activeRect) _activeRect.adjusted = true;
    isDown = false;
    _dragHandle = null;
  }

  el.addEventListener('mousedown', onDown);
  el.addEventListener('mousemove', onMove);
  el.addEventListener('mouseup', onUp);
  el.addEventListener('touchstart', onDown, { passive: false });
  el.addEventListener('touchmove', onMove, { passive: false });
  el.addEventListener('touchend', onUp);
}

// ---------------------------------------------------------------------------
// Add / delete rectangles
// ---------------------------------------------------------------------------

function addRectToCurrentPage(type: 'image' | 'text' | 'label'): void {
  // Add to the first visible page (or page 0)
  const scrollEl = document.getElementById('pdfAdjustPages');
  let targetIdx = 0;
  if (scrollEl) {
    const pageEls = scrollEl.querySelectorAll('.pdfAdjustPage');
    for (const pe of pageEls) {
      const rect = pe.getBoundingClientRect();
      if (rect.top < window.innerHeight / 2 && rect.bottom > 0) {
        targetIdx = parseInt((pe as HTMLElement).dataset.pageIdx || '0');
      }
    }
  }
  const page = _pages[targetIdx];
  if (!page) return;

  // Smart default size: use median size of existing rects of the same type.
  // Labels/numbers get +20% (small rects need more margin to grab easily).
  // Images and text get +3%.
  let defW = 0.3, defH = 0.2; // fallback
  const sameTypeRects = _pages.flatMap(p => p.rects.filter(r => r.type === type));
  if (sameTypeRects.length > 0) {
    const ws = sameTypeRects.map(r => r.w).sort((a, b) => a - b);
    const hs = sameTypeRects.map(r => r.h).sort((a, b) => a - b);
    const scale = type === 'label' ? 1.20 : 1.03;
    defW = ws[Math.floor(ws.length / 2)] * scale;
    defH = hs[Math.floor(hs.length / 2)] * scale;
  }

  const newRect: AdjustRect = {
    id: `p${targetIdx}_new_${Date.now()}`,
    type,
    x: 0.2, y: 0.2, w: defW, h: defH,
    pageIdx: targetIdx,
    adjusted: true, // user-added = always run snap-to-content
  };
  page.rects.push(newRect);
  _activeRect = newRect;
  renderRectsForPage(targetIdx);
  updateRectCounts();
}

function onKeyDown(e: KeyboardEvent): void {
  if ((e.key === 'Delete' || e.key === 'Backspace') && _activeRect) {
    const page = _pages[_activeRect.pageIdx];
    if (page) {
      page.rects = page.rects.filter(r => r.id !== _activeRect!.id);
      renderRectsForPage(_activeRect.pageIdx);
      _activeRect = null;
      updateRectCounts();
    }
  }
}

// ---------------------------------------------------------------------------
// Snap to content: for user-adjusted/added rects, find actual image borders
// within the rectangle area by trimming white/background from edges.
// ---------------------------------------------------------------------------

function snapToContent(canvas: HTMLCanvasElement, rx: number, ry: number, rw: number, rh: number): { x: number; y: number; w: number; h: number } {
  const ctx = canvas.getContext('2d')!;
  const x0 = Math.max(0, rx), y0 = Math.max(0, ry);
  const x1 = Math.min(canvas.width, rx + rw), y1 = Math.min(canvas.height, ry + rh);
  const w = x1 - x0, h = y1 - y0;
  if (w < 10 || h < 10) return { x: rx, y: ry, w: rw, h: rh };

  const imgData = ctx.getImageData(x0, y0, w, h).data;
  const THRESHOLD = 240; // pixel lighter than this = "white/background"

  // Scan from each edge inward to find content
  function rowHasContent(row: number): boolean {
    for (let col = 0; col < w; col++) {
      const idx = (row * w + col) * 4;
      if (imgData[idx] < THRESHOLD || imgData[idx + 1] < THRESHOLD || imgData[idx + 2] < THRESHOLD) return true;
    }
    return false;
  }
  function colHasContent(col: number): boolean {
    for (let row = 0; row < h; row++) {
      const idx = (row * w + col) * 4;
      if (imgData[idx] < THRESHOLD || imgData[idx + 1] < THRESHOLD || imgData[idx + 2] < THRESHOLD) return true;
    }
    return false;
  }

  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  while (top < h && !rowHasContent(top)) top++;
  while (bottom > top && !rowHasContent(bottom)) bottom--;
  while (left < w && !colHasContent(left)) left++;
  while (right > left && !colHasContent(right)) right--;

  // Don't trim more than 20% from any edge (user's rect is a hint, not wildly off)
  const maxTrim = Math.min(w, h) * 0.2;
  top = Math.min(top, maxTrim);
  left = Math.min(left, maxTrim);
  bottom = Math.max(bottom, h - 1 - maxTrim);
  right = Math.max(right, w - 1 - maxTrim);

  return {
    x: x0 + left,
    y: y0 + top,
    w: right - left + 1,
    h: bottom - top + 1,
  };
}

// ---------------------------------------------------------------------------
// Apply — re-extract with adjusted rectangles
// ---------------------------------------------------------------------------

async function onApply(): Promise<void> {
  if (!_pdfDoc || _pages.length === 0) {
    showToast('No PDF loaded');
    return;
  }

  // Collect ALL image rects across ALL pages — this is the source of truth
  const allImageRects: { rect: AdjustRect; pageIdx: number }[] = [];
  for (let pi = 0; pi < _pages.length; pi++) {
    for (const r of _pages[pi].rects) {
      if (r.type === 'image') allImageRects.push({ rect: r, pageIdx: pi });
    }
  }
  const expectedCount = allImageRects.length;
  if (expectedCount === 0) {
    showToast('No image frames to apply');
    return;
  }

  // Save rect overlay for recall next time this PDF is opened
  saveRectsForFile();

  console.log(`[pdfAdjust] Apply: ${expectedCount} image rects across ${_pages.length} pages`);
  for (let pi = 0; pi < _pages.length; pi++) {
    const pgImgs = _pages[pi].rects.filter(r => r.type === 'image').length;
    if (pgImgs > 0) console.log(`  Page ${pi + 1}: ${pgImgs} images`);
  }

  // --- Show progress bar inside the Adjust overlay ---
  const applyBtn = document.getElementById('pdfAdjustApply') as HTMLButtonElement;
  if (applyBtn) { applyBtn.disabled = true; applyBtn.style.opacity = '0.5'; }
  const addBtns = ['pdfAdjustAddImage', 'pdfAdjustAddText', 'pdfAdjustAddLabel'];
  addBtns.forEach(id => { const b = document.getElementById(id) as HTMLButtonElement; if (b) { b.disabled = true; b.style.opacity = '0.5'; } });

  const pagesContainer = document.getElementById('pdfAdjustPages')!;
  pagesContainer.innerHTML = '';
  const progressWrap = document.createElement('div');
  progressWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;';
  progressWrap.innerHTML = `
    <div id="pdfAdjustProgressLabel" style="font-size:15px;color:#ccc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-weight:600;">Applying adjustments…</div>
    <div style="width:60%;max-width:400px;height:6px;background:#333;border-radius:3px;overflow:hidden;">
      <div id="pdfAdjustProgressBar" style="width:0%;height:100%;background:#c94432;transition:width 0.15s;border-radius:3px;"></div>
    </div>
    <div id="pdfAdjustProgressDetail" style="font-size:12px;color:#666;font-family:monospace;"></div>
  `;
  pagesContainer.appendChild(progressWrap);

  function setApplyProgress(pct: number, label: string, detail?: string): void {
    const bar = document.getElementById('pdfAdjustProgressBar');
    const lbl = document.getElementById('pdfAdjustProgressLabel');
    const det = document.getElementById('pdfAdjustProgressDetail');
    if (bar) bar.style.width = Math.min(100, pct) + '%';
    if (lbl) lbl.textContent = label;
    if (det) det.textContent = detail || '';
  }

  // Yield to let the UI paint the progress bar
  await new Promise(r => setTimeout(r, 50));

  const fileName = _currentFile?.name.replace(/\.pdf$/i, '') || '';
  const SCALE = 2;

  try {
    const framesToLoad: { src: string; label: string; cropW: number; cropH: number; textContent: string; pageIdx?: number; sortY?: number; sortX?: number; rectId?: string }[] = [];
    const processedRectIds = new Set<string>();
    let processedSoFar = 0;

    // Process ALL pages — even if there are blank/divider pages between pages
    // with rects. The loop visits every page; pages without image rects are
    // skipped cheaply. Gaps of 1 or 100 empty pages do NOT break extraction.
    for (let pi = 0; pi < _pages.length; pi++) {
      const pageData = _pages[pi];
      const pageImageRects = pageData.rects
        .filter(r => r.type === 'image')
        .sort((a, b) => a.y - b.y || a.x - b.x);

      // Skip pages with no image rects (blank divider pages, title pages, etc.)
      if (pageImageRects.length === 0) continue;

      setApplyProgress(
        Math.round((processedSoFar / expectedCount) * 80),
        `Processing page ${pi + 1} of ${_pages.length}…`,
        `${processedSoFar} / ${expectedCount} frames`
      );
      await new Promise(r => setTimeout(r, 10)); // yield for UI

      const page = await _pdfDoc.getPage(pi + 1);
      const vp = page.getViewport({ scale: SCALE });
      const pageW = Math.round(vp.width);
      const pageH = Math.round(vp.height);

      // Render page at scale=2 for cropping
      const pc = document.createElement('canvas');
      pc.width = pageW; pc.height = pageH;
      await page.render({ canvasContext: pc.getContext('2d')!, viewport: vp }).promise;

      // Get text items for this page
      const textItems = await getTextItems(page, SCALE);

      // Build row clusters for text matching (same as handlePDF)
      const rowTops = [...new Set(pageImageRects.map(r => Math.round(r.y * pageH)))].sort((a, b) => a - b);
      const rowClusters: number[] = [];
      for (const yt of rowTops) {
        if (rowClusters.length === 0 || yt - rowClusters[rowClusters.length - 1] > 40) rowClusters.push(yt);
      }

      // =================================================================
      // STEP 1: Crop every GREEN rect → create frame (no label/text yet)
      // =================================================================
      const hasRedRects = pageData.rects.some(r => r.type === 'label');
      const hasBlueRects = pageData.rects.some(r => r.type === 'text');

      // Build red zones for exclusion (numbers must not leak into text)
      const allLabelRects = pageData.rects.filter(r => r.type === 'label');
      const redZones: { x: number; y: number; w: number; h: number }[] = [];
      for (const lr of allLabelRects) {
        redZones.push({
          x: Math.round(lr.x * pageW), y: Math.round(lr.y * pageH),
          w: Math.round(lr.w * pageW), h: Math.round(lr.h * pageH),
        });
      }
      function isInsideRedZone(t: TextItem): boolean {
        const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
        for (const z of redZones) {
          if (tcx >= z.x && tcx <= z.x + z.w && tcy >= z.y && tcy <= z.y + z.h) return true;
        }
        return false;
      }
      const textItemsNoLabels = textItems.filter(t => !isInsideRedZone(t));

      for (const imgRect of pageImageRects) {
        try {
          let ix = Math.round(imgRect.x * pageW);
          let iy = Math.round(imgRect.y * pageH);
          let iw = Math.round(imgRect.w * pageW);
          let ih = Math.round(imgRect.h * pageH);

          if (imgRect.adjusted) {
            const snapped = snapToContent(pc, ix, iy, iw, ih);
            ix = snapped.x; iy = snapped.y; iw = snapped.w; ih = snapped.h;
          }

          const crop = document.createElement('canvas');
          const pad = 3;
          const cx = Math.max(0, ix - pad), cy = Math.max(0, iy - pad);
          const cw = Math.min(pageW - cx, iw + pad * 2), ch = Math.min(pageH - cy, ih + pad * 2);
          crop.width = cw; crop.height = ch;
          crop.getContext('2d')!.drawImage(pc, cx, cy, cw, ch, 0, 0, cw, ch);

          // Label fallback: only if NO red rects exist on this page
          let label = '';
          if (!hasRedRects) {
            const labelResult = matchLabel(textItems, ix, iy, iw, ih, true) as { text: string; item?: TextItem } | null;
            label = labelResult ? labelResult.text : '';
          }

          // Text fallback: only if NO blue rects exist on this page
          let textContent = '';
          if (!hasBlueRects) {
            const nextRowY = rowClusters.find(ry => ry > iy + ih * 0.5);
            const maxY = nextRowY !== undefined ? nextRowY : pageH;
            textContent = matchText(textItemsNoLabels, ix, iy, iw, ih, maxY);
          }

          framesToLoad.push({
            src: crop.toDataURL('image/jpeg', 0.93),
            label, cropW: cw, cropH: ch, textContent,
            pageIdx: pi, sortY: iy, sortX: ix, rectId: imgRect.id,
          });
          processedRectIds.add(imgRect.id);
        } catch (rectErr) {
          console.error(`[pdfAdjust] rect ${imgRect.id} page ${pi + 1} error:`, rectErr);
          // Basic recovery — just crop
          try {
            const ix = Math.round(imgRect.x * pageW), iy = Math.round(imgRect.y * pageH);
            const iw = Math.round(imgRect.w * pageW), ih = Math.round(imgRect.h * pageH);
            const crop = document.createElement('canvas');
            const pad = 3;
            const cx = Math.max(0, ix - pad), cy = Math.max(0, iy - pad);
            const cw = Math.min(pageW - cx, iw + pad * 2), ch = Math.min(pageH - cy, ih + pad * 2);
            crop.width = cw; crop.height = ch;
            crop.getContext('2d')!.drawImage(pc, cx, cy, cw, ch, 0, 0, cw, ch);
            framesToLoad.push({
              src: crop.toDataURL('image/jpeg', 0.93),
              label: '', cropW: cw, cropH: ch, textContent: '',
              pageIdx: pi, sortY: iy, sortX: ix, rectId: imgRect.id,
            });
            processedRectIds.add(imgRect.id);
          } catch { /* skip */ }
        }
        processedSoFar++;
      }

      // =================================================================
      // STEP 2: Read every RED rect directly from the PDF.
      // Text layer first, OCR fallback. The text IS the label.
      // Assign using pattern (median offset) + greedy 1:1 (no double-claims).
      // =================================================================
      if (hasRedRects) {
        const pageFrameStart = framesToLoad.length - pageImageRects.length;
        const pageFrames = framesToLoad.slice(pageFrameStart);
        const claimed = new Set<number>(); // indices into pageFrames already assigned

        // Read all red rects
        const readings: { text: string; cx: number; cy: number }[] = [];
        for (const lr of allLabelRects) {
          const lx = Math.round(lr.x * pageW), ly = Math.round(lr.y * pageH);
          const lw = Math.round(lr.w * pageW), lh = Math.round(lr.h * pageH);

          // READ from PDF text layer — items overlapping this rect
          const items = textItems.filter(t =>
            t.x + t.w > lx && t.x < lx + lw &&
            t.y + t.h > ly && t.y < ly + lh
          );
          let text = items.sort((a, b) => a.y - b.y || a.x - b.x).map(t => t.text).join(' ').trim();

          // OCR fallback if text layer empty
          if (!text && lw > 5 && lh > 5) {
            try {
              const ocrCrop = document.createElement('canvas');
              ocrCrop.width = lw; ocrCrop.height = lh;
              ocrCrop.getContext('2d')!.drawImage(pc, lx, ly, lw, lh, 0, 0, lw, lh);
              const worker = await createWorker('eng', 1, {
                workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
                corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
              } as any);
              const result = await worker.recognize(ocrCrop.toDataURL('image/png'));
              text = (result.data.text || '').trim();
              await worker.terminate();
            } catch { /* silent */ }
          }

          if (text) {
            readings.push({ text, cx: lx + lw / 2, cy: ly + lh / 2 });
          }
        }

        // Compute pattern: median offset from each red rect center to its nearest image center
        const offsets: { dx: number; dy: number }[] = [];
        for (const lr of allLabelRects) {
          const lcx = Math.round(lr.x * pageW) + Math.round(lr.w * pageW) / 2;
          const lcy = Math.round(lr.y * pageH) + Math.round(lr.h * pageH) / 2;
          let nearDist = Infinity;
          let nearImgCx = 0, nearImgCy = 0;
          for (const ir of pageImageRects) {
            const icx = Math.round(ir.x * pageW) + Math.round(ir.w * pageW) / 2;
            const icy = Math.round(ir.y * pageH) + Math.round(ir.h * pageH) / 2;
            const d = Math.abs(lcx - icx) + Math.abs(lcy - icy);
            if (d < nearDist) { nearDist = d; nearImgCx = icx; nearImgCy = icy; }
          }
          offsets.push({ dx: nearImgCx - lcx, dy: nearImgCy - lcy });
        }
        let medDx = 0, medDy = 0;
        if (offsets.length > 0) {
          const dxs = offsets.map(o => o.dx).sort((a, b) => a - b);
          const dys = offsets.map(o => o.dy).sort((a, b) => a - b);
          medDx = dxs[Math.floor(dxs.length / 2)];
          medDy = dys[Math.floor(dys.length / 2)];
        }

        // Pattern-based greedy 1:1 assignment
        for (const rd of readings) {
          const expectedX = rd.cx + medDx;
          const expectedY = rd.cy + medDy;
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let fi = 0; fi < pageFrames.length; fi++) {
            if (claimed.has(fi)) continue;
            const fx = (pageFrames[fi].sortX ?? 0) + (pageFrames[fi].cropW ?? 0) / 2;
            const fy = (pageFrames[fi].sortY ?? 0) + (pageFrames[fi].cropH ?? 0) / 2;
            const dist = Math.abs(expectedX - fx) + Math.abs(expectedY - fy);
            if (dist < bestDist) { bestDist = dist; bestIdx = fi; }
          }
          if (bestIdx >= 0) {
            pageFrames[bestIdx].label = rd.text;
            claimed.add(bestIdx);
            console.log(`[pdfAdjust] RED "${rd.text}" → frame #${bestIdx} at (${pageFrames[bestIdx].sortX}, ${pageFrames[bestIdx].sortY})`);
          }
        }
      }

      // =================================================================
      // STEP 3: Read every BLUE rect directly from the PDF.
      // Text layer (with red-zone exclusion) + OCR fallback.
      // Assign using pattern (median offset) + greedy 1:1.
      // =================================================================
      const allBlueRects = pageData.rects.filter(r => r.type === 'text');
      if (allBlueRects.length > 0) {
        const pageFrameStart = framesToLoad.length - pageImageRects.length;
        const pageFrames = framesToLoad.slice(pageFrameStart);
        const claimed = new Set<number>();

        const blueReadings: { text: string; cx: number; cy: number }[] = [];
        for (const br of allBlueRects) {
          const bx = Math.round(br.x * pageW), by = Math.round(br.y * pageH);
          const bw = Math.round(br.w * pageW), bh = Math.round(br.h * pageH);

          // READ from PDF text layer — items overlapping this rect, EXCLUDING red zones
          const items = textItemsNoLabels.filter(t =>
            t.x + t.w > bx && t.x < bx + bw &&
            t.y + t.h > by && t.y < by + bh
          );
          let text = items.sort((a, b) => a.y - b.y || a.x - b.x).map(t => t.text).join(' ').trim();

          // OCR fallback if text layer empty
          if (!text && bw > 10 && bh > 10) {
            try {
              const ocrCrop = document.createElement('canvas');
              ocrCrop.width = bw; ocrCrop.height = bh;
              ocrCrop.getContext('2d')!.drawImage(pc, bx, by, bw, bh, 0, 0, bw, bh);
              const worker = await createWorker('eng', 1, {
                workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
                corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
              } as any);
              const result = await worker.recognize(ocrCrop.toDataURL('image/png'));
              text = (result.data.text || '').trim();
              await worker.terminate();
            } catch { /* silent */ }
          }

          if (text) {
            blueReadings.push({ text, cx: bx + bw / 2, cy: by + bh / 2 });
          }
        }

        // Compute pattern: median offset from each blue rect center to nearest image center
        const blueOffsets: { dx: number; dy: number }[] = [];
        for (const br of allBlueRects) {
          const bcx = Math.round(br.x * pageW) + Math.round(br.w * pageW) / 2;
          const bcy = Math.round(br.y * pageH) + Math.round(br.h * pageH) / 2;
          let nearDist = Infinity;
          let nearImgCx = 0, nearImgCy = 0;
          for (const ir of pageImageRects) {
            const icx = Math.round(ir.x * pageW) + Math.round(ir.w * pageW) / 2;
            const icy = Math.round(ir.y * pageH) + Math.round(ir.h * pageH) / 2;
            const d = Math.abs(bcx - icx) + Math.abs(bcy - icy);
            if (d < nearDist) { nearDist = d; nearImgCx = icx; nearImgCy = icy; }
          }
          blueOffsets.push({ dx: nearImgCx - bcx, dy: nearImgCy - bcy });
        }
        let blueMedDx = 0, blueMedDy = 0;
        if (blueOffsets.length > 0) {
          const dxs = blueOffsets.map(o => o.dx).sort((a, b) => a - b);
          const dys = blueOffsets.map(o => o.dy).sort((a, b) => a - b);
          blueMedDx = dxs[Math.floor(dxs.length / 2)];
          blueMedDy = dys[Math.floor(dys.length / 2)];
        }

        // Pattern-based greedy 1:1 assignment
        for (const bd of blueReadings) {
          const expectedX = bd.cx + blueMedDx;
          const expectedY = bd.cy + blueMedDy;
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let fi = 0; fi < pageFrames.length; fi++) {
            if (claimed.has(fi)) continue;
            const fx = (pageFrames[fi].sortX ?? 0) + (pageFrames[fi].cropW ?? 0) / 2;
            const fy = (pageFrames[fi].sortY ?? 0) + (pageFrames[fi].cropH ?? 0) / 2;
            const dist = Math.abs(expectedX - fx) + Math.abs(expectedY - fy);
            if (dist < bestDist) { bestDist = dist; bestIdx = fi; }
          }
          if (bestIdx >= 0) {
            pageFrames[bestIdx].textContent = bd.text;
            claimed.add(bestIdx);
            console.log(`[pdfAdjust] BLUE "${bd.text.slice(0, 40)}" → frame #${bestIdx}`);
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // VERIFICATION: every green rect must produce a frame. If any were missed,
    // log exactly which ones and attempt recovery.
    // -----------------------------------------------------------------------
    setApplyProgress(82, 'Verifying extraction…', `${framesToLoad.length} / ${expectedCount} frames`);
    await new Promise(r => setTimeout(r, 10));

    if (framesToLoad.length < expectedCount) {
      console.warn(`[pdfAdjust] MISMATCH: expected ${expectedCount} frames, got ${framesToLoad.length}`);
      const missedRects = allImageRects.filter(r => !processedRectIds.has(r.rect.id));
      console.warn(`[pdfAdjust] Missed rects:`, missedRects.map(r => `${r.rect.id} on page ${r.pageIdx + 1}`));

      // Recovery: full extraction per missed rect (snap, label, text, OCR)
      // Group missed rects by page so we only render each page once
      const missedByPage = new Map<number, typeof missedRects>();
      for (const m of missedRects) {
        const arr = missedByPage.get(m.pageIdx) || [];
        arr.push(m);
        missedByPage.set(m.pageIdx, arr);
      }

      for (const [pi, pageMissed] of missedByPage) {
        try {
          setApplyProgress(83, `Recovering page ${pi + 1}…`, `${pageMissed.length} missed frame${pageMissed.length > 1 ? 's' : ''}`);
          await new Promise(r => setTimeout(r, 10));

          const page = await _pdfDoc.getPage(pi + 1);
          const vp = page.getViewport({ scale: SCALE });
          const pageW = Math.round(vp.width), pageH = Math.round(vp.height);
          const pc = document.createElement('canvas');
          pc.width = pageW; pc.height = pageH;
          await page.render({ canvasContext: pc.getContext('2d')!, viewport: vp }).promise;
          const textItems = await getTextItems(page, SCALE);

          // All image rects on this page (for row clusters)
          const pageData = _pages[pi];
          const allPageImgRects = pageData ? pageData.rects.filter(r => r.type === 'image').sort((a, b) => a.y - b.y || a.x - b.x) : [];
          const rowTops = [...new Set(allPageImgRects.map(r => Math.round(r.y * pageH)))].sort((a, b) => a - b);
          const rowClusters: number[] = [];
          for (const yt of rowTops) {
            if (rowClusters.length === 0 || yt - rowClusters[rowClusters.length - 1] > 40) rowClusters.push(yt);
          }

          for (const missed of pageMissed) {
            try {
              const ir = missed.rect;
              let ix = Math.round(ir.x * pageW), iy = Math.round(ir.y * pageH);
              let iw = Math.round(ir.w * pageW), ih = Math.round(ir.h * pageH);

              if (ir.adjusted) {
                const snapped = snapToContent(pc, ix, iy, iw, ih);
                ix = snapped.x; iy = snapped.y; iw = snapped.w; ih = snapped.h;
              }

              const crop = document.createElement('canvas');
              const pad = 3;
              const cx = Math.max(0, ix - pad), cy = Math.max(0, iy - pad);
              const cw = Math.min(pageW - cx, iw + pad * 2), ch = Math.min(pageH - cy, ih + pad * 2);
              crop.width = cw; crop.height = ch;
              crop.getContext('2d')!.drawImage(pc, cx, cy, cw, ch, 0, 0, cw, ch);

              // Full label detection: matchLabel + user red rects + OCR fallback
              const labelResult = matchLabel(textItems, ix, iy, iw, ih, true) as { text: string } | null;
              let label = labelResult ? labelResult.text : '';

              // Check user-added label rects on this page
              if (!label && pageData) {
                const userLabelRects = pageData.rects.filter(r => r.type === 'label');
                for (const lr of userLabelRects) {
                  const lx = Math.round(lr.x * pageW), ly = Math.round(lr.y * pageH);
                  const lw = Math.round(lr.w * pageW), lh = Math.round(lr.h * pageH);
                  // Check proximity to this image
                  const dist = Math.abs(lx - ix) + Math.abs(ly - iy);
                  if (dist < pageW * 0.3) {
                    // Read text from this label rect
                    const items = textItems.filter(t => t.x + t.w > lx && t.x < lx + lw && t.y + t.h > ly && t.y < ly + lh);
                    let lText = items.map(t => t.text).join(' ').trim();
                    // OCR fallback
                    if (!lText && lw > 5 && lh > 5) {
                      try {
                        const ocrCrop = document.createElement('canvas');
                        ocrCrop.width = lw; ocrCrop.height = lh;
                        ocrCrop.getContext('2d')!.drawImage(pc, lx, ly, lw, lh, 0, 0, lw, lh);
                        const worker = await createWorker('eng', 1, {
                          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
                          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
                        } as any);
                        const result = await worker.recognize(ocrCrop.toDataURL('image/png'));
                        lText = (result.data.text || '').trim();
                        await worker.terminate();
                      } catch { /* silent */ }
                    }
                    if (lText) { label = lText; break; }
                  }
                }
              }

              // Full text detection
              const nextRowY = rowClusters.find(ry => ry > iy + ih * 0.5);
              const maxY = nextRowY !== undefined ? nextRowY : pageH;
              let textContent = matchText(textItems, ix, iy, iw, ih, maxY);

              // Check user-added text rects on this page
              if (!textContent && pageData) {
                const userTextRects = pageData.rects.filter(r => r.type === 'text');
                for (const tr of userTextRects) {
                  const tx = Math.round(tr.x * pageW), ty = Math.round(tr.y * pageH);
                  const tw = Math.round(tr.w * pageW), th = Math.round(tr.h * pageH);
                  const dist = Math.abs(tx - ix) + Math.abs(ty - iy);
                  if (dist < pageW * 0.3) {
                    const txtItems = textItems.filter(t => t.x + t.w > tx && t.x < tx + tw && t.y + t.h > ty && t.y < ty + th);
                    let uText = txtItems.sort((a, b) => a.y - b.y || a.x - b.x).map(t => t.text).join(' ').trim();
                    if (!uText && tw > 10 && th > 10) {
                      try {
                        const ocrCrop = document.createElement('canvas');
                        ocrCrop.width = tw; ocrCrop.height = th;
                        ocrCrop.getContext('2d')!.drawImage(pc, tx, ty, tw, th, 0, 0, tw, th);
                        const worker = await createWorker('eng', 1, {
                          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
                          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
                        } as any);
                        const result = await worker.recognize(ocrCrop.toDataURL('image/png'));
                        uText = (result.data.text || '').trim();
                        await worker.terminate();
                      } catch { /* silent */ }
                    }
                    if (uText) { textContent = uText; break; }
                  }
                }
              }

              framesToLoad.push({
                src: crop.toDataURL('image/jpeg', 0.93),
                label, cropW: cw, cropH: ch, textContent,
                pageIdx: pi, sortY: iy, sortX: ix, rectId: ir.id,
              });
              console.log(`[pdfAdjust] Recovered rect ${ir.id} page ${pi + 1}: label="${label}"`);
            } catch (recErr) {
              console.error(`[pdfAdjust] Could not recover rect ${missed.rect.id}:`, recErr);
            }
          }
        } catch (pageErr) {
          console.error(`[pdfAdjust] Could not recover page ${pi + 1}:`, pageErr);
        }
      }
      console.log(`[pdfAdjust] After recovery: ${framesToLoad.length} frames`);
    } else {
      console.log(`[pdfAdjust] All ${expectedCount} image rects extracted successfully`);
    }

    // Sort frames by position: page order, then top-to-bottom, left-to-right
    setApplyProgress(85, 'Sorting frames…');
    if (framesToLoad.length > 1) {
      const medH = framesToLoad.map(f => f.cropH).sort((a, b) => a - b)[Math.floor(framesToLoad.length / 2)] || 100;
      const rowBucket = medH * 0.5;
      framesToLoad.sort((a, b) => {
        if ((a.pageIdx ?? 0) !== (b.pageIdx ?? 0)) return (a.pageIdx ?? 0) - (b.pageIdx ?? 0);
        const rowA = Math.floor((a.sortY ?? 0) / rowBucket);
        const rowB = Math.floor((b.sortY ?? 0) / rowBucket);
        return rowA !== rowB ? rowA - rowB : (a.sortX ?? 0) - (b.sortX ?? 0);
      });
    }

    // Labels from red rects are authoritative — no re-sequencing.
    // The user/extraction placed specific numbers on specific images.
    setApplyProgress(88, 'Finalising labels…');

    setApplyProgress(92, 'Loading into app…', `${framesToLoad.length} frames`);
    await new Promise(r => setTimeout(r, 50));

    closePdfAdjust();

    // Load into app
    resetStoryboardState();
    if (fileName) useStore.setState({ lastPdfName: fileName });
    const s = state();
    const frameStartIdx = s.frames.length;
    let nextId = s.nextId;
    for (const item of framesToLoad) {
      const id = nextId++;
      s.frames.push({
        id, src: item.src, label: item.label,
        cropW: item.cropW, cropH: item.cropH,
        strokes: [], drawMode: false,
        textContent: item.textContent || '', tableData: null,
      });
      s.versions[id] = [{ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null }];
      s.activeTab[id] = 0;
      s.drawColor[id] = COLORS[0];
      s.drawWidth[id] = 6;
      s.drawEraser[id] = false;
    }
    for (let i = frameStartIdx; i < s.frames.length; i++) {
      if (!s.frames[i].label) s.frames[i].label = '#' + (i - frameStartIdx + 1);
    }
    useStore.setState({ nextId });
    updateFrameBadge();
    showToast(`${framesToLoad.length} frames loaded from adjusted positions`);
    requestAnimationFrame(() => { (window as any).__fh_renderAll?.(); });
  } catch (err) {
    console.error('[pdfAdjust] Apply failed:', err);
    showToast('Error applying adjustments');
  }
}
