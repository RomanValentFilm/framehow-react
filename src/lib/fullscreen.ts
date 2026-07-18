// Fullscreen overlay (desktop/tablet only) — opens a frame or version
// in a large overlay with the same drawing toolbar.

import { COLORS, state, useStore, bumpRenderTick } from '../store/state';
import type { StripType } from '../store/state';
import { drawToolbarHTML, starHTML, getStripVersions, stripTabPrefix, ensureStripVersions, getStripActiveTab, setStripActiveTab, addNewStripVersion } from './helpers';
import { restoreCanvas, restoreMainCanvas, setupDrawing, setupMainDrawing, snapshotFrame } from './drawing';
import { resetToolbarState } from './view';
import { flushSyncNow } from './currentProject';
import { openCamera } from './camera';
import { openTextModal } from './modals';

// Default draw settings: blue, middle thickness, no eraser
const DEFAULT_DRAW_COLOR = COLORS[4]; // #3080e0 blue
const DEFAULT_DRAW_WIDTH = 12;        // middle thickness

// Global "last used" — persists across frames within the session
let _lastColor: string = DEFAULT_DRAW_COLOR;
let _lastWidth: number = DEFAULT_DRAW_WIDTH;

const fsCollapseSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/></svg>';

/** Check if any visible version in a strip has content (image or strokes) */
export function stripHasContent(fid: number, strip: StripType): boolean {
  const vers = getStripVersions(fid, strip);
  return vers.some(v => !v.hidden && (v.bgImage || (v.strokes && v.strokes.length > 0)));
}

export function openFullscreen(fid: number, startVi: number, origin: 'main' | 'ver' | 'floor' | 'refs', initialMode?: 'draw' | 'cam'): void {
  if (document.querySelector('.fs-overlay')) return;
  useStore.setState({ fsOverlayActive: { fid, vi: startVi, origin } });
  const s = state();
  const f = s.frames.find((x) => x.id === fid)!;
  const strip: StripType = origin === 'main' ? 'ver' : origin as StripType;
  let vi = startVi;
  let ver = getStripVersions(fid, strip)[vi];
  const isMain = origin === 'main';
  const src: any = isMain ? f : ver;
  if (!src) return;

  // Current mode: draw (default), cam, write
  let fsMode: 'draw' | 'cam' | 'write' = 'draw';

  // Apply last-used color/width (carries across frames), eraser always off
  s.drawColor[fid] = _lastColor;
  s.drawWidth[fid] = _lastWidth;
  s.drawEraser[fid] = false;

  const overlay = document.createElement('div');
  overlay.className = 'fs-overlay';

  const cw = (f && f.cropW) || 960,
    ch = (f && f.cropH) || 540;
  const aspect = cw / ch;

  function getCid() { return 'fs_cvs_' + fid + '_' + vi; }

  function calcSize() {
    const maxW = window.innerWidth - 40;
    const maxH = window.innerHeight - 100;
    let dw = maxW,
      dh = maxW / aspect;
    if (dh > maxH) {
      dh = maxH;
      dw = maxH * aspect;
    }
    return { dw, dh };
  }

  function buildVersionTabs(): string {
    if (isMain) return '';
    const vers = getStripVersions(fid, strip);
    const prefix = stripTabPrefix(strip);
    const tabs = vers.map((v, i) =>
      `<button class="vtab${i === vi ? ' active' : ''}" data-fstab="${i}">${v.label || prefix + (i + 1)}</button>`
    ).join('');
    return `<div class="fs-strip-tabs"><span class="frame-label-tag">${f.label || '#'}</span><div class="version-tabs">${tabs}<button class="vtab-add" data-fsadd>+</button></div></div>`;
  }

  function buildBottomBar(): string {
    if (isMain) {
      // Main frame: just the draw toolbar, no mode buttons
      return `<div class="color-row fs-color-row">${drawToolbarHTML(fid, 'data-fsfid', fid)}</div>`;
    }
    const drawActive = fsMode === 'draw' ? ' active' : '';
    const camActive = fsMode === 'cam' ? ' active' : '';
    const writeActive = fsMode === 'write' ? ' active' : '';
    return `<div class="fs-bottom-bar">
      <div class="fs-mode-btns">
        <button class="fs-mode-btn${drawActive}" data-fsmode="draw">DRAW</button>
        <button class="fs-mode-btn${camActive}" data-fsmode="cam">CAM</button>
        <button class="fs-mode-btn${writeActive}" data-fsmode="write">WRITE</button>
      </div>
      <div class="color-row fs-color-row" style="${fsMode === 'draw' ? '' : 'display:none;'}">${drawToolbarHTML(fid, 'data-fsfid', fid)}</div>
    </div>`;
  }

  function buildOverlay() {
    const { dw, dh } = calcSize();
    const cid = getCid();
    overlay.innerHTML = `
      <button class="fs-close">${fsCollapseSVG}</button>
      <div class="fs-inner">
        ${buildVersionTabs()}
        <div class="fs-canvas-area">
          <div class="fs-canvas-wrap draw-active" style="width:${dw}px;height:${dh}px;cursor:crosshair;"><canvas id="${cid}" width="${cw}" height="${ch}" style="width:${dw}px;height:${dh}px;"></canvas>${
      !isMain ? starHTML(fid, vi) : ''
    }</div>
        </div>
        ${buildBottomBar()}
      </div>`;
  }

  function switchTab(newVi: number) {
    vi = newVi;
    ver = getStripVersions(fid, strip)[vi];
    if (!ver) return;
    setStripActiveTab(fid, strip, vi);
    useStore.setState({ fsOverlayActive: { fid, vi, origin } });
    fsMode = 'draw';
    buildOverlay();
    initCanvas();
    wireEvents();
  }

  // Refresh after camera capture (called via custom event from applyCapturedImage)
  function onFsRefresh() {
    const vers = getStripVersions(fid, strip);
    const newVi = getStripActiveTab(fid, strip);
    vi = Math.min(newVi, vers.length - 1);
    ver = vers[vi];
    if (!ver) return;
    fsMode = 'draw';
    buildOverlay();
    initCanvas();
    wireEvents();
  }

  function triggerCamera() {
    fsMode = 'cam';
    // Highlight CAM button
    overlay.querySelectorAll('.fs-mode-btn').forEach(b => b.classList.remove('active'));
    const camBtn = overlay.querySelector('[data-fsmode="cam"]');
    if (camBtn) camBtn.classList.add('active');
    // Hide draw toolbar
    const toolbar = overlay.querySelector('.fs-color-row') as HTMLElement | null;
    if (toolbar) toolbar.style.display = 'none';
    // Open camera — pass overlay as anchor div, fromCompare=false, fromMain=false
    openCamera(fid, overlay, false, false, strip);
  }

  function triggerWrite() {
    if (!ver) return;
    ver.strokes = ver.strokes || [];
    const existing = ver.strokes.find((st: any) => st.type === 'text');
    const curColor = existing ? existing.color : s.drawColor[fid] || '#fff';
    openTextModal(existing ? existing.text || '' : '', curColor || '#fff').then((result) => {
      if (result !== null) {
        snapshotFrame(fid, strip);
        const { text, color } = result;
        s.drawColor[fid] = color;
        if (existing) {
          if (text) {
            existing.text = text;
            existing.color = color;
          } else {
            ver.strokes = ver.strokes.filter((stk: any) => stk !== existing);
          }
        } else if (text) {
          ver.strokes.push({ type: 'text', text, color, x: 20, y: 50 });
        }
        if (ver.type === 'empty' && ver.strokes.length > 0) ver.type = 'drawing';
        bumpRenderTick();
      }
      // Refresh canvas to show text
      fsMode = 'draw';
      buildOverlay();
      initCanvas();
      wireEvents();
      void flushSyncNow();
    });
  }

  buildOverlay();
  // Lock body scroll so the page behind the overlay doesn't shift on iOS
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);

  function initCanvas() {
    const cid = getCid();
    const cvs = overlay.querySelector(`#${cid}`) as HTMLCanvasElement | null;
    if (!cvs) return;
    if (isMain && !f.drawMode) {
      f.drawMode = true;
      f.strokes = f.strokes || [];
      restoreMainCanvas(cvs, f);
      const _img = new Image();
      _img.src = f.src;
      _img.onload = () => setupMainDrawing(cvs, fid);
    } else if (isMain) {
      restoreMainCanvas(cvs, f);
      setupMainDrawing(cvs, fid);
    } else if (!isMain && ver) {
      restoreCanvas(cvs, ver);
      setupDrawing(cvs, fid, vi, strip);
    }
  }
  initCanvas();

  function wireEvents() {
    overlay.querySelector('.fs-close')!.addEventListener('click', () => closeFullscreen());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeFullscreen();
    });
    // Version tab switching
    overlay.querySelectorAll('[data-fstab]').forEach((t) =>
      t.addEventListener('click', () => {
        const idx = parseInt((t as HTMLElement).dataset.fstab!);
        if (idx !== vi) switchTab(idx);
      })
    );
    // Add new version
    const addBtn = overlay.querySelector('[data-fsadd]');
    if (addBtn) addBtn.addEventListener('click', () => {
      const vers = ensureStripVersions(fid, strip);
      const prefix = stripTabPrefix(strip);
      const n = vers.length + 1;
      const newVer = { id: n, label: `${prefix}${n}`, type: 'empty' as const, strokes: [], bgImage: null };
      addNewStripVersion(fid, strip, newVer);
      // Switch to the newly added version (last visible)
      const updatedVers = getStripVersions(fid, strip);
      switchTab(updatedVers.length - 1);
    });
    // Mode buttons (DRAW / CAM / WRITE)
    overlay.querySelectorAll('[data-fsmode]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.fsmode as 'draw' | 'cam' | 'write';
        if (mode === 'draw') {
          fsMode = 'draw';
          overlay.querySelectorAll('.fs-mode-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const toolbar = overlay.querySelector('.fs-color-row') as HTMLElement | null;
          if (toolbar) toolbar.style.display = '';
        } else if (mode === 'cam') {
          triggerCamera();
        } else if (mode === 'write') {
          triggerWrite();
        }
      })
    );
    // Draw toolbar: colors
    overlay.querySelectorAll('.color-dot').forEach((d) =>
      d.addEventListener('click', () => {
        const c = (d as HTMLElement).dataset.color!;
        state().drawColor[fid] = c;
        state().drawEraser[fid] = false;
        _lastColor = c; // remember globally
        overlay.querySelectorAll('.color-dot').forEach((dd) =>
          dd.classList.toggle('selected', (dd as HTMLElement).dataset.color === c)
        );
        // re-highlight active thickness
        const tw = String(state().drawWidth[fid] || _lastWidth);
        overlay.querySelectorAll('.thick-btn').forEach((dd) =>
          dd.classList.toggle('selected', (dd as HTMLElement).dataset.tw === tw)
        );
        overlay.querySelectorAll('.eraser-btn').forEach((dd) => dd.classList.remove('selected'));
      })
    );
    overlay.querySelectorAll('.thick-btn').forEach((d) =>
      d.addEventListener('click', () => {
        const w = parseInt((d as HTMLElement).dataset.tw!);
        state().drawWidth[fid] = w;
        state().drawEraser[fid] = false;
        _lastWidth = w; // remember globally
        overlay.querySelectorAll('.thick-btn').forEach((dd) =>
          dd.classList.toggle('selected', (dd as HTMLElement).dataset.tw === (d as HTMLElement).dataset.tw)
        );
        overlay.querySelectorAll('.eraser-btn').forEach((dd) => dd.classList.remove('selected'));
        // re-highlight active color
        const cc = state().drawColor[fid] || _lastColor;
        overlay.querySelectorAll('.color-dot').forEach((dd) =>
          dd.classList.toggle('selected', (dd as HTMLElement).dataset.color === cc)
        );
      })
    );
    overlay.querySelectorAll('.eraser-btn').forEach((d) =>
      d.addEventListener('click', () => {
        state().drawEraser[fid] = !state().drawEraser[fid];
        d.classList.toggle('selected', state().drawEraser[fid]);
        if (state().drawEraser[fid]) {
          overlay.querySelectorAll('.color-dot').forEach((dd) => dd.classList.remove('selected'));
        }
      })
    );
    // Undo button — remove last drawn stroke
    overlay.querySelectorAll('.draw-undo-btn').forEach((d) =>
      d.addEventListener('click', () => {
        const strokes = isMain ? f.strokes : (ver ? ver.strokes : null);
        if (!strokes || strokes.length === 0) return;
        // Find last non-text stroke and remove it
        for (let i = strokes.length - 1; i >= 0; i--) {
          if (strokes[i].type !== 'text') {
            strokes.splice(i, 1);
            break;
          }
        }
        // Re-render canvas
        const cvs = overlay.querySelector('canvas') as HTMLCanvasElement | null;
        if (cvs) {
          if (isMain) restoreMainCanvas(cvs, f);
          else if (ver) restoreCanvas(cvs, ver);
          if (isMain) setupMainDrawing(cvs, fid);
          else setupDrawing(cvs, fid, vi, strip);
        }
        bumpRenderTick();
      })
    );
  }
  wireEvents();

  // Listen for camera capture refresh
  window.addEventListener('fs-refresh', onFsRefresh);

  function onResize() {
    const { dw, dh } = calcSize();
    const wrap = overlay.querySelector('.fs-canvas-wrap') as HTMLElement | null;
    const cvs = overlay.querySelector('canvas') as HTMLCanvasElement | null;
    if (wrap) {
      wrap.style.width = dw + 'px';
      wrap.style.height = dh + 'px';
    }
    if (cvs) {
      cvs.style.width = dw + 'px';
      cvs.style.height = dh + 'px';
    }
    if (cvs) {
      if (isMain) restoreMainCanvas(cvs, f);
      else if (ver) restoreCanvas(cvs, ver);
      if (isMain) setupMainDrawing(cvs, fid);
      else setupDrawing(cvs, fid, vi, strip);
    }
  }
  window.addEventListener('resize', onResize);
  (overlay as any)._resizeHandler = onResize;
  (overlay as any)._fsRefreshHandler = onFsRefresh;
  (overlay as any)._escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeFullscreen();
  };
  document.addEventListener('keydown', (overlay as any)._escHandler);

  // If initial mode is 'cam', trigger camera after overlay is ready
  if (initialMode === 'cam' && !isMain) {
    setTimeout(() => triggerCamera(), 100);
  }
}

export function closeFullscreen(): void {
  const overlay = document.querySelector('.fs-overlay') as HTMLElement | null;
  if (!overlay) return;
  const s = state();
  // Reset crossCompare so 3x2 card shows main frame content, not the version
  const fsInfo = s.fsOverlayActive;
  if (fsInfo) {
    s.crossCompare[fsInfo.fid] = -1;
  }
  document.removeEventListener('keydown', (overlay as any)._escHandler);
  if ((overlay as any)._resizeHandler) window.removeEventListener('resize', (overlay as any)._resizeHandler);
  if ((overlay as any)._fsRefreshHandler) window.removeEventListener('fs-refresh', (overlay as any)._fsRefreshHandler);
  overlay.remove();
  document.body.style.overflow = '';
  useStore.setState({ fsOverlayActive: null });
  resetToolbarState();
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
  void flushSyncNow(); // DRW-5: close fullscreen canvas → end of drawing session
}
