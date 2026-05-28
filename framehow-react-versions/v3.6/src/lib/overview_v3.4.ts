// Full Overview rendering — main + grid of versions for each frame, side-by-side.

import { state, useStore } from '../store/state';
import {
  drawToolbarHTML,
  fsButtonHTML,
  starHTML,
  tableHTML,
  defaultTableData,
  addNewVersion,
  unhideVersion,
  relabelVersions,
  ovCollapseExpanded,
  updateFrameBadge,
} from './helpers';
import { restoreCanvas, restoreMainCanvas, setupMainDrawing } from './drawing';
import { renderVersionFrame } from './render';
import { showLabelEdit } from './modals';

export function renderOverview(): void {
  const overviewScroll = document.getElementById('overviewScroll')!;
  overviewScroll.innerHTML = '';
  const s = state();
  if (!s.frames.length) return;
  s.frames.forEach((f) => overviewScroll.appendChild(buildOverviewRow(f)));
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
  if (f.hidden) {
    const tabs = s.versions[fid] || [];
    const ai = s.activeTab[fid] || 0;
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
  const tabs = s.versions[fid] || [];
  const ai = s.activeTab[fid] || 0;

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
    }${fsButtonHTML(fid, 0, 'main')}</div>`;
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
      <button class="act-btn${s.prevFrameState[fid] && s.prevFrameState[fid]!.origin === 'main' ? '' : ' disabled'}" data-mact="undo" data-mfid="${fid}"><svg width="12" height="12" viewBox="-24 -24 48 48" fill="currentColor"><g transform="scale(-1,1) rotate(90)"><path d="M-12,-18 L-12,2 A14,14 0 0 0 16,2 L16,-6 L10,-6 L10,2 A8,8 0 0 1 -6,2 L-6,-12 L-1,-12 L-9,-22 L-17,-12 L-12,-12 Z"/></g></svg></button>
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
    const isVReorder = s.verReorderFid === fid;
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
        <div class="ov-ver-label" style="pointer-events:auto;">${ver.label || 'v' + (vi + 1)}<button class="btn" data-ovunhide="${fid}" data-ovunhidevi="${vi}" style="margin-left:auto;font-size:10px;padding:2px 10px;">Un-Hide</button></div>
        <div style="opacity:0.3;pointer-events:none;"><div class="ver-canvas-area"><div class="canvas-wrap" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9}"><canvas id="${vcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas></div></div></div>
      </div>`;
      const uhBtn = vcard.querySelector(`[data-ovunhide="${fid}"]`) as HTMLElement | null;
      if (uhBtn)
        uhBtn.addEventListener('click', () => {
          unhideVersion(ver, fid);
          renderOverviewRow(row, fid);
          const vd = document.querySelector(`.frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (vd) renderVersionFrame(vd, fid);
        });
      const cvs = vcard.querySelector(`#${vcid}`) as HTMLCanvasElement | null;
      if (cvs) restoreCanvas(cvs, ver);
      verDiv.appendChild(vcard);
      return;
    }
    vcard.style.opacity = '';
    vcard.innerHTML = `<div class="frame-card${cardClass ? ' ' + cardClass : ''}" data-ovfid="${fid}" data-ovi="${vi}">
      <div class="ov-ver-label">${ver.label || 'v' + (vi + 1)} ${reorderHTML}</div>
      <div class="ver-canvas-area"><div class="canvas-wrap${
        s.drawActive[fid] === 'ver' && isActive ? ' draw-active' : ''
      }" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9}"><canvas id="${vcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas>${
      ver.type === 'empty' ? '<div class="canvas-hint"><span>click to choose action</span></div>' : ''
    }${starHTML(fid, vi)}${fsButtonHTML(fid, vi, 'ver')}</div></div>
      ${s.drawActive[fid] === 'ver' && isActive ? `<div class="color-row">${colorDotsVer}</div>` : ''}
      <div class="version-actions">
        <button class="act-btn" data-action="upload" data-fid="${fid}">Load</button>
        <button class="act-btn${s.drawActive[fid] === 'ver' && isActive ? ' active' : ''}" data-action="draw" data-fid="${fid}">DRAW</button>
        <button class="act-btn" data-action="camera" data-fid="${fid}">◎ CAM</button>
        <button class="act-btn" data-action="text" data-fid="${fid}">WRITE</button>
        <button class="act-btn" data-action="copy" data-fid="${fid}">Copy</button>
        <button class="act-btn" data-action="paste" data-fid="${fid}">Paste</button>
        <button class="act-btn" data-action="clear" data-fid="${fid}">Hide/Del</button>
        <button class="act-btn${s.prevFrameState[fid] && s.prevFrameState[fid]!.origin === 'ver' ? '' : ' disabled'}" data-action="undo" data-fid="${fid}"><svg width="12" height="12" viewBox="-24 -24 48 48" fill="currentColor"><g transform="scale(-1,1) rotate(90)"><path d="M-12,-18 L-12,2 A14,14 0 0 0 16,2 L16,-6 L10,-6 L10,2 A8,8 0 0 1 -6,2 L-6,-12 L-1,-12 L-9,-22 L-17,-12 L-12,-12 Z"/></g></svg></button>
      </div>
    </div>`;
    const fc = vcard.querySelector('.frame-card') as HTMLElement;
    fc.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.act-btn,.color-dot,.thick-btn,.eraser-btn,.vtab-add,.reorder-label')) return;
      if (!document.contains(fc)) return;
      if (state().drawingInProgress || state().drawSuppressClick) return;
      if ((e.target as HTMLElement).tagName === 'CANVAS' && s.drawActive[fid] && vi === s.activeTab[fid]) return;
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
        s.activeTab[fid] = vi;
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
      const wasActive = vi === s.activeTab[fid];
      const wasExpanded = prevFid === fid && wasActive;
      if (wasActive && wasExpanded) {
        ovCollapseExpanded();
        return;
      }
      useStore.setState({ ovExpandedFid: fid });
      if (!wasActive) {
        s.activeTab[fid] = vi;
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
        if (vi !== ai) s.activeTab[fid] = vi;
        useStore.setState({ overviewAction: true });
        const vStripCard = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        const fn = (window as any).__fh_handleAction;
        if (fn) fn((b as HTMLElement).dataset.action!, fid, vStripCard || fc);
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
        const curAi = s.activeTab[fid];
        if (dir === 'left' && curAi > 0) {
          [tabs[curAi - 1], tabs[curAi]] = [tabs[curAi], tabs[curAi - 1]];
          s.activeTab[fid] = curAi - 1;
        } else if (dir === 'right' && curAi < tabs.length - 1) {
          [tabs[curAi], tabs[curAi + 1]] = [tabs[curAi + 1], tabs[curAi]];
          s.activeTab[fid] = curAi + 1;
        }
        relabelVersions(fid);
        useStore.setState({ verReorderFid: fid });
        renderOverviewRow(row, fid);
      })
    );
    const startBtn = fc.querySelector('[data-ovreorderstart]') as HTMLElement | null;
    if (startBtn)
      startBtn.addEventListener('click', () => {
        for (const k in s.drawActive) s.drawActive[+k] = null;
        useStore.setState({ reorderFid: null, swipeHighlightFid: null, verReorderFid: fid });
        renderOverviewRow(row, fid);
      });
    const doneBtn = fc.querySelector('[data-ovreorderdone]') as HTMLElement | null;
    if (doneBtn)
      doneBtn.addEventListener('click', () => {
        useStore.setState({ verReorderFid: null });
        renderOverviewRow(row, fid);
      });
    const cvs = fc.querySelector(`#${vcid}`) as HTMLCanvasElement | null;
    if (cvs) {
      restoreCanvas(cvs, ver);
      if (ver.type !== 'empty' && s.drawActive[fid] === 'ver' && isActive) {
        // setupDrawing in expanded version card
        const setupFn = (window as any).__fh_setupDrawing;
        if (setupFn) setupFn(cvs, fid, vi);
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
    addNewVersion(fid, { id: n, label: 'v' + n, type: 'empty', strokes: [], bgImage: null });
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
