// Reusable helper utilities — HTML fragments, version manipulation,
// state cleanup, and inline view-mode helpers.

import { COLORS, state, useStore, DEFAULT_STRIP_DEFS, bumpRenderTick } from '../store/state';
import type { Version, Frame, Stroke, TableData, StripType, FrameSnapshot } from '../store/state';
import { getCurrentProject, flushSyncNow, markFrameDirty } from './currentProject';

/** Scroll a frame card into the center of the visible area after re-render.
 *  Uses requestAnimationFrame to wait for layout to settle.
 *  Delegates to scrollAnchorTo (view.ts) via window to avoid circular imports. */
// Pending anchor timers from scrollFrameIntoView — can be cancelled externally
export const _actionAnchorTimers: number[] = [];

// iPhone-only: needs multi-delay anchoring because Safari layout settles slowly
const _isIPhone = /iPhone/.test(navigator.userAgent) && 'ontouchend' in document;

export function scrollFrameIntoView(fid: number, _strip?: StripType): void {
  const fn = (window as any).__fh_scrollAnchorTo;
  if (!fn) return;
  if (_isIPhone) {
    // Cancel any previous action-anchor timers
    _actionAnchorTimers.forEach(clearTimeout);
    _actionAnchorTimers.length = 0;
    // Multi-delay anchor for slower iOS Safari layout settling after modal close
    requestAnimationFrame(() => fn(fid));
    [50, 150, 300].forEach((delay) => {
      _actionAnchorTimers.push(window.setTimeout(() => fn(fid), delay));
    });
  } else {
    requestAnimationFrame(() => fn(fid));
  }
}

export function escH(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fsExpandSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

// Note icon SVGs: 2.5 lines (empty) vs 4 full lines (has text)
const noteEmptySVG = '<svg viewBox="0 0 36 36" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="0" y="0" width="36" height="36" rx="3"/><line x1="7" y1="8" x2="29" y2="8"/><line x1="7" y1="15" x2="29" y2="15"/><line x1="7" y1="22" x2="14" y2="22"/></svg>';
const noteFullSVG = '<svg viewBox="0 0 36 36" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="0" y="0" width="36" height="36" rx="3"/><line x1="7" y1="7" x2="29" y2="7"/><line x1="7" y1="14" x2="29" y2="14"/><line x1="7" y1="21" x2="29" y2="21"/><line x1="7" y1="28" x2="29" y2="28"/></svg>';

/** Get the note text for a specific frame/version slot. */
function getNoteText(fid: number, vi: number, origin: 'main' | 'ver' | 'floor' | 'refs'): string {
  const s = state();
  if (origin === 'main') {
    const f = s.frames.find((x) => x.id === fid);
    return f?.note || '';
  }
  const vers = s.stripVersions[origin]?.[fid];
  const v = vers?.[vi];
  return v?.note || '';
}

export function noteIconSVG(fid: number, vi: number = 0, origin: 'main' | 'ver' | 'floor' | 'refs' = 'main'): string {
  const note = getNoteText(fid, vi, origin);
  return note.trim() ? noteFullSVG : noteEmptySVG;
}

export function fsButtonHTML(fid: number, vi: number, origin: 'main' | 'ver' | 'floor' | 'refs'): string {
  return `<button class="fs-btn" data-fsfid="${fid}" data-fsvi="${vi}" data-fsorigin="${origin}">${noteIconSVG(fid, vi, origin)}</button>`;
}

export function openNoteModal(fid: number, vi: number, origin: 'main' | 'ver' | 'floor' | 'refs', updateIcon: () => void): void {
  const s = state();

  // Find the target object that holds the note
  let noteHolder: { note?: string } | undefined;
  if (origin === 'main') {
    noteHolder = s.frames.find((x) => x.id === fid);
  } else {
    noteHolder = s.stripVersions[origin]?.[fid]?.[vi];
  }
  if (!noteHolder) return;

  // Block scroll/touch behind modal (same pattern as device lock overlay)
  document.body.style.overflow = 'hidden';

  const modalOverlay = document.createElement('div');
  modalOverlay.style.cssText =
    'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.6);' +
    'display:flex;align-items:center;justify-content:center;padding:16px;' +
    'touch-action:none;overscroll-behavior:none;';
  const stopEvent = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  modalOverlay.addEventListener('wheel', stopEvent, { passive: false });
  modalOverlay.addEventListener('touchmove', stopEvent, { passive: false });

  // Detect phone: either dimension < 600 catches portrait + landscape
  const isPhone = Math.min(window.innerWidth, window.innerHeight) < 600;

  const box = document.createElement('div');
  box.style.cssText =
    'background:#111;border:none;border-radius:12px;' +
    `padding:${isPhone ? '8px' : '10px'};` +
    `width:${isPhone ? '340px' : '680px'};max-width:90vw;max-height:85vh;color:#fff;` +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

  // Phone: smaller textarea. Desktop/tablet: taller.
  const textareaHeight = isPhone ? '160px' : '320px';

  box.innerHTML = `
    <textarea id="fsNoteArea" style="
      width:100%;height:${textareaHeight};background:#111;border:none;border-radius:8px;
      color:#fff;font-size:14px;padding:10px;resize:none;outline:none;
      font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.5;
      box-sizing:border-box;
    " placeholder="NOTE for this frame...">${escH(noteHolder.note || '')}</textarea>
    <div style="display:flex;gap:10px;margin-top:8px;justify-content:flex-end;">
      <button id="fsNoteCancel" style="
        padding:10px 20px;border-radius:8px;border:1px solid #555;
        background:#2a2a2a;color:#ccc;font-size:14px;font-weight:500;cursor:pointer;
      ">Cancel</button>
      <button id="fsNoteOk" style="
        padding:10px 20px;border-radius:8px;border:none;
        background:#d52632;color:#fff;font-size:14px;font-weight:600;cursor:pointer;
      ">OK</button>
    </div>`;

  modalOverlay.appendChild(box);
  document.body.appendChild(modalOverlay);
  const area = document.getElementById('fsNoteArea') as HTMLTextAreaElement;
  setTimeout(() => area.focus(), 50);

  // No keepAlive needed — typing in the textarea fires keydown which the
  // heartbeat sender's capture-phase listener on `document` already picks up.
  // When the user pauses for 10+ seconds (reading/thinking), the heartbeat
  // naturally goes stale and the other device can proceed — this is correct,
  // the note text lives in the textarea DOM, not in Zustand state, so a pull
  // from the other device won't overwrite uncommitted text.

  function cleanup() {
    modalOverlay.remove();
    document.body.style.overflow = '';
  }

  document.getElementById('fsNoteOk')!.addEventListener('click', () => {
    // Re-read state at click time — a sync pull while the modal was open
    // may have replaced the frame/version objects, making the captured
    // noteHolder reference stale (detached from the store).
    const fresh = state();
    let target: { note?: string } | undefined;
    if (origin === 'main') {
      target = fresh.frames.find((x) => x.id === fid);
    } else {
      target = fresh.stripVersions[origin]?.[fid]?.[vi];
    }
    if (!target) return;
    target.note = area.value;
    bumpRenderTick(); // trigger Zustand subscriber → marks dirty + re-renders all icons
    cleanup();
    updateIcon();
    // In-place mutation doesn't change the object reference, so the
    // ref-based _dirtyFrameIds tracker won't catch it. Explicitly mark
    // the frame dirty so a pull merge won't overwrite the note.
    const frame = fresh.frames.find((f) => f.id === fid);
    if (frame?.serverFrameId) markFrameDirty(frame.serverFrameId);
    // Flush immediately so the note reaches the server before the
    // heartbeat goes stale (~10s) and another device pulls.
    void flushSyncNow();
  });
  document.getElementById('fsNoteCancel')!.addEventListener('click', cleanup);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) cleanup(); });
  area.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cleanup(); } });
}

export function starHTML(fid: number, vi: number, strip: StripType = 'ver'): string {
  const ver = getStripVersions(fid, strip)[vi];
  if (!ver) return '';
  const filled = ver.starred;
  const starSVG = filled
    ? '<svg viewBox="0 0 24 24" fill="#fff" stroke="#fff" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z"/></svg>';
  return `<button class="star-btn" data-starfid="${fid}" data-starvi="${vi}" data-starstrip="${strip}">${starSVG}</button>`;
}

export function drawToolbarHTML(fid: number, attrName: string, attrVal: string | number): string {
  const s = state();
  const chosenColor = s.drawColor[fid] || COLORS[0];
  const chosenWidth = s.drawWidth[fid] || 6;
  const isEraser = s.drawEraser[fid] || false;
  const dots = COLORS.map(
    (c) =>
      `<div class="color-dot${!isEraser && c === chosenColor ? ' selected' : ''}" style="background:${c};${
        c === '#ffffff' ? 'border-color:var(--border-strong);' : ''
      }" data-color="${c}" ${attrName}="${attrVal}"></div>`
  ).join('');
  const strokeSVG = (sw: number) =>
    `<svg width="24" height="16" viewBox="0 0 24 16"><path d="M2 10 Q6 ${10 - sw * 1.5} 8 10 Q10 ${10 + sw * 1.5} 12 10 Q14 ${10 - sw * 1.5} 16 10 Q18 ${10 + sw * 1.5} 22 10" fill="none" stroke="#fff" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
  const widths = [6, 12, 24];
  const thicks = widths
    .map((w) => {
      const sw = w === 6 ? 1.5 : w === 12 ? 3 : 5;
      return `<div class="thick-btn${!isEraser && w === chosenWidth ? ' selected' : ''}" data-tw="${w}" ${attrName}="${attrVal}" title="${w}px">${strokeSVG(sw)}</div>`;
    })
    .join('');
  const eraserSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.6 1.6c.8-.8 2-.8 2.8 0L21.4 5.6c.8.8.8 2 0 2.8L12 18"/><path d="M6 12l5 5"/></svg>`;
  const eraser = `<div class="eraser-btn${isEraser ? ' selected' : ''}" data-eraser="1" ${attrName}="${attrVal}" title="Eraser">${eraserSVG}</div>`;
  const undoSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 19v-2h7.1c1.15 0 2.13-.4 2.93-1.2.8-.8 1.2-1.78 1.2-2.93s-.4-2.13-1.2-2.93c-.8-.8-1.78-1.2-2.93-1.2H7.83l2.59 2.59L9 12.74 4 7.74l5-5 1.41 1.41L7.83 6.74H14.1c1.71 0 3.16.6 4.36 1.8s1.8 2.65 1.8 4.36-.6 3.16-1.8 4.36-2.65 1.8-4.36 1.8H7Z"/></svg>`;
  const undo = `<div class="draw-undo-btn" data-drawundo="1" ${attrName}="${attrVal}" title="Undo">${undoSVG}</div>`;
  return `${dots}<div class="draw-sep"></div>${thicks}<div class="draw-sep"></div>${eraser}<div class="draw-sep"></div>${undo}`;
}

export function defaultTableData(): TableData {
  return { headers: ['', '', ''], rows: [['', '', ''], ['', '', ''], ['', '', '']] };
}

export function tableHTML(fid: number, td?: TableData | null): string {
  if (!td) td = defaultTableData();
  let h = '<div class="frame-table-wrap"><table class="frame-table" data-tblfid="' + fid + '"><thead><tr>';
  for (let c = 0; c < td.headers.length; c++) {
    h += '<th><input type="text" value="' + escH(td.headers[c]) + '" placeholder="Column ' + (c + 1) + '" data-col="' + c + '"></th>';
  }
  h += '</tr></thead><tbody>';
  for (let r = 0; r < td.rows.length; r++) {
    h += '<tr>';
    for (let c = 0; c < td.headers.length; c++) {
      h += '<td><textarea rows="1" data-row="' + r + '" data-col="' + c + '">' + escH(td.rows[r]?.[c] || '') + '</textarea></td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table><button class="frame-table-addrow" data-addrow="' + fid + '">+ add row</button></div>';
  return h;
}

export function saveTableFromDOM(tbl: HTMLElement): void {
  const fid = parseInt((tbl as HTMLElement).dataset.tblfid!);
  const f = state().frames.find((fr) => fr.id === fid);
  if (!f) return;
  const headers: string[] = [];
  tbl.querySelectorAll('thead input').forEach((inp) => headers.push((inp as HTMLInputElement).value));
  const rows: string[][] = [];
  tbl.querySelectorAll('tbody tr').forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll('textarea').forEach((ta) => cells.push((ta as HTMLTextAreaElement).value));
    rows.push(cells);
  });
  f.tableData = { headers, rows };
}

export function saveOpenTextEdits(): void {
  document.querySelectorAll('textarea.frame-text-edit[data-textfid]').forEach((ta) => {
    const fid = parseInt((ta as HTMLElement).dataset.textfid!);
    const f = state().frames.find((fr) => fr.id === fid);
    if (f) f.textContent = (ta as HTMLTextAreaElement).value;
  });
}

export function saveOpenTableEdits(): void {
  document.querySelectorAll('.frame-table[data-tblfid]').forEach((tbl) => saveTableFromDOM(tbl as HTMLElement));
}

// Version manipulation
export function nextVisibleVer(fid: number, fromIdx: number, dir: 'left' | 'right', strip: StripType = 'ver'): number {
  const tabs = getStripVersions(fid, strip);
  if (dir === 'right') {
    for (let i = fromIdx + 1; i < tabs.length; i++) {
      if (!tabs[i].hidden) return i;
    }
  } else {
    for (let i = fromIdx - 1; i >= 0; i--) {
      if (!tabs[i].hidden) return i;
    }
  }
  return -1;
}

export function hasVisibleVer(fid: number, fromIdx: number, dir: 'left' | 'right', strip: StripType = 'ver'): boolean {
  return nextVisibleVer(fid, fromIdx, dir, strip) >= 0;
}

export function relabelVersions(fid: number): void {
  const vers = state().versions[fid];
  if (!vers) return;
  let vn = 1,
    hn = 1;
  vers.forEach((v) => {
    v.label = v.hidden ? `h${hn++}` : `v${vn++}`;
  });
}

export function addNewVersion(fid: number, newVer: Version): void {
  // fhTrack is imported in init; calling site can wrap if needed
  const vers = state().versions[fid];
  let lastVisible = -1;
  for (let i = vers.length - 1; i >= 0; i--) {
    if (!vers[i].hidden) {
      lastVisible = i;
      break;
    }
  }
  vers.splice(lastVisible + 1, 0, newVer);
  state().activeTab[fid] = lastVisible + 1;
  relabelVersions(fid);
}

export function reorderByStars(fid: number, strip: StripType = 'ver'): void {
  const vers = getStripVersions(fid, strip);
  if (!vers || vers.length === 0) return;
  // Tagged versions (origin + copy) always stay at the FRONT in their existing order
  const tagged = vers.filter((v) => v.setupTagged);
  const untagged = vers.filter((v) => !v.setupTagged);
  const visible = untagged.filter((v) => !v.hidden);
  const hidden = untagged.filter((v) => v.hidden);
  const visStarred = visible.filter((v) => v.starred);
  const visUnstarred = visible.filter((v) => !v.starred);
  const hidStarred = hidden.filter((v) => v.starred);
  const hidUnstarred = hidden.filter((v) => !v.starred);
  const newOrder = [...tagged, ...visStarred, ...visUnstarred, ...hidStarred, ...hidUnstarred];
  vers.length = 0;
  newOrder.forEach((v) => vers.push(v));
}

export function toggleStar(fid: number, vi: number, strip: StripType = 'ver'): void {
  const vers = getStripVersions(fid, strip);
  if (!vers || !vers[vi]) return;
  const ver = vers[vi];
  ver.starred = !ver.starred;
  reorderByStars(fid, strip);
  const newIdx = vers.indexOf(ver);
  setStripActiveTab(fid, strip, newIdx);
  relabelStripVersions(fid, strip);
  void flushSyncNow(); // VER-12: star/unstar version → click star icon
}

export function unhideVersion(ver: Version, fid: number, strip: StripType = 'ver'): void {
  ver.hidden = false;
  const vers = getStripVersions(fid, strip);
  const curIdx = vers.indexOf(ver);
  if (curIdx >= 0) {
    vers.splice(curIdx, 1);
    // Find the end of the tagged-front section (origins + copies always stay first)
    let afterTagged = 0;
    for (let i = 0; i < vers.length; i++) {
      if (vers[i].setupTagged) afterTagged = i + 1;
      else break;
    }
    if (ver.starred) {
      // Insert after last visible starred, but never before tagged front
      let lastVisStarred = afterTagged - 1;
      for (let i = afterTagged; i < vers.length; i++) {
        if (!vers[i].hidden && vers[i].starred) lastVisStarred = i;
      }
      const insertAt = lastVisStarred + 1;
      vers.splice(insertAt, 0, ver);
      setStripActiveTab(fid, strip, insertAt);
    } else {
      let lastVisible = -1;
      for (let i = vers.length - 1; i >= 0; i--) {
        if (!vers[i].hidden) {
          lastVisible = i;
          break;
        }
      }
      vers.splice(lastVisible + 1, 0, ver);
      setStripActiveTab(fid, strip, lastVisible + 1);
    }
  }
  relabelStripVersions(fid, strip);
  void flushSyncNow(); // VER-11: un-hide version → click Un-Hide
}

export function isMainEmpty(f: Frame | undefined): boolean {
  return !f || ((!f.src || f.src === '') && (!f.strokes || f.strokes.length === 0));
}

export function autoNewVersionIfNeeded(fid: number): Version {
  const s = state();
  const ai = s.activeTab[fid],
    ver = s.versions[fid][ai];
  // NOTE: no overviewAction short-circuit — see autoNewStripVersionIfNeeded.
  if (ver.bgImage || (ver.strokes && ver.strokes.length > 0)) {
    const n = s.versions[fid].length + 1;
    const newVer: Version = { id: n, label: `v${n}`, type: 'empty', strokes: [], bgImage: null };
    addNewVersion(fid, newVer);
    return newVer;
  }
  return ver;
}

export function restoreFrame(fid: number, strip: StripType = 'ver'): void {
  const s = state();
  const slice = reg(strip).slice();
  const snap = slice.prevFrameState[fid];
  if (!snap) return;

  // Always restore main frame data (shared across strips)
  const f = s.frames.find((fr) => fr.id === fid);
  if (f && snap.origin === 'main') {
    f.src = snap.main.src;
    f.strokes = snap.main.strokes;
    f.drawMode = snap.main.drawMode;
    f.textContent = snap.main.textContent;
    f.tableData = snap.main.tableData ? JSON.parse(JSON.stringify(snap.main.tableData)) : null;
  }

  // Restore strip-specific version data
  slice.versions[fid] = snap.versions;
  slice.activeTab[fid] = snap.activeTab;
  if (snap.crossCompare === undefined) delete slice.crossCompare[fid];
  else slice.crossCompare[fid] = snap.crossCompare;
  slice.prevFrameState[fid] = null;
}

export function clearAllDrawActive(): void {
  const s = state();
  let changed = false;
  let lastActiveFid: number | null = null;
  let lastActiveStrip: StripType = 'main';
  for (const fid in s.drawActive) {
    if (s.drawActive[+fid]) {
      changed = true;
      lastActiveStrip = s.drawActive[+fid] as StripType;
      lastActiveFid = +fid;
      s.drawActive[+fid] = null;
    }
  }
  if (!changed) return;
  if (s.currentViewMode === 'overview' || s.currentViewMode === 'grid4' || s.currentViewMode === 'grid3x2') return;
  document.querySelectorAll('.frame-card[data-mfid]').forEach((div) => {
    const fid = parseInt((div as HTMLElement).dataset.mfid!);
    // avoid circular import — render.ts wires this through window
    const fn = (window as any).__fh_renderMainFrame;
    if (fn) fn(div, fid);
  });
  document.querySelectorAll('.frame-card[data-vfid]').forEach((div) => {
    const el = div as HTMLElement;
    const fid = parseInt(el.dataset.vfid!);
    const strip = (el.dataset.strip || 'ver') as StripType;
    const fn = (window as any).__fh_renderVersionFrame;
    if (fn) fn(div, fid, strip);
  });
  // NOTE: No scroll anchoring here — clearAllDrawActive is called from many
  // places (cross-compare, brush switches, etc.) and anchoring on every call
  // causes unwanted jumps.  Anchoring is done explicitly at draw/write/camera
  // close sites in actions.ts instead.
}

export function clearReorder(): void {
  clearVerReorder();
  const s = state();
  if (!s.reorderFid) return;
  const prev = s.reorderFid;
  useStore.setState({ reorderFid: null });
  document.querySelectorAll('.frame-card.reorder-active').forEach((c) => c.classList.remove('reorder-active'));
  const md = document.querySelector(`.frame-card[data-mfid="${prev}"]`) as HTMLElement | null;
  const renderMain = (window as any).__fh_renderMainFrame;
  if (md && renderMain) renderMain(md, prev);
  document.querySelectorAll('.frame-card[data-vfid]').forEach((c) => {
    const el = c as HTMLElement;
    const strip = (el.dataset.strip || 'ver') as StripType;
    const fn = (window as any).__fh_renderVersionFrame;
    if (fn) fn(c, parseInt(el.dataset.vfid!), strip);
  });
}

export function clearVerReorder(): void {
  const s = state();
  const needRender = s.verReorderFid || s.swipeHighlightFid;
  const prev = s.verReorderFid || s.swipeHighlightFid;
  useStore.setState({ verReorderFid: null, verReorderStrip: null, swipeHighlightFid: null });
  if (!needRender) return;
  // Re-render affected version frame cards
  const renderVer = (window as any).__fh_renderVersionFrame;
  if (renderVer) {
    document.querySelectorAll(`.frame-card[data-vfid="${prev}"]`).forEach((el) => {
      const strip = ((el as HTMLElement).dataset.strip || 'ver') as StripType;
      renderVer(el, prev, strip);
    });
  }
  // Re-render main frame cards too — they use verReorderFid for the 'locked' class
  const renderMn = (window as any).__fh_renderMainFrame;
  if (renderMn) {
    document.querySelectorAll('.frame-card[data-mfid]').forEach((c) => {
      renderMn(c as HTMLElement, parseInt((c as HTMLElement).dataset.mfid!));
    });
  }
  const md = document.querySelector(`.frame-card[data-mfid="${prev}"]`) as HTMLElement | null;
  const renderMain = (window as any).__fh_renderMainFrame;
  if (md && (state().crossCompare[prev as number] ?? -1) >= 0 && renderMain) renderMain(md, +prev!);
}

export function applyReorderHighlight(fid: number): void {
  const mc = document.querySelector(`.frame-card[data-mfid="${fid}"]`);
  const vc = document.querySelector(`.frame-card[data-vfid="${fid}"]`);
  if (mc) mc.classList.add('reorder-active');
  if (vc) vc.classList.add('reorder-active');
}

export function ovCollapseExpanded(): void {
  const s = state();
  const prevFid = s.ovExpandedFid;
  if (prevFid === null) return;
  if (s.drawActive[prevFid]) s.drawActive[prevFid] = null;
  s.drawEraser[prevFid] = false;
  useStore.setState({ ovExpandedFid: null });
  const overviewScroll = document.getElementById('overviewScroll')!;
  const oldRow = overviewScroll.querySelector(`.overview-row[data-ofid="${prevFid}"]`) as HTMLElement | null;
  const fn = (window as any).__fh_renderOverviewRow;
  if (oldRow && fn) fn(oldRow, prevFid);
}

export function updateFrameBadge(): void {
  const s = state();

  // Hide frame badge on iPhone portrait + portrait mode project
  const isPhone = Math.min(window.innerWidth, window.innerHeight) <= 430;
  const isPhonePortrait = isPhone && window.innerHeight > window.innerWidth;
  const badgeEl = document.getElementById('frameBadge');
  if (badgeEl) {
    if (isPhonePortrait && s.portraitMode) {
      badgeEl.style.display = 'none';
    } else {
      badgeEl.style.display = '';
      if (s.activeGroupId !== null) {
        // Group active — show group frame count (only count frames that exist)
        const group = s.groups.find(g => g.id === s.activeGroupId);
        if (group) {
          const existingIds = new Set(s.frames.map(f => f.id));
          const groupCount = group.frameIds.filter(id => existingIds.has(id)).length;
          badgeEl.textContent = `${groupCount} frame${groupCount !== 1 ? 's' : ''} [${group.name}]`;
        }
      } else {
        // ALL mode — show total frame count
        const visible = s.frames.filter((f) => !f.hidden).length;
        const hidden = s.frames.length - visible;
        badgeEl.textContent = `${visible} frame${visible !== 1 ? 's' : ''}${
          hidden > 0 ? ' (' + hidden + ' hidden)' : ''
        }`;
      }
    }
  }

  // Update project name in toolbar
  const nameEl = document.getElementById('toolbarProjectName');
  if (nameEl) {
    const cp = getCurrentProject();
    nameEl.textContent = cp.name || 'UNTITLED';
  }
}

// ── Strip registry & accessors ──
// Central lookup that maps each strip type to its state slices, scroll ID,
// and tab-label prefix. To add a new strip in the future:
//   1. Add the name to the StripType union in store/state.ts
//   2. Add 4 state fields: <name>Versions, <name>ActiveTab, <name>CrossCompare, <name>PrevFrameState
//   3. Add one entry to STRIP_REGISTRY below
//   4. Add a <div> column in StripColumns.tsx and a toggle button in ViewBar.tsx
//   That's it — all accessor functions, snapshot/restore, and action handlers
//   will pick it up automatically.

interface StripSlice {
  versions: Record<number, Version[]>;
  activeTab: Record<number, number>;
  crossCompare: Record<number, number>;
  prevFrameState: Record<number, FrameSnapshot | null>;
}

interface StripRegistryEntry {
  prefix: string;      // tab label prefix: 'v', 'f', 'r', …
  scrollId: string;    // DOM scroll container id
  slice: () => StripSlice; // returns live references to the state buckets
}

// ─── STRIP REGISTRY — built automatically from DEFAULT_STRIP_DEFS ───
// Adding a strip to DEFAULT_STRIP_DEFS is all that's needed; scrollId follows
// convention: 'ver' → 'versionsScroll', others → '{id}Scroll'.
const SCROLL_ID_OVERRIDES: Record<string, string> = { ver: 'versionsScroll' };

const STRIP_REGISTRY: Record<string, StripRegistryEntry> = {};

for (const def of DEFAULT_STRIP_DEFS) {
  const id = def.id;
  STRIP_REGISTRY[id] = {
    prefix: def.prefix,
    scrollId: SCROLL_ID_OVERRIDES[id] || `${id}Scroll`,
    slice: (() => {
      const stripId = id;
      return () => {
        const s = state();
        return {
          versions: s.stripVersions[stripId] || (s.stripVersions[stripId] = {}),
          activeTab: s.stripActiveTab[stripId] || (s.stripActiveTab[stripId] = {}),
          crossCompare: s.stripCrossCompare[stripId] || (s.stripCrossCompare[stripId] = {}),
          prevFrameState: s.stripPrevFrameState[stripId] || (s.stripPrevFrameState[stripId] = {}),
        };
      };
    })(),
  };
}

/** Get the registry entry for a strip (falls back to 'ver' for unknown types) */
function reg(strip: StripType): StripRegistryEntry {
  return STRIP_REGISTRY[strip] || STRIP_REGISTRY.ver;
}

export function stripTabPrefix(strip: StripType): string {
  const def = state().stripDefs.find((d) => d.id === strip);
  return def ? def.prefix : reg(strip).prefix;
}

/** Return the human-readable default label for a strip type */
export function stripDefaultLabel(strip: StripType): string {
  const def = state().stripDefs.find((d) => d.id === strip);
  return def ? def.defaultFrameLabel : 'version';
}

/** Return the user-facing button label for a strip type */
export function stripButtonLabel(strip: StripType): string {
  const def = state().stripDefs.find((d) => d.id === strip);
  return def ? def.buttonLabel : strip.toUpperCase();
}

/** Return the custom strip label for a frame, falling back to the default */
export function getFrameStripLabel(f: Frame, strip: StripType): string {
  return f.stripLabels?.[strip] || stripDefaultLabel(strip);
}

/** Set the strip label globally — strips never have per-frame overrides */
export function setFrameStripLabel(f: Frame, strip: StripType, label: string): void {
  if (label.trim().length === 0) return;
  const s = state();
  const def = s.stripDefs.find((d) => d.id === strip);
  if (!def) return;

  // Update the default label so ALL frames in this strip show the new name
  def.defaultFrameLabel = label.trim();
  // Clear any per-frame stripLabels overrides on ALL frames
  for (const fr of s.frames) {
    if (fr.stripLabels && fr.stripLabels[strip]) {
      delete fr.stripLabels[strip];
    }
  }

  // Update strip prefix from first letter and relabel all tabs
  const newPrefix = label.trim()[0].toLowerCase();
  if (def.prefix !== newPrefix) {
    def.prefix = newPrefix;
    const versMap = reg(strip).slice().versions;
    for (const fid of Object.keys(versMap)) {
      relabelStripVersions(+fid, strip);
    }
  }
}

export function stripScrollId(strip: StripType): string {
  if (strip === 'main') return 'mainScroll';
  return reg(strip).scrollId;
}

export function getStripVersions(fid: number, strip: StripType): Version[] {
  return reg(strip).slice().versions[fid] || [];
}

export function setStripVersions(fid: number, strip: StripType, vers: Version[]): void {
  reg(strip).slice().versions[fid] = vers;
}

export function ensureStripVersions(fid: number, strip: StripType): Version[] {
  const sl = reg(strip).slice();
  const prefix = stripTabPrefix(strip);
  if (!sl.versions[fid] || sl.versions[fid].length === 0) {
    sl.versions[fid] = [{ id: 1, label: `${prefix}1`, type: 'empty', strokes: [], bgImage: null }];
    sl.activeTab[fid] = 0;
  }
  return sl.versions[fid];
}

export function getStripActiveTab(fid: number, strip: StripType): number {
  return reg(strip).slice().activeTab[fid] || 0;
}

export function setStripActiveTab(fid: number, strip: StripType, val: number): void {
  reg(strip).slice().activeTab[fid] = val;
}

export function getStripCrossCompare(fid: number, strip: StripType): number {
  return reg(strip).slice().crossCompare[fid] ?? -1;
}

export function setStripCrossCompare(fid: number, strip: StripType, val: number): void {
  reg(strip).slice().crossCompare[fid] = val;
}

export function getStripPrevFrameState(fid: number, strip: StripType): FrameSnapshot | null {
  return reg(strip).slice().prevFrameState[fid] || null;
}

export function setStripPrevFrameState(fid: number, strip: StripType, snap: FrameSnapshot | null): void {
  reg(strip).slice().prevFrameState[fid] = snap;
}

/** Relabel versions for any strip type */
export function relabelStripVersions(fid: number, strip: StripType): void {
  const vers = getStripVersions(fid, strip);
  if (!vers) return;
  const prefix = stripTabPrefix(strip);
  let vn = 1, hn = 1;
  vers.forEach((v) => {
    v.label = v.hidden ? `h${hn++}` : `${prefix}${vn++}`;
  });
}

/** Add a new version to any strip, after the last visible tab */
export function addNewStripVersion(fid: number, strip: StripType, newVer: Version): void {
  const vers = getStripVersions(fid, strip);
  let lastVisible = -1;
  for (let i = vers.length - 1; i >= 0; i--) {
    if (!vers[i].hidden) { lastVisible = i; break; }
  }
  vers.splice(lastVisible + 1, 0, newVer);
  setStripActiveTab(fid, strip, lastVisible + 1);
  relabelStripVersions(fid, strip);
}

/** Auto-create new version if current one has content, for any strip */
export function autoNewStripVersionIfNeeded(fid: number, strip: StripType): Version {
  const ai = getStripActiveTab(fid, strip);
  const vers = getStripVersions(fid, strip);
  const ver = vers[ai];
  // NOTE: no overviewAction short-circuit — camera/upload from 3x2 view must
  // create a new version (v2, v3, …) just like the main strip does.
  if (ver.bgImage || (ver.strokes && ver.strokes.length > 0)) {
    const prefix = stripTabPrefix(strip);
    const n = vers.length + 1;
    const newVer: Version = { id: n, label: `${prefix}${n}`, type: 'empty', strokes: [], bgImage: null };
    addNewStripVersion(fid, strip, newVer);
    return newVer;
  }
  return ver;
}
