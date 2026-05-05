// Action handlers for Main strip and Version strip cards.

import { COLORS, state, useStore } from '../store/state';
import {
  addNewVersion,
  applyReorderHighlight,
  autoNewVersionIfNeeded,
  clearAllDrawActive,
  clearReorder,
  isMainEmpty,
  ovCollapseExpanded,
  relabelVersions,
  restoreFrame,
  saveOpenTableEdits,
  saveOpenTextEdits,
  updateFrameBadge,
} from './helpers';
import { snapshotFrame } from './drawing';
import { renderAll, renderMainFrame, renderVersionFrame } from './render';
import { renderOverviewRow } from './overview';
import { showConfirm, showDeleteChoice, showToast, showVersionChoice, openTextModal } from './modals';
import { drawFit } from './drawing';
import { openCamera, getCameraTarget, clearCameraTarget, setOnCapturedImage } from './camera';

export function handleMainAction(action: string, fid: number, div: HTMLElement): void {
  const s = state();
  const f = s.frames.find((fr) => fr.id === fid);
  if (!f) return;
  const idx = s.frames.indexOf(f);

  if (action === 'reorderstart') {
    for (const k in s.drawActive) s.drawActive[+k] = null;
    useStore.setState({ verReorderFid: null, swipeHighlightFid: null, reorderFid: fid });
    renderMainFrame(div, fid);
    document.querySelectorAll('.frame-card[data-vfid]').forEach((c) =>
      renderVersionFrame(c as HTMLElement, parseInt((c as HTMLElement).dataset.vfid!))
    );
    applyReorderHighlight(fid);
    return;
  }
  if (action === 'reorderdone') {
    clearReorder();
    return;
  }
  if (action === 'moveup' || action === 'movedown') {
    if (s.reorderFid !== fid) {
      clearAllDrawActive();
      clearReorder();
      useStore.setState({ reorderFid: fid });
      renderMainFrame(div, fid);
      applyReorderHighlight(fid);
      return;
    }
    if (action === 'moveup' && idx <= 0) return;
    if (action === 'movedown' && idx >= s.frames.length - 1) return;
    if (action === 'moveup') [s.frames[idx - 1], s.frames[idx]] = [s.frames[idx], s.frames[idx - 1]];
    else [s.frames[idx], s.frames[idx + 1]] = [s.frames[idx + 1], s.frames[idx]];
    renderAll();
    useStore.setState({ reorderFid: fid });
    applyReorderHighlight(fid);
    const mc = document.querySelector(`.frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
    if (mc) mc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  if (action === 'undo') {
    restoreFrame(fid);
    const md = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
    if (md) renderMainFrame(md, fid);
    const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
    if (vd) renderVersionFrame(vd, fid);
    return;
  }
  if (action === 'pictxt') {
    saveOpenTextEdits();
    saveOpenTableEdits();
    for (const oid of Object.keys(s.showText)) {
      if (+oid !== fid && s.showText[+oid]) {
        s.showText[+oid] = null;
        const od = document.querySelector(`#mainScroll .frame-card[data-mfid="${oid}"]`) as HTMLElement | null;
        if (od) renderMainFrame(od, +oid);
      }
    }
    const cur = s.showText[fid];
    if (!cur) s.showText[fid] = 'text';
    else if (cur === 'text') s.showText[fid] = 'table';
    else s.showText[fid] = null;
    renderMainFrame(div, fid);
    return;
  }

  saveOpenTextEdits();
  saveOpenTableEdits();
  s.showText[fid] = null;
  clearReorder();
  const wasDrawing = s.drawActive[fid] === 'main';
  clearAllDrawActive();

  if (action === 'new') {
    const nid = s.nextId;
    useStore.setState({ nextId: nid + 1 });
    const newFrame = {
      id: nid,
      src: '',
      label: '',
      cropW: f.cropW || 960,
      cropH: f.cropH || 540,
      strokes: [],
      drawMode: true,
      textContent: '',
      tableData: null,
    };
    s.frames.splice(idx + 1, 0, newFrame);
    s.versions[nid] = [{ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null }];
    s.activeTab[nid] = 0;
    s.drawColor[nid] = COLORS[0];
    s.drawWidth[nid] = 6;
    s.drawEraser[nid] = false;
    updateFrameBadge();
    renderAll();
  } else if (action === 'duplicate') {
    const nid = s.nextId;
    useStore.setState({ nextId: nid + 1 });
    const newFrame = {
      id: nid,
      src: f.src,
      label: f.label ? f.label + ' copy' : '',
      cropW: f.cropW,
      cropH: f.cropH,
      strokes: JSON.parse(JSON.stringify(f.strokes || [])),
      drawMode: false,
      textContent: f.textContent || '',
      tableData: f.tableData ? JSON.parse(JSON.stringify(f.tableData)) : null,
    };
    s.frames.splice(idx + 1, 0, newFrame);
    s.versions[nid] = [{ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null }];
    s.activeTab[nid] = 0;
    s.drawColor[nid] = COLORS[0];
    s.drawWidth[nid] = 6;
    s.drawEraser[nid] = false;
    updateFrameBadge();
    renderAll();
  } else if (action === 'draw') {
    if (!wasDrawing) s.drawActive[fid] = 'main';
    f.drawMode = true;
    renderMainFrame(div, fid);
    const vdiv = document.querySelector(`.frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
    if (vdiv) renderVersionFrame(vdiv, fid);
  } else if (action === 'write') {
    f.strokes = f.strokes || [];
    const existing = f.strokes.find((st: any) => st.type === 'text');
    const curColor = existing ? existing.color : s.drawColor[fid] || '#fff';
    openTextModal(existing ? existing.text || '' : '', curColor || '#fff').then((result) => {
      if (result !== null) {
        snapshotFrame(fid, 'main');
        const { text, color } = result;
        s.drawColor[fid] = color;
        if (existing) {
          if (text) {
            existing.text = text;
            existing.color = color;
          } else {
            f.strokes = f.strokes.filter((stk: any) => stk !== existing);
          }
        } else if (text) {
          f.strokes.push({ type: 'text', text, color, x: 20, y: 50 });
        }
        if ((f.strokes || []).length > 0) f.drawMode = true;
      }
      renderMainFrame(div, fid);
      const vdiv2 = document.querySelector(`.frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      if (vdiv2) renderVersionFrame(vdiv2, fid);
    });
  } else if (action === 'upload') {
    if (s.currentViewMode === 'overview') {
      if (!isMainEmpty(f)) {
        showConfirm('Are you sure you want to override the content inside the Main Frame?').then((ok) => {
          if (!ok) return;
          useStore.setState({ mainImgTarget: { fid, div, toVersion: false, fromOverview: true } });
          (document.getElementById('mainImgInput') as HTMLInputElement).click();
        });
        return;
      }
      useStore.setState({ mainImgTarget: { fid, div, toVersion: false, fromOverview: true } });
    } else {
      useStore.setState({ mainImgTarget: { fid, div, toVersion: !isMainEmpty(f) } });
    }
    (document.getElementById('mainImgInput') as HTMLInputElement).click();
  } else if (action === 'copy') {
    useStore.setState({
      stripClipboard: {
        bgImage: f.src || null,
        strokes: JSON.parse(JSON.stringify(f.strokes || [])),
        cropW: f.cropW,
        cropH: f.cropH,
      },
    });
    showToast('Copied');
  } else if (action === 'paste') {
    if (!s.stripClipboard) {
      showToast('Nothing to paste');
      return;
    }
    const doPaste = () => {
      snapshotFrame(fid, 'main');
      f.src = s.stripClipboard!.bgImage || '';
      f.strokes = JSON.parse(JSON.stringify(s.stripClipboard!.strokes || []));
      f.drawMode = f.strokes.length > 0;
      renderMainFrame(div, fid);
      const vdiv = document.querySelector(`.frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      if (vdiv) renderVersionFrame(vdiv, fid);
      if (s.currentViewMode === 'overview') {
        const ovRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
        if (ovRow) renderOverviewRow(ovRow, fid);
      }
      showToast('Pasted');
    };
    if (f.src || (f.strokes && f.strokes.length > 0)) {
      showConfirm('Are you sure you want to override the original frame?').then((ok) => {
        if (ok) doPaste();
      });
      return;
    }
    doPaste();
  } else if (action === 'camera') {
    openCamera(fid, div, false, true);
  } else if (action === 'delete') {
    showDeleteChoice().then((choice) => {
      if (!choice) return;
      if (choice === 'hide') {
        f.hidden = true;
        updateFrameBadge();
        renderAll();
      } else {
        s.frames.splice(idx, 1);
        delete s.versions[fid];
        delete s.activeTab[fid];
        delete s.drawColor[fid];
        updateFrameBadge();
        renderAll();
      }
    });
    return;
  }
}

export function handleAction(action: string, fid: number, div: HTMLElement, fromCompare?: boolean): void {
  const s = state();
  const ai = s.activeTab[fid],
    ver = s.versions[fid][ai];

  function rerender() {
    if (fromCompare) {
      renderMainFrame(div, fid);
      const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      if (vd) renderVersionFrame(vd, fid);
    } else {
      renderVersionFrame(div, fid);
      const md = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
      if (md) renderMainFrame(md, fid);
    }
  }

  if (action === 'undo') {
    restoreFrame(fid);
    rerender();
    return;
  }
  if (s.showText[fid]) {
    saveOpenTextEdits();
    saveOpenTableEdits();
    s.showText[fid] = null;
    const mdiv = document.querySelector(`.frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
    if (mdiv) renderMainFrame(mdiv, fid);
  }
  clearReorder();
  const wasDrawing = s.drawActive[fid] === 'ver';
  clearAllDrawActive();

  if (action === 'draw') {
    if (!wasDrawing) s.drawActive[fid] = 'ver';
    else if (s.overviewAction) s.drawEraser[fid] = false;
    ver.type = 'drawing';
    rerender();
  } else if (action === 'upload') {
    useStore.setState({ imgTarget: { fid, div, fromCompare } });
    (document.getElementById('imgInput') as HTMLInputElement).removeAttribute('capture');
    (document.getElementById('imgInput') as HTMLInputElement).click();
  } else if (action === 'camera') {
    openCamera(fid, div, !!fromCompare, false);
  } else if (action === 'text') {
    ver.strokes = ver.strokes || [];
    const existing = ver.strokes.find((st: any) => st.type === 'text');
    const curColor = existing ? existing.color : s.drawColor[fid] || '#fff';
    const wasOverview = s.overviewAction;
    openTextModal(existing ? existing.text || '' : '', curColor || '#fff').then((result) => {
      if (result !== null) {
        snapshotFrame(fid, 'ver');
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
      }
      rerender();
      if (wasOverview) {
        const ovRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
        if (ovRow) renderOverviewRow(ovRow, fid);
        useStore.setState({ overviewAction: false });
      }
    });
  } else if (action === 'copy') {
    const f = state().frames.find((fr) => fr.id === fid) || ({ cropW: undefined, cropH: undefined } as any);
    useStore.setState({
      stripClipboard: {
        bgImage: ver.bgImage || null,
        strokes: JSON.parse(JSON.stringify(ver.strokes || [])),
        cropW: f.cropW,
        cropH: f.cropH,
      },
    });
    showToast('Copied');
  } else if (action === 'paste') {
    if (!s.stripClipboard) {
      showToast('Nothing to paste');
      return;
    }
    snapshotFrame(fid, 'ver');
    if (s.overviewAction) {
      ver.type = s.stripClipboard.bgImage ? 'upload' : 'drawing';
      ver.strokes = JSON.parse(JSON.stringify(s.stripClipboard.strokes || []));
      ver.bgImage = s.stripClipboard.bgImage || null;
      rerender();
      showToast('Pasted into active version');
    } else {
      const n = s.versions[fid].length + 1;
      const newVer = {
        id: n,
        label: `v${n}`,
        type: (s.stripClipboard.bgImage ? 'upload' : 'drawing') as 'upload' | 'drawing',
        strokes: JSON.parse(JSON.stringify(s.stripClipboard.strokes || [])),
        bgImage: s.stripClipboard.bgImage || null,
      };
      addNewVersion(fid, newVer);
      if (fromCompare) s.crossCompare[fid] = s.activeTab[fid];
      rerender();
      showToast('Pasted as new version');
    }
  } else if (action === 'clear') {
    showVersionChoice().then((choice) => {
      if (!choice) return;
      if (choice === 'hide') {
        ver.hidden = true;
        if (s.ovExpandedFid === fid) useStore.setState({ ovExpandedFid: null });
        if (s.drawActive[fid]) {
          s.drawActive[fid] = null;
          s.drawEraser[fid] = false;
        }
        const vers = s.versions[fid];
        const curIdx = vers.indexOf(ver);
        if (curIdx >= 0) {
          vers.splice(curIdx, 1);
          let lastVisible = -1;
          for (let i = vers.length - 1; i >= 0; i--) {
            if (!vers[i].hidden) {
              lastVisible = i;
              break;
            }
          }
          vers.splice(lastVisible + 1, 0, ver);
          const visibleIdx = vers.findIndex((v) => !v.hidden);
          s.activeTab[fid] = visibleIdx >= 0 ? visibleIdx : 0;
        }
        relabelVersions(fid);
        rerender();
        if (s.currentViewMode === 'overview') {
          const row = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
          if (row) renderOverviewRow(row, fid);
        }
      } else {
        snapshotFrame(fid, 'ver');
        const vers = s.versions[fid];
        const curIdx = vers.indexOf(ver);
        if (curIdx >= 0) vers.splice(curIdx, 1);
        if (vers.length === 0) vers.push({ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null });
        s.activeTab[fid] = Math.min(s.activeTab[fid], vers.length - 1);
        rerender();
      }
    });
    return;
  }
}

export function applyCapturedImage(dataURL: string, target: any): void {
  const s = state();
  const { fid, div, fromCompare, fromMain } = target;
  snapshotFrame(fid, fromMain ? 'main' : 'ver');
  if (fromMain) {
    const f = s.frames.find((fr) => fr.id === fid);
    if (f && isMainEmpty(f)) {
      f.src = dataURL;
      f.drawMode = false;
      const md = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
      if (md) renderMainFrame(md, fid);
    } else {
      const t = autoNewVersionIfNeeded(fid);
      t.type = 'upload';
      t.bgImage = dataURL;
      if (s.currentViewMode === 'main') s.crossCompare[fid] = s.activeTab[fid];
      const md = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
      if (md) renderMainFrame(md, fid);
      const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      if (vd) renderVersionFrame(vd, fid);
    }
  } else if (fromCompare) {
    const t = autoNewVersionIfNeeded(fid);
    t.type = 'upload';
    t.bgImage = dataURL;
    s.crossCompare[fid] = s.activeTab[fid];
    renderMainFrame(div, fid);
    const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
    if (vd) renderVersionFrame(vd, fid);
  } else {
    const t = autoNewVersionIfNeeded(fid);
    t.type = 'upload';
    t.bgImage = dataURL;
    renderVersionFrame(div, fid);
    const nai = s.activeTab[fid];
    const vcvs = div.querySelector(`#cvs_${fid}_${nai}`) as HTMLCanvasElement | null;
    if (vcvs) drawFit(vcvs, dataURL);
  }
  showToast('Photo captured');
  useStore.setState({ centerFid: String(fid) });
  if (s.currentViewMode === 'overview') {
    const ovRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
    if (ovRow) renderOverviewRow(ovRow, fid);
  }
  useStore.setState({ overviewAction: false });
  clearCameraTarget();
}

// Wire up the camera capture pipeline → applyCapturedImage
setOnCapturedImage(applyCapturedImage);
