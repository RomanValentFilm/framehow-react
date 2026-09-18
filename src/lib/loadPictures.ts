// LOAD PICTURES INTO A CARD'S VERSIONS (#527).
//
// Roman, 18 September: "when you press LOAD on version frame cards, a modal
// opens … 'drag your pictures here to upload' … if the user uploads multiple
// picts, they open multiple versions e.g. v3 – v14 … and a button 'select
// from your files'". So LOAD opens a small sheet with a drop zone and a
// button; the button is the file picker that LOAD used to open directly.
//
// ONE loader for both doors. The picker's change handler and the drop zone
// hand their files to `loadPicturesIntoVersions`, which is the body the
// picker's handler had in init.ts — lifted here so a dropped file and a
// picked file take exactly the same path. The first picture goes onto the
// current version if it is empty (or a new one, as before); every further
// picture opens a new version of its own.

import { state, useStore } from '../store/state';
import type { StripType } from '../store/state';
import {
  autoNewStripVersionIfNeeded, getStripVersions, getStripActiveTab, setStripActiveTab,
  setStripCrossCompare, stripScrollId, stripTabPrefix,
} from './helpers';
import { snapshotFrame } from './drawing';
import { renderMainFrame, renderVersionFrame } from './render';
import { renderOverviewRow, renderGrid4Row, renderGrid3x2Card } from './overview';
import { showToast } from './modals';
import { trace } from './syncTrace';
import { flushSyncNow } from './currentProject';

/** Put these pictures into the card LOAD was pressed on (`imgTarget`). */
export function loadPicturesIntoVersions(files: ArrayLike<File>): void {
  const s = state();
  if (!files || files.length === 0 || !s.imgTarget) return;
  const { fid, div, fromCompare } = s.imgTarget;
  const strip: StripType = s.imgTarget.stripType || 'ver';
  const scrollId = stripScrollId(strip);
  snapshotFrame(fid, strip);
  let loaded = 0;
  const total = files.length;
  for (let i = 0; i < total; i++) {
    const reader = new FileReader();
    reader.onerror = () => {
      trace(`picture: could not read "${files[i].name}" — ${reader.error?.name ?? 'unknown error'}: ${reader.error?.message ?? ''}`);
      showToast('Could not read that picture.');
    };
    reader.onload = (ev) => {
      const dataURL = (ev.target as FileReader).result as string;
      if (i === 0) {
        // First file: use autoNewStripVersionIfNeeded (respects current tab state)
        const target = autoNewStripVersionIfNeeded(fid, strip);
        target.type = 'upload';
        target.bgImage = dataURL;
        target.r2Key = undefined; // Clear so sync uploads the new image
      } else {
        // Additional files: create new version tabs (new versions have no r2Key by default)
        const allVers = getStripVersions(fid, strip);
        const n = allVers.length + 1;
        const prefix = stripTabPrefix(strip);
        const newVer = { id: n, label: `${prefix}${n}`, type: 'upload' as const, strokes: [], bgImage: dataURL };
        allVers.push(newVer);
        setStripActiveTab(fid, strip, allVers.length - 1);
      }
      loaded++;
      if (loaded === total) {
        // All files loaded — re-render once
        if (fromCompare) {
          setStripCrossCompare(fid, strip, getStripActiveTab(fid, strip));
          renderMainFrame(div, fid);
          const vd = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (vd) renderVersionFrame(vd, fid, strip);
        } else {
          renderVersionFrame(div, fid, strip);
        }
        if (state().currentViewMode === 'grid3x2') {
          const cw = document.querySelector(`#overviewScroll .grid3x2-card-wrap[data-g3fid="${fid}"]`) as HTMLElement | null;
          if (cw) renderGrid3x2Card(cw, fid);
        } else if (state().currentViewMode === 'overview' || state().currentViewMode === 'grid4') {
          const ovRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
          if (ovRow) { state().currentViewMode === 'grid4' ? renderGrid4Row(ovRow, fid) : renderOverviewRow(ovRow, fid); }
        }
        useStore.setState({ overviewAction: false });
        // Refresh fullscreen overlay if open
        if (document.querySelector('.fs-overlay')) window.dispatchEvent(new Event('fs-refresh'));
        void flushSyncNow(); // VER-3/VER-4: upload to version → file(s) loaded
      }
    };
    reader.readAsDataURL(files[i]);
  }
}

let _sheet: HTMLElement | null = null;

/**
 * THE LOAD SHEET: a drop zone and a "Choose from your files" button. The
 * button opens the same hidden file input LOAD always opened, so the picker
 * path is unchanged; a drop goes straight to the loader.
 */
export function openLoadPicturesSheet(): void {
  closeLoadPicturesSheet();
  // DESKTOP ONLY (Roman): on an iPad or iPhone there is nothing to drag from,
  // and the sheet would be one more tap on every load. The picker opens
  // straight away there, as LOAD always did.
  if (navigator.maxTouchPoints > 0) {
    const input = document.getElementById('imgInput') as HTMLInputElement | null;
    if (!input) return;
    input.removeAttribute('capture');
    input.click();
    return;
  }
  const overlay = document.createElement('div');
  overlay.id = 'loadPicturesSheet';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,0.7);' +
    'display:flex;align-items:center;justify-content:center;padding:16px;' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
  const box = document.createElement('div');
  box.style.cssText =
    'background:#1e1e1e;border:1px solid #444;border-radius:14px;padding:20px 24px;' +
    'max-width:460px;width:100%;color:#fff;';
  box.innerHTML = `
    <div style="font-weight:700;font-size:15px;margin-bottom:12px;">Load pictures</div>
    <div class="load-drop-zone" style="
      border:2px dashed #555;border-radius:12px;padding:34px 16px;text-align:center;
      color:#aaa;font-size:14px;margin-bottom:14px;transition:border-color .15s,background .15s;">
      Drop your pictures here<br>
      <span style="font-size:12px;color:#777;">several at once open as several versions</span>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;align-items:center;">
      <button class="load-cancel-btn" style="
        padding:9px 16px;border-radius:8px;border:1px solid #555;background:#2a2a2a;
        color:#ccc;font-size:13px;font-weight:500;cursor:pointer;
        font-family:-apple-system,BlinkMacSystemFont,sans-serif;">Cancel</button>
      <button class="load-choose-btn" style="
        padding:9px 16px;border-radius:8px;border:none;background:#d52632;color:#fff;
        font-size:13px;font-weight:600;cursor:pointer;
        font-family:-apple-system,BlinkMacSystemFont,sans-serif;">Choose from your files…</button>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  _sheet = overlay;

  const zone = box.querySelector('.load-drop-zone') as HTMLElement;
  const light = (on: boolean) => {
    zone.style.borderColor = on ? '#d52632' : '#555';
    zone.style.background = on ? 'rgba(213,38,50,0.08)' : 'transparent';
  };
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  for (const evt of ['dragenter', 'dragover'] as const) {
    zone.addEventListener(evt, (e) => { stop(e); light(true); });
    overlay.addEventListener(evt, stop);
  }
  zone.addEventListener('dragleave', (e) => { stop(e); light(false); });
  const takeDrop = (e: DragEvent) => {
    stop(e);
    light(false);
    const all = Array.from(e.dataTransfer?.files ?? []);
    const pictures = all.filter((f) => f.type.startsWith('image/'));
    if (pictures.length === 0) { showToast(all.length ? 'Those are not pictures.' : 'Nothing was dropped.'); return; }
    closeLoadPicturesSheet();
    loadPicturesIntoVersions(pictures);
  };
  zone.addEventListener('drop', takeDrop);
  overlay.addEventListener('drop', takeDrop);   // a drop beside the zone still counts

  // The picker: the same hidden input LOAD always used; its change handler
  // (init.ts) loads the files. The sheet closes on the way there.
  box.querySelector('.load-choose-btn')!.addEventListener('click', () => {
    closeLoadPicturesSheet();
    const input = document.getElementById('imgInput') as HTMLInputElement | null;
    if (!input) return;
    input.removeAttribute('capture');
    input.click();
  });
  box.querySelector('.load-cancel-btn')!.addEventListener('click', () => {
    closeLoadPicturesSheet();
    useStore.setState({ imgTarget: null });
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { closeLoadPicturesSheet(); useStore.setState({ imgTarget: null }); }
  });
}

export function closeLoadPicturesSheet(): void {
  if (_sheet) { _sheet.remove(); _sheet = null; }
}
