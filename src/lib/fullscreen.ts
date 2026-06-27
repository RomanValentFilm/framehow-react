// Fullscreen overlay (desktop/tablet only) — opens a frame or version
// in a large overlay with the same drawing toolbar.

import { COLORS, state, useStore } from '../store/state';
import type { StripType } from '../store/state';
import { drawToolbarHTML, starHTML, getStripVersions } from './helpers';
import { restoreCanvas, restoreMainCanvas, setupDrawing, setupMainDrawing } from './drawing';
import { resetToolbarState } from './view';
import { flushSyncNow } from './currentProject';

// Default draw settings: blue, middle thickness, no eraser
const DEFAULT_DRAW_COLOR = COLORS[4]; // #3080e0 blue
const DEFAULT_DRAW_WIDTH = 12;        // middle thickness

// Global "last used" — persists across frames within the session
let _lastColor: string = DEFAULT_DRAW_COLOR;
let _lastWidth: number = DEFAULT_DRAW_WIDTH;

const fsCollapseSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/></svg>';

export function openFullscreen(fid: number, vi: number, origin: 'main' | 'ver' | 'floor' | 'refs'): void {
  if (document.querySelector('.fs-overlay')) return;
  useStore.setState({ fsOverlayActive: { fid, vi, origin } });
  const s = state();
  const f = s.frames.find((x) => x.id === fid)!;
  const strip: StripType = origin === 'main' ? 'ver' : origin as StripType;
  const ver = getStripVersions(fid, strip)[vi];
  const isMain = origin === 'main';
  const src: any = isMain ? f : ver;
  if (!src) return;

  // Apply last-used color/width (carries across frames), eraser always off
  s.drawColor[fid] = _lastColor;
  s.drawWidth[fid] = _lastWidth;
  s.drawEraser[fid] = false;

  const overlay = document.createElement('div');
  overlay.className = 'fs-overlay';

  const cw = (f && f.cropW) || 960,
    ch = (f && f.cropH) || 540;
  const aspect = cw / ch;

  const cid = 'fs_cvs_' + fid + '_' + vi;

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

  function buildOverlay() {
    const { dw, dh } = calcSize();
    overlay.innerHTML = `
      <button class="fs-close">${fsCollapseSVG}</button>
      <div class="fs-inner">
        <div class="fs-canvas-area">
          <div class="fs-canvas-wrap draw-active" style="width:${dw}px;height:${dh}px;cursor:crosshair;"><canvas id="${cid}" width="${cw}" height="${ch}" style="width:${dw}px;height:${dh}px;"></canvas>${
      !isMain ? starHTML(fid, vi) : ''
    }</div>
        </div>
        <div class="color-row fs-color-row">${drawToolbarHTML(fid, 'data-fsfid', fid)}</div>
      </div>`;
  }

  buildOverlay();
  // Lock body scroll so the page behind the overlay doesn't shift on iOS
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);

  function initCanvas() {
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
  }
  wireEvents();

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
  (overlay as any)._escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeFullscreen();
  };
  document.addEventListener('keydown', (overlay as any)._escHandler);
}

export function closeFullscreen(): void {
  const overlay = document.querySelector('.fs-overlay') as HTMLElement | null;
  if (!overlay) return;
  document.removeEventListener('keydown', (overlay as any)._escHandler);
  if ((overlay as any)._resizeHandler) window.removeEventListener('resize', (overlay as any)._resizeHandler);
  overlay.remove();
  document.body.style.overflow = '';
  useStore.setState({ fsOverlayActive: null });
  resetToolbarState();
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
  void flushSyncNow(); // DRW-5: close fullscreen canvas → end of drawing session
}
