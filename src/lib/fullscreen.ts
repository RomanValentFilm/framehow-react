// Fullscreen overlay (desktop/tablet only) — opens a frame or version
// in a large overlay with the same drawing toolbar.

import { COLORS, state, useStore, bumpRenderTick } from '../store/state';
import type { StripType } from '../store/state';
import { drawToolbarHTML, starHTML, toggleStar, getStripVersions, stripTabPrefix, stripScrollId, ensureStripVersions, getStripActiveTab, setStripActiveTab, addNewStripVersion, relabelStripVersions, revealActiveVersionTab } from './helpers';
import { restoreCanvas, restoreMainCanvas, setupDrawing, setupMainDrawing, snapshotFrame } from './drawing';
import { resetToolbarState } from './view';
import { stampChangedContent } from './changeStamps';
import { flushSyncNow, markFrameDirty } from './currentProject';
import { openCamera } from './camera';
import { openTextModal, showVersionChoice } from './modals';
import { stripTagHTML, handleStripTagClick } from './setups';

// Default draw settings: blue, middle thickness, no eraser
const DEFAULT_DRAW_COLOR = COLORS[4]; // #3080e0 blue
const DEFAULT_DRAW_WIDTH = 12;        // middle thickness

// Global "last used" — persists across frames within the session
// Fullscreen used to keep a colour of its own here, which nothing else knew
// about — that was half of why the pen kept changing (#336). The one pen
// colour now lives in the store, with everything else.
let _lastWidth: number = DEFAULT_DRAW_WIDTH;

const fsCollapseSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/></svg>';

/** Find the source card element for open/close animation */
function findSourceCard(fid: number, origin?: string): HTMLElement | null {
  // 3x2 card canvas
  const g3 = document.querySelector(`.grid3x2-card-wrap[data-g3fid="${fid}"] .canvas-wrap`) as HTMLElement | null;
  if (g3 && g3.offsetParent) return g3;
  // Main frame canvas
  if (origin === 'main') {
    const main = document.querySelector(`.frame-card[data-mfid="${fid}"] .canvas-wrap`) as HTMLElement | null;
    if (main && main.offsetParent) return main;
  }
  // Specific strip scroll container (finds the right canvas in multi-strip views)
  const strip = (!origin || origin === 'main') ? 'ver' : origin;
  const scrollId = stripScrollId(strip as StripType);
  const stripEl = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"] .canvas-wrap`) as HTMLElement | null;
  if (stripEl && stripEl.offsetParent) return stripEl;
  // Fallback: any version frame canvas
  const ver = document.querySelector(`.frame-card[data-vfid="${fid}"] .canvas-wrap`) as HTMLElement | null;
  if (ver && ver.offsetParent) return ver;
  return null;
}

/** Check if any visible version in a strip has content (image or strokes) */
export function stripHasContent(fid: number, strip: StripType): boolean {
  const vers = getStripVersions(fid, strip);
  return vers.some(v => !v.hidden && (v.bgImage || (v.strokes && v.strokes.length > 0)));
}

/** Extra breathing room under the button row when opened from a grid card. */
const FS_GRID_BOTTOM_GAP = 24;

export function openFullscreen(
  fid: number,
  startVi: number,
  origin: 'main' | 'ver' | 'floor' | 'refs',
  initialMode?: 'draw' | 'cam',
  /** Opened from a CAST BOARD / 3x2 grid card rather than a strip column.
   *  Those cards sit low on the page, so the picture is shrunk slightly to
   *  keep the button row clear of the bottom edge. */
  fromGrid = false,
): void {
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

  // Draw-only mode: triggered by DRAW buttons — just toolbar, no mode buttons
  // Full mode: triggered by VERSN buttons — all buttons, starts neutral
  const drawOnly = initialMode === 'draw';

  // Current mode: none (neutral), draw, cam, write
  let fsMode: 'none' | 'draw' | 'cam' | 'write' = drawOnly ? 'draw' : 'none';
  let fsReorder = false;

  // Apply last-used color/width (carries across frames), eraser always off
  s.drawWidth[fid] = _lastWidth;
  s.drawEraser[fid] = false;

  const overlay = document.createElement('div');
  // FITTING and 9:16 projects only — landscape projects are untouched.
  const gridGap = fromGrid && state().portraitMode;
  overlay.className = 'fs-overlay';

  const cw = (f && f.cropW) || 960,
    ch = (f && f.cropH) || 540;
  const aspect = cw / ch;

  function getCid() { return 'fs_cvs_' + fid + '_' + vi; }

  function calcSize() {
    const maxW = window.innerWidth - 40;
    const maxH = window.innerHeight - 100 - (gridGap ? FS_GRID_BOTTOM_GAP : 0);
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
    const isHidden = ver && ver.hidden;
    const tabs = vers.map((v, i) => {
      const activeClass = i === vi ? ' active' + (fsReorder ? ' reorder-highlight' : '') : '';
      const hiddenStyle = v.hidden ? ' style="opacity:0.3;"' : '';
      return `<button class="vtab${activeClass}" data-fstab="${i}"${hiddenStyle}>${v.label || prefix + (i + 1)}</button>`;
    }).join('');
    // Right side: Un-Hide (if hidden) or reorder-group (if multiple tabs)
    let rightHTML = '';
    if (isHidden) {
      rightHTML = `<button class="btn" data-fsunhide style="margin-left:auto;font-size:10px;padding:2px 10px;">Un-Hide</button>`;
    } else if (vers.length > 1) {
      const { dw } = calcSize();
      const offsetPx = Math.round(dw * 0.02);
      rightHTML = `<div class="reorder-group${fsReorder ? ' active' : ''}" style="margin-left:auto;margin-right:${offsetPx}px;"><button class="vtab-add" data-fsmove="left" title="Move left">◀</button>${
        fsReorder
          ? `<span class="reorder-label" data-fsreorderdone>DONE</span>`
          : `<span class="reorder-label" data-fsreorderstart>move</span>`
      }<button class="vtab-add" data-fsmove="right" title="Move right">▶</button></div>`;
    }
    const { dw: tabsW } = calcSize();
    return `<div class="fs-strip-tabs" style="width:${tabsW}px;max-width:${tabsW}px;"><span class="frame-label-tag">${f.label || '#'}</span><div class="version-tabs">${tabs}<button class="vtab-add" data-fsadd>+</button></div>${rightHTML}</div>`;
  }

  function buildBottomBar(): string {
    const isHidden = !isMain && ver && ver.hidden;
    const disabledAttr = isHidden ? ' disabled style="opacity:0.3;pointer-events:none;"' : '';

    // Draw-only mode: just the drawing toolbar, no mode buttons
    if (drawOnly) {
      return `<div class="fs-bottom-bar">
        <div class="color-row fs-color-row">${drawToolbarHTML(fid, 'data-fsfid', fid)}</div>
      </div>`;
    }

    // Full mode: all buttons, toolbar hidden until DRAW pressed
    const drawActive = fsMode === 'draw' ? ' active' : '';
    const camActive = fsMode === 'cam' ? ' active' : '';
    const writeActive = fsMode === 'write' ? ' active' : '';
    return `<div class="fs-bottom-bar">
      ${!isMain ? `<button class="fs-util-btn" data-fsutil="load"${disabledAttr}>Load</button>` : ''}
      <div class="fs-mode-btns">
        <button class="fs-mode-btn${drawActive}" data-fsmode="draw"${disabledAttr}>DRAW</button>
        <button class="fs-mode-btn${camActive}" data-fsmode="cam"${disabledAttr}>CAM</button>
        <button class="fs-mode-btn${writeActive}" data-fsmode="write"${disabledAttr}>WRITE</button>
      </div>
      ${!isMain ? `<button class="fs-util-btn" data-fsutil="hide"${disabledAttr}>Hide</button>` : ''}
      <div class="color-row fs-color-row" style="${fsMode === 'draw' && !isHidden ? '' : 'display:none;'}">${drawToolbarHTML(fid, 'data-fsfid', fid)}</div>
    </div>`;
  }

  function buildOverlay() {
    const { dw, dh } = calcSize();
    // Only pay out the bottom gap if the picture actually gave up height for
    // it; otherwise the block would just drift upwards for no reason.
    if (gridGap && dh >= window.innerHeight - 100 - FS_GRID_BOTTOM_GAP - 1) {
      overlay.classList.add('fs-from-grid');
    }

    const cid = getCid();
    const isHidden = !isMain && ver && ver.hidden;
    const canvasStyle = `width:${dw}px;height:${dh}px;${isHidden ? 'opacity:0.3;pointer-events:none;' : fsReorder ? 'pointer-events:none;' : fsMode === 'draw' ? 'cursor:crosshair;' : 'pointer-events:none;cursor:default;'}`;
    const wrapStyle = `width:${dw}px;height:${dh}px;${fsReorder ? 'outline:2px solid #d52632;outline-offset:-2px;' : ''}`;
    const wrapClass = `fs-canvas-wrap${fsMode === 'draw' ? ' draw-active' : ''}`;

    // Navigation arrows (skip hidden versions)
    let navLeft = '', navRight = '';
    if (!isMain && !fsReorder) {
      const allVers = getStripVersions(fid, strip);
      const hasPrev = allVers.slice(0, vi).some(v => !v.hidden);
      const hasNext = allVers.slice(vi + 1).some(v => !v.hidden);
      if (hasPrev) navLeft = '<button class="nav-arrow nav-arrow-left" data-fsnav="left">‹</button>';
      if (hasNext) navRight = '<button class="nav-arrow nav-arrow-right" data-fsnav="right">›</button>';
    }

    overlay.innerHTML = `
      <button class="fs-close">${fsCollapseSVG}</button>
      <div class="fs-inner">
        ${buildVersionTabs()}
        <div class="fs-canvas-area">
          <div class="${wrapClass}" style="${wrapStyle}"><canvas id="${cid}" width="${cw}" height="${ch}" style="${canvasStyle}"></canvas>${
      !isMain && !isHidden ? starHTML(fid, vi, strip) : ''
    }${!isMain && !isHidden ? stripTagHTML(fid, vi, strip) : ''}${navLeft}${navRight}</div>
        </div>
        ${buildBottomBar()}
      </div>`;
    // Make sure the active tab is on screen in its row — with many versions it
    // can otherwise sit off the end, hiding which Look you are drawing into.
    requestAnimationFrame(() => revealActiveVersionTab(overlay));
  }

  function switchTab(newVi: number) {
    vi = newVi;
    ver = getStripVersions(fid, strip)[vi];
    if (!ver) return;
    setStripActiveTab(fid, strip, vi);
    useStore.setState({ fsOverlayActive: { fid, vi, origin } });
    fsMode = drawOnly ? 'draw' : 'none';
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
    fsMode = drawOnly ? 'draw' : 'none';
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
    const curColor = existing ? existing.color : s.penColor || '#fff';
    openTextModal(existing ? existing.text || '' : '', curColor || '#fff').then((result) => {
      if (result !== null) {
        snapshotFrame(fid, strip);
        const { text, color } = result;
        s.drawColor[fid] = color;
        useStore.setState({ penColor: color });   // one pen (#336)
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
      fsMode = drawOnly ? 'draw' : 'none';
      buildOverlay();
      initCanvas();
      wireEvents();
      void flushSyncNow();
    });
  }

  buildOverlay();
  // Lock body scroll so the page behind the overlay doesn't shift on iOS
  document.body.style.overflow = 'hidden';

  // Prepare opening animation (set transparent before appending so no flash)
  const sourceEl = findSourceCard(fid, origin);
  if (sourceEl) overlay.style.background = 'transparent';

  document.body.appendChild(overlay);

  function initCanvas() {
    const cid = getCid();
    const cvs = overlay.querySelector(`#${cid}`) as HTMLCanvasElement | null;
    if (!cvs) return;
    if (isMain && !f.drawMode) {
      f.drawMode = true;
      f.strokes = f.strokes || [];
      restoreMainCanvas(cvs, f);
      // Switch drawing on straight away. This used to wait for the frame's
      // image to finish loading — but a frame with no image, or one whose
      // image is already cached, never reports finishing, so drawing was
      // never switched on and the first open after loading a project was dead.
      setupMainDrawing(cvs, fid);
      if (f.src) {
        const _img = new Image();
        _img.onload = () => {
          // Not while a stroke is in progress — the repaint would wipe the
          // line under the user's finger. It is redrawn when the stroke ends.
          if (state().drawingInProgress) return;
          restoreMainCanvas(cvs, f);
        };
        _img.src = f.src;                              // set src AFTER onload
      }
    } else if (isMain) {
      restoreMainCanvas(cvs, f);
      setupMainDrawing(cvs, fid);
    } else if (!isMain && ver) {
      restoreCanvas(cvs, ver);
      setupDrawing(cvs, fid, vi, strip);
    }
  }
  initCanvas();

  /** Exit reorder mode if active, rebuild overlay */
  function exitReorder() {
    if (!fsReorder) return;
    fsReorder = false;
    relabelStripVersions(fid, strip);
    bumpRenderTick();
    void flushSyncNow();
    buildOverlay();
    initCanvas();
    wireEvents();
  }

  function wireEvents() {
    overlay.querySelector('.fs-close')!.addEventListener('click', () => closeFullscreen());
    // Version tab switching
    overlay.querySelectorAll('[data-fstab]').forEach((t) =>
      t.addEventListener('click', () => {
        exitReorder();
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
    // Load button — trigger file picker for this version
    overlay.querySelectorAll('[data-fsutil="load"]').forEach((btn) =>
      btn.addEventListener('click', () => {
        exitReorder();
        useStore.setState({ imgTarget: { fid, div: overlay, fromCompare: false, stripType: strip } });
        (document.getElementById('imgInput') as HTMLInputElement).removeAttribute('capture');
        (document.getElementById('imgInput') as HTMLInputElement).click();
      })
    );
    // Hide button — hide current version (same as strip Hide)
    overlay.querySelectorAll('[data-fsutil="hide"]').forEach((btn) =>
      btn.addEventListener('click', () => {
        exitReorder();
        if (!ver) return;
        showVersionChoice().then((choice) => {
          if (!choice) return;
          if (choice === 'hide') {
            ver.hidden = true;
            const allVers = getStripVersions(fid, strip);
            const curIdx = allVers.indexOf(ver);
            if (curIdx >= 0) {
              allVers.splice(curIdx, 1);
              let lastVisible = -1;
              for (let i = 0; i < allVers.length; i++) {
                if (!allVers[i].hidden) lastVisible = i;
              }
              allVers.splice(lastVisible + 1, 0, ver);
              const visibleIdx = allVers.findIndex((v) => !v.hidden);
              setStripActiveTab(fid, strip, visibleIdx >= 0 ? visibleIdx : 0);
            }
            relabelStripVersions(fid, strip);
          } else {
            // Delete
            snapshotFrame(fid, strip);
            const allVers = getStripVersions(fid, strip);
            const curIdx = allVers.indexOf(ver);
            if (curIdx >= 0) allVers.splice(curIdx, 1);
            if (allVers.length === 0) allVers.push({ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null });
            setStripActiveTab(fid, strip, Math.min(getStripActiveTab(fid, strip), allVers.length - 1));
            relabelStripVersions(fid, strip);
          }
          bumpRenderTick();
          void flushSyncNow();
          // Switch to first visible version or close if none left
          const updatedVers = getStripVersions(fid, strip);
          const visibleVers = updatedVers.filter(v => !v.hidden);
          if (visibleVers.length === 0) {
            closeFullscreen();
          } else {
            const newVi = updatedVers.indexOf(visibleVers[0]);
            switchTab(newVi >= 0 ? newVi : 0);
          }
        });
      })
    );
    // Move arrows — swap version position (also activates reorder if not active)
    overlay.querySelectorAll('[data-fsmove]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!fsReorder) {
          vi = getStripActiveTab(fid, strip);
          ver = getStripVersions(fid, strip)[vi];
          fsReorder = true;
        }
        const dir = (btn as HTMLElement).dataset.fsmove as 'left' | 'right';
        const allVers = getStripVersions(fid, strip);
        const ai = getStripActiveTab(fid, strip);
        if (dir === 'left' && ai > 0) {
          [allVers[ai - 1], allVers[ai]] = [allVers[ai], allVers[ai - 1]];
          setStripActiveTab(fid, strip, ai - 1);
        } else if (dir === 'right' && ai < allVers.length - 1) {
          [allVers[ai], allVers[ai + 1]] = [allVers[ai + 1], allVers[ai]];
          setStripActiveTab(fid, strip, ai + 1);
        } else return;
        relabelStripVersions(fid, strip);
        vi = getStripActiveTab(fid, strip);
        ver = allVers[vi];
        useStore.setState({ fsOverlayActive: { fid, vi, origin } });
        buildOverlay();
        initCanvas();
        wireEvents();
      })
    );
    // Reorder start
    const startBtn = overlay.querySelector('[data-fsreorderstart]');
    if (startBtn) startBtn.addEventListener('click', () => {
      vi = getStripActiveTab(fid, strip);
      ver = getStripVersions(fid, strip)[vi];
      fsReorder = true;
      buildOverlay();
      initCanvas();
      wireEvents();
    });
    // Reorder done
    const doneBtn = overlay.querySelector('[data-fsreorderdone]');
    if (doneBtn) doneBtn.addEventListener('click', () => {
      fsReorder = false;
      relabelStripVersions(fid, strip);
      bumpRenderTick();
      void flushSyncNow();
      buildOverlay();
      initCanvas();
      wireEvents();
    });
    // Un-Hide button — restore hidden version
    const unhideBtn = overlay.querySelector('[data-fsunhide]');
    if (unhideBtn) unhideBtn.addEventListener('click', () => {
      if (!ver) return;
      ver.hidden = false;
      relabelStripVersions(fid, strip);
      bumpRenderTick();
      void flushSyncNow();
      buildOverlay();
      initCanvas();
      wireEvents();
    });
    // Mode buttons (DRAW / CAM / WRITE) — only in full mode
    overlay.querySelectorAll('[data-fsmode]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.fsmode as 'draw' | 'cam' | 'write';
        if (fsReorder) exitReorder();
        if (mode === 'draw') {
          if (fsMode === 'draw') {
            // Toggle off → neutral
            fsMode = 'none';
            overlay.querySelectorAll('.fs-mode-btn').forEach(b => b.classList.remove('active'));
            const toolbar = overlay.querySelector('.fs-color-row') as HTMLElement | null;
            if (toolbar) toolbar.style.display = 'none';
            const cvs = overlay.querySelector('canvas') as HTMLElement | null;
            if (cvs) { cvs.style.pointerEvents = 'none'; cvs.style.cursor = 'default'; }
            const wrap = overlay.querySelector('.fs-canvas-wrap') as HTMLElement | null;
            if (wrap) wrap.classList.remove('draw-active');
          } else {
            // Activate draw
            fsMode = 'draw';
            overlay.querySelectorAll('.fs-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const toolbar = overlay.querySelector('.fs-color-row') as HTMLElement | null;
            if (toolbar) toolbar.style.display = '';
            const cvs = overlay.querySelector('canvas') as HTMLElement | null;
            if (cvs) { cvs.style.pointerEvents = ''; cvs.style.cursor = 'crosshair'; }
            const wrap = overlay.querySelector('.fs-canvas-wrap') as HTMLElement | null;
            if (wrap) wrap.classList.add('draw-active');
          }
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
        useStore.setState({ penColor: c });   // one pen (#336)
        state().drawEraser[fid] = false;
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
        const cc = state().penColor;                 // one pen (#336)
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
        // Draw what is left. The canvas is the same one and is already being
        // listened to — asking again is what made every stroke be recorded
        // twice, then three times, then four (#334).
        const cvs = overlay.querySelector('canvas') as HTMLCanvasElement | null;
        if (cvs) {
          if (isMain) restoreMainCanvas(cvs, f);
          else if (ver) restoreCanvas(cvs, ver);
        }
        // Undoing is a change to the drawing like any other, and the app has to
        // know there is something to send (#335). Strokes are changed in place,
        // which the usual watcher cannot see.
        if (f.serverFrameId) markFrameDirty(f.serverFrameId);
        stampChangedContent();
        bumpRenderTick();
      })
    );
    // Navigation arrows — switch to prev/next visible version
    overlay.querySelectorAll('[data-fsnav]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dir = (btn as HTMLElement).dataset.fsnav as 'left' | 'right';
        const allVers = getStripVersions(fid, strip);
        let target = vi;
        if (dir === 'left') {
          for (let i = vi - 1; i >= 0; i--) { if (!allVers[i].hidden) { target = i; break; } }
        } else {
          for (let i = vi + 1; i < allVers.length; i++) { if (!allVers[i].hidden) { target = i; break; } }
        }
        if (target !== vi) switchTab(target);
      })
    );
    // Star button — toggle star, rebuild overlay
    overlay.querySelectorAll('.star-btn').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleStar(fid, vi, strip);
        // After reorder, find where current version moved
        const allVers = getStripVersions(fid, strip);
        vi = getStripActiveTab(fid, strip);
        ver = allVers[vi];
        bumpRenderTick();
        buildOverlay();
        initCanvas();
        wireEvents();
      })
    );
    // TAG button — handle strip tag click, rebuild after modal closes
    overlay.querySelectorAll('[data-striptag-fid]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const verRef = ver; // capture reference before reorder
        handleStripTagClick(fid, vi, strip);
        // Poll for tag overlay removal, then find version's new position and rebuild
        const poll = setInterval(() => {
          if (!document.getElementById('stripTagOverlay')) {
            clearInterval(poll);
            setTimeout(() => {
              // Tagging/untagging reorders versions — find by reference
              const allVers = getStripVersions(fid, strip);
              const newIdx = allVers.indexOf(verRef);
              vi = newIdx >= 0 ? newIdx : 0;
              ver = allVers[vi];
              setStripActiveTab(fid, strip, vi);
              buildOverlay();
              initCanvas();
              wireEvents();
            }, 100);
          }
        }, 200);
      })
    );
    // Swipe between versions (touch only, only when not drawing)
    if (!isMain) {
      const canvasArea = overlay.querySelector('.fs-canvas-area') as HTMLElement | null;
      if (canvasArea) {
        let swipeX = 0, swipeY = 0;
        canvasArea.addEventListener('touchstart', (e) => {
          swipeX = e.touches[0].clientX;
          swipeY = e.touches[0].clientY;
        }, { passive: true });
        canvasArea.addEventListener('touchend', (e) => {
          if (fsMode === 'draw') return; // don't interfere with drawing
          const dx = e.changedTouches[0].clientX - swipeX;
          const dy = e.changedTouches[0].clientY - swipeY;
          if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
          const allVers = getStripVersions(fid, strip);
          let target = vi;
          if (dx < 0) { // swipe left → next
            for (let i = vi + 1; i < allVers.length; i++) { if (!allVers[i].hidden) { target = i; break; } }
          } else { // swipe right → prev
            for (let i = vi - 1; i >= 0; i--) { if (!allVers[i].hidden) { target = i; break; } }
          }
          if (target !== vi) switchTab(target);
        }, { passive: true });
      }
    }
  }
  wireEvents();

  // Opening animation: zoom from source card
  if (sourceEl) {
    const wrap = overlay.querySelector('.fs-canvas-wrap') as HTMLElement;
    if (wrap) {
      const sourceRect = sourceEl.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const scaleX = sourceRect.width / wrapRect.width;
      const scaleY = sourceRect.height / wrapRect.height;
      const translateX = (sourceRect.left + sourceRect.width / 2) - (wrapRect.left + wrapRect.width / 2);
      const translateY = (sourceRect.top + sourceRect.height / 2) - (wrapRect.top + wrapRect.height / 2);

      // Initial state: canvas at source card position, controls hidden
      wrap.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
      wrap.style.outline = 'none';

      // While the zoom runs the canvas is still scaled down to the size of the
      // source card, so a touch would be mapped through the wrong scale and the
      // stroke would land far outside the picture — drawing appears dead. Take
      // input off the canvas until the zoom has finished.
      const animCvs = overlay.querySelector('canvas') as HTMLElement | null;
      const cvsPointerEvents = animCvs ? animCvs.style.pointerEvents : '';
      if (animCvs) animCvs.style.pointerEvents = 'none';
      overlay.querySelectorAll('.fs-strip-tabs, .fs-bottom-bar, .fs-close').forEach((el) => {
        (el as HTMLElement).style.opacity = '0';
      });

      requestAnimationFrame(() => { requestAnimationFrame(() => {
        // Animate to fullscreen
        overlay.style.transition = 'background 0.18s ease-out';
        overlay.style.background = '';
        wrap.style.transition = 'transform 0.18s ease-out';
        wrap.style.transform = '';
        overlay.querySelectorAll('.fs-strip-tabs, .fs-bottom-bar, .fs-close').forEach((el) => {
          (el as HTMLElement).style.transition = 'opacity 0.1s ease-out 0.08s';
          (el as HTMLElement).style.opacity = '';
        });
        // Clean up inline styles after animation
        setTimeout(() => {
          overlay.style.transition = '';
          wrap.style.transition = '';
          wrap.style.outline = '';
          // Zoom finished — hand the canvas back exactly as it was.
          if (animCvs) animCvs.style.pointerEvents = cvsPointerEvents;
          overlay.querySelectorAll('.fs-strip-tabs, .fs-bottom-bar, .fs-close').forEach((el) => {
            (el as HTMLElement).style.transition = '';
          });
        }, 200);
      }); });
    }
  }

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
  if ((overlay as any)._closing) return; // prevent double-close during animation

  const s = state();
  const fsInfo = s.fsOverlayActive;

  const doRemove = () => {
    // Reset crossCompare so the 3x2 / gallery card shows the main frame again.
    // In the strip views the user cross-swiped to that version deliberately —
    // dropping it there would throw them back to the main picture straight
    // after they finished working on the version.
    const inGridView = s.currentViewMode === 'grid3x2'
      || s.currentViewMode === 'grid4'
      || s.currentViewMode === 'overview';
    if (fsInfo && inGridView) s.crossCompare[fsInfo.fid] = -1;
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
  };

  // Try animated close: zoom back to source card
  const targetEl = fsInfo ? findSourceCard(fsInfo.fid, fsInfo.origin) : null;
  const wrap = targetEl ? overlay.querySelector('.fs-canvas-wrap') as HTMLElement : null;

  if (targetEl && wrap) {
    (overlay as any)._closing = true;
    const targetRect = targetEl.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const scaleX = targetRect.width / wrapRect.width;
    const scaleY = targetRect.height / wrapRect.height;
    const translateX = (targetRect.left + targetRect.width / 2) - (wrapRect.left + wrapRect.width / 2);
    const translateY = (targetRect.top + targetRect.height / 2) - (wrapRect.top + wrapRect.height / 2);

    // Fade out controls
    overlay.querySelectorAll('.fs-strip-tabs, .fs-bottom-bar, .fs-close').forEach((el) => {
      (el as HTMLElement).style.transition = 'opacity 0.08s';
      (el as HTMLElement).style.opacity = '0';
    });
    // Animate canvas to source card + fade background
    overlay.style.transition = 'background 0.18s ease-in';
    overlay.style.background = 'transparent';
    wrap.style.transition = 'transform 0.18s ease-in';
    wrap.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
    wrap.style.outline = 'none';

    setTimeout(doRemove, 200);
  } else {
    doRemove();
  }
}
