// Full Overview rendering — main + grid of versions for each frame, side-by-side.

import { state, useStore, isTouch } from '../store/state';
import type { StripType } from '../store/state';
import {
  drawToolbarHTML,
  fsButtonHTML,
  starHTML,
  tableHTML,
  defaultTableData,
  addNewStripVersion,
  unhideVersion,
  relabelStripVersions,
  ovCollapseExpanded,
  updateFrameBadge,
  getStripVersions,
  getStripActiveTab,
  setStripActiveTab,
  getStripPrevFrameState,
  stripTabPrefix,
  stripDefaultLabel,
  stripScrollId,
  getFrameStripLabel,
  setFrameStripLabel,
} from './helpers';
import { restoreCanvas, restoreMainCanvas, setupMainDrawing } from './drawing';
import { renderVersionFrame } from './render';
import { showLabelEdit, showVerLabelEdit, showDeleteChoice, showConfirm } from './modals';
import { getVisibleFrames, removeFrameFromGroup } from './groups';
import { setupTagHTML, wireSetupClicks } from './setups';

export function renderOverview(): void {
  const overviewScroll = document.getElementById('overviewScroll')!;
  overviewScroll.innerHTML = '';
  const visibleFrames = getVisibleFrames();
  if (!visibleFrames.length) return;
  visibleFrames.forEach((f) => overviewScroll.appendChild(buildOverviewRow(f)));
}

export function buildOverviewRow(f: any): HTMLElement {
  const row = document.createElement('div');
  row.className = 'overview-row';
  row.dataset.ofid = String(f.id);
  renderOverviewRow(row, f.id);
  return row;
}

export function renderOverviewRow(row: HTMLElement, fid: number): void {
  const s = state();
  const f = s.frames.find((x) => x.id === fid);
  if (!f) return;
  const companionStrip: StripType = (s.activeStrips.find((st: string) => st !== 'main') || 'ver') as StripType;
  // Only show as hidden in ALL mode — inside a group, frames are always visible
  if (f.hidden && s.activeGroupId === null) {
    const tabs = getStripVersions(fid, companionStrip) || [];
    const ai = getStripActiveTab(fid, companionStrip) || 0;
    const tabsHTML = tabs
      .map(
        (t: any, i: number) =>
          `<span class="vtab${i === ai ? ' active' : ''}" style="pointer-events:none;">${t.label}</span>`
      )
      .join('');
    row.innerHTML = '';
    const hiddenDiv = document.createElement('div');
    hiddenDiv.style.cssText = 'width:100%;';
    hiddenDiv.innerHTML = `<div class="frame-card" style="padding:0;background:rgba(51,51,51,0.4);border-color:rgba(255,255,255,0.12);">
      <div class="frame-num" style="gap:8px;">
        ${f.label ? `<span class="frame-label-tag">${f.label}</span>` : '<span style="color:var(--text-faint);font-style:italic;">hidden</span>'}
        <div class="version-tabs" style="pointer-events:none;opacity:0.4;">${tabsHTML}</div>
        <button class="btn" data-unhide="${fid}" style="margin-left:auto;font-size:10px;padding:2px 10px;">Un-Hide</button>
      </div>
    </div>`;
    hiddenDiv.querySelector(`[data-unhide="${fid}"]`)!.addEventListener('click', () => {
      f.hidden = false;
      updateFrameBadge();
      renderOverviewRow(row, fid);
    });
    row.appendChild(hiddenDiv);
    return;
  }
  const tabs = getStripVersions(fid, companionStrip) || [];
  const ai = getStripActiveTab(fid, companionStrip) || 0;
  const tabPrefix = stripTabPrefix(companionStrip);

  const mainDiv = document.createElement('div');
  mainDiv.className = 'overview-main';
  const mcid = 'ov_mc_' + fid;
  const colorDotsMain = drawToolbarHTML(fid, 'data-omfid', fid);
  let mainBody = '';
  const viewMode = s.showText[fid];
  if (viewMode === 'text') {
    mainBody = `<div class="canvas-wrap text-view" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9}"><textarea class="frame-text-edit" data-textfid="${fid}" placeholder="No text — click to add">${f.textContent || ''}</textarea></div>`;
  } else if (viewMode === 'table') {
    if (!f.tableData) f.tableData = defaultTableData();
    mainBody = `<div class="canvas-wrap text-view" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9}">${tableHTML(fid, f.tableData)}</div>`;
  } else {
    mainBody = `<div class="canvas-wrap${s.drawActive[fid] === 'main' ? ' draw-active' : ''}" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9}">${
      f.drawMode
        ? `<canvas id="${mcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas>`
        : `<img src="${f.src}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;">`
    }${fsButtonHTML(fid, 0, 'main')}${setupTagHTML(fid)}</div>`;
  }
  const btnLabel =
    viewMode === 'text'
      ? 'Pic/<span class="ptt-bold">Txt</span>/Tbl'
      : viewMode === 'table'
      ? 'Pic/Txt/<span class="ptt-bold">Tbl</span>'
      : '<span class="ptt-bold">Pic</span>/Txt/Tbl';
  const mainReorder = s.reorderFid === fid;
  mainDiv.innerHTML = `<div class="frame-card${mainReorder ? ' ov-reorder' : ''}" data-mfid="${fid}">
    <div class="frame-num"><span class="frame-label-tag" data-editlabel="${fid}">${f.label || '#'}</span><button class="vtab pictxt-btn${
    viewMode ? ' active' : ''
  }" data-mact="pictxt" data-mfid="${fid}">${btnLabel}</button><div class="reorder-group${
    s.reorderFid === fid ? ' active' : ''
  }${s.verReorderFid !== null ? ' locked' : ''}"><button class="vtab-add" data-mact="moveup" data-mfid="${fid}">▲</button>${
    s.reorderFid === fid
      ? `<span class="reorder-label" data-mact="reorderdone" data-mfid="${fid}">DONE</span>`
      : `<span class="reorder-label" data-mact="reorderstart" data-mfid="${fid}">re-order</span>`
  }<button class="vtab-add" data-mact="movedown" data-mfid="${fid}">▼</button></div></div>
    <div class="version-body">${mainBody}</div>
    ${s.drawActive[fid] === 'main' ? `<div class="color-row">${colorDotsMain}</div>` : ''}
    <div class="version-actions">
      <button class="act-btn" data-mact="new" data-mfid="${fid}">New</button>
      <button class="act-btn" data-mact="upload" data-mfid="${fid}">Load</button>
      <button class="act-btn${s.drawActive[fid] === 'main' ? ' active' : ''}" data-mact="draw" data-mfid="${fid}">DRAW</button>
      <button class="act-btn" data-mact="camera" data-mfid="${fid}">◎ CAM</button>
      <button class="act-btn" data-mact="write" data-mfid="${fid}">WRITE</button>
      <button class="act-btn" data-mact="copy" data-mfid="${fid}">Copy</button>
      <button class="act-btn" data-mact="paste" data-mfid="${fid}">Paste</button>
      <button class="act-btn" data-mact="delete" data-mfid="${fid}">Hide/Del</button>
      <button class="act-btn${s.prevFrameState[fid] && s.prevFrameState[fid]!.origin === 'main' ? '' : ' disabled'}" data-mact="undo" data-mfid="${fid}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 19v-2h7.1c1.15 0 2.13-.4 2.93-1.2.8-.8 1.2-1.78 1.2-2.93s-.4-2.13-1.2-2.93c-.8-.8-1.78-1.2-2.93-1.2H7.83l2.59 2.59L9 12.74 4 7.74l5-5 1.41 1.41L7.83 6.74H14.1c1.71 0 3.16.6 4.36 1.8s1.8 2.65 1.8 4.36-.6 3.16-1.8 4.36-2.65 1.8-4.36 1.8H7Z"/></svg></button>
    </div>
  </div>`;

  const mainCard = mainDiv.querySelector('.frame-card')!;
  mainCard.querySelectorAll('.color-dot[data-omfid]').forEach((d) =>
    d.addEventListener('click', () => {
      const c = (d as HTMLElement).dataset.color!;
      s.drawColor[fid] = c;
      s.drawEraser[fid] = false;
      const txt = f.strokes && f.strokes.find((stk: any) => stk.type === 'text');
      if (txt) txt.color = c;
      renderOverviewRow(row, fid);
    })
  );
  mainCard.querySelectorAll('.thick-btn[data-omfid]').forEach((d) =>
    d.addEventListener('click', () => {
      s.drawWidth[fid] = parseInt((d as HTMLElement).dataset.tw!);
      s.drawEraser[fid] = false;
      renderOverviewRow(row, fid);
    })
  );
  mainCard.querySelectorAll('.eraser-btn[data-omfid]').forEach((d) =>
    d.addEventListener('click', () => {
      s.drawEraser[fid] = !s.drawEraser[fid];
      renderOverviewRow(row, fid);
    })
  );
  mainCard.querySelectorAll('[data-mact]').forEach((b) =>
    b.addEventListener('click', () => {
      const fn = (window as any).__fh_handleMainAction;
      if (fn) fn((b as HTMLElement).dataset.mact!, fid, mainCard as HTMLElement);
      requestAnimationFrame(() => renderOverviewRow(row, fid));
    })
  );
  mainCard.querySelectorAll('[data-editlabel]').forEach((el) =>
    el.addEventListener('click', async () => {
      const result = await showLabelEdit(f.label);
      if (result === null) return;
      f.label = result;
      const fn = (window as any).__fh_renderAll;
      if (fn) fn();
    })
  );
  if (f.drawMode) {
    const cvs = mainCard.querySelector(`#${mcid}`) as HTMLCanvasElement | null;
    if (cvs) {
      restoreMainCanvas(cvs, f);
      if (s.drawActive[fid] === 'main') setupMainDrawing(cvs, fid);
    }
  }

  const verDiv = document.createElement('div');
  verDiv.className = 'overview-versions';

  tabs.forEach((ver: any, vi: number) => {
    const vcard = document.createElement('div');
    vcard.className = 'ov-ver-card';
    const vcid = 'ov_vc_' + fid + '_' + vi;
    const isVReorder = s.verReorderFid === fid && s.verReorderStrip === companionStrip;
    const isActive = vi === ai;
    const colorDotsVer = drawToolbarHTML(fid, 'data-ovfid', fid);
    const isExpanded = isActive && s.ovExpandedFid === fid;
    const cardClass =
      mainReorder ? 'ov-reorder' : (isVReorder && isActive ? 'ov-moving' : isActive ? 'ov-active' : '') + (isExpanded ? ' ov-expanded' : '');
    const reorderHTML =
      tabs.length > 1 && isActive
        ? `<div class="reorder-group${isVReorder ? ' active' : ''}"><button class="vtab-add" data-ovmove="left" data-fid="${fid}" title="Move left">◀</button>${
            isVReorder
              ? `<span class="reorder-label" data-ovreorderdone="${fid}">DONE</span>`
              : `<span class="reorder-label" data-ovreorderstart="${fid}">move</span>`
          }<button class="vtab-add" data-ovmove="right" data-fid="${fid}" title="Move right">▶</button></div>`
        : '';
    if (ver.hidden) {
      vcard.innerHTML = `<div class="frame-card${cardClass ? ' ' + cardClass : ''}" data-ovfid="${fid}" data-ovi="${vi}">
        <div class="ov-ver-label" style="pointer-events:auto;">${ver.label || tabPrefix + (vi + 1)}<button class="btn" data-ovunhide="${fid}" data-ovunhidevi="${vi}" style="margin-left:auto;font-size:10px;padding:2px 10px;">Un-Hide</button></div>
        <div style="opacity:0.3;pointer-events:none;"><div class="ver-canvas-area"><div class="canvas-wrap" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9}"><canvas id="${vcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas></div></div></div>
      </div>`;
      const uhBtn = vcard.querySelector(`[data-ovunhide="${fid}"]`) as HTMLElement | null;
      if (uhBtn)
        uhBtn.addEventListener('click', () => {
          unhideVersion(ver, fid, companionStrip);
          renderOverviewRow(row, fid);
          const vd = document.querySelector(`.frame-card[data-vfid="${fid}"][data-strip="${companionStrip}"]`) as HTMLElement | null;
          if (vd) renderVersionFrame(vd, fid, companionStrip);
        });
      const cvs = vcard.querySelector(`#${vcid}`) as HTMLCanvasElement | null;
      if (cvs) restoreCanvas(cvs, ver);
      verDiv.appendChild(vcard);
      return;
    }
    vcard.style.opacity = '';
    vcard.innerHTML = `<div class="frame-card${cardClass ? ' ' + cardClass : ''}" data-ovfid="${fid}" data-ovi="${vi}">
      <div class="ov-ver-label"><span class="frame-label-tag ver-label-combo" data-oveditver="${fid}">${f.label} ${getFrameStripLabel(f, companionStrip)}</span><span class="g4-ver-tab">${ver.label || tabPrefix + (vi + 1)}</span>${reorderHTML}</div>
      <div class="ver-canvas-area"><div class="canvas-wrap${
        s.drawActive[fid] === companionStrip && isActive ? ' draw-active' : ''
      }" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9}"><canvas id="${vcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas>${
      ver.type === 'empty' ? '<div class="canvas-hint"><span>click to choose action</span></div>' : ''
    }${starHTML(fid, vi, companionStrip)}${fsButtonHTML(fid, vi, companionStrip)}</div></div>
      ${s.drawActive[fid] === companionStrip && isActive ? `<div class="color-row">${colorDotsVer}</div>` : ''}
      <div class="version-actions">
        <button class="act-btn" data-action="upload" data-fid="${fid}">Load</button>
        <button class="act-btn${s.drawActive[fid] === companionStrip && isActive ? ' active' : ''}" data-action="draw" data-fid="${fid}">DRAW</button>
        <button class="act-btn" data-action="camera" data-fid="${fid}">◎ CAM</button>
        <button class="act-btn" data-action="text" data-fid="${fid}">WRITE</button>
        <button class="act-btn" data-action="copy" data-fid="${fid}">Copy</button>
        <button class="act-btn" data-action="paste" data-fid="${fid}">Paste</button>
        <button class="act-btn" data-action="clear" data-fid="${fid}">Hide/Del</button>
        <button class="act-btn${getStripPrevFrameState(fid, companionStrip) ? '' : ' disabled'}" data-action="undo" data-fid="${fid}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 19v-2h7.1c1.15 0 2.13-.4 2.93-1.2.8-.8 1.2-1.78 1.2-2.93s-.4-2.13-1.2-2.93c-.8-.8-1.78-1.2-2.93-1.2H7.83l2.59 2.59L9 12.74 4 7.74l5-5 1.41 1.41L7.83 6.74H14.1c1.71 0 3.16.6 4.36 1.8s1.8 2.65 1.8 4.36-.6 3.16-1.8 4.36-2.65 1.8-4.36 1.8H7Z"/></svg></button>
      </div>
    </div>`;
    const fc = vcard.querySelector('.frame-card') as HTMLElement;
    // Version label rename
    fc.querySelectorAll('[data-oveditver]').forEach((el) =>
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!f) return;
        const result = await showVerLabelEdit(f.label, getFrameStripLabel(f, companionStrip));
        if (result === null) return;
        setFrameStripLabel(f, companionStrip, result);
        const fn = (window as any).__fh_renderAll;
        if (fn) fn();
      })
    );
    fc.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.act-btn,.color-dot,.thick-btn,.eraser-btn,.vtab-add,.reorder-label,[data-oveditver]')) return;
      if (!document.contains(fc)) return;
      if (state().drawingInProgress || state().drawSuppressClick) return;
      if ((e.target as HTMLElement).tagName === 'CANVAS' && s.drawActive[fid] && vi === getStripActiveTab(fid, companionStrip)) return;
      let mainDrawWasClosed = false;
      for (const k in s.drawActive) {
        if (s.drawActive[+k] === 'main') {
          s.drawActive[+k] = null;
          s.drawEraser[+k] = false;
          mainDrawWasClosed = true;
          if (parseInt(k) !== fid) {
            const mRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${k}"]`) as HTMLElement | null;
            if (mRow) renderOverviewRow(mRow, parseInt(k));
          }
        }
      }
      if (mainDrawWasClosed) {
        setStripActiveTab(fid, companionStrip, vi);
        useStore.setState({ ovExpandedFid: fid });
        renderOverviewRow(row, fid);
        return;
      }
      const prevFid = s.ovExpandedFid;
      if (prevFid !== null) {
        if (prevFid !== fid) ovCollapseExpanded();
        else if (s.drawActive[fid] || s.drawEraser[fid]) {
          s.drawActive[fid] = null;
          s.drawEraser[fid] = false;
        }
      }
      const wasActive = vi === getStripActiveTab(fid, companionStrip);
      const wasExpanded = prevFid === fid && wasActive;
      if (wasActive && wasExpanded) {
        ovCollapseExpanded();
        return;
      }
      useStore.setState({ ovExpandedFid: fid });
      if (!wasActive) {
        setStripActiveTab(fid, companionStrip, vi);
        renderOverviewRow(row, fid);
        return;
      }
      row.querySelectorAll('.ov-ver-card .frame-card.ov-expanded').forEach((c) => c.classList.remove('ov-expanded'));
      fc.classList.add('ov-expanded');
    });
    fc.querySelectorAll('.color-dot[data-ovfid]').forEach((d) =>
      d.addEventListener('click', () => {
        const c = (d as HTMLElement).dataset.color!;
        s.drawColor[fid] = c;
        s.drawEraser[fid] = false;
        const txt = ver.strokes && ver.strokes.find((stk: any) => stk.type === 'text');
        if (txt) txt.color = c;
        renderOverviewRow(row, fid);
      })
    );
    fc.querySelectorAll('.thick-btn[data-ovfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawWidth[fid] = parseInt((d as HTMLElement).dataset.tw!);
        s.drawEraser[fid] = false;
        renderOverviewRow(row, fid);
      })
    );
    fc.querySelectorAll('.eraser-btn[data-ovfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawEraser[fid] = !s.drawEraser[fid];
        renderOverviewRow(row, fid);
      })
    );
    fc.querySelectorAll('.act-btn[data-action]').forEach((b) =>
      b.addEventListener('click', () => {
        if (vi !== ai) setStripActiveTab(fid, companionStrip, vi);
        useStore.setState({ overviewAction: true });
        const scrollId = stripScrollId(companionStrip);
        const vStripCard = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        const fn = (window as any).__fh_handleAction;
        if (fn) fn((b as HTMLElement).dataset.action!, fid, vStripCard || fc, false, companionStrip);
        const action = (b as HTMLElement).dataset.action!;
        const asyncActions = ['upload', 'camera', 'text'];
        if (!asyncActions.includes(action)) {
          useStore.setState({ overviewAction: false });
          requestAnimationFrame(() => renderOverviewRow(row, fid));
        }
      })
    );
    fc.querySelectorAll('[data-ovmove]').forEach((b) =>
      b.addEventListener('click', () => {
        for (const k in s.drawActive) s.drawActive[+k] = null;
        useStore.setState({ reorderFid: null, swipeHighlightFid: null });
        const dir = (b as HTMLElement).dataset.ovmove!;
        const curAi = getStripActiveTab(fid, companionStrip);
        if (dir === 'left' && curAi > 0) {
          [tabs[curAi - 1], tabs[curAi]] = [tabs[curAi], tabs[curAi - 1]];
          setStripActiveTab(fid, companionStrip, curAi - 1);
        } else if (dir === 'right' && curAi < tabs.length - 1) {
          [tabs[curAi], tabs[curAi + 1]] = [tabs[curAi + 1], tabs[curAi]];
          setStripActiveTab(fid, companionStrip, curAi + 1);
        }
        relabelStripVersions(fid, companionStrip);
        useStore.setState({ verReorderFid: fid, verReorderStrip: companionStrip });
        renderOverviewRow(row, fid);
      })
    );
    const startBtn = fc.querySelector('[data-ovreorderstart]') as HTMLElement | null;
    if (startBtn)
      startBtn.addEventListener('click', () => {
        for (const k in s.drawActive) s.drawActive[+k] = null;
        useStore.setState({ reorderFid: null, swipeHighlightFid: null, verReorderFid: fid, verReorderStrip: companionStrip });
        renderOverviewRow(row, fid);
      });
    const doneBtn = fc.querySelector('[data-ovreorderdone]') as HTMLElement | null;
    if (doneBtn)
      doneBtn.addEventListener('click', () => {
        useStore.setState({ verReorderFid: null, verReorderStrip: null });
        renderOverviewRow(row, fid);
      });
    const cvs = fc.querySelector(`#${vcid}`) as HTMLCanvasElement | null;
    if (cvs) {
      restoreCanvas(cvs, ver);
      if (ver.type !== 'empty' && s.drawActive[fid] === companionStrip && isActive) {
        // setupDrawing in expanded version card
        const setupFn = (window as any).__fh_setupDrawing;
        if (setupFn) setupFn(cvs, fid, vi, companionStrip);
      }
    }
    verDiv.appendChild(vcard);
  });

  const addCard = document.createElement('div');
  addCard.className = 'ov-add-card';
  addCard.innerHTML = '<span class="ov-add-label">+ New Version</span>';
  addCard.addEventListener('click', () => {
    const fn = (window as any).__fh_clearAllDrawActive;
    if (fn) fn();
    const n = tabs.length + 1;
    addNewStripVersion(fid, companionStrip, { id: n, label: tabPrefix + n, type: 'empty', strokes: [], bgImage: null });
    renderOverviewRow(row, fid);
    const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
    if (vd) renderVersionFrame(vd, fid);
  });
  const firstHiddenIdx = tabs.findIndex((t: any) => t.hidden);
  if (firstHiddenIdx > 0) {
    verDiv.insertBefore(addCard, verDiv.children[firstHiddenIdx]);
  } else {
    verDiv.appendChild(addCard);
  }

  row.innerHTML = '';
  row.appendChild(mainDiv);
  row.appendChild(verDiv);
}

/* ── GRID4 view ─────────────────────────────────────────────── */

export function renderGrid4(): void {
  const overviewScroll = document.getElementById('overviewScroll')!;
  overviewScroll.innerHTML = '';
  const visibleFrames = getVisibleFrames();
  if (!visibleFrames.length) return;
  visibleFrames.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'overview-row g4-row';
    row.dataset.ofid = String(f.id);
    renderGrid4Row(row, f.id);
    overviewScroll.appendChild(row);
  });
}

export function renderGrid4Row(row: HTMLElement, fid: number): void {
  const s = state();
  const f = s.frames.find((x: any) => x.id === fid);
  if (!f) return;
  row.innerHTML = '';
  const companionStrip: StripType = (s.activeStrips.find((st: string) => st !== 'main') || 'ver') as StripType;

  // ── Hidden frame — collapsed bar with Un-Hide (only in ALL mode) ──
  if (f.hidden && s.activeGroupId === null) {
    const tabs = getStripVersions(fid, companionStrip) || [];
    const ai = getStripActiveTab(fid, companionStrip) || 0;
    const tabsHTML = tabs
      .map(
        (t: any, i: number) =>
          `<span class="vtab${i === ai ? ' active' : ''}" style="pointer-events:none;">${t.label}</span>`
      )
      .join('');
    const hiddenDiv = document.createElement('div');
    hiddenDiv.style.cssText = 'width:100%;';
    hiddenDiv.innerHTML = `<div class="frame-card" style="padding:0;background:rgba(51,51,51,0.4);border-color:rgba(255,255,255,0.12);">
      <div class="frame-num" style="gap:8px;">
        ${f.label ? `<span class="frame-label-tag">${f.label}</span>` : '<span style="color:var(--text-faint);font-style:italic;">hidden</span>'}
        <div class="version-tabs" style="pointer-events:none;opacity:0.4;">${tabsHTML}</div>
        <button class="btn" data-unhide="${fid}" style="margin-left:auto;font-size:10px;padding:2px 10px;">Un-Hide</button>
      </div>
    </div>`;
    hiddenDiv.querySelector(`[data-unhide="${fid}"]`)!.addEventListener('click', () => {
      f.hidden = false;
      updateFrameBadge();
      renderGrid4Row(row, fid);
    });
    row.appendChild(hiddenDiv);
    return;
  }

  const tabs = getStripVersions(fid, companionStrip) || [];
  const tabPrefix = stripTabPrefix(companionStrip);
  const ar = `${f.cropW || 16}/${f.cropH || 9}`;

  // ── Main frame card ──
  const mainWrap = document.createElement('div');
  mainWrap.className = 'g4-main';
  const mcid = 'g4_mc_' + fid;
  const colorDotsMain = drawToolbarHTML(fid, 'data-omfid', fid);
  const viewMode = s.showText[fid];
  let mainBody = '';
  if (viewMode === 'text') {
    mainBody = `<div class="canvas-wrap text-view" style="aspect-ratio:${ar}"><textarea class="frame-text-edit" data-textfid="${fid}" placeholder="No text — click to add">${f.textContent || ''}</textarea></div>`;
  } else if (viewMode === 'table') {
    if (!f.tableData) f.tableData = defaultTableData();
    mainBody = `<div class="canvas-wrap text-view" style="aspect-ratio:${ar}">${tableHTML(fid, f.tableData)}</div>`;
  } else {
    mainBody = `<div class="canvas-wrap${s.drawActive[fid] === 'main' ? ' draw-active' : ''}" style="aspect-ratio:${ar}">${
      f.drawMode
        ? `<canvas id="${mcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas>`
        : `<img src="${f.src}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;">`
    }${fsButtonHTML(fid, 0, 'main')}${setupTagHTML(fid)}</div>`;
  }
  const btnLabel =
    viewMode === 'text'
      ? 'Pic/<span class="ptt-bold">Txt</span>/Tbl'
      : viewMode === 'table'
      ? 'Pic/Txt/<span class="ptt-bold">Tbl</span>'
      : '<span class="ptt-bold">Pic</span>/Txt/Tbl';
  const mainReorder = s.reorderFid === fid;
  mainWrap.innerHTML = `<div class="frame-card${mainReorder ? ' ov-reorder' : ''}" data-mfid="${fid}">
    <div class="frame-num"><span class="frame-label-tag" data-editlabel="${fid}">${f.label || '#'}</span><button class="vtab pictxt-btn${viewMode ? ' active' : ''}" data-mact="pictxt" data-mfid="${fid}">${btnLabel}</button><div class="reorder-group${
    s.reorderFid === fid ? ' active' : ''
  }${s.verReorderFid !== null ? ' locked' : ''}"><button class="vtab-add" data-mact="moveup" data-mfid="${fid}">▲</button>${
    s.reorderFid === fid
      ? `<span class="reorder-label" data-mact="reorderdone" data-mfid="${fid}">DONE</span>`
      : `<span class="reorder-label" data-mact="reorderstart" data-mfid="${fid}">order</span>`
  }<button class="vtab-add" data-mact="movedown" data-mfid="${fid}">▼</button></div></div>
    <div class="version-body">${mainBody}</div>
    ${s.drawActive[fid] === 'main' ? `<div class="color-row">${colorDotsMain}</div>` : ''}
    <div class="version-actions">
      <button class="act-btn" data-mact="new" data-mfid="${fid}">New</button>
      <button class="act-btn" data-mact="upload" data-mfid="${fid}">Load</button>
      <button class="act-btn${s.drawActive[fid] === 'main' ? ' active' : ''}" data-mact="draw" data-mfid="${fid}">DRAW</button>
      <button class="act-btn" data-mact="camera" data-mfid="${fid}">◎ CAM</button>
      <button class="act-btn" data-mact="write" data-mfid="${fid}">WRITE</button>
      <button class="act-btn" data-mact="copy" data-mfid="${fid}">Copy</button>
      <button class="act-btn" data-mact="paste" data-mfid="${fid}">Paste</button>
      <button class="act-btn" data-mact="delete" data-mfid="${fid}">Hide/Del</button>
      <button class="act-btn${s.prevFrameState[fid] && s.prevFrameState[fid]!.origin === 'main' ? '' : ' disabled'}" data-mact="undo" data-mfid="${fid}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 19v-2h7.1c1.15 0 2.13-.4 2.93-1.2.8-.8 1.2-1.78 1.2-2.93s-.4-2.13-1.2-2.93c-.8-.8-1.78-1.2-2.93-1.2H7.83l2.59 2.59L9 12.74 4 7.74l5-5 1.41 1.41L7.83 6.74H14.1c1.71 0 3.16.6 4.36 1.8s1.8 2.65 1.8 4.36-.6 3.16-1.8 4.36-2.65 1.8-4.36 1.8H7Z"/></svg></button>
    </div>
  </div>`;

  // Wire main card events
  const mainCard = mainWrap.querySelector('.frame-card')!;
  mainCard.querySelectorAll('.color-dot[data-omfid]').forEach((d) =>
    d.addEventListener('click', () => {
      s.drawColor[fid] = (d as HTMLElement).dataset.color!;
      s.drawEraser[fid] = false;
      renderGrid4Row(row, fid);
    })
  );
  mainCard.querySelectorAll('.thick-btn[data-omfid]').forEach((d) =>
    d.addEventListener('click', () => {
      s.drawWidth[fid] = parseInt((d as HTMLElement).dataset.tw!);
      s.drawEraser[fid] = false;
      renderGrid4Row(row, fid);
    })
  );
  mainCard.querySelectorAll('.eraser-btn[data-omfid]').forEach((d) =>
    d.addEventListener('click', () => {
      s.drawEraser[fid] = !s.drawEraser[fid];
      renderGrid4Row(row, fid);
    })
  );
  mainCard.querySelectorAll('[data-mact]').forEach((b) =>
    b.addEventListener('click', () => {
      const fn = (window as any).__fh_handleMainAction;
      if (fn) fn((b as HTMLElement).dataset.mact!, fid, mainCard as HTMLElement);
      requestAnimationFrame(() => renderGrid4Row(row, fid));
    })
  );
  mainCard.querySelectorAll('[data-editlabel]').forEach((el) =>
    el.addEventListener('click', async () => {
      const result = await showLabelEdit(f.label);
      if (result === null) return;
      f.label = result;
      const fn = (window as any).__fh_renderAll;
      if (fn) fn();
    })
  );
  if (f.drawMode) {
    const cvs = mainCard.querySelector(`#${mcid}`) as HTMLCanvasElement | null;
    if (cvs) {
      restoreMainCanvas(cvs, f);
      if (s.drawActive[fid] === 'main') setupMainDrawing(cvs, fid);
    }
  }
  row.appendChild(mainWrap);

  // ── Versions wrapper ──
  const versionsWrap = document.createElement('div');
  versionsWrap.className = 'g4-versions';

  // ── Version cards ──
  tabs.forEach((ver: any, vi: number) => {
    const colWrap = document.createElement('div');
    colWrap.className = 'g4-ver-col';
    const vcid = 'g4_vc_' + fid + '_' + vi;

    // ── Hidden version — dimmed with Un-Hide ──
    if (ver.hidden) {
      colWrap.innerHTML = `<div class="frame-card" data-ovfid="${fid}" data-ovi="${vi}">
        <div class="ov-ver-label" style="pointer-events:auto;">${ver.label || tabPrefix + (vi + 1)}<button class="btn" data-ovunhide="${fid}" data-ovunhidevi="${vi}" style="margin-left:auto;font-size:10px;padding:2px 10px;">Un-Hide</button></div>
        <div style="opacity:0.3;pointer-events:none;"><div class="ver-canvas-area"><div class="canvas-wrap" style="aspect-ratio:${ar}"><canvas id="${vcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas></div></div></div>
      </div>`;
      const uhBtn = colWrap.querySelector(`[data-ovunhide="${fid}"]`) as HTMLElement | null;
      if (uhBtn)
        uhBtn.addEventListener('click', () => {
          unhideVersion(ver, fid, companionStrip);
          renderGrid4Row(row, fid);
          const vd = document.querySelector(`.frame-card[data-vfid="${fid}"][data-strip="${companionStrip}"]`) as HTMLElement | null;
          if (vd) renderVersionFrame(vd, fid, companionStrip);
        });
      const cvs = colWrap.querySelector(`#${vcid}`) as HTMLCanvasElement | null;
      if (cvs) restoreCanvas(cvs, ver);
      versionsWrap.appendChild(colWrap);
      return;
    }

    const isActive = vi === (getStripActiveTab(fid, companionStrip) || 0);
    const isVReorder = s.verReorderFid === fid && s.verReorderStrip === companionStrip;
    const colorDotsVer = drawToolbarHTML(fid, 'data-ovfid', fid);
    const cardClass =
      mainReorder ? 'ov-reorder' : (isVReorder && isActive ? 'ov-moving' : isActive ? 'ov-active' : '');
    const reorderHTML =
      tabs.length > 1 && isActive
        ? `<div class="reorder-group${isVReorder ? ' active' : ''}"><button class="vtab-add" data-ovmove="left" data-fid="${fid}" title="Move left">◀</button>${
            isVReorder
              ? `<span class="reorder-label" data-ovreorderdone="${fid}">DONE</span>`
              : `<span class="reorder-label" data-ovreorderstart="${fid}">move</span>`
          }<button class="vtab-add" data-ovmove="right" data-fid="${fid}" title="Move right">▶</button></div>`
        : '';
    colWrap.innerHTML = `<div class="frame-card${cardClass ? ' ' + cardClass : ''}" data-ovfid="${fid}" data-ovi="${vi}">
      <div class="frame-num ver-frame-num"><span class="frame-label-tag ver-label-combo" data-g4verlabel="${fid}">${f.label} ${getFrameStripLabel(f, companionStrip)}</span><span class="g4-ver-tab">${ver.label || tabPrefix + (vi + 1)}</span>${reorderHTML}</div>
      <div class="ver-canvas-area"><div class="canvas-wrap${
        s.drawActive[fid] === companionStrip && isActive ? ' draw-active' : ''
      }" style="aspect-ratio:${ar}"><canvas id="${vcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas>${
      ver.type === 'empty' ? '<div class="canvas-hint"><span>click to choose action</span></div>' : ''
    }${starHTML(fid, vi, companionStrip)}${fsButtonHTML(fid, vi, companionStrip)}</div></div>
      ${s.drawActive[fid] === companionStrip && isActive ? `<div class="color-row">${colorDotsVer}</div>` : ''}
      <div class="version-actions">
        <button class="act-btn" data-action="upload" data-fid="${fid}">Load</button>
        <button class="act-btn${s.drawActive[fid] === companionStrip && isActive ? ' active' : ''}" data-action="draw" data-fid="${fid}">DRAW</button>
        <button class="act-btn" data-action="camera" data-fid="${fid}">◎ CAM</button>
        <button class="act-btn" data-action="text" data-fid="${fid}">WRITE</button>
        <button class="act-btn" data-action="copy" data-fid="${fid}">Copy</button>
        <button class="act-btn" data-action="paste" data-fid="${fid}">Paste</button>
        <button class="act-btn" data-action="clear" data-fid="${fid}">Hide/Del</button>
        <button class="act-btn${getStripPrevFrameState(fid, companionStrip) ? '' : ' disabled'}" data-action="undo" data-fid="${fid}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 19v-2h7.1c1.15 0 2.13-.4 2.93-1.2.8-.8 1.2-1.78 1.2-2.93s-.4-2.13-1.2-2.93c-.8-.8-1.78-1.2-2.93-1.2H7.83l2.59 2.59L9 12.74 4 7.74l5-5 1.41 1.41L7.83 6.74H14.1c1.71 0 3.16.6 4.36 1.8s1.8 2.65 1.8 4.36-.6 3.16-1.8 4.36-2.65 1.8-4.36 1.8H7Z"/></svg></button>
      </div>
    </div>`;

    const fc = colWrap.querySelector('.frame-card') as HTMLElement;
    // Click on version card → select it
    fc.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.act-btn,.color-dot,.thick-btn,.eraser-btn,[data-g4verlabel]')) return;
      if (state().drawingInProgress || state().drawSuppressClick) return;
      if ((e.target as HTMLElement).tagName === 'CANVAS' && s.drawActive[fid] && vi === getStripActiveTab(fid, companionStrip)) return;
      setStripActiveTab(fid, companionStrip, vi);
      renderGrid4Row(row, fid);
    });
    // Version label rename (same as TWIN mode)
    fc.querySelectorAll('[data-g4verlabel]').forEach((el) =>
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!f) return;
        const result = await showVerLabelEdit(f.label, getFrameStripLabel(f, companionStrip));
        if (result === null) return;
        setFrameStripLabel(f, companionStrip, result);
        const fn = (window as any).__fh_renderAll;
        if (fn) fn();
      })
    );
    fc.querySelectorAll('.color-dot[data-ovfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawColor[fid] = (d as HTMLElement).dataset.color!;
        s.drawEraser[fid] = false;
        renderGrid4Row(row, fid);
      })
    );
    fc.querySelectorAll('.thick-btn[data-ovfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawWidth[fid] = parseInt((d as HTMLElement).dataset.tw!);
        s.drawEraser[fid] = false;
        renderGrid4Row(row, fid);
      })
    );
    fc.querySelectorAll('.eraser-btn[data-ovfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawEraser[fid] = !s.drawEraser[fid];
        renderGrid4Row(row, fid);
      })
    );
    fc.querySelectorAll('.act-btn[data-action]').forEach((b) =>
      b.addEventListener('click', () => {
        if (vi !== (getStripActiveTab(fid, companionStrip) || 0)) setStripActiveTab(fid, companionStrip, vi);
        useStore.setState({ overviewAction: true });
        const scrollId = stripScrollId(companionStrip);
        const vStripCard = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        const fn = (window as any).__fh_handleAction;
        if (fn) fn((b as HTMLElement).dataset.action!, fid, vStripCard || fc, false, companionStrip);
        const action = (b as HTMLElement).dataset.action!;
        const asyncActions = ['upload', 'camera', 'text'];
        if (!asyncActions.includes(action)) {
          useStore.setState({ overviewAction: false });
          requestAnimationFrame(() => renderGrid4Row(row, fid));
        }
      })
    );
    // Version move handlers (◀▶)
    fc.querySelectorAll('[data-ovmove]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const k in s.drawActive) s.drawActive[+k] = null;
        useStore.setState({ reorderFid: null, swipeHighlightFid: null });
        const dir = (b as HTMLElement).dataset.ovmove!;
        const curAi = getStripActiveTab(fid, companionStrip);
        if (dir === 'left' && curAi > 0) {
          [tabs[curAi - 1], tabs[curAi]] = [tabs[curAi], tabs[curAi - 1]];
          setStripActiveTab(fid, companionStrip, curAi - 1);
        } else if (dir === 'right' && curAi < tabs.length - 1) {
          [tabs[curAi], tabs[curAi + 1]] = [tabs[curAi + 1], tabs[curAi]];
          setStripActiveTab(fid, companionStrip, curAi + 1);
        }
        relabelStripVersions(fid, companionStrip);
        useStore.setState({ verReorderFid: fid, verReorderStrip: companionStrip });
        renderGrid4Row(row, fid);
      })
    );
    const startBtn = fc.querySelector('[data-ovreorderstart]') as HTMLElement | null;
    if (startBtn)
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const k in s.drawActive) s.drawActive[+k] = null;
        useStore.setState({ reorderFid: null, swipeHighlightFid: null, verReorderFid: fid, verReorderStrip: companionStrip });
        renderGrid4Row(row, fid);
      });
    const doneBtn = fc.querySelector('[data-ovreorderdone]') as HTMLElement | null;
    if (doneBtn)
      doneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        useStore.setState({ verReorderFid: null, verReorderStrip: null });
        renderGrid4Row(row, fid);
      });
    const cvs = fc.querySelector(`#${vcid}`) as HTMLCanvasElement | null;
    if (cvs) {
      restoreCanvas(cvs, ver);
      if (ver.type !== 'empty' && s.drawActive[fid] === companionStrip && isActive) {
        const setupFn = (window as any).__fh_setupDrawing;
        if (setupFn) setupFn(cvs, fid, vi, companionStrip);
      }
    }
    versionsWrap.appendChild(colWrap);
  });

  // ── "+ New Version" card ──
  const addCard = document.createElement('div');
  addCard.className = 'ov-add-card g4-add-card';
  addCard.innerHTML = '<span class="ov-add-label">+ New Version</span>';
  addCard.addEventListener('click', () => {
    const fn = (window as any).__fh_clearAllDrawActive;
    if (fn) fn();
    const n = tabs.length + 1;
    addNewStripVersion(fid, companionStrip, { id: n, label: tabPrefix + n, type: 'empty', strokes: [], bgImage: null });
    renderGrid4Row(row, fid);
    const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
    if (vd) renderVersionFrame(vd, fid);
  });
  versionsWrap.appendChild(addCard);

  row.appendChild(versionsWrap);
}

/* ── GRID 3×2 view ─────────────────────────────────────────────── */
// 3-column grid of MAIN frame cards.  Hidden frames are completely
// invisible.  Groups are respected via getVisibleFrames().  A black
// page-separator line is inserted after every 6 visible cards.

export function renderGrid3x2(): void {
  const overviewScroll = document.getElementById('overviewScroll')!;
  overviewScroll.innerHTML = '';
  const s = state();
  // In 3×2, hidden frames are fully invisible (not a collapsed bar)
  const allFrames = getVisibleFrames();
  const visibleFrames = s.activeGroupId !== null
    ? allFrames
    : allFrames.filter((f: any) => !f.hidden);
  if (!visibleFrames.length) return;

  const container = document.createElement('div');
  container.className = 'grid3x2-container';

  visibleFrames.forEach((f: any, idx: number) => {
    // Page separator after every 6 frames
    if (idx > 0 && idx % 6 === 0) {
      const sep = document.createElement('div');
      sep.className = 'grid3x2-page-sep';
      container.appendChild(sep);
    }
    const cardWrap = document.createElement('div');
    cardWrap.className = 'grid3x2-card-wrap';
    cardWrap.dataset.g3fid = String(f.id);
    renderGrid3x2Card(cardWrap, f.id);
    container.appendChild(cardWrap);
  });
  overviewScroll.appendChild(container);

  // Set per-element margins: inter-row gap accounts for text area height
  requestAnimationFrame(() => recalcGrid3x2Margins());
}

/** Recalculate grid3x2 per-element margins (call on render AND on resize).
 *  All vertical gaps = 3vw — matches column-gap and side padding. */
export function recalcGrid3x2Margins(): void {
  const container = document.querySelector('.grid3x2-container') as HTMLElement | null;
  if (!container) return;
  const vw3 = Math.round(window.innerWidth * 0.03);
  container.style.rowGap = '0';
  // All card-wraps: uniform bottom margin = 3vw
  container.querySelectorAll('.grid3x2-card-wrap').forEach((cw: Element) => {
    (cw as HTMLElement).style.marginBottom = vw3 + 'px';
  });
  // Separator: same gap above and below (3vw).
  // Cards before separator keep their marginBottom (= vw3), so marginTop = 0.
  container.querySelectorAll('.grid3x2-page-sep').forEach((sep: Element) => {
    const el = sep as HTMLElement;
    el.style.marginTop = '0';
    el.style.marginBottom = vw3 + 'px';
  });
}

export function renderGrid3x2Card(wrap: HTMLElement, fid: number): void {
  const s = state();
  const f = s.frames.find((x: any) => x.id === fid);
  if (!f) return;
  wrap.innerHTML = '';

  // Grid 3×2 always uses 'ver' as companion — same as MAIN STRIP SINGLE VIEW
  const companionStrip: StripType = 'ver';
  const compareIdx = s.crossCompare[fid] ?? -1;
  const isCompare = compareIdx >= 0;
  const ar = `${f.cropW || 16}/${f.cropH || 9}`;

  if (isCompare) {
    // ── Showing VERSION content (after cross-swipe) ──
    const tabs = getStripVersions(fid, companionStrip) || [];
    const ai = Math.min(compareIdx, Math.max(tabs.length - 1, 0));
    if (!tabs.length) return;
    const ver = tabs[ai];
    if (!ver) return;
    const vcid = `g3_vc_${fid}_${ai}`;
    const tabPrefix = stripTabPrefix(companionStrip);
    const colorDots = drawToolbarHTML(fid, 'data-g3vfid', fid);

    // Version tabs row
    const tabsHTML = tabs.map((t: any, i: number) =>
      `<button class="vtab${i === ai ? ' active' : ''}" data-g3tab="${fid}" data-g3idx="${i}">${t.label || tabPrefix + (i + 1)}</button>`
    ).join('') + `<button class="vtab-add" data-g3vadd="${fid}">+</button>`;

    const mainReorder = s.reorderFid === fid;
    wrap.innerHTML = `<div class="frame-card${mainReorder ? ' g3-reorder-active' : ''}" data-g3fid="${fid}">
      <div class="frame-num ver-frame-num">
        <span class="frame-label-tag">${f.label || '#'} ${getFrameStripLabel(f, companionStrip)}</span>
        <div class="version-tabs">${tabsHTML}</div>
      </div>
      <div class="ver-canvas-area"><div class="canvas-wrap${
        s.drawActive[fid] === companionStrip ? ' draw-active' : ''
      }" style="aspect-ratio:${ar}"><canvas id="${vcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas>${
        ver.type === 'empty' ? '<div class="canvas-hint"><span>choose an action below</span></div>' : ''
      }${starHTML(fid, ai, companionStrip)}${fsButtonHTML(fid, ai, companionStrip)}</div></div>
      ${s.drawActive[fid] === companionStrip ? `<div class="color-row">${colorDots}</div>` : ''}
      <div class="version-actions">
        <button class="act-btn" data-action="upload" data-fid="${fid}">Load</button>
        <button class="act-btn${s.drawActive[fid] === companionStrip ? ' active' : ''}" data-action="draw" data-fid="${fid}">DRAW</button>
        <button class="act-btn" data-action="camera" data-fid="${fid}">◎ CAM</button>
        <button class="act-btn" data-action="text" data-fid="${fid}">WRITE</button>
        <button class="act-btn" data-action="clear" data-fid="${fid}">HIDE</button>
      </div>
    </div>`;

    // Wire version tab clicks
    wrap.querySelectorAll('[data-g3tab]').forEach((t) =>
      t.addEventListener('click', () => {
        const idx = parseInt((t as HTMLElement).dataset.g3idx!);
        s.crossCompare[fid] = idx;
        setStripActiveTab(fid, companionStrip, idx);
        renderGrid3x2Card(wrap, fid);
      })
    );
    // Wire + button
    const addBtn = wrap.querySelector(`[data-g3vadd="${fid}"]`) as HTMLElement | null;
    if (addBtn) addBtn.addEventListener('click', () => {
      const n = tabs.length + 1;
      addNewStripVersion(fid, companionStrip, { id: n, label: tabPrefix + n, type: 'empty', strokes: [], bgImage: null });
      const newTabs = getStripVersions(fid, companionStrip);
      s.crossCompare[fid] = newTabs.length - 1;
      setStripActiveTab(fid, companionStrip, newTabs.length - 1);
      renderGrid3x2Card(wrap, fid);
    });
    // Wire action buttons (same pattern as grid4 version cards)
    wrap.querySelectorAll('.act-btn[data-action]').forEach((b) =>
      b.addEventListener('click', () => {
        setStripActiveTab(fid, companionStrip, ai);
        useStore.setState({ overviewAction: true });
        const scrollId = stripScrollId(companionStrip);
        const vStripCard = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        const fc = wrap.querySelector('.frame-card') as HTMLElement;
        const fn = (window as any).__fh_handleAction;
        if (fn) fn((b as HTMLElement).dataset.action!, fid, vStripCard || fc, false, companionStrip);
        const action = (b as HTMLElement).dataset.action!;
        const asyncActions = ['upload', 'camera', 'text'];
        if (!asyncActions.includes(action)) {
          useStore.setState({ overviewAction: false });
          requestAnimationFrame(() => renderGrid3x2Card(wrap, fid));
        }
      })
    );
    // Color toolbar wiring
    wrap.querySelectorAll('.color-dot[data-g3vfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawColor[fid] = (d as HTMLElement).dataset.color!;
        s.drawEraser[fid] = false;
        renderGrid3x2Card(wrap, fid);
      })
    );
    wrap.querySelectorAll('.thick-btn[data-g3vfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawWidth[fid] = parseInt((d as HTMLElement).dataset.tw!);
        s.drawEraser[fid] = false;
        renderGrid3x2Card(wrap, fid);
      })
    );
    wrap.querySelectorAll('.eraser-btn[data-g3vfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawEraser[fid] = !s.drawEraser[fid];
        renderGrid3x2Card(wrap, fid);
      })
    );
    // Restore version canvas
    const cvs = wrap.querySelector(`#${vcid}`) as HTMLCanvasElement | null;
    if (cvs && ver) {
      restoreCanvas(cvs, ver);
      if (ver.type !== 'empty' && s.drawActive[fid] === companionStrip) {
        const setupFn = (window as any).__fh_setupDrawing;
        if (setupFn) setupFn(cvs, fid, ai, companionStrip);
      }
    }
    // Cross-swipe/arrows: swipe left → back to main
    _addGrid3x2Nav(wrap, fid, true);

  } else {
    // ── Showing MAIN content (default state) ──
    const mcid = `g3_mc_${fid}`;
    const colorDots = drawToolbarHTML(fid, 'data-g3mfid', fid);
    const viewMode = s.showText[fid];
    let bodyHTML = '';
    if (viewMode === 'text') {
      bodyHTML = `<div class="canvas-wrap text-view" style="aspect-ratio:${ar}"><textarea class="frame-text-edit" data-textfid="${fid}" placeholder="No text — click to add">${f.textContent || ''}</textarea></div>`;
    } else if (viewMode === 'table') {
      if (!f.tableData) f.tableData = defaultTableData();
      bodyHTML = `<div class="canvas-wrap text-view" style="aspect-ratio:${ar}">${tableHTML(fid, f.tableData)}</div>`;
    } else {
      bodyHTML = `<div class="canvas-wrap${s.drawActive[fid] === 'main' ? ' draw-active' : ''}" style="aspect-ratio:${ar}">${
        f.drawMode
          ? `<canvas id="${mcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas>`
          : `<img src="${f.src}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;">`
      }${fsButtonHTML(fid, 0, 'main')}${setupTagHTML(fid)}</div>`;
    }
    const btnLabel = viewMode === 'text'
      ? 'Pic/<span class="ptt-bold">Txt</span>/Tbl'
      : viewMode === 'table'
      ? 'Pic/Txt/<span class="ptt-bold">Tbl</span>'
      : '<span class="ptt-bold">Pic</span>/Txt/Tbl';

    const g3Reorder = s.reorderFid === fid;
    wrap.innerHTML = `<div class="frame-card${g3Reorder ? ' g3-reorder-active' : ''}" data-g3fid="${fid}">
      <div class="frame-num"><span class="frame-label-tag" data-editlabel="${fid}">${f.label || '#'}</span><button class="vtab pictxt-btn${
      viewMode ? ' active' : ''
    }" data-mact="pictxt" data-mfid="${fid}">${btnLabel}</button><div class="reorder-group${
      s.reorderFid === fid ? ' active' : ''
    }${s.verReorderFid !== null ? ' locked' : ''}"><button class="vtab-add" data-mact="moveup" data-mfid="${fid}">◄</button>${
      s.reorderFid === fid
        ? `<span class="reorder-label" data-mact="reorderdone" data-mfid="${fid}">DONE</span>`
        : `<span class="reorder-label" data-mact="reorderstart" data-mfid="${fid}">re-order</span>`
    }<button class="vtab-add" data-mact="movedown" data-mfid="${fid}">►</button></div></div>
      <div class="version-body">${bodyHTML}</div>
      ${s.drawActive[fid] === 'main' ? `<div class="color-row">${colorDots}</div>` : ''}
      <div class="version-actions">
        <button class="act-btn" data-mact="new" data-mfid="${fid}">New</button>
        <button class="act-btn" data-mact="upload" data-mfid="${fid}">Load</button>
        <button class="act-btn${s.drawActive[fid] === 'main' ? ' active' : ''}" data-mact="draw" data-mfid="${fid}">DRAW</button>
        <button class="act-btn" data-mact="camera" data-mfid="${fid}">◎ CAM</button>
        <button class="act-btn" data-mact="write" data-mfid="${fid}">WRITE</button>
        <button class="act-btn" data-mact="delete" data-mfid="${fid}">HIDE</button>
      </div>
    </div>
    <div class="g3-text-block" data-g3text="${fid}" contenteditable="false">${f.textContent ? f.textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''}</div>`;

    const card = wrap.querySelector('.frame-card')!;

    // Wire editable text block below card
    const textBlock = wrap.querySelector(`[data-g3text="${fid}"]`) as HTMLElement | null;
    if (textBlock) {
      textBlock.addEventListener('click', () => {
        textBlock.contentEditable = 'true';
        textBlock.classList.add('g3-text-active');
        textBlock.focus();
      });
      textBlock.addEventListener('blur', () => {
        textBlock.contentEditable = 'false';
        textBlock.classList.remove('g3-text-active');
        f.textContent = textBlock.innerText;
        textBlock.scrollTop = 0;
      });
    }

    // Color toolbar wiring
    card.querySelectorAll('.color-dot[data-g3mfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawColor[fid] = (d as HTMLElement).dataset.color!;
        s.drawEraser[fid] = false;
        renderGrid3x2Card(wrap, fid);
      })
    );
    card.querySelectorAll('.thick-btn[data-g3mfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawWidth[fid] = parseInt((d as HTMLElement).dataset.tw!);
        s.drawEraser[fid] = false;
        renderGrid3x2Card(wrap, fid);
      })
    );
    card.querySelectorAll('.eraser-btn[data-g3mfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawEraser[fid] = !s.drawEraser[fid];
        renderGrid3x2Card(wrap, fid);
      })
    );
    // Action buttons
    card.querySelectorAll('[data-mact]').forEach((b) =>
      b.addEventListener('click', (e) => {
        const act = (b as HTMLElement).dataset.mact!;
        // Hide/Del in 3×2 — show same confirmation modal as other views
        if (act === 'delete') {
          e.stopPropagation();
          const s2 = state();
          if (s2.activeGroupId !== null) {
            // Inside a group: confirm removal from group
            const gid = s2.activeGroupId;
            showConfirm('Remove this frame and all its versions from this group?\nYou can still find the frame in group ALL.').then((ok) => {
              if (!ok) return;
              useStore.setState({ scrollHideGuard: Date.now() + 600 });
              removeFrameFromGroup(fid, gid);
              updateFrameBadge();
              const renderFn = (window as any).__fh_renderGrid3x2;
              if (renderFn) renderFn();
            });
          } else {
            // ALL view: hide or permanent delete
            showDeleteChoice().then((choice) => {
              if (!choice) return;
              useStore.setState({ scrollHideGuard: Date.now() + 600 });
              if (choice === 'hide') {
                f.hidden = true;
              } else {
                const s3 = state();
                const idx2 = s3.frames.findIndex((x: any) => x.id === fid);
                if (idx2 >= 0) s3.frames.splice(idx2, 1);
                delete s3.versions[fid];
                delete s3.activeTab[fid];
                delete s3.drawColor[fid];
              }
              updateFrameBadge();
              const renderFn = (window as any).__fh_renderGrid3x2;
              if (renderFn) renderFn();
            });
          }
          return;
        }
        const fn = (window as any).__fh_handleMainAction;
        if (fn) fn(act, fid, card as HTMLElement);
        // Async actions (write, upload, camera) re-render in their own callbacks
        const asyncActs = ['write', 'upload', 'camera'];
        if (!asyncActs.includes(act)) {
          requestAnimationFrame(() => {
            if (act === 'new') {
              const renderFn = (window as any).__fh_renderGrid3x2;
              if (renderFn) renderFn();
            } else {
              renderGrid3x2Card(wrap, fid);
            }
          });
        }
      })
    );
    // Label edit
    card.querySelectorAll('[data-editlabel]').forEach((el) =>
      el.addEventListener('click', async () => {
        const result = await showLabelEdit(f.label);
        if (result === null) return;
        f.label = result;
        const fn = (window as any).__fh_renderGrid3x2;
        if (fn) fn();
      })
    );
    // Canvas setup
    if (f.drawMode) {
      const cvs = card.querySelector(`#${mcid}`) as HTMLCanvasElement | null;
      if (cvs) {
        restoreMainCanvas(cvs, f);
        if (s.drawActive[fid] === 'main') setupMainDrawing(cvs, fid);
      }
    }
    // Canvas click → exit 3×2, jump to MAIN + companion strip view (single click, all platforms)
    if (!s.drawActive[fid] && viewMode !== 'text' && viewMode !== 'table') {
      const canvasWrap = card.querySelector('.canvas-wrap') as HTMLElement | null;
      if (canvasWrap) {
        let _tapX = 0, _tapY = 0;
        canvasWrap.addEventListener('pointerdown', (e) => { _tapX = e.clientX; _tapY = e.clientY; }, { passive: true });
        canvasWrap.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.act-btn,.fs-btn,.star-btn,.nav-arrow,.setup-toggle-btn')) return;
          if (s.drawingInProgress || s.drawSuppressClick) return;
          const dx = Math.abs(e.clientX - _tapX), dy = Math.abs(e.clientY - _tapY);
          if (dx > 15 || dy > 15) return; // was a swipe, not a tap
          // Exit 3×2 → MAIN + closest companion (ver > floor > refs)
          const curStrips = state().activeStrips;
          const priority: StripType[] = ['ver', 'floor', 'refs'];
          const best = priority.find((st) => curStrips.includes(st as any)) || 'ver';
          useStore.setState({ activeStrips: ['main', best] as any });
          const setVm = (window as any).__fh_setViewMode;
          if (setVm) setVm('both', false, String(fid));
        });
      }
    }
    // Cross-swipe/arrows: swipe right → show version content
    if (!s.drawActive[fid]) _addGrid3x2Nav(wrap, fid, false);
  }
  // Wire setup toggle buttons
  if (state().setupEditing) wireSetupClicks(wrap);
}

/** Add swipe (touch) and arrow (desktop) navigation for 3×2 cards.
 *  @param isVersion true when the card is currently showing version content */
function _addGrid3x2Nav(wrap: HTMLElement, fid: number, isVersion: boolean): void {
  const cw = wrap.querySelector('.canvas-wrap') as HTMLElement | null;
  if (!cw) return;
  const s = state();
  // Grid 3×2 always uses 'ver' — same as MAIN STRIP SINGLE VIEW
  const companionStrip: StripType = 'ver';

  if (isTouch) {
    // Touch: swipe handler
    let sx = 0, sy = 0;
    cw.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    cw.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
      if (state().drawingInProgress) return;
      if (isVersion && dx > 0) {
        const cur = s.crossCompare[fid] ?? 0;
        if (cur > 0) {
          s.crossCompare[fid] = cur - 1;
          setStripActiveTab(fid, companionStrip, cur - 1);
        } else {
          s.crossCompare[fid] = -1; // back to main
        }
        renderGrid3x2Card(wrap, fid);
      } else if (!isVersion && dx < 0) {
        const ai = getStripActiveTab(fid, companionStrip) || 0;
        s.crossCompare[fid] = ai;
        renderGrid3x2Card(wrap, fid);
      } else if (isVersion && dx < 0) {
        const cur = s.crossCompare[fid] ?? 0;
        const tabs = getStripVersions(fid, companionStrip);
        if (cur < tabs.length - 1) {
          s.crossCompare[fid] = cur + 1;
          setStripActiveTab(fid, companionStrip, cur + 1);
          renderGrid3x2Card(wrap, fid);
        }
      }
    });
  }

  // Arrow buttons — always show (touch AND desktop)
  if (isVersion) {
    const cur = s.crossCompare[fid] ?? 0;
    const leftHTML = '<button class="nav-arrow nav-arrow-left" data-g3nav="left">‹</button>';
    const tabs = getStripVersions(fid, companionStrip);
    const rightHTML = cur < tabs.length - 1 ? '<button class="nav-arrow nav-arrow-right" data-g3nav="right">›</button>' : '';
    cw.insertAdjacentHTML('beforeend', leftHTML + rightHTML);
  } else {
    const tabs = getStripVersions(fid, companionStrip);
    if (tabs.length > 0) {
      cw.insertAdjacentHTML('beforeend', '<button class="nav-arrow nav-arrow-right" data-g3nav="right">›</button>');
    }
  }
  cw.querySelectorAll('[data-g3nav]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dir = (btn as HTMLElement).dataset.g3nav!;
      if (isVersion) {
        if (dir === 'left') {
          const cur = s.crossCompare[fid] ?? 0;
          if (cur > 0) {
            s.crossCompare[fid] = cur - 1;
            setStripActiveTab(fid, companionStrip, cur - 1);
          } else {
            s.crossCompare[fid] = -1; // back to main
          }
        } else {
          const cur = s.crossCompare[fid] ?? 0;
          const tabs = getStripVersions(fid, companionStrip);
          if (cur < tabs.length - 1) {
            s.crossCompare[fid] = cur + 1;
            setStripActiveTab(fid, companionStrip, cur + 1);
          }
        }
      } else {
        const ai = getStripActiveTab(fid, companionStrip) || 0;
        s.crossCompare[fid] = ai;
      }
      renderGrid3x2Card(wrap, fid);
    })
  );
}
