// Action handlers for Main strip and Version/Floor/Refs strip cards.

import { COLORS, state, useStore, bumpRenderTick } from '../store/state';
import type { StripType } from '../store/state';
import { reorderFrameInGroup, addFrameToActiveGroup, removeFrameFromGroup, hideFrameInGroup } from './groups';
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
  scrollFrameIntoView,
  updateFrameBadge,
  getStripVersions,
  setStripVersions,
  getStripActiveTab,
  setStripActiveTab,
  getStripCrossCompare,
  setStripCrossCompare,
  relabelStripVersions,
  addNewStripVersion,
  autoNewStripVersionIfNeeded,
  stripScrollId,
} from './helpers';
import { snapshotFrame } from './drawing';
import { renderAll, renderMainFrame, renderVersionFrame } from './render';
import { renderOverviewRow, renderGrid4Row, renderGrid3x2Card } from './overview';
import { showConfirm, showDeleteChoice, showGroupDeleteChoice, showToast, showVersionChoice, openTextModal } from './modals';
import { fhTrack } from './tracking';
import { drawFit } from './drawing';
import { openCamera, getCameraTarget, clearCameraTarget, setOnCapturedImage } from './camera';
import { recordTombstone } from './accountFlow';
import { openFullscreen } from './fullscreen';
import { flushSyncNow } from './currentProject';

export function handleMainAction(action: string, fid: number, div: HTMLElement): void {
  const s = state();
  if (s.setupMode) return; // locked while setup bar is open
  const f = s.frames.find((fr) => fr.id === fid);
  if (!f) return;
  const idx = s.frames.indexOf(f);

  if (action === 'reorderstart') {
    for (const k in s.drawActive) s.drawActive[+k] = null;
    useStore.setState({ verReorderFid: null, verReorderStrip: null, swipeHighlightFid: null, reorderFid: fid });
    renderMainFrame(div, fid);
    document.querySelectorAll('.frame-card[data-vfid]').forEach((c) => {
      const el = c as HTMLElement;
      renderVersionFrame(el, parseInt(el.dataset.vfid!), (el.dataset.strip || 'ver') as StripType);
    });
    applyReorderHighlight(fid);
    return;
  }
  if (action === 'reorderdone') {
    clearReorder();
    void flushSyncNow(); // ORD-4 / GRP-7: exit reorder mode → DONE
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
    // If a group is active, reorder within the group's frameIds array
    if (s.activeGroupId !== null) {
      const dir = action === 'moveup' ? 'up' : 'down';
      if (!reorderFrameInGroup(fid, dir)) return;
      renderAll();
    } else {
      if (action === 'moveup' && idx <= 0) return;
      if (action === 'movedown' && idx >= s.frames.length - 1) return;
      if (action === 'moveup') [s.frames[idx - 1], s.frames[idx]] = [s.frames[idx], s.frames[idx - 1]];
      else [s.frames[idx], s.frames[idx + 1]] = [s.frames[idx + 1], s.frames[idx]];
      renderAll();
    }
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
    void flushSyncNow(); // FRM-10: undo on main
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
    void flushSyncNow(); // FRM-11: toggle Pic/Text/Table
    return;
  }

  saveOpenTextEdits();
  saveOpenTableEdits();
  s.showText[fid] = null;
  clearReorder();
  const wasDrawing = s.drawActive[fid] === 'main';
  clearAllDrawActive();

  if (action === 'new') {
    // --- Auto-label logic ---
    // Portrait mode: every new frame gets "name"
    if (s.portraitMode) {
      const s2 = state();
      const f2 = s2.frames.find((fr) => fr.id === fid);
      if (!f2) return;
      const idx2 = s2.frames.indexOf(f2);
      const nid = s2.nextId;
      useStore.setState({ nextId: nid + 1 });
      const insideGroup = s.activeGroupId !== null;
      const newFrame: any = {
        id: nid,
        src: '',
        label: 'name',
        cropW: f2.cropW || 540,
        cropH: f2.cropH || 960,
        strokes: [],
        drawMode: true,
        textContent: '',
        tableData: null,
      };
      if (insideGroup) newFrame.hidden = true;
      s2.frames.splice(idx2 + 1, 0, newFrame);
      s2.versions[nid] = [{ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null }];
      s2.activeTab[nid] = 0;
      s2.drawColor[nid] = COLORS[0];
      s2.drawWidth[nid] = 6;
      s2.drawEraser[nid] = false;
      addFrameToActiveGroup(nid, fid);
      updateFrameBadge();
      renderAll();
      void flushSyncNow(); // FRM-1: create new frame (portrait)
      return;
    }
    // --- Auto-label logic ---
    // "3"    → "3#1",   "3#1"  → "3#2",  "3#2" → "3#3"
    // "4a"   → "4a#1",  "4a#1" → "4a#2"
    // Base is the full label; # counter increments.
    const prevLabel = f.label || '';
    let newLabel: string;
    const hashMatch = prevLabel.match(/^(.+)#(\d+)$/);
    if (hashMatch) {
      // Previous is "3#2" → "3#3", or "4a#1" → "4a#2"
      const base = hashMatch[1];
      const counter = parseInt(hashMatch[2], 10);
      newLabel = `${base}#${counter + 1}`;
    } else {
      // Previous is "3" or "4a" or anything → keep full label, add #1
      newLabel = `${prevLabel}#1`;
    }

    {
      const s2 = state();
      const f2 = s2.frames.find((fr) => fr.id === fid);
      if (!f2) return;
      const idx2 = s2.frames.indexOf(f2);
      const nid = s2.nextId;
      const insideGroup = s.activeGroupId !== null;
      useStore.setState({ nextId: nid + 1 });
      const newFrame: any = {
        id: nid,
        src: '',
        label: newLabel,
        cropW: f2.cropW || (s.portraitMode ? 540 : 960),
        cropH: f2.cropH || (s.portraitMode ? 960 : 540),
        strokes: [],
        drawMode: true,
        textContent: '',
        tableData: null,
      };
      // Frames created inside a group are auto-hidden in ALL view
      if (insideGroup) newFrame.hidden = true;
      s2.frames.splice(idx2 + 1, 0, newFrame);
      s2.versions[nid] = [{ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null }];
      s2.activeTab[nid] = 0;
      s2.drawColor[nid] = COLORS[0];
      s2.drawWidth[nid] = 6;
      s2.drawEraser[nid] = false;
      addFrameToActiveGroup(nid, fid);
      updateFrameBadge();
      renderAll();
      void flushSyncNow(); // FRM-1: create new frame
    }
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
    addFrameToActiveGroup(nid, fid);
    updateFrameBadge();
    renderAll();
    void flushSyncNow(); // duplicate frame
  } else if (action === 'draw') {
    fhTrack('draw_used', { strip: 'main' });
    openFullscreen(fid, 0, 'main');
  } else if (action === 'write') {
    fhTrack('write_used', { strip: 'main' });
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
        bumpRenderTick(); // Ensure Zustand subscriber fires → IDB save + dirty flag
      }
      const cs = state();
      if (cs.currentViewMode === 'grid3x2') {
        // div may be detached — find wrap by fid instead
        const cardWrap = document.querySelector(`#overviewScroll .grid3x2-card-wrap[data-g3fid="${fid}"]`) as HTMLElement | null;
        const renderFn = (window as any).__fh_renderGrid3x2Card;
        if (cardWrap && renderFn) renderFn(cardWrap, fid);
        useStore.setState({ overviewAction: false });
      } else {
        renderMainFrame(div, fid);
        const vdiv2 = document.querySelector(`.frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (vdiv2) renderVersionFrame(vdiv2, fid);
        scrollFrameIntoView(fid, 'main');
      }
      void flushSyncNow(); // FRM-15: write text stroke → OK
    });
  } else if (action === 'upload') {
    if (s.currentViewMode === 'overview' || s.currentViewMode === 'grid4' || s.currentViewMode === 'grid3x2') {
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
    // toast removed
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
      if (s.currentViewMode === 'overview' || s.currentViewMode === 'grid4' || s.currentViewMode === 'grid3x2') {
        if (s.currentViewMode === 'grid3x2') {
          const cw = document.querySelector(`#overviewScroll .grid3x2-card-wrap[data-g3fid="${fid}"]`) as HTMLElement | null;
          if (cw) renderGrid3x2Card(cw, fid);
        } else {
          const ovRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
          if (ovRow) { s.currentViewMode === 'grid4' ? renderGrid4Row(ovRow, fid) : renderOverviewRow(ovRow, fid); }
        }
      }
      void flushSyncNow(); // FRM-8: paste to main
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
    if (s.activeGroupId !== null) {
      // Inside a group: confirm, then remove frame from this group (frame stays in ALL)
      const currentGroupId = s.activeGroupId;
      showConfirm('Remove this frame and all its versions from this group?\nYou can still find the frame in group ALL.').then((ok) => {
        if (!ok) return;
        useStore.setState({ scrollHideGuard: Date.now() + 600 });
        removeFrameFromGroup(fid, currentGroupId);
        updateFrameBadge();
        renderAll();
      });
    } else {
      // ALL view: HIDE or permanent DELETE
      showDeleteChoice().then((choice) => {
        if (!choice) return;
        useStore.setState({ scrollHideGuard: Date.now() + 600 });
        if (choice === 'hide') {
          f.hidden = true;
          updateFrameBadge();
          renderAll();
          void flushSyncNow(); // FRM-4: hide frame
        } else {
          // Record tombstones BEFORE removing from state
          recordTombstone('frame', f.serverFrameId);
          // Also tombstone all synced versions across all strips
          for (const stripId of Object.keys(s.stripVersions)) {
            const vers = s.stripVersions[stripId]?.[fid];
            if (!vers) continue;
            for (const v of vers) recordTombstone('version', v.serverVersionId);
          }
          s.frames.splice(idx, 1);
          delete s.versions[fid];
          delete s.activeTab[fid];
          delete s.drawColor[fid];
          updateFrameBadge();
          renderAll();
          void flushSyncNow(); // FRM-3: delete frame (tombstone recorded)
        }
      });
    }
    return;
  }
}

export function handleAction(action: string, fid: number, div: HTMLElement, fromCompare?: boolean, strip: StripType = 'ver'): void {
  const s = state();
  if (s.setupMode) return; // locked while setup bar is open
  const ai = getStripActiveTab(fid, strip);
  const vers = getStripVersions(fid, strip);
  const ver = vers[ai];
  const scrollId = stripScrollId(strip);

  function rerender() {
    if (fromCompare) {
      renderMainFrame(div, fid);
      const vd = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      if (vd) renderVersionFrame(vd, fid, strip);
    } else {
      renderVersionFrame(div, fid, strip);
      const md = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
      if (md) renderMainFrame(md, fid);
    }
  }

  if (action === 'undo') {
    restoreFrame(fid, strip);
    rerender();
    void flushSyncNow(); // VER-13: undo on version
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
  const wasDrawing = s.drawActive[fid] === strip;
  clearAllDrawActive();

  if (action === 'draw') {
    fhTrack('draw_used', { strip });
    openFullscreen(fid, ai, strip);
  } else if (action === 'upload') {
    useStore.setState({ imgTarget: { fid, div, fromCompare, stripType: strip } });
    (document.getElementById('imgInput') as HTMLInputElement).removeAttribute('capture');
    (document.getElementById('imgInput') as HTMLInputElement).click();
  } else if (action === 'camera') {
    openCamera(fid, div, !!fromCompare, false, strip);
  } else if (action === 'text') {
    fhTrack('write_used', { strip });
    ver.strokes = ver.strokes || [];
    const existing = ver.strokes.find((st: any) => st.type === 'text');
    const curColor = existing ? existing.color : s.drawColor[fid] || '#fff';
    const wasOverview = s.overviewAction;
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
        bumpRenderTick(); // Ensure Zustand subscriber fires → IDB save + dirty flag
      }
      rerender();
      if (wasOverview) {
        if (s.currentViewMode === 'grid3x2') {
          const cw = document.querySelector(`#overviewScroll .grid3x2-card-wrap[data-g3fid="${fid}"]`) as HTMLElement | null;
          if (cw) renderGrid3x2Card(cw, fid);
        } else {
          const ovRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
          if (ovRow) { s.currentViewMode === 'grid4' ? renderGrid4Row(ovRow, fid) : renderOverviewRow(ovRow, fid); }
        }
        useStore.setState({ overviewAction: false });
      } else {
        scrollFrameIntoView(fid, strip);
      }
      void flushSyncNow(); // VER-6: write text on version → OK
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
  } else if (action === 'paste') {
    if (!s.stripClipboard) {
      showToast('Nothing to paste');
      return;
    }
    snapshotFrame(fid, strip);
    if (s.overviewAction) {
      ver.type = s.stripClipboard.bgImage ? 'upload' : 'drawing';
      ver.strokes = JSON.parse(JSON.stringify(s.stripClipboard.strokes || []));
      ver.bgImage = s.stripClipboard.bgImage || null;
      ver.r2Key = undefined; // Clear so sync uploads the pasted image
      rerender();
    } else {
      // If the current version is empty, paste INTO it instead of creating a new one
      if (ver && ver.type === 'empty') {
        ver.type = s.stripClipboard.bgImage ? 'upload' : 'drawing';
        ver.strokes = JSON.parse(JSON.stringify(s.stripClipboard.strokes || []));
        ver.bgImage = s.stripClipboard.bgImage || null;
        ver.r2Key = undefined; // Clear so sync uploads the pasted image
      } else {
        const allVers = getStripVersions(fid, strip);
        const n = allVers.length + 1;
        const newVer = {
          id: n,
          label: `v${n}`,
          type: (s.stripClipboard.bgImage ? 'upload' : 'drawing') as 'upload' | 'drawing',
          strokes: JSON.parse(JSON.stringify(s.stripClipboard.strokes || [])),
          bgImage: s.stripClipboard.bgImage || null,
        };
        addNewStripVersion(fid, strip, newVer);
      }
      if (fromCompare) setStripCrossCompare(fid, strip, getStripActiveTab(fid, strip));
      rerender();
    }
    void flushSyncNow(); // VER-8: paste to version
  } else if (action === 'clear') {
    showVersionChoice().then((choice) => {
      if (!choice) return;
      useStore.setState({ scrollHideGuard: Date.now() + 600 });
      if (choice === 'hide') {
        ver.hidden = true;
        if (s.ovExpandedFid === fid) useStore.setState({ ovExpandedFid: null });
        if (s.drawActive[fid]) {
          s.drawActive[fid] = null;
          s.drawEraser[fid] = false;
        }
        const allVers = getStripVersions(fid, strip);
        const curIdx = allVers.indexOf(ver);
        if (curIdx >= 0) {
          allVers.splice(curIdx, 1);
          let lastVisible = -1;
          for (let i = allVers.length - 1; i >= 0; i--) {
            if (!allVers[i].hidden) {
              lastVisible = i;
              break;
            }
          }
          allVers.splice(lastVisible + 1, 0, ver);
          const visibleIdx = allVers.findIndex((v) => !v.hidden);
          setStripActiveTab(fid, strip, visibleIdx >= 0 ? visibleIdx : 0);
        }
        relabelStripVersions(fid, strip);
        rerender();
        if (s.currentViewMode === 'overview' || s.currentViewMode === 'grid4' || s.currentViewMode === 'grid3x2') {
          const row = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
          if (row) { s.currentViewMode === 'grid4' ? renderGrid4Row(row, fid) : renderOverviewRow(row, fid); }
        }
        void flushSyncNow(); // VER-9: hide version
      } else {
        // Record tombstone BEFORE removing from state
        recordTombstone('version', ver.serverVersionId);
        snapshotFrame(fid, strip);
        const allVers = getStripVersions(fid, strip);
        const curIdx = allVers.indexOf(ver);
        if (curIdx >= 0) allVers.splice(curIdx, 1);
        if (allVers.length === 0) allVers.push({ id: 1, label: 'v1', type: 'empty', strokes: [], bgImage: null });
        setStripActiveTab(fid, strip, Math.min(getStripActiveTab(fid, strip), allVers.length - 1));
        relabelStripVersions(fid, strip);
        rerender();
        if (s.currentViewMode === 'overview' || s.currentViewMode === 'grid4' || s.currentViewMode === 'grid3x2') {
          const row = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
          if (row) { s.currentViewMode === 'grid4' ? renderGrid4Row(row, fid) : renderOverviewRow(row, fid); }
        }
        void flushSyncNow(); // VER-10: delete version (tombstone recorded)
      }
    });
    return;
  }
}

export function applyCapturedImage(dataURL: string, target: any): void {
  const s = state();
  const { fid, div, fromCompare, fromMain } = target;
  const strip: StripType = target.stripType || 'ver';
  const scrollId = stripScrollId(strip);
  snapshotFrame(fid, fromMain ? 'main' : strip);
  let capturedToVersion = false;
  if (fromMain) {
    const f = s.frames.find((fr) => fr.id === fid);
    if (f && isMainEmpty(f)) {
      f.src = dataURL;
      f.drawMode = false;
      const md = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
      if (md) renderMainFrame(md, fid);
    } else {
      capturedToVersion = true;
      const t = autoNewStripVersionIfNeeded(fid, strip);
      t.type = 'upload';
      t.bgImage = dataURL;
      t.r2Key = undefined; // Clear so sync uploads the new image
      if (s.currentViewMode === 'main') {
        // Show captured version inline in main card (cross-compare)
        s.crossCompare[fid] = getStripActiveTab(fid, strip);
        s.crossCompareStrip[fid] = strip;
      }
      const md = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
      if (md) renderMainFrame(md, fid);
      const vd = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      if (vd) renderVersionFrame(vd, fid, strip);
    }
  } else if (fromCompare) {
    capturedToVersion = true;
    const t = autoNewStripVersionIfNeeded(fid, strip);
    t.type = 'upload';
    t.bgImage = dataURL;
    t.r2Key = undefined; // Clear so sync uploads the new image
    setStripCrossCompare(fid, strip, getStripActiveTab(fid, strip));
    renderMainFrame(div, fid);
    const vd = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
    if (vd) renderVersionFrame(vd, fid, strip);
  } else {
    capturedToVersion = true;
    const t = autoNewStripVersionIfNeeded(fid, strip);
    t.type = 'upload';
    t.bgImage = dataURL;
    t.r2Key = undefined; // Clear so sync uploads the new image
    renderVersionFrame(div, fid, strip);
    const nai = getStripActiveTab(fid, strip);
    const cvsPfx = `cvs_${strip}_${fid}_${nai}`;
    const vcvs = div.querySelector(`#${cvsPfx}`) as HTMLCanvasElement | null;
    if (vcvs) drawFit(vcvs, dataURL);
  }
  // toast removed
  useStore.setState({ centerFid: String(fid) });
  if (s.currentViewMode === 'grid3x2') {
    // After camera capture in grid3x2, switch card to show the captured version
    // (unless image went directly to an empty main canvas)
    if (capturedToVersion) {
      s.crossCompare[fid] = getStripActiveTab(fid, strip as StripType);
    }
    const cw = document.querySelector(`#overviewScroll .grid3x2-card-wrap[data-g3fid="${fid}"]`) as HTMLElement | null;
    if (cw) renderGrid3x2Card(cw, fid);
  } else if (s.currentViewMode === 'overview' || s.currentViewMode === 'grid4') {
    const ovRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
    if (ovRow) { s.currentViewMode === 'grid4' ? renderGrid4Row(ovRow, fid) : renderOverviewRow(ovRow, fid); }
  }
  useStore.setState({ overviewAction: false });
  clearCameraTarget();
  scrollFrameIntoView(fid, fromMain ? 'main' : strip);
  void flushSyncNow(); // FRM-17/VER-14: camera capture → snap
}

// Wire up the camera capture pipeline → applyCapturedImage
setOnCapturedImage(applyCapturedImage);
