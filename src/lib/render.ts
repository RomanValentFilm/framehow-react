// Main + version strip card rendering. Ported from the original `renderMainFrame`,
// `renderVersionFrame`, `buildMainFrame`, `buildVersionFrame`, `renderAll`.

import { state, useStore } from '../store/state';
import {
  drawToolbarHTML,
  fsButtonHTML,
  starHTML,
  tableHTML,
  defaultTableData,
  saveOpenTextEdits,
  saveOpenTableEdits,
  addNewVersion,
  unhideVersion,
  relabelVersions,
  clearAllDrawActive,
  clearReorder,
  updateFrameBadge,
} from './helpers';
import { restoreCanvas, restoreMainCanvas, setupDrawing, setupMainDrawing } from './drawing';
import { addCrossSwipe, addNavArrows, scheduleSyncHeights } from './view';
import { showLabelEdit } from './modals';

export function renderAll(): void {
  saveOpenTextEdits();
  saveOpenTableEdits();
  const mainScroll = document.getElementById('mainScroll')!;
  const versionsScroll = document.getElementById('versionsScroll')!;
  const overviewScroll = document.getElementById('overviewScroll')!;
  mainScroll.innerHTML = '';
  versionsScroll.innerHTML = '';
  overviewScroll.innerHTML = '';
  const s = state();
  if (!s.frames.length) return;
  s.frames.forEach((f) => {
    mainScroll.appendChild(buildMainFrame(f));
    versionsScroll.appendChild(buildVersionFrame(f.id));
  });
  if (s.currentViewMode === 'overview') {
    const fn = (window as any).__fh_renderOverview;
    if (fn) fn();
  }
  requestAnimationFrame(() => scheduleSyncHeights());
}

export function buildMainFrame(f: any): HTMLElement {
  const div = document.createElement('div');
  div.className = 'frame-card';
  div.dataset.mfid = String(f.id);
  renderMainFrame(div, f.id);
  return div;
}

export function buildVersionFrame(fid: number): HTMLElement {
  const div = document.createElement('div');
  div.className = 'frame-card';
  div.dataset.vfid = String(fid);
  renderVersionFrame(div, fid);
  return div;
}

export function renderMainFrame(div: HTMLElement, fid: number): void {
  const s = state();
  const f = s.frames.find((fr) => fr.id === fid);
  if (!f) return;

  if (f.hidden) {
    div.style.background = 'rgba(51,51,51,0.4)';
    div.style.borderColor = 'rgba(255,255,255,0.12)';
    div.innerHTML = `
      <div class="frame-num">
        ${f.label ? `<span class="frame-label-tag">${f.label}</span>` : '<span style="color:var(--text-faint);font-style:italic;">hidden</span>'}
        <button class="btn" data-unhide="${fid}" style="margin-left:auto;font-size:10px;padding:2px 10px;">Un-Hide</button>
      </div>`;
    div.querySelector(`[data-unhide="${fid}"]`)!.addEventListener('click', () => {
      f.hidden = false;
      div.style.background = '';
      div.style.borderColor = '';
      updateFrameBadge();
      renderAll();
    });
    scheduleSyncHeights();
    return;
  }
  div.style.background = '';
  div.style.borderColor = '';
  const mcid = `mcvs_${fid}`;
  const compareIdx = s.crossCompare[fid] ?? -1;
  const isCompare = compareIdx >= 0 && s.currentViewMode === 'main';

  if (isCompare) {
    s.activeTab[fid] = compareIdx;
    const tabs = s.versions[fid],
      ai = compareIdx,
      ver = tabs[ai],
      cid = `mcvs_${fid}_${ai}`;
    const isCReorder = s.verReorderFid === fid;
    const tabsHTML =
      tabs
        .map(
          (t: any, i: number) =>
            `<button class="vtab ${
              i === ai ? 'active' + (isCReorder ? ' reorder-highlight' : '') : ''
            }${i === ai && s.swipeHighlightFid === fid ? ' swipe-highlight' : ''}" data-cfidtab="${fid}" data-cidx="${i}"${
              t.hidden ? ' style="opacity:0.3;pointer-events:none;"' : ''
            }>${t.label}</button>`
        )
        .join('') + `<button class="vtab-add" data-cvadd="${fid}">+</button>`;
    const reorderHTML =
      tabs.length > 1
        ? `<div class="reorder-group${isCReorder ? ' active' : ''}${
            s.reorderFid !== null ? ' locked' : ''
          }"><button class="vtab-add" data-cvmove="left" data-cfid="${fid}" title="Move left">◀</button>${
            isCReorder
              ? `<span class="reorder-label" data-cvreorderdone="${fid}">DONE</span>`
              : `<span class="reorder-label" data-cvreorderstart="${fid}">move</span>`
          }<button class="vtab-add" data-cvmove="right" data-cfid="${fid}" title="Move right">▶</button></div>`
        : '';
    const colorDots = drawToolbarHTML(fid, 'data-cfid', fid);
    const cCanvasBorder = isCReorder
      ? 'border:2px solid #e53935;border-radius:var(--radius-sm);'
      : 'border:2px solid var(--accent);border-radius:var(--radius-sm);';
    div.innerHTML = `
      <div class="frame-num ver-frame-num">${
        f.label ? `<span class="frame-label-tag">${f.label}</span>` : '<span></span>'
      }<div class="version-tabs${
        s.reorderFid === fid ? ' locked-dim' : s.verReorderFid === fid ? ' locked' : ''
      }">${tabsHTML}</div>${reorderHTML}</div>
      <div class="ver-canvas-area"><div class="canvas-wrap${
        s.drawActive[fid] === 'ver' ? ' draw-active' : ''
      }" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9};${cCanvasBorder}"><canvas id="${cid}" width="${
      f.cropW || 960
    }" height="${f.cropH || 540}"></canvas>${
        ver.type === 'empty' ? '<div class="canvas-hint"><span>choose an action below</span></div>' : ''
      }${starHTML(fid, ai)}${fsButtonHTML(fid, ai, 'ver')}</div></div>
      ${s.drawActive[fid] === 'ver' ? `<div class="color-row">${colorDots}</div>` : ''}
      <div class="version-actions">
        <button class="act-btn" data-cact="upload" data-cfid="${fid}">Load</button>
        <button class="act-btn${s.drawActive[fid] === 'ver' ? ' active' : ''}" data-cact="draw" data-cfid="${fid}">DRAW</button>
        <button class="act-btn" data-cact="camera" data-cfid="${fid}">◎ CAM</button>
        <button class="act-btn" data-cact="text" data-cfid="${fid}">WRITE</button>
        <button class="act-btn" data-cact="copy" data-cfid="${fid}">Copy</button>
        <button class="act-btn" data-cact="paste" data-cfid="${fid}">Paste</button>
        <button class="act-btn" data-cact="clear" data-cfid="${fid}">Hide/Del</button>
        <button class="act-btn${s.prevFrameState[fid] && s.prevFrameState[fid]!.origin === 'ver' ? '' : ' disabled'}" data-cact="undo" data-cfid="${fid}" style="margin-left:auto">Undo</button>
      </div>`;

    div.querySelectorAll('[data-cfidtab]').forEach((t) =>
      t.addEventListener('click', () => {
        if (s.reorderFid === fid || s.verReorderFid === fid) return;
        clearAllDrawActive();
        const idx = parseInt((t as HTMLElement).dataset.cidx!);
        s.crossCompare[fid] = idx;
        s.activeTab[fid] = idx;
        renderMainFrame(div, fid);
        const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (vd) renderVersionFrame(vd, fid);
      })
    );
    const addBtn = div.querySelector('[data-cvadd]') as HTMLElement | null;
    if (addBtn)
      addBtn.addEventListener('click', () => {
        if (s.reorderFid === fid || s.verReorderFid === fid) return;
        clearAllDrawActive();
        const n = s.versions[fid].length + 1;
        addNewVersion(fid, { id: n, label: `v${n}`, type: 'empty', strokes: [], bgImage: null });
        s.crossCompare[fid] = s.activeTab[fid];
        renderMainFrame(div, fid);
        const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (vd) renderVersionFrame(vd, fid);
      });
    const cStartBtn = div.querySelector('[data-cvreorderstart]') as HTMLElement | null;
    if (cStartBtn)
      cStartBtn.addEventListener('click', () => {
        for (const k in s.drawActive) s.drawActive[+k] = null;
        useStore.setState({ reorderFid: null, swipeHighlightFid: null });
        document.querySelectorAll('.frame-card.reorder-active').forEach((c) => c.classList.remove('reorder-active'));
        useStore.setState({ verReorderFid: fid });
        renderMainFrame(div, fid);
        document.querySelectorAll('.frame-card[data-mfid]').forEach((c) => {
          if (parseInt((c as HTMLElement).dataset.mfid!) !== fid) renderMainFrame(c as HTMLElement, parseInt((c as HTMLElement).dataset.mfid!));
        });
        document.querySelectorAll('.frame-card[data-vfid]').forEach((c) =>
          renderVersionFrame(c as HTMLElement, parseInt((c as HTMLElement).dataset.vfid!))
        );
      });
    const cDoneBtn = div.querySelector('[data-cvreorderdone]') as HTMLElement | null;
    if (cDoneBtn)
      cDoneBtn.addEventListener('click', () => {
        useStore.setState({ verReorderFid: null });
        renderMainFrame(div, fid);
        const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (vd) renderVersionFrame(vd, fid);
        document.querySelectorAll('.frame-card[data-mfid]').forEach((c) => {
          if (parseInt((c as HTMLElement).dataset.mfid!) !== fid) renderMainFrame(c as HTMLElement, parseInt((c as HTMLElement).dataset.mfid!));
        });
        document.querySelectorAll('.frame-card[data-vfid]').forEach((c) => {
          if (parseInt((c as HTMLElement).dataset.vfid!) !== fid)
            renderVersionFrame(c as HTMLElement, parseInt((c as HTMLElement).dataset.vfid!));
        });
      });
    div.querySelectorAll('[data-cvmove]').forEach((b) =>
      b.addEventListener('click', () => {
        for (const k in s.drawActive) s.drawActive[+k] = null;
        useStore.setState({ reorderFid: null, swipeHighlightFid: null });
        document.querySelectorAll('.frame-card.reorder-active').forEach((c) => c.classList.remove('reorder-active'));
        const dir = (b as HTMLElement).dataset.cvmove!;
        const t = s.versions[fid];
        const ci = s.crossCompare[fid];
        if (dir === 'left' && ci > 0) {
          [t[ci - 1], t[ci]] = [t[ci], t[ci - 1]];
          s.crossCompare[fid] = ci - 1;
          s.activeTab[fid] = ci - 1;
        } else if (dir === 'right' && ci < t.length - 1) {
          [t[ci], t[ci + 1]] = [t[ci + 1], t[ci]];
          s.crossCompare[fid] = ci + 1;
          s.activeTab[fid] = ci + 1;
        }
        relabelVersions(fid);
        useStore.setState({ verReorderFid: fid });
        renderMainFrame(div, fid);
        const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (vd) renderVersionFrame(vd, fid);
        document.querySelectorAll('.frame-card[data-mfid]').forEach((c) => {
          if (parseInt((c as HTMLElement).dataset.mfid!) !== fid) renderMainFrame(c as HTMLElement, parseInt((c as HTMLElement).dataset.mfid!));
        });
        document.querySelectorAll('.frame-card[data-vfid]').forEach((c) => {
          if (parseInt((c as HTMLElement).dataset.vfid!) !== fid)
            renderVersionFrame(c as HTMLElement, parseInt((c as HTMLElement).dataset.vfid!));
        });
      })
    );
    div.querySelectorAll('.color-dot[data-cfid]').forEach((d) =>
      d.addEventListener('click', () => {
        const c = (d as HTMLElement).dataset.color!;
        s.drawColor[fid] = c;
        s.drawEraser[fid] = false;
        const txt = ver.strokes && ver.strokes.find((stk: any) => stk.type === 'text');
        if (txt) txt.color = c;
        renderMainFrame(div, fid);
      })
    );
    div.querySelectorAll('.thick-btn[data-cfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawWidth[fid] = parseInt((d as HTMLElement).dataset.tw!);
        s.drawEraser[fid] = false;
        renderMainFrame(div, fid);
      })
    );
    div.querySelectorAll('.eraser-btn[data-cfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawEraser[fid] = !s.drawEraser[fid];
        renderMainFrame(div, fid);
      })
    );
    div.querySelectorAll('[data-cact]').forEach((b) =>
      b.addEventListener('click', () => {
        s.activeTab[fid] = s.crossCompare[fid];
        const fn = (window as any).__fh_handleAction;
        if (fn) fn((b as HTMLElement).dataset.cact!, fid, div, true);
      })
    );
    const cvs = div.querySelector(`#${cid}`) as HTMLCanvasElement | null;
    if (cvs) {
      if (ver) restoreCanvas(cvs, ver);
      else {
        const ctx = cvs.getContext('2d')!;
        ctx.clearRect(0, 0, cvs.width, cvs.height);
      }
      if (s.drawActive[fid] === 'ver' && ver) setupDrawing(cvs, fid, ai);
    }
    if (!s.drawActive[fid]) {
      const cw = (div.querySelector('.ver-canvas-area') || div.querySelector('.canvas-wrap')) as HTMLElement | null;
      if (cw) addCrossSwipe(cw, fid, 'main');
      const nw = div.querySelector('.canvas-wrap') as HTMLElement | null;
      if (nw) addNavArrows(nw, fid, 'main');
    }
    scheduleSyncHeights();
    return;
  }

  // ── NORMAL MODE ──
  const colorDots = drawToolbarHTML(fid, 'data-mfid', fid);
  let bodyHTML = '';
  const viewMode2 = s.showText[fid];
  if (viewMode2 === 'text') {
    bodyHTML = `<div class="canvas-wrap text-view" style="aspect-ratio:${f.cropW || 16}/${
      f.cropH || 9
    }"><textarea class="frame-text-edit" data-textfid="${fid}" placeholder="No text — click to add">${f.textContent || ''}</textarea></div>`;
  } else if (viewMode2 === 'table') {
    if (!f.tableData) f.tableData = defaultTableData();
    bodyHTML = `<div class="canvas-wrap text-view" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9}">${tableHTML(
      fid,
      f.tableData
    )}</div>`;
  } else {
    bodyHTML = `<div class="canvas-wrap${
      s.drawActive[fid] === 'main' ? ' draw-active' : ''
    }" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9}">${
      f.drawMode
        ? `<canvas id="${mcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas>`
        : `<img src="${f.src}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;">`
    }${fsButtonHTML(fid, 0, 'main')}</div>`;
  }
  const btnLabel2 =
    viewMode2 === 'text'
      ? 'Pic/<span class="ptt-bold">Txt</span>/Tbl'
      : viewMode2 === 'table'
      ? 'Pic/Txt/<span class="ptt-bold">Tbl</span>'
      : '<span class="ptt-bold">Pic</span>/Txt/Tbl';
  div.innerHTML = `
    <div class="frame-num"><span class="frame-label-tag" data-editlabel="${fid}">${f.label || '#'}</span><button class="vtab pictxt-btn${
    viewMode2 ? ' active' : ''
  }" data-mact="pictxt" data-mfid="${fid}">${btnLabel2}</button><div class="reorder-group${
    s.reorderFid === fid ? ' active' : ''
  }${s.verReorderFid !== null ? ' locked' : ''}"><button class="vtab-add" data-mact="moveup" data-mfid="${fid}" title="Move up">▲</button>${
    s.reorderFid === fid
      ? `<span class="reorder-label" data-mact="reorderdone" data-mfid="${fid}">DONE</span>`
      : `<span class="reorder-label" data-mact="reorderstart" data-mfid="${fid}">re-order</span>`
  }<button class="vtab-add" data-mact="movedown" data-mfid="${fid}" title="Move down">▼</button></div></div>
    <div class="version-body">${bodyHTML}</div>
    ${s.drawActive[fid] === 'main' ? `<div class="color-row">${colorDots}</div>` : ''}
    <div class="version-actions">
      <button class="act-btn" data-mact="new" data-mfid="${fid}">New</button>
      <button class="act-btn" data-mact="upload" data-mfid="${fid}">Load</button>
      <button class="act-btn${s.drawActive[fid] === 'main' ? ' active' : ''}" data-mact="draw" data-mfid="${fid}">DRAW</button>
      <button class="act-btn" data-mact="camera" data-mfid="${fid}">◎ CAM</button>
      <button class="act-btn" data-mact="write" data-mfid="${fid}">WRITE</button>
      <button class="act-btn" data-mact="copy" data-mfid="${fid}">Copy</button>
      <button class="act-btn" data-mact="paste" data-mfid="${fid}">Paste</button>
      <button class="act-btn" data-mact="delete" data-mfid="${fid}">Hide/Del</button>
      <button class="act-btn${s.prevFrameState[fid] && s.prevFrameState[fid]!.origin === 'main' ? '' : ' disabled'}" data-mact="undo" data-mfid="${fid}" style="margin-left:auto">Undo</button>
    </div>`;

  div.querySelectorAll('.color-dot[data-mfid]').forEach((d) =>
    d.addEventListener('click', () => {
      const c = (d as HTMLElement).dataset.color!;
      s.drawColor[fid] = c;
      s.drawEraser[fid] = false;
      const txt = f.strokes && f.strokes.find((stk: any) => stk.type === 'text');
      if (txt) txt.color = c;
      renderMainFrame(div, fid);
    })
  );
  div.querySelectorAll('.thick-btn[data-mfid]').forEach((d) =>
    d.addEventListener('click', () => {
      s.drawWidth[fid] = parseInt((d as HTMLElement).dataset.tw!);
      s.drawEraser[fid] = false;
      renderMainFrame(div, fid);
    })
  );
  div.querySelectorAll('.eraser-btn[data-mfid]').forEach((d) =>
    d.addEventListener('click', () => {
      s.drawEraser[fid] = !s.drawEraser[fid];
      renderMainFrame(div, fid);
    })
  );
  div.querySelectorAll('[data-mact]').forEach((b) =>
    b.addEventListener('click', () => {
      const fn = (window as any).__fh_handleMainAction;
      if (fn) fn((b as HTMLElement).dataset.mact!, fid, div);
    })
  );
  div.querySelectorAll('[data-editlabel]').forEach((el) =>
    el.addEventListener('click', async () => {
      const result = await showLabelEdit(f.label);
      if (result === null) return;
      f.label = result;
      renderAll();
    })
  );
  if (f.drawMode) {
    const cvs = div.querySelector(`#${mcid}`) as HTMLCanvasElement | null;
    if (cvs) {
      restoreMainCanvas(cvs, f);
      if (s.drawActive[fid] === 'main') setupMainDrawing(cvs, fid);
    }
  }
  if (!s.drawActive[fid]) {
    const cw = (div.querySelector('.canvas-wrap') || div.querySelector('.version-body')) as HTMLElement | null;
    if (cw) addCrossSwipe(cw, fid, 'main');
    const nw = div.querySelector('.canvas-wrap') as HTMLElement | null;
    if (nw) addNavArrows(nw, fid, 'main');
  }
  scheduleSyncHeights();
}

export function renderVersionFrame(div: HTMLElement, fid: number): void {
  const s = state();
  const tabs = s.versions[fid],
    ai = s.activeTab[fid] || 0,
    ver = tabs[ai],
    cid = `cvs_${fid}_${ai}`;
  const f = s.frames.find((fr) => fr.id === fid);

  if (f && f.hidden) {
    div.style.background = 'rgba(51,51,51,0.4)';
    div.style.borderColor = 'rgba(255,255,255,0.12)';
    const tabsHTML = tabs
      .map(
        (t: any, i: number) =>
          `<span class="vtab${i === ai ? ' active' : ''}" style="pointer-events:none;opacity:0.4;">${t.label}</span>`
      )
      .join('');
    div.innerHTML = `
      <div class="frame-num ver-frame-num">
        ${f.label ? `<span class="frame-label-tag">${f.label}</span>` : '<span style="color:var(--text-faint);font-style:italic;">hidden</span>'}
        <div class="version-tabs" style="pointer-events:none;">${tabsHTML}</div>
        <button class="btn" data-unhide="${fid}" style="margin-left:auto;font-size:10px;padding:2px 10px;">Un-Hide</button>
      </div>`;
    div.querySelector(`[data-unhide="${fid}"]`)!.addEventListener('click', () => {
      f.hidden = false;
      div.style.background = '';
      div.style.borderColor = '';
      updateFrameBadge();
      renderAll();
    });
    scheduleSyncHeights();
    return;
  }
  div.style.background = '';
  div.style.borderColor = '';
  div.style.opacity = '';
  const _verHidden = ver && ver.hidden;
  const isMainInline = (s.crossCompare[fid] ?? -1) >= 0 && s.currentViewMode === 'ver';

  if (isMainInline && f) {
    const mcid = `vmcvs_${fid}`;
    const colorDotsM = drawToolbarHTML(fid, 'data-mfid', fid);
    let bodyHTML = '';
    const viewMode3 = s.showText[fid];
    if (viewMode3 === 'text') {
      bodyHTML = `<div class="canvas-wrap text-view" style="aspect-ratio:${f.cropW || 16}/${
        f.cropH || 9
      }"><textarea class="frame-text-edit" data-textfid="${fid}" placeholder="No text — click to add">${f.textContent || ''}</textarea></div>`;
    } else if (viewMode3 === 'table') {
      if (!f.tableData) f.tableData = defaultTableData();
      bodyHTML = `<div class="canvas-wrap text-view" style="aspect-ratio:${f.cropW || 16}/${f.cropH || 9}">${tableHTML(
        fid,
        f.tableData
      )}</div>`;
    } else {
      bodyHTML = `<div class="canvas-wrap${
        s.drawActive[fid] === 'main' ? ' draw-active' : ''
      }" style="aspect-ratio:${f.cropW || 16}/${
        f.cropH || 9
      };border:2px solid var(--accent);border-radius:var(--radius-sm);">${
        f.drawMode
          ? `<canvas id="${mcid}" width="${f.cropW || 960}" height="${f.cropH || 540}"></canvas>`
          : `<img src="${f.src}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;">`
      }${fsButtonHTML(fid, 0, 'main')}</div>`;
    }
    const btnLabel3 =
      viewMode3 === 'text'
        ? 'Pic/<span class="ptt-bold">Txt</span>/Tbl'
        : viewMode3 === 'table'
        ? 'Pic/Txt/<span class="ptt-bold">Tbl</span>'
        : '<span class="ptt-bold">Pic</span>/Txt/Tbl';
    div.innerHTML = `
      <div class="frame-num"><span class="frame-label-tag" data-editlabel="${fid}">${f.label || '#'}</span><button class="vtab pictxt-btn${
      viewMode3 ? ' active' : ''
    }" data-mact="pictxt" data-mfid="${fid}">${btnLabel3}</button><div class="reorder-group${
      s.reorderFid === fid ? ' active' : ''
    }${s.verReorderFid !== null ? ' locked' : ''}"><button class="vtab-add" data-mact="moveup" data-mfid="${fid}" title="Move up">▲</button>${
      s.reorderFid === fid
        ? `<span class="reorder-label" data-mact="reorderdone" data-mfid="${fid}">DONE</span>`
        : `<span class="reorder-label" data-mact="reorderstart" data-mfid="${fid}">re-order</span>`
    }<button class="vtab-add" data-mact="movedown" data-mfid="${fid}" title="Move down">▼</button></div></div>
      <div class="version-body">${bodyHTML}</div>
      ${s.drawActive[fid] === 'main' ? `<div class="color-row">${colorDotsM}</div>` : ''}
      <div class="version-actions">
        <button class="act-btn" data-mact="new" data-mfid="${fid}">New</button>
        <button class="act-btn" data-mact="upload" data-mfid="${fid}">Load</button>
        <button class="act-btn${s.drawActive[fid] === 'main' ? ' active' : ''}" data-mact="draw" data-mfid="${fid}">DRAW</button>
        <button class="act-btn" data-mact="camera" data-mfid="${fid}">◎ CAM</button>
        <button class="act-btn" data-mact="write" data-mfid="${fid}">WRITE</button>
        <button class="act-btn" data-mact="copy" data-mfid="${fid}">Copy</button>
        <button class="act-btn" data-mact="paste" data-mfid="${fid}">Paste</button>
        <button class="act-btn" data-mact="delete" data-mfid="${fid}">Hide/Del</button>
        <button class="act-btn${s.prevFrameState[fid] && s.prevFrameState[fid]!.origin === 'main' ? '' : ' disabled'}" data-mact="undo" data-mfid="${fid}" style="margin-left:auto">Undo</button>
      </div>`;
    div.querySelectorAll('.color-dot[data-mfid]').forEach((d) =>
      d.addEventListener('click', () => {
        const c = (d as HTMLElement).dataset.color!;
        s.drawColor[fid] = c;
        s.drawEraser[fid] = false;
        const txt = f.strokes && f.strokes.find((stk: any) => stk.type === 'text');
        if (txt) txt.color = c;
        renderVersionFrame(div, fid);
        const md = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
        if (md) renderMainFrame(md, fid);
      })
    );
    div.querySelectorAll('.thick-btn[data-mfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawWidth[fid] = parseInt((d as HTMLElement).dataset.tw!);
        s.drawEraser[fid] = false;
        renderVersionFrame(div, fid);
      })
    );
    div.querySelectorAll('.eraser-btn[data-mfid]').forEach((d) =>
      d.addEventListener('click', () => {
        s.drawEraser[fid] = !s.drawEraser[fid];
        renderVersionFrame(div, fid);
      })
    );
    div.querySelectorAll('[data-mact]').forEach((b) =>
      b.addEventListener('click', () => {
        const mainDiv = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
        const fn = (window as any).__fh_handleMainAction;
        if (fn) fn((b as HTMLElement).dataset.mact!, fid, mainDiv || div);
        const verDiv = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (verDiv) renderVersionFrame(verDiv, fid);
      })
    );
    div.querySelectorAll('[data-editlabel]').forEach((el) =>
      el.addEventListener('click', async () => {
        const result = await showLabelEdit(f.label);
        if (result === null) return;
        f.label = result;
        renderAll();
      })
    );
    if (f.drawMode) {
      const cvs = div.querySelector(`#${mcid}`) as HTMLCanvasElement | null;
      if (cvs) {
        restoreMainCanvas(cvs, f);
        if (s.drawActive[fid] === 'main') setupMainDrawing(cvs, fid);
      }
    }
    if (!s.drawActive[fid]) {
      const cw = (div.querySelector('.canvas-wrap') || div.querySelector('.version-body')) as HTMLElement | null;
      if (cw) addCrossSwipe(cw, fid, 'ver');
      const nw = div.querySelector('.canvas-wrap') as HTMLElement | null;
      if (nw) addNavArrows(nw, fid, 'ver');
    }
    scheduleSyncHeights();
    return;
  }

  const isVReorder = s.verReorderFid === fid;
  const tabsHTML =
    tabs
      .map(
        (t: any, i: number) =>
          `<button class="vtab ${
            i === ai
              ? 'active' + (isVReorder ? ' reorder-highlight' : '') + (s.swipeHighlightFid === fid ? ' swipe-highlight' : '')
              : ''
          }" data-fid="${fid}" data-idx="${i}"${
            (i === ai && s.verSlideDir ? ` style="--slide-dir:${s.verSlideDir}"` : '') +
            (!s.verSlideDir && t.hidden ? ` style="opacity:0.3"` : '')
          }>${t.label}</button>`
      )
      .join('') + `<button class="vtab-add" data-vadd="${fid}">+</button>`;
  const reorderHTML =
    tabs.length > 1
      ? `<div class="reorder-group${isVReorder ? ' active' : ''}${
          s.reorderFid !== null ? ' locked' : ''
        }"><button class="vtab-add" data-vmove="left" data-fid="${fid}" title="Move left">◀</button>${
          isVReorder
            ? `<span class="reorder-label" data-vreorderdone="${fid}">DONE</span>`
            : `<span class="reorder-label" data-vreorderstart="${fid}">move</span>`
        }<button class="vtab-add" data-vmove="right" data-fid="${fid}" title="Move right">▶</button></div>`
      : '';
  const colorDots = drawToolbarHTML(fid, 'data-fid', fid);
  const canvasBorder = isVReorder
    ? 'border:2px solid #e53935;border-radius:var(--radius-sm);'
    : (s.crossCompare[fid] ?? -1) >= 0 && s.currentViewMode === 'ver'
    ? 'border:2px solid var(--accent);border-radius:var(--radius-sm);'
    : '';
  div.innerHTML = `
    <div class="frame-num ver-frame-num">${
      f && f.label ? `<span class="frame-label-tag">${f.label} version</span>` : '<span></span>'
    }<div class="version-tabs${
    s.reorderFid === fid ? ' locked-dim' : s.verReorderFid === fid ? ' locked' : ''
  }">${tabsHTML}</div>${
      _verHidden ? `<button class="btn" data-vunhide="${fid}" style="margin-left:auto;font-size:10px;padding:2px 10px;">Un-Hide</button>` : reorderHTML
    }</div>
    <div style="${_verHidden ? 'opacity:0.3;' : ''}">
      <div class="ver-canvas-area"><div class="canvas-wrap${
        !_verHidden && s.drawActive[fid] === 'ver' ? ' draw-active' : ''
      }" data-fid="${fid}" style="aspect-ratio:${f ? f.cropW : 16}/${f ? f.cropH : 9};${canvasBorder}"><canvas id="${cid}" width="${
    f ? f.cropW : 960
  }" height="${f ? f.cropH : 540}"${_verHidden ? ' style="pointer-events:none;"' : ''}></canvas>${
      !_verHidden && ver.type === 'empty' && (s.crossCompare[fid] ?? -1) < 0 ? '<div class="canvas-hint"><span>choose an action below</span></div>' : ''
    }${!_verHidden ? starHTML(fid, ai) : ''}${!_verHidden ? fsButtonHTML(fid, ai, 'ver') : ''}</div></div>
      ${
        !_verHidden && s.drawActive[fid] === 'ver'
          ? `<div class="color-row">${colorDots}</div>`
          : !_verHidden && s.drawActive[fid]
          ? `<div class="color-row" style="visibility:hidden">${colorDots}</div>`
          : ''
      }
      <div class="version-actions"${_verHidden ? ' style="pointer-events:none;opacity:0.3;"' : ''}>
        <button class="act-btn${_verHidden ? ' disabled' : ''}" ${_verHidden ? '' : 'data-action="upload" data-fid="' + fid + '"'}>Load</button>
        <button class="act-btn${_verHidden ? ' disabled' : !_verHidden && s.drawActive[fid] === 'ver' ? ' active' : ''}" ${_verHidden ? '' : 'data-action="draw" data-fid="' + fid + '"'}>DRAW</button>
        <button class="act-btn${_verHidden ? ' disabled' : ''}" ${_verHidden ? '' : 'data-action="camera" data-fid="' + fid + '"'}>◎ CAM</button>
        <button class="act-btn${_verHidden ? ' disabled' : ''}" ${_verHidden ? '' : 'data-action="text" data-fid="' + fid + '"'}>WRITE</button>
        <button class="act-btn${_verHidden ? ' disabled' : ''}" ${_verHidden ? '' : 'data-action="copy" data-fid="' + fid + '"'}>Copy</button>
        <button class="act-btn${_verHidden ? ' disabled' : ''}" ${_verHidden ? '' : 'data-action="paste" data-fid="' + fid + '"'}>Paste</button>
        <button class="act-btn${_verHidden ? ' disabled' : ''}" ${_verHidden ? '' : 'data-action="clear" data-fid="' + fid + '"'}>Hide/Del</button>
        <button class="act-btn${_verHidden ? ' disabled' : s.prevFrameState[fid] && s.prevFrameState[fid]!.origin === 'ver' ? '' : ' disabled'}" ${_verHidden ? '' : 'data-action="undo" data-fid="' + fid + '"'} style="margin-left:auto">Undo</button>
      </div>
    </div>`;
  div.querySelectorAll('.vtab[data-fid]').forEach((t) =>
    t.addEventListener('click', () => {
      if (s.reorderFid === fid || s.verReorderFid === fid) return;
      useStore.setState({ swipeHighlightFid: null });
      clearAllDrawActive();
      s.activeTab[fid] = parseInt((t as HTMLElement).dataset.idx!);
      renderVersionFrame(div, fid);
    })
  );
  div.querySelector('[data-vadd]')!.addEventListener('click', () => {
    if (s.reorderFid === fid || s.verReorderFid === fid) return;
    useStore.setState({ swipeHighlightFid: null });
    clearAllDrawActive();
    const n = s.versions[fid].length + 1;
    addNewVersion(fid, { id: n, label: `v${n}`, type: 'empty', strokes: [], bgImage: null });
    renderVersionFrame(div, fid);
  });
  const vUnhideBtn = div.querySelector(`[data-vunhide="${fid}"]`) as HTMLElement | null;
  if (vUnhideBtn)
    vUnhideBtn.addEventListener('click', () => {
      unhideVersion(ver, fid);
      renderVersionFrame(div, fid);
      if (s.currentViewMode === 'overview') {
        const row = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
        const fn = (window as any).__fh_renderOverviewRow;
        if (row && fn) fn(row, fid);
      }
    });
  const startBtn = div.querySelector('[data-vreorderstart]') as HTMLElement | null;
  if (startBtn)
    startBtn.addEventListener('click', () => {
      for (const k in s.drawActive) s.drawActive[+k] = null;
      useStore.setState({ reorderFid: null, swipeHighlightFid: null });
      document.querySelectorAll('.frame-card.reorder-active').forEach((c) => c.classList.remove('reorder-active'));
      useStore.setState({ verReorderFid: fid });
      renderVersionFrame(div, fid);
      document.querySelectorAll('.frame-card[data-mfid]').forEach((c) =>
        renderMainFrame(c as HTMLElement, parseInt((c as HTMLElement).dataset.mfid!))
      );
    });
  const doneBtn = div.querySelector('[data-vreorderdone]') as HTMLElement | null;
  if (doneBtn)
    doneBtn.addEventListener('click', () => {
      useStore.setState({ verReorderFid: null });
      renderVersionFrame(div, fid);
      document.querySelectorAll('.frame-card[data-mfid]').forEach((c) =>
        renderMainFrame(c as HTMLElement, parseInt((c as HTMLElement).dataset.mfid!))
      );
    });
  div.querySelectorAll('[data-vmove]').forEach((b) =>
    b.addEventListener('click', () => {
      for (const k in s.drawActive) s.drawActive[+k] = null;
      useStore.setState({ reorderFid: null, swipeHighlightFid: null });
      document.querySelectorAll('.frame-card.reorder-active').forEach((c) => c.classList.remove('reorder-active'));
      const dir = (b as HTMLElement).dataset.vmove!;
      const tabs2 = s.versions[fid];
      const ai2 = s.activeTab[fid];
      if (dir === 'left' && ai2 > 0) {
        [tabs2[ai2 - 1], tabs2[ai2]] = [tabs2[ai2], tabs2[ai2 - 1]];
        s.activeTab[fid] = ai2 - 1;
      } else if (dir === 'right' && ai2 < tabs2.length - 1) {
        [tabs2[ai2], tabs2[ai2 + 1]] = [tabs2[ai2 + 1], tabs2[ai2]];
        s.activeTab[fid] = ai2 + 1;
      }
      relabelVersions(fid);
      useStore.setState({ verReorderFid: fid, verSlideDir: dir === 'left' ? '20px' : '-20px' });
      renderVersionFrame(div, fid);
      useStore.setState({ verSlideDir: null });
      document.querySelectorAll('.frame-card[data-mfid]').forEach((c) =>
        renderMainFrame(c as HTMLElement, parseInt((c as HTMLElement).dataset.mfid!))
      );
    })
  );
  div.querySelectorAll('.color-dot').forEach((d) =>
    d.addEventListener('click', () => {
      const c = (d as HTMLElement).dataset.color!;
      s.drawColor[fid] = c;
      s.drawEraser[fid] = false;
      const txt = ver.strokes && ver.strokes.find((stk: any) => stk.type === 'text');
      if (txt) txt.color = c;
      renderVersionFrame(div, fid);
    })
  );
  div.querySelectorAll('.thick-btn').forEach((d) =>
    d.addEventListener('click', () => {
      s.drawWidth[fid] = parseInt((d as HTMLElement).dataset.tw!);
      s.drawEraser[fid] = false;
      renderVersionFrame(div, fid);
    })
  );
  div.querySelectorAll('.eraser-btn').forEach((d) =>
    d.addEventListener('click', () => {
      s.drawEraser[fid] = !s.drawEraser[fid];
      renderVersionFrame(div, fid);
    })
  );
  div.querySelectorAll('.act-btn').forEach((b) =>
    b.addEventListener('click', () => {
      const fn = (window as any).__fh_handleAction;
      if (fn) fn((b as HTMLElement).dataset.action!, fid, div);
    })
  );
  const cvs = div.querySelector(`#${cid}`) as HTMLCanvasElement | null;
  if (cvs) {
    if ((s.crossCompare[fid] ?? -1) >= 0 && s.currentViewMode === 'ver') {
      restoreMainCanvas(cvs, f!);
    } else {
      restoreCanvas(cvs, ver);
      if (ver.type !== 'empty' && s.drawActive[fid] === 'ver') setupDrawing(cvs, fid, ai);
    }
  }
  const swipeEl = (div.querySelector('.ver-canvas-area') || div.querySelector('.canvas-wrap[data-fid]')) as HTMLElement | null;
  if (swipeEl && !s.drawActive[fid]) {
    let sx = 0,
      sy = 0;
    swipeEl.addEventListener(
      'touchstart',
      (e) => {
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
      },
      { passive: true }
    );
    swipeEl.addEventListener(
      'touchend',
      (e) => {
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
        if (s.reorderFid !== null) return;
        const tabs2 = s.versions[fid],
          ai2 = s.activeTab[fid];
        if (s.verReorderFid === fid) {
          if (dx < 0 && ai2 > 0) {
            [tabs2[ai2 - 1], tabs2[ai2]] = [tabs2[ai2], tabs2[ai2 - 1]];
            s.activeTab[fid] = ai2 - 1;
            relabelVersions(fid);
            useStore.setState({ verSlideDir: '-20px' });
            renderVersionFrame(div, fid);
            useStore.setState({ verSlideDir: null });
          } else if (dx > 0 && ai2 < tabs2.length - 1) {
            [tabs2[ai2], tabs2[ai2 + 1]] = [tabs2[ai2 + 1], tabs2[ai2]];
            s.activeTab[fid] = ai2 + 1;
            relabelVersions(fid);
            useStore.setState({ verSlideDir: '20px' });
            renderVersionFrame(div, fid);
            useStore.setState({ verSlideDir: null });
          }
          return;
        }
        if (dx < 0 && ai2 < tabs2.length - 1) {
          clearReorder();
          clearAllDrawActive();
          s.activeTab[fid] = ai2 + 1;
          useStore.setState({ verSlideDir: '20px', swipeHighlightFid: fid });
          renderVersionFrame(div, fid);
          useStore.setState({ verSlideDir: null });
        } else if (dx > 0 && ai2 > 0) {
          clearReorder();
          clearAllDrawActive();
          s.activeTab[fid] = ai2 - 1;
          useStore.setState({ verSlideDir: '-20px', swipeHighlightFid: fid });
          renderVersionFrame(div, fid);
          useStore.setState({ verSlideDir: null });
        } else if (dx > 0 && ai2 === 0 && s.currentViewMode === 'ver' && (s.crossCompare[fid] ?? -1) < 0) {
          s.crossCompare[fid] = 0;
          renderVersionFrame(div, fid);
        } else if (dx < 0 && (s.crossCompare[fid] ?? -1) >= 0 && s.currentViewMode === 'ver') {
          s.crossCompare[fid] = -1;
          renderVersionFrame(div, fid);
        }
      },
      { passive: true }
    );
  }
  if (!s.drawActive[fid]) {
    const nw = div.querySelector('.canvas-wrap') as HTMLElement | null;
    if (nw) addNavArrows(nw, fid, 'ver');
  }
  scheduleSyncHeights();
}
