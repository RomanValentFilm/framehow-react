// PDF Import Adjustment Tool
// Shows PDF pages with draggable rectangles over detected images (green),
// text areas (blue), and label areas (red). User adjusts rectangles to
// correct the extraction, then re-extracts with the adjusted positions.

import * as pdfjsLib from 'pdfjs-dist';
import { showToast, setProgress } from './modals';
import { extractCandidates, getTextItems, matchLabel, matchText } from './pdf';
import type { Candidate, TextItem } from './pdf';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdjustRect {
  id: string;
  type: 'image' | 'text' | 'label';
  x: number; y: number; w: number; h: number; // relative to page (0–1)
  pageIdx: number;
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
      <div style="display:flex;gap:8px;">
        <button id="pdfAdjustAddImage" style="padding:5px 12px;border-radius:6px;border:1px solid #00c850;background:transparent;color:#00c850;font-size:12px;cursor:pointer;">+ Image</button>
        <button id="pdfAdjustAddText" style="padding:5px 12px;border-radius:6px;border:1px solid #3c82ff;background:transparent;color:#3c82ff;font-size:12px;cursor:pointer;">+ Text</button>
        <button id="pdfAdjustAddLabel" style="padding:5px 12px;border-radius:6px;border:1px solid #ff3c3c;background:transparent;color:#ff3c3c;font-size:12px;cursor:pointer;">+ Label</button>
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
      <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#ff3c3c;">◼ Label/Number</span>
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

export function closePdfAdjust(): void {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _pages = [];
  _pdfDoc = null;
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

const RENDER_SCALE = 1.5; // balance between quality and performance

async function renderAllPages(): Promise<void> {
  const container = document.getElementById('pdfAdjustPages')!;
  container.innerHTML = '';
  _pages = [];
  const allPageCandidates: { candidates: Candidate[]; pageW: number; pageH: number }[] = [];

  for (let p = 1; p <= _pdfDoc.numPages; p++) {
    const page = await _pdfDoc.getPage(p);
    const vp = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;

    const pageData: PageData = {
      pageNum: p,
      canvas,
      width: canvas.width,
      height: canvas.height,
      rects: [],
    };
    _pages.push(pageData);

    // Auto-detect using the SAME logic as handlePDF
    await autoDetectRects(page, pageData, allPageCandidates);

    // Build page element
    const pageEl = document.createElement('div');
    pageEl.className = 'pdfAdjustPage';
    pageEl.dataset.pageIdx = String(p - 1);
    pageEl.style.cssText = 'position:relative;display:inline-block;border:1px solid #333;';

    // Page number label
    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;top:-20px;left:0;font-size:11px;color:#666;font-family:monospace;';
    label.textContent = `Page ${p}`;
    pageEl.appendChild(label);

    // The PDF page canvas
    canvas.style.cssText = `display:block;max-width:90vw;height:auto;`;
    pageEl.appendChild(canvas);

    // SVG overlay for rectangles
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    svg.id = `pdfAdjustSvg_${p - 1}`;
    pageEl.appendChild(svg);

    // Interaction layer
    const interactLayer = document.createElement('div');
    interactLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;';
    interactLayer.dataset.pageIdx = String(p - 1);
    wireInteraction(interactLayer, p - 1);
    pageEl.appendChild(interactLayer);

    container.appendChild(pageEl);
    renderRectsForPage(p - 1);
  }
}

// ---------------------------------------------------------------------------
// Auto-detect rectangles — runs the EXACT same logic as handlePDF:
// extractCandidates → dominant size filter → matchLabel → matchText
// Only shows what the real extraction would find.
// ---------------------------------------------------------------------------

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
    text.textContent = rect.type.toUpperCase();
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
    const HANDLE_R = 0.015; // relative handle hit radius

    // Check active rect's handles first
    if (_activeRect && _activeRect.pageIdx === pageIdx) {
      const r = _activeRect;
      const corners = [
        { x: r.x, y: r.y, name: 'nw' },
        { x: r.x + r.w, y: r.y, name: 'ne' },
        { x: r.x, y: r.y + r.h, name: 'sw' },
        { x: r.x + r.w, y: r.y + r.h, name: 'se' },
      ];
      for (const c of corners) {
        if (Math.abs(pos.x - c.x) < HANDLE_R && Math.abs(pos.y - c.y) < HANDLE_R) {
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
    e.preventDefault();
    const pos = getPos('touches' in e ? e.touches[0] : e);
    const hit = findHit(pos);
    if (hit) {
      _activeRect = hit.rect;
      _dragHandle = hit.handle;
      _dragStartX = pos.x;
      _dragStartY = pos.y;
      _dragStartRect = { x: hit.rect.x, y: hit.rect.y, w: hit.rect.w, h: hit.rect.h };
      isDown = true;
    } else {
      _activeRect = null;
    }
    renderRectsForPage(pageIdx);
  }

  function onMove(e: MouseEvent | TouchEvent): void {
    if (!isDown || !_activeRect || !_dragHandle) return;
    e.preventDefault();
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

  const newRect: AdjustRect = {
    id: `p${targetIdx}_new_${Date.now()}`,
    type,
    x: 0.2, y: 0.2, w: 0.3, h: 0.2,
    pageIdx: targetIdx,
  };
  page.rects.push(newRect);
  _activeRect = newRect;
  renderRectsForPage(targetIdx);
}

function onKeyDown(e: KeyboardEvent): void {
  if ((e.key === 'Delete' || e.key === 'Backspace') && _activeRect) {
    const page = _pages[_activeRect.pageIdx];
    if (page) {
      page.rects = page.rects.filter(r => r.id !== _activeRect!.id);
      renderRectsForPage(_activeRect.pageIdx);
      _activeRect = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Apply — re-extract with adjusted rectangles
// ---------------------------------------------------------------------------

async function onApply(): Promise<void> {
  if (!_pdfDoc || _pages.length === 0) {
    showToast('No PDF loaded');
    return;
  }
  showToast('Applying adjusted extraction…');
  // TODO: Step 4 — use the adjusted rects to extract frames, text, labels
  // and replace the current project's frames
  closePdfAdjust();
}
