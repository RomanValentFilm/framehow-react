// Reusable helper utilities — HTML fragments, version manipulation,
// state cleanup, and inline view-mode helpers.

import { COLORS, state, useStore } from '../store/state';
import type { Version, Frame, Stroke, TableData } from '../store/state';

export function escH(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fsExpandSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

export function fsButtonHTML(fid: number, vi: number, origin: 'main' | 'ver'): string {
  return `<button class="fs-btn" data-fsfid="${fid}" data-fsvi="${vi}" data-fsorigin="${origin}">${fsExpandSVG}</button>`;
}

export function starHTML(fid: number, vi: number): string {
  const ver = (state().versions[fid] || [])[vi];
  if (!ver) return '';
  const filled = ver.starred;
  const starSVG = filled
    ? '<svg viewBox="0 0 24 24" fill="#aaa" stroke="#aaa" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="#aaa" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z"/></svg>';
  return `<button class="star-btn" data-starfid="${fid}" data-starvi="${vi}">${starSVG}</button>`;
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
export function nextVisibleVer(fid: number, fromIdx: number, dir: 'left' | 'right'): number {
  const tabs = state().versions[fid] || [];
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

export function hasVisibleVer(fid: number, fromIdx: number, dir: 'left' | 'right'): boolean {
  return nextVisibleVer(fid, fromIdx, dir) >= 0;
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

export function reorderByStars(fid: number): void {
  const vers = state().versions[fid];
  if (!vers) return;
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

export function toggleStar(fid: number, vi: number): void {
  const vers = state().versions[fid];
  if (!vers || !vers[vi]) return;
  const ver = vers[vi];
  ver.starred = !ver.starred;
  reorderByStars(fid);
  const newIdx = vers.indexOf(ver);
  state().activeTab[fid] = newIdx;
  relabelVersions(fid);
}

export function unhideVersion(ver: Version, fid: number): void {
  ver.hidden = false;
  const vers = state().versions[fid];
  const curIdx = vers.indexOf(ver);
  if (curIdx >= 0) {
    vers.splice(curIdx, 1);
    if (ver.starred) {
      let lastVisStarred = -1;
      for (let i = 0; i < vers.length; i++) {
        if (!vers[i].hidden && vers[i].starred) lastVisStarred = i;
      }
      vers.splice(lastVisStarred + 1, 0, ver);
      state().activeTab[fid] = lastVisStarred + 1;
    } else {
      let lastVisible = -1;
      for (let i = vers.length - 1; i >= 0; i--) {
        if (!vers[i].hidden) {
          lastVisible = i;
          break;
        }
      }
      vers.splice(lastVisible + 1, 0, ver);
      state().activeTab[fid] = lastVisible + 1;
    }
  }
  relabelVersions(fid);
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

export function restoreFrame(fid: number): void {
  const s = state();
  const snap = s.prevFrameState[fid];
  if (!snap) return;
  const f = s.frames.find((fr) => fr.id === fid);
  if (f) {
    f.src = snap.main.src;
    f.strokes = snap.main.strokes;
    f.drawMode = snap.main.drawMode;
    f.textContent = snap.main.textContent;
    f.tableData = snap.main.tableData ? JSON.parse(JSON.stringify(snap.main.tableData)) : null;
  }
  s.versions[fid] = snap.versions;
  s.activeTab[fid] = snap.activeTab;
  if (snap.crossCompare === undefined) delete s.crossCompare[fid];
  else s.crossCompare[fid] = snap.crossCompare;
  s.prevFrameState[fid] = null;
}

export function clearAllDrawActive(): void {
  const s = state();
  let changed = false;
  for (const fid in s.drawActive) {
    if (s.drawActive[+fid]) {
      changed = true;
      s.drawActive[+fid] = null;
    }
  }
  if (!changed) return;
  if (s.currentViewMode === 'overview') return;
  document.querySelectorAll('.frame-card[data-mfid]').forEach((div) => {
    const fid = parseInt((div as HTMLElement).dataset.mfid!);
    // avoid circular import — render.ts wires this through window
    const fn = (window as any).__fh_renderMainFrame;
    if (fn) fn(div, fid);
  });
  document.querySelectorAll('.frame-card[data-vfid]').forEach((div) => {
    const fid = parseInt((div as HTMLElement).dataset.vfid!);
    const fn = (window as any).__fh_renderVersionFrame;
    if (fn) fn(div, fid);
  });
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
    const fn = (window as any).__fh_renderVersionFrame;
    if (fn) fn(c, parseInt((c as HTMLElement).dataset.vfid!));
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
  document.getElementById('frameBadge')!.textContent = `${visible} frame${visible !== 1 ? 's' : ''}${
    hidden > 0 ? ' (' + hidden + ' hidden)' : ''
  }`;
}
