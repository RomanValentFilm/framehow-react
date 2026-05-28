// Reusable helper utilities — HTML fragments, version manipulation,
// state cleanup, and inline view-mode helpers.

import { COLORS, state, useStore } from '../store/state';
import type { Version, Frame, Stroke, TableData, StripType, FrameSnapshot } from '../store/state';
import { getCurrentProject } from './currentProject';

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

export function fsButtonHTML(fid: number, vi: number, origin: 'main' | 'ver' | 'floor' | 'refs'): string {
  return `<button class="fs-btn" data-fsfid="${fid}" data-fsvi="${vi}" data-fsorigin="${origin}">${fsExpandSVG}</button>`;
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
  return `${dots}<div class="draw-sep"></div>${thicks}<div class="draw-sep"></div>${eraser}`;
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
  const visible = vers.filter((v) => !v.hidden);
  const hidden = vers.filter((v) => v.hidden);
  const visStarred = visible.filter((v) => v.starred);
  const visUnstarred = visible.filter((v) => !v.starred);
  const hidStarred = hidden.filter((v) => v.starred);
  const hidUnstarred = hidden.filter((v) => !v.starred);
  const newOrder = [...visStarred, ...visUnstarred, ...hidStarred, ...hidUnstarred];
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
}

export function unhideVersion(ver: Version, fid: number, strip: StripType = 'ver'): void {
  ver.hidden = false;
  const vers = getStripVersions(fid, strip);
  const curIdx = vers.indexOf(ver);
  if (curIdx >= 0) {
    vers.splice(curIdx, 1);
    if (ver.starred) {
      let lastVisStarred = -1;
      for (let i = 0; i < vers.length; i++) {
        if (!vers[i].hidden && vers[i].starred) lastVisStarred = i;
      }
      vers.splice(lastVisStarred + 1, 0, ver);
      setStripActiveTab(fid, strip, lastVisStarred + 1);
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
}

export function isMainEmpty(f: Frame | undefined): boolean {
  return !f || ((!f.src || f.src === '') && (!f.strokes || f.strokes.length === 0));
}

export function autoNewVersionIfNeeded(fid: number): Version {
  const s = state();
  const ai = s.activeTab[fid],
    ver = s.versions[fid][ai];
  if (s.overviewAction) return ver;
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
  const bucket = strip === 'floor' ? s.floorPrevFrameState
    : strip === 'refs' ? s.refsPrevFrameState
    : s.prevFrameState;
  const snap = bucket[fid];
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
  const vers = strip === 'floor' ? s.floorVersions
    : strip === 'refs' ? s.refsVersions
    : s.versions;
  const tabs = strip === 'floor' ? s.floorActiveTab
    : strip === 'refs' ? s.refsActiveTab
    : s.activeTab;
  const cc = strip === 'floor' ? s.floorCrossCompare
    : strip === 'refs' ? s.refsCrossCompare
    : s.crossCompare;

  vers[fid] = snap.versions;
  tabs[fid] = snap.activeTab;
  if (snap.crossCompare === undefined) delete cc[fid];
  else cc[fid] = snap.crossCompare;
  bucket[fid] = null;
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
  if (s.currentViewMode === 'overview' || s.currentViewMode === 'grid4') return;
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
  useStore.setState({ verReorderFid: null, swipeHighlightFid: null });
  if (!needRender) return;
  const vd = document.querySelector(`.frame-card[data-vfid="${prev}"]`) as HTMLElement | null;
  const renderVer = (window as any).__fh_renderVersionFrame;
  if (vd && renderVer) renderVer(vd, prev);
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
  const visible = s.frames.filter((f) => !f.hidden).length;
  const hidden = s.frames.length - visible;

  // Hide frame badge on iPhone portrait + portrait mode project
  const isPhone = Math.min(window.innerWidth, window.innerHeight) <= 430;
  const isPhonePortrait = isPhone && window.innerHeight > window.innerWidth;
  const badgeEl = document.getElementById('frameBadge');
  if (badgeEl) {
    if (isPhonePortrait && s.portraitMode) {
      badgeEl.style.display = 'none';
    } else {
      badgeEl.style.display = '';
      const groupLabel = s.activeGroupId !== null
        ? (() => { const g = s.groups.find(g => g.id === s.activeGroupId); return g ? ` [${g.name}]` : ''; })()
        : '';
      badgeEl.textContent = `${visible} frame${visible !== 1 ? 's' : ''}${
        hidden > 0 ? ' (' + hidden + ' hidden)' : ''
      }${groupLabel}`;
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

// ─── ADD NEW STRIPS HERE ───
const STRIP_REGISTRY: Record<string, StripRegistryEntry> = {
  ver:   { prefix: 'v', scrollId: 'versionsScroll', slice: () => { const s = state(); return { versions: s.versions, activeTab: s.activeTab, crossCompare: s.crossCompare, prevFrameState: s.prevFrameState }; } },
  floor: { prefix: 'f', scrollId: 'floorScroll',    slice: () => { const s = state(); return { versions: s.floorVersions, activeTab: s.floorActiveTab, crossCompare: s.floorCrossCompare, prevFrameState: s.floorPrevFrameState }; } },
  refs:  { prefix: 'r', scrollId: 'refsScroll',     slice: () => { const s = state(); return { versions: s.refsVersions, activeTab: s.refsActiveTab, crossCompare: s.refsCrossCompare, prevFrameState: s.refsPrevFrameState }; } },
};

/** Get the registry entry for a strip (falls back to 'ver' for unknown types) */
function reg(strip: StripType): StripRegistryEntry {
  return STRIP_REGISTRY[strip] || STRIP_REGISTRY.ver;
}

export function stripTabPrefix(strip: StripType): string {
  return reg(strip).prefix;
}

/** Return the human-readable default label for a strip type */
export function stripDefaultLabel(strip: StripType): string {
  if (strip === 'floor') return 'floor plan';
  if (strip === 'refs') return 'reference';
  return 'version';
}

/** Return the custom strip label for a frame, falling back to the default */
export function getFrameStripLabel(f: Frame, strip: StripType): string {
  if (strip === 'floor') return f.floorLabel || stripDefaultLabel(strip);
  if (strip === 'refs') return f.refsLabel || stripDefaultLabel(strip);
  return f.versionLabel || stripDefaultLabel(strip);
}

/** Set the custom strip label on the correct field of a frame */
export function setFrameStripLabel(f: Frame, strip: StripType, label: string): void {
  if (strip === 'floor') f.floorLabel = label;
  else if (strip === 'refs') f.refsLabel = label;
  else f.versionLabel = label;
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
  const prefix = reg(strip).prefix;
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
  const s = state();
  const ai = getStripActiveTab(fid, strip);
  const vers = getStripVersions(fid, strip);
  const ver = vers[ai];
  if (s.overviewAction) return ver;
  if (ver.bgImage || (ver.strokes && ver.strokes.length > 0)) {
    const prefix = stripTabPrefix(strip);
    const n = vers.length + 1;
    const newVer: Version = { id: n, label: `${prefix}${n}`, type: 'empty', strokes: [], bgImage: null };
    addNewStripVersion(fid, strip, newVer);
    return newVer;
  }
  return ver;
}
