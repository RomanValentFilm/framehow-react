// Top-level wiring — installs all global event handlers, button click
// handlers, file inputs, and exposes cross-module render hooks via
// window.__fh_* (used to break circular import cycles between render,
// overview, actions, and helpers).

import { state, useStore, isTouch, resetStoryboardState } from '../store/state';
import { renderAll, renderMainFrame, renderVersionFrame } from './render';
import { renderOverview, renderOverviewRow, renderGrid4, renderGrid4Row, renderGrid3x2, renderGrid3x2Card, recalcGrid3x2Margins } from './overview';
import { handleAction, handleMainAction } from './actions';
import { setViewMode, autoPhoneMainView, wireScrollHandlers, scrollAnchorTo } from './view';
import {
  saveTableFromDOM,
  defaultTableData,
  toggleStar,
  clearAllDrawActive,
  clearVerReorder,
  updateFrameBadge,
  tableHTML,
  autoNewVersionIfNeeded,
  autoNewStripVersionIfNeeded,
  getStripVersions,
  getStripActiveTab,
  setStripActiveTab,
  setStripCrossCompare,
  addNewStripVersion,
  stripScrollId,
  stripTabPrefix,
  relabelStripVersions,
  openNoteModal,
  noteIconSVG,
} from './helpers';
import type { StripType } from '../store/state';
import { snapshotFrame } from './drawing';
import { drawFit } from './drawing';
import { setupDrawing } from './drawing';
import { showToast, showNewProjectModal, isNewProjectModalOpen } from './modals';
import type { NewProjectChoice } from './modals';
import { handlePDF } from './pdf';
import { handleFolderImages, startFromScratch, startPortrait } from './files';
import { openExportModal, openPptxModal, runExport, runPptxExport, openImageExportModal, runImageExport, openPortraitExportModal, runPortraitExport, openPortraitImageExportModal, runPortraitImageExport, updateExportVisibility, buildVersionPicker, buildPptxVersionPicker } from './exports';
import { wireCameraEvents } from './camera';
// openFullscreen is now triggered by DRAW button (actions.ts), not the fs-btn
import { toggleGroupSidebar } from './groups';
import { toggleSetupMode, handleSetupFrameClick, handleSetupRemoveClick, handleStripTagClick, showSetupPillHint } from './setups';
import { startHeartbeat, fhTrack } from './tracking';
import {
  bootstrapAccountSystem,
  flowAccountOrSignIn,
  flowLoadProject,
  flowRestoreProject,
  flowSaveProject,
  isToasterShowing,
  showSaveToaster,
} from './accountFlow';
import { getActiveMs, onActivityTick, startActivityTracking } from './activity';
import { startAutosave, getCurrentProject, clearCurrentProject, flushSyncNow, subscribe as subscribeProject } from './currentProject';
import { subscribe as subscribeSession, isLoggedIn } from './session';

let initialized = false;

export function initFramehow(): void {
  if (initialized) return;
  initialized = true;

  // Cross-module render shims (avoid circular imports)
  (window as any).__fh_renderAll = renderAll;
  (window as any).__fh_renderMainFrame = renderMainFrame;
  (window as any).__fh_renderVersionFrame = renderVersionFrame;
  (window as any).__fh_renderOverview = renderOverview;
  (window as any).__fh_renderOverviewRow = renderOverviewRow;
  (window as any).__fh_renderGrid4 = renderGrid4;
  (window as any).__fh_renderGrid4Row = renderGrid4Row;
  (window as any).__fh_renderGrid3x2 = renderGrid3x2;
  (window as any).__fh_renderGrid3x2Card = renderGrid3x2Card;
  (window as any).__fh_recalcGrid3x2Margins = recalcGrid3x2Margins;
  (window as any).__fh_setViewMode = setViewMode;
  (window as any).__fh_handleMainAction = handleMainAction;
  (window as any).__fh_handleAction = handleAction;
  (window as any).__fh_clearAllDrawActive = clearAllDrawActive;
  (window as any).__fh_setupDrawing = setupDrawing;
  (window as any).__fh_scrollAnchorTo = scrollAnchorTo;
  (window as any).__fh_flushSyncNow = flushSyncNow;

  // Drawing-suppress click cleanup (mouseup/touchend at document level)
  document.addEventListener('mouseup', () => {
    if (state().drawingInProgress) return;
    setTimeout(() => useStore.setState({ drawSuppressClick: false }), 0);
  });
  document.addEventListener('touchend', () => {
    if (state().drawingInProgress) return;
    setTimeout(() => useStore.setState({ drawSuppressClick: false }), 0);
  });

  // Overview scroll click — collapse expanded version + close main draw on outside click
  document.getElementById('overviewScroll')!.addEventListener('click', (e: MouseEvent) => {
    const s = state();
    if (s.drawingInProgress || s.drawSuppressClick) return;
    if (!document.contains(e.target as Node)) return;
    const target = e.target as HTMLElement;
    const clickedMainCard = target.closest('.overview-main .frame-card') as HTMLElement | null;
    const clickedMainFid = clickedMainCard
      ? parseInt(clickedMainCard.dataset.mfid || clickedMainCard.dataset.omfid || '0')
      : null;
    const clickedVerCard = target.closest('.ov-ver-card .frame-card') as HTMLElement | null;
    const clickedVerFid = clickedVerCard ? parseInt(clickedVerCard.dataset.ovfid || '0') : null;
    const clickedVerIdx = clickedVerCard ? parseInt(clickedVerCard.dataset.ovi || '0') : null;
    const overviewScroll = document.getElementById('overviewScroll')!;
    for (const k in s.drawActive) {
      if (s.drawActive[+k] === 'main' && parseInt(k) !== clickedMainFid) {
        s.drawActive[+k] = null;
        s.drawEraser[+k] = false;
        if (clickedVerCard && clickedVerFid === parseInt(k)) {
          s.activeTab[clickedVerFid] = clickedVerIdx!;
          useStore.setState({ ovExpandedFid: clickedVerFid });
        }
        const mRow = overviewScroll.querySelector(`.overview-row[data-ofid="${k}"]`) as HTMLElement | null;
        if (mRow) renderOverviewRow(mRow, parseInt(k));
      }
    }
    if (s.ovExpandedFid === null) return;
    if (target.closest('.ov-ver-card')) return;
    // Collapse expanded
    const prevFid = s.ovExpandedFid;
    if (prevFid !== null) {
      if (s.drawActive[prevFid]) s.drawActive[prevFid] = null;
      s.drawEraser[prevFid] = false;
      useStore.setState({ ovExpandedFid: null });
      const oldRow = overviewScroll.querySelector(`.overview-row[data-ofid="${prevFid}"]`) as HTMLElement | null;
      if (oldRow) renderOverviewRow(oldRow, prevFid);
    }
  });

  // Live-save text edits + table edits
  // FRM-12/FRM-13: 5-second text inactivity timer — pushes text to server
  // before the heartbeat goes stale (10s), so the other device gets the latest.
  let _textFlushTimer: ReturnType<typeof setTimeout> | null = null;
  function _resetTextFlushTimer(): void {
    if (_textFlushTimer) clearTimeout(_textFlushTimer);
    _textFlushTimer = setTimeout(() => {
      _textFlushTimer = null;
      void flushSyncNow(); // FRM-12/FRM-13: 5s text inactivity → flush
    }, 5000);
  }
  document.addEventListener('input', (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.matches('textarea.frame-text-edit[data-textfid]')) {
      const fid = parseInt(target.dataset.textfid!);
      const f = state().frames.find((fr) => fr.id === fid);
      if (f) f.textContent = (target as HTMLTextAreaElement).value;
      _resetTextFlushTimer();
    }
    const tbl = target.closest('.frame-table[data-tblfid]') as HTMLElement | null;
    if (tbl) {
      saveTableFromDOM(tbl);
      _resetTextFlushTimer();
    }
  });
  // FRM-12/FRM-13: blur = end of action → flush immediately
  document.addEventListener('focusout', (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    if (target.matches('textarea.frame-text-edit[data-textfid]') ||
        target.closest('.frame-table[data-tblfid]')) {
      if (_textFlushTimer) { clearTimeout(_textFlushTimer); _textFlushTimer = null; }
      void flushSyncNow(); // FRM-12/FRM-13: blur → end of text/table editing
    }
  });

  // Add row to table
  document.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-addrow]') as HTMLElement | null;
    if (!btn) return;
    const fid = parseInt(btn.dataset.addrow!);
    const f = state().frames.find((fr) => fr.id === fid);
    if (!f) return;
    const tbl = btn.parentElement!.querySelector('.frame-table') as HTMLElement | null;
    if (tbl) saveTableFromDOM(tbl);
    if (!f.tableData) f.tableData = defaultTableData();
    f.tableData.rows.push(new Array(f.tableData.headers.length).fill(''));
    const wrap = btn.closest('.canvas-wrap') as HTMLElement | null;
    if (wrap) {
      wrap.innerHTML = tableHTML(fid, f.tableData);
    }
    void flushSyncNow(); // FRM-14: add table row
  });

  // Star button delegated handler
  document.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('.star-btn') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    const fid = +btn.dataset.starfid!,
      vi = +btn.dataset.starvi!;
    const starStrip = (btn.dataset.starstrip || 'ver') as StripType;
    const oldIdx = vi;
    toggleStar(fid, vi, starStrip);
    const newIdx = getStripActiveTab(fid, starStrip);
    renderAll();
    if (oldIdx !== newIdx) {
      const dir = newIdx < oldIdx ? '-20px' : '20px';
      setTimeout(() => {
        const activeVtab =
          (document.querySelector(`.vtab.active[data-fid="${fid}"][data-tabstrip="${starStrip}"]`) as HTMLElement | null) ||
          (document.querySelector(`.vtab.active[data-idx="${newIdx}"][data-tabstrip="${starStrip}"]`) as HTMLElement | null);
        if (activeVtab) {
          activeVtab.style.setProperty('--slide-dir', dir);
          activeVtab.classList.add('reorder-highlight');
          activeVtab.addEventListener(
            'animationend',
            () => {
              activeVtab.classList.remove('reorder-highlight');
              activeVtab.style.removeProperty('--slide-dir');
            },
            { once: true }
          );
        }
      }, 50);
    }
  });

  // Note button delegated handler (replaced fullscreen expand)
  document.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('.fs-btn') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    const fid = +btn.dataset.fsfid!;
    const vi = +(btn.dataset.fsvi ?? 0);
    const origin = (btn.dataset.fsorigin ?? 'main') as 'main' | 'ver' | 'floor' | 'refs';
    openNoteModal(fid, vi, origin, () => {
      // Update the icon to reflect whether note has content
      btn.innerHTML = noteIconSVG(fid, vi, origin);
    });
  });

  // Setup frame assignment — delegated so it works regardless of render timing
  document.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-setup-fid]') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const fid = parseInt(btn.dataset.setupFid!, 10);
    handleSetupFrameClick(fid);
  });

  // Strip-tag pill — delegated so clicks work even when canvas has image content
  document.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-striptag-fid]') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const fid = parseInt(btn.dataset.striptagFid!, 10);
    const vi = parseInt(btn.dataset.striptagVi!, 10);
    const strip = btn.dataset.striptagStrip! as StripType;
    handleStripTagClick(fid, vi, strip);
  });

  // Setup pill hint — tap a setup pill on main frame in normal mode → show hint + pulse SETUPS btn
  document.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-setup-hint]') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    showSetupPillHint();
  });

  // Setup pill remove — tap another setup's pill in edit mode → remove that setup from the frame
  document.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-setup-remove-fid]') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const fid = parseInt((btn as HTMLElement).dataset.setupRemoveFid!, 10);
    handleSetupRemoveClick(fid);
  });

  // Main Menu dropdown — flush-save on open (safety net before potential project switch)
  // Guard: on iOS/iPadOS, touch→click synthesis can let the document listener
  // fire in the same tick despite stopPropagation, instantly closing the menu.
  let _menuGuard = false;
  const menuBtn = document.getElementById('mainMenuBtn')!;
  menuBtn.style.touchAction = 'manipulation'; // remove 300ms double-tap delay
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (state().setupMode) return; // locked while setup bar is open
    const menu = document.getElementById('mainMenu')!;
    menu.classList.toggle('open');
    _menuGuard = true;
    setTimeout(() => { _menuGuard = false; }, 80);
    void flushSyncNow(); // non-blocking save — ensures current work is safe
  });
  // Prevent menu-item clicks from bubbling to the document close handler —
  // on iOS/iPadOS the bubble can race with the item handler and swallow taps.
  document.getElementById('mainMenu')!.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  document.addEventListener('click', () => {
    if (_menuGuard) return;
    document.getElementById('mainMenu')!.classList.remove('open');
  });

  // ── Global: dismiss any active MOVE/reorder when clicking elsewhere ─
  document.addEventListener('click', (e: MouseEvent) => {
    if (state().verReorderFid === null) return;
    const t = e.target as HTMLElement;
    // Keep MOVE active only when clicking move arrows or the reorder label (MOVE/DONE)
    if (t.closest('.vtab-add, .reorder-label, [data-ovmove], [data-vmove], [data-cvmove]')) return;
    clearVerReorder();
  });

  // ── New Project modal handler ──────────────────────────────────────
  // Centralised handler: opens the New Project modal and acts on the
  // user's choice. The callback pattern (not Promise) preserves the
  // user-gesture chain so file-input .click() works on Safari / iOS.
  function openNewProjectModal(): void {
    showNewProjectModal((choice: NewProjectChoice) => {
      if (choice !== 'cancel') fhTrack('signpost_choice', { choice });
      switch (choice) {
        case 'pdf':
          clearAllDrawActive();
          (document.getElementById('pdfInput') as HTMLInputElement).click();
          break;
        case 'images':
          clearAllDrawActive();
          (document.getElementById('folderImgInput') as HTMLInputElement).click();
          break;
        case 'scratch':
          startFromScratch();
          renderAll();
          autoPhoneMainView();
          break;
        case 'portrait':
          startPortrait();
          renderAll();
          autoPhoneMainView();
          break;
        case 'open':
          void flowLoadProject();
          break;
        case 'cancel':
        default:
          break;
      }
    });
  }

  // Let other modules (e.g. accountFlow) trigger the Signpost modal
  window.addEventListener('fh:open-signpost', () => openNewProjectModal());

  // Menu > New Project
  document.getElementById('menuNewProject')!.addEventListener('click', () => {
    document.getElementById('mainMenu')!.classList.remove('open');
    const cp = getCurrentProject();
    if (state().frames.length > 0) {
      if (cp.projectId) {
        // Already saved — flush in background (state snapshot is synchronous),
        // then reset immediately so the UI feels instant.
        void flushSyncNow();
      } else {
        // Never saved — ask user asynchronously, then proceed
        void (async () => {
          const ok = await import('./modals').then(m => m.showConfirm('Save your current work before starting a new project?'));
          if (ok) {
            await flowSaveProject();
          }
          resetStoryboardState();
          clearCurrentProject();
          renderAll();
          updateFrameBadge();
          openNewProjectModal();
        })();
        return; // async path handles the rest
      }
      resetStoryboardState();
      clearCurrentProject();
      renderAll();
      updateFrameBadge();
    }
    openNewProjectModal();
  });
  document.getElementById('menuExport')!.addEventListener('click', () => {
    document.getElementById('mainMenu')!.classList.remove('open');
    if (!state().frames.length) {
      showToast('No frames to export');
      return;
    }
    if (state().portraitMode) {
      document.getElementById('portraitExportChooser')!.classList.remove('hidden');
    } else {
      document.getElementById('exportChooser')!.classList.remove('hidden');
    }
  });
  // Account-system menu entries (v1.6)
  document.getElementById('menuSaveProject')!.addEventListener('click', () => {
    document.getElementById('mainMenu')!.classList.remove('open');
    if (!state().frames.length) {
      showToast('Nothing to save yet — load or create some frames first.');
      return;
    }
    void flowSaveProject();
  });
  document.getElementById('menuLoadProject')!.addEventListener('click', () => {
    document.getElementById('mainMenu')!.classList.remove('open');
    void flowLoadProject();
  });
  document.getElementById('menuAccount')!.addEventListener('click', () => {
    document.getElementById('mainMenu')!.classList.remove('open');
    void flowAccountOrSignIn();
  });

  // Restore Project
  document.getElementById('menuRestoreProject')!.addEventListener('click', () => {
    document.getElementById('mainMenu')!.classList.remove('open');
    void flowRestoreProject();
  });

  // Adjust PDF Import
  document.getElementById('menuAdjustPdf')!.addEventListener('click', () => {
    document.getElementById('mainMenu')!.classList.remove('open');
    import('./pdfAdjust').then(m => m.openPdfAdjust());
  });

  // Customise modal
  document.getElementById('menuCustomise')!.addEventListener('click', () => {
    document.getElementById('mainMenu')!.classList.remove('open');
    const s = state();
    // Populate inputs with current strip labels
    const inp1 = document.getElementById('customStrip1') as HTMLInputElement;
    const inp2 = document.getElementById('customStrip2') as HTMLInputElement;
    const inp3 = document.getElementById('customStrip3') as HTMLInputElement;
    inp1.value = s.stripDefs[0]?.buttonLabel || 'STRIP1';
    inp2.value = s.stripDefs[1]?.buttonLabel || 'STRIP2';
    inp3.value = s.stripDefs[2]?.buttonLabel || 'STRIP3';
    (document.getElementById('customFrameLabel1') as HTMLInputElement).value = s.stripDefs[0]?.defaultFrameLabel || 'vers';
    (document.getElementById('customFrameLabel2') as HTMLInputElement).value = s.stripDefs[1]?.defaultFrameLabel || 'floor';
    (document.getElementById('customFrameLabel3') as HTMLInputElement).value = s.stripDefs[2]?.defaultFrameLabel || 'refs';
    document.getElementById('customiseModal')!.classList.remove('hidden');
  });
  document.getElementById('customiseCancel')!.addEventListener('click', () => {
    document.getElementById('customiseModal')!.classList.add('hidden');
  });
  document.getElementById('customiseSave')!.addEventListener('click', () => {
    const inp1 = document.getElementById('customStrip1') as HTMLInputElement;
    const inp2 = document.getElementById('customStrip2') as HTMLInputElement;
    const inp3 = document.getElementById('customStrip3') as HTMLInputElement;
    const fl1 = document.getElementById('customFrameLabel1') as HTMLInputElement;
    const fl2 = document.getElementById('customFrameLabel2') as HTMLInputElement;
    const fl3 = document.getElementById('customFrameLabel3') as HTMLInputElement;
    const s = state();
    const newDefs = s.stripDefs.map((def, i) => {
      const raw = i === 0 ? inp1.value : i === 1 ? inp2.value : inp3.value;
      const flRaw = i === 0 ? fl1.value : i === 1 ? fl2.value : fl3.value;
      const label = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 6) || def.buttonLabel;
      const frameLabel = flRaw.trim().slice(0, 6) || def.defaultFrameLabel;
      return { ...def, buttonLabel: label, defaultFrameLabel: frameLabel };
    });
    useStore.setState({ stripDefs: newDefs });
    // Update prefix + relabel tabs, and clear per-frame overrides
    for (const def of newDefs) {
      // Clear all per-frame stripLabels so every frame uses the new default
      for (const fr of s.frames) {
        if (fr.stripLabels && fr.stripLabels[def.id]) {
          delete fr.stripLabels[def.id];
        }
      }
      const newPrefix = def.defaultFrameLabel[0]?.toLowerCase() || def.prefix;
      if (def.prefix !== newPrefix) {
        def.prefix = newPrefix;
        const versMap = s.stripVersions[def.id] || {};
        for (const fid of Object.keys(versMap)) {
          relabelStripVersions(+fid, def.id);
        }
      }
    }
    document.getElementById('customiseModal')!.classList.add('hidden');
    renderAll();
    void flushSyncNow(); // CUS-1: customise strip labels → Save
  });
  // Close customise on backdrop click
  document.getElementById('customiseModal')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'customiseModal') {
      document.getElementById('customiseModal')!.classList.add('hidden');
    }
  });

  // PDF input
  document.getElementById('pdfInput')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await handlePDF(file);
    renderAll();
    autoPhoneMainView();
    (e.target as HTMLInputElement).value = '';
  });

  // Folder images input — handleFolderImages calls renderAll() itself when the
  // async FileReader chain completes, so no follow-up needed here.
  document.getElementById('folderImgInput')!.addEventListener('change', handleFolderImages);

  // Export chooser
  document.getElementById('exportFmtCancel')!.addEventListener('click', () =>
    document.getElementById('exportChooser')!.classList.add('hidden')
  );
  document.getElementById('exportFmtPDF')!.addEventListener('click', () => {
    document.getElementById('exportChooser')!.classList.add('hidden');
    openExportModal();
  });
  document.getElementById('exportFmtPPTX')!.addEventListener('click', () => {
    document.getElementById('exportChooser')!.classList.add('hidden');
    openPptxModal();
  });
  document.getElementById('exportFmtImages')!.addEventListener('click', () => {
    document.getElementById('exportChooser')!.classList.add('hidden');
    openImageExportModal();
  });

  // PDF export modal
  document.getElementById('exportCancel')!.addEventListener('click', () =>
    document.getElementById('exportModal')!.classList.add('hidden')
  );
  document.querySelectorAll('input[name="exportLayout"]').forEach((r) =>
    r.addEventListener('change', () => {
      const layout = (document.querySelector('input[name="exportLayout"]:checked') as HTMLInputElement).value;
      updateExportVisibility(layout, 'export');
      if (layout === 'overview') buildVersionPicker();
    })
  );
  // Rebuild version picker when overview strip selection changes
  document.getElementById('exportOverviewStripPicker')?.addEventListener('change', () => buildVersionPicker());
  document.getElementById('exportGo')!.addEventListener('click', runExport);

  // PPTX export modal
  document.getElementById('pptxCancel')!.addEventListener('click', () =>
    document.getElementById('pptxModal')!.classList.add('hidden')
  );
  document.querySelectorAll('input[name="pptxLayout"]').forEach((r) =>
    r.addEventListener('change', () => {
      const layout = (document.querySelector('input[name="pptxLayout"]:checked') as HTMLInputElement).value;
      updateExportVisibility(layout, 'pptx');
      if (layout === 'overview') buildPptxVersionPicker();
    })
  );
  document.getElementById('pptxOverviewStripPicker')?.addEventListener('change', () => buildPptxVersionPicker());
  document.getElementById('pptxGo')!.addEventListener('click', runPptxExport);

  // Image export modal
  document.getElementById('imageExportCancel')!.addEventListener('click', () =>
    document.getElementById('imageExportModal')!.classList.add('hidden')
  );
  document.getElementById('imageExportGo')!.addEventListener('click', runImageExport);

  // Portrait (9:16) export chooser
  document.getElementById('portraitFmtCancel')!.addEventListener('click', () =>
    document.getElementById('portraitExportChooser')!.classList.add('hidden')
  );
  document.getElementById('portraitFmtPDF')!.addEventListener('click', () => {
    document.getElementById('portraitExportChooser')!.classList.add('hidden');
    openPortraitExportModal('pdf');
  });
  document.getElementById('portraitFmtPPTX')!.addEventListener('click', () => {
    document.getElementById('portraitExportChooser')!.classList.add('hidden');
    openPortraitExportModal('pptx');
  });
  document.getElementById('portraitFmtImages')!.addEventListener('click', () => {
    document.getElementById('portraitExportChooser')!.classList.add('hidden');
    openPortraitImageExportModal();
  });
  document.getElementById('portraitImageExportCancel')!.addEventListener('click', () =>
    document.getElementById('portraitImageExportModal')!.classList.add('hidden')
  );
  document.getElementById('portraitImageExportGo')!.addEventListener('click', () => {
    void runPortraitImageExport();
  });
  // Portrait export modal
  document.getElementById('portraitExportCancel')!.addEventListener('click', () =>
    document.getElementById('portraitExportModal')!.classList.add('hidden')
  );
  document.getElementById('portraitExportGo')!.addEventListener('click', runPortraitExport);

  // Helper: show "max N strips" overlay with the right number
  function showMaxStripsOverlay(maxN: number) {
    const om = document.getElementById('maxStripsMsg')!;
    const txt = document.getElementById('maxStripsMsgText');
    if (txt) txt.innerHTML = `You can fit maximum ${maxN} STRIPS VIEW<br>on this device's screen.<br><br>Please toggle-off a strip's button<br>to select another one.`;
    om.classList.add('show');
    const dismiss = (e?: Event) => { if (e) { e.stopPropagation(); e.preventDefault(); } om.classList.remove('show'); };
    om.addEventListener('click', dismiss, { once: true });
    setTimeout(() => om.classList.remove('show'), 3000);
  }

  // View mode buttons (excludes strip toggles — they have their own handler)
  document.querySelectorAll('.view-btn:not(.strip-toggle)').forEach((b) =>
    b.addEventListener('click', () => {
      const w = window.innerWidth,
        h = window.innerHeight;
      const isPhone = Math.min(w, h) <= 430;
      const isPhonePortrait = isPhone && h > w;
      const view = (b as HTMLElement).dataset.view as string;

      // Block everything except SETUPS button while setup mode is open
      if (state().setupMode && view !== 'setups') return;

      // Left-side buttons: iPad/Desktop only
      if (view === 'group') {
        if (isPhonePortrait) {
          // If stuck in a group on portrait, allow escaping back to ALL
          const gs = state();
          if (gs.activeGroupId !== null) {
            useStore.setState({ activeGroupId: null });
            (window as any).__fh_renderAll?.();
            showToast('Showing all frames');
            return;
          }
          showToast('Rotate to landscape to use Groups');
          return;
        }
        toggleGroupSidebar();
        return;
      }
      if (view === '3x2') {
        if (h > w) {
          // Portrait (phone or tablet): show rotate overlay
          const overlay = document.getElementById('g3RotateMsg');
          if (overlay) {
            overlay.classList.add('show');
            const dismiss = () => { overlay.classList.remove('show'); };
            overlay.addEventListener('click', dismiss, { once: true });
            setTimeout(dismiss, 5000);
          }
          return;
        }
        const s = state();
        // Toggle off if already in 3×2
        if (s.currentViewMode === 'grid3x2') {
          setViewMode('both');
          return;
        }
        // Pick companion strip (for cross-swipe to version)
        const companion = s.activeStrips.find((st: string) => st !== 'main') || 'ver';
        // Deactivate NEEDS strip when entering 3×2
        useStore.setState({ activeStrips: ['main', companion] as any, needsStripVisible: false });
        const needsBtn = document.getElementById('needsStripBtn');
        if (needsBtn) needsBtn.classList.remove('active');
        setViewMode('grid3x2' as any);
        return;
      }

      if (view === 'setups') {
        toggleSetupMode();
        return;
      }

      if (view === 'needs') {
        const s = state();
        const cur = s.needsStripVisible;
        // If in 3×2 view, exit to MAIN+NEEDS (same pattern as other strip exits)
        if (s.currentViewMode === 'grid3x2') {
          useStore.setState({ activeStrips: ['main'] as any, needsStripVisible: true, crossCompare: {}, currentViewMode: 'both' });
          const btn = document.getElementById('needsStripBtn');
          if (btn) btn.classList.add('active');
          renderAll();
          return;
        }
        if (!cur) {
          // Toggling NEEDS on — check strip limits
          const w = window.innerWidth, h = window.innerHeight;
          const isPhone = Math.min(w, h) <= 430;
          const isTablet = navigator.maxTouchPoints > 1 && !isPhone && Math.min(w, h) <= 830; // excludes iPad Pro
          const totalVisible = s.activeStrips.length + 1; // +1 for NEEDS about to be added
          if (isPhone && w > h && totalVisible > 2) { showMaxStripsOverlay(2); return; }
          if (isTablet && h > w && totalVisible > 3) { showMaxStripsOverlay(3); return; }
          if (isTablet && w > h && totalVisible > 4) { showMaxStripsOverlay(4); return; }
        }
        useStore.setState({ needsStripVisible: !cur });
        const btn = document.getElementById('needsStripBtn');
        if (btn) btn.classList.toggle('active', !cur);
        renderAll();
        return;
      }

      // OFF button — exit 1+2V/GRID4 back to normal columns with same strip pair
      if (view === 'off') {
        const s = state();
        let viewMode: 'main' | 'ver' | 'both' = 'both';
        if (s.activeStrips.length === 1 && s.activeStrips[0] === 'main') viewMode = 'main';
        else if (s.activeStrips.length === 1) viewMode = 'ver';
        useStore.setState({ currentViewMode: viewMode });
        renderAll();
        return;
      }

      if (isPhone && (view === 'overview' || view === 'grid4')) {
        const om = document.getElementById('overviewPhoneMsg')!;
        om.classList.add('show');
        const dismiss = (e?: Event) => {
          if (e) { e.stopPropagation(); e.preventDefault(); }
          om.classList.remove('show');
        };
        om.addEventListener('click', dismiss, { once: true });
        setTimeout(() => om.classList.remove('show'), 3000);
        return;
      }

      // 1+2V and GRID4: always MAIN + one companion strip
      if (view === 'overview' || view === 'grid4') {
        const s = state();
        // If already in this mode, toggle back to normal columns
        if (s.currentViewMode === view) {
          setViewMode('both');
          return;
        }
        // Pick companion: first non-main strip in activeStrips, or default to 'ver'
        const companion = s.activeStrips.find((st: string) => st !== 'main') || 'ver';
        useStore.setState({ activeStrips: ['main', companion] as any });
        setViewMode(view as any);
        return;
      }

      setViewMode(view as any);
    })
  );

  // Strip toggle buttons (middle group) — toggle strips, auto-derive layout
  document.querySelectorAll('.strip-toggle').forEach((b) =>
    b.addEventListener('click', () => {
      if (state().setupMode) return; // locked while setup bar is open
      const strip = (b as HTMLElement).dataset.strip as 'main' | 'ver' | 'floor' | 'refs';
      const s = state();
      const w = window.innerWidth, h = window.innerHeight;
      const isPhone = Math.min(w, h) <= 430;
      const isPhonePortrait = isPhone && h > w;
      const isPhoneLandscape = isPhone && w > h;

      // In grid3x2: clicking any strip button exits to that strip's view
      // Must use renderAll() because strip scroll containers (floor/refs) may
      // not have frame cards — they're only built when the strip is in activeStrips.
      if (s.currentViewMode === 'grid3x2') {
        useStore.setState({ crossCompare: {} });
        if (strip === 'main') {
          useStore.setState({ activeStrips: ['main'], currentViewMode: 'main' });
        } else {
          useStore.setState({ activeStrips: ['main', strip] as any, currentViewMode: 'both' });
        }
        renderAll();
        return;
      }

      // In 1+2V / GRID4 mode: MAIN locked on, switch companion strip
      if (s.currentViewMode === 'overview' || s.currentViewMode === 'grid4') {
        if (strip === 'main') return; // MAIN always on in these modes
        useStore.setState({ activeStrips: ['main', strip] as any });
        renderAll();
        return;
      }

      // ── iPhone portrait: single strip view only ──
      if (isPhonePortrait) {
        const viewMode = strip === 'main' ? 'main' as const : 'ver' as const;
        // Reset cross-compare so stale state from previous view doesn't bleed through
        const freshCC: Record<number, number> = {};
        useStore.setState({ activeStrips: [strip], currentViewMode: viewMode, crossCompare: freshCC, stripCrossCompare: { ...s.stripCrossCompare, ver: freshCC } });
        renderAll();
        return;
      }

      // ── iPhone landscape: max 2 strips ──
      if (isPhoneLandscape) {
        const current = [...s.activeStrips];
        const idx = current.indexOf(strip);
        if (idx >= 0) {
          // Toggling off — don't allow removing the last strip
          if (current.length <= 1) return;
          current.splice(idx, 1);
        } else {
          // Toggling on — enforce max 2 strips (NEEDS counts as one)
          const totalVisible = current.length + (s.needsStripVisible ? 1 : 0) + 1; // +1 for strip being added
          if (totalVisible > 2) { showMaxStripsOverlay(2); return; }
          current.push(strip);
        }
        let viewMode: 'main' | 'ver' | 'both' = 'both';
        if (current.length === 1 && current[0] === 'main') viewMode = 'main';
        else if (current.length === 1) viewMode = 'ver';
        // Reset cross-compare so stale state from previous view doesn't bleed through
        const freshCC2: Record<number, number> = {};
        useStore.setState({ activeStrips: current, currentViewMode: viewMode, crossCompare: freshCC2, stripCrossCompare: { ...s.stripCrossCompare, ver: freshCC2 } });
        renderAll();
        return;
      }

      // ── iPad / Desktop: normal toggle ──
      const isTablet = navigator.maxTouchPoints > 1 && !isPhone && Math.min(w, h) <= 830; // excludes iPad Pro
      const current = [...s.activeStrips];
      const idx = current.indexOf(strip);

      if (idx >= 0) {
        // Don't allow removing the last strip
        if (current.length <= 1) return;
        current.splice(idx, 1);
      } else {
        // iPad: enforce max 3 portrait / 4 landscape (NEEDS counts as one)
        if (isTablet) {
          const totalVisible = current.length + (s.needsStripVisible ? 1 : 0) + 1; // +1 for strip being added
          const maxStrips = h > w ? 3 : 4;
          if (totalVisible > maxStrips) { showMaxStripsOverlay(maxStrips); return; }
        }
        current.push(strip);
      }

      // Derive currentViewMode from active strips
      let viewMode: 'main' | 'ver' | 'both' = 'both';
      if (current.length === 1 && current[0] === 'main') viewMode = 'main';
      else if (current.length === 1) viewMode = 'ver';

      // Reset cross-compare so stale state from previous view doesn't bleed through
      const freshCC3: Record<number, number> = {};
      useStore.setState({ activeStrips: current, currentViewMode: viewMode, crossCompare: freshCC3, stripCrossCompare: { ...s.stripCrossCompare, ver: freshCC3 } });
      renderAll();
    })
  );

  // imgInput / mainImgInput change
  document.getElementById('mainImgInput')!.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    const s = state();
    if (!file || !s.mainImgTarget) return;
    const { fid, div, toVersion, fromOverview } = s.mainImgTarget;
    const f = s.frames.find((fr) => fr.id === fid);
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      snapshotFrame(fid, 'main');
      if (toVersion) {
        const target = autoNewVersionIfNeeded(fid);
        target.type = 'upload';
        target.bgImage = (ev.target as FileReader).result as string;
        target.r2Key = undefined; // Clear so sync uploads the new image
        if (state().currentViewMode === 'main') s.crossCompare[fid] = s.activeTab[fid];
        renderMainFrame(div, fid);
        const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (vd) renderVersionFrame(vd, fid);
        // toast removed
      } else {
        f.src = (ev.target as FileReader).result as string;
        f.r2Key = undefined; // Clear so sync uploads the new image
        f.drawMode = false;
        renderMainFrame(div, fid);
        const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (vd) renderVersionFrame(vd, fid);
      }
      if (fromOverview) {
        const ovRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
        if (ovRow) renderOverviewRow(ovRow, fid);
      }
      void flushSyncNow(); // FRM-7: upload image to main → file selected
    };
    reader.readAsDataURL(file);
    (e.target as HTMLInputElement).value = '';
    useStore.setState({ mainImgTarget: null });
  });

  document.getElementById('imgInput')!.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
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
          void flushSyncNow(); // VER-3/VER-4: upload to version → file(s) loaded
        }
      };
      reader.readAsDataURL(files[i]);
    }
    (e.target as HTMLInputElement).value = '';
  });

  // Camera + crop UI
  wireCameraEvents();

  // Scroll/orientation
  wireScrollHandlers();

  // Set initial view mode
  setViewMode('both');

  // Telemetry
  startHeartbeat();

  // Service worker — skip in dev mode so cached SW never blocks fresh code
  if ('serviceWorker' in navigator) {
    if (import.meta.env.DEV) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.unregister());
      });
    } else {
      navigator.serviceWorker.register('/app/sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              // Update available — next reload will use the new version
            }
          });
        });
      });
    }
  }

  // iOS :active CSS enabler
  document.addEventListener('touchstart', () => {}, { passive: true });

  // Account system: bootstrap, activity, autosave, toaster trigger.
  startActivityTracking();
  startAutosave();

  // Update the menu's "Sign In" / "Account" label to reflect login state.
  function refreshAccountMenuLabel(): void {
    const btn = document.getElementById('menuAccount');
    if (btn) btn.textContent = isLoggedIn() ? 'Account' : 'Sign in / Log in';
  }
  refreshAccountMenuLabel();
  subscribeSession(refreshAccountMenuLabel);

  // Keep toolbar project name in sync with currentProject changes (save, load, rename)
  subscribeProject(() => updateFrameBadge());

  // Save toaster trigger logic
  // ------------------------------------------------------------------------
  // Production: 5 minutes of active use AND a storyboard is loaded.
  // Dev/preview only (localhost or import.meta.env.DEV): URL overrides
  //   ?toaster=now    → fire immediately
  //   ?toaster=test   → fire 5s after a storyboard is loaded
  // ------------------------------------------------------------------------
  const FIVE_MIN = 5 * 60 * 1000;
  const TEST_DELAY = 5 * 1000;
  const isDevOrPreview =
    import.meta.env.DEV ||
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
  const toasterOverride = isDevOrPreview
    ? new URL(window.location.href).searchParams.get('toaster')
    : null;

  let toasterFired = false;
  function maybeFireToaster(): void {
    if (toasterFired) return;
    if (isToasterShowing()) return;
    if (state().frames.length === 0) return;
    toasterFired = true;
    showSaveToaster();
  }

  // Apply overrides immediately in dev/preview (without waiting for activity).
  if (toasterOverride === 'now') {
    // Fire as soon as React paints — small delay so the user can see frames first
    // if they're loaded by the bootstrap flow.
    setTimeout(() => {
      toasterFired = true;
      showSaveToaster();
    }, 100);
  } else if (toasterOverride === 'test') {
    // Fire 5s after a storyboard becomes loaded.
    let testTimer: number | null = null;
    const tryStart = () => {
      if (testTimer !== null) return;
      if (state().frames.length === 0) return;
      testTimer = window.setTimeout(() => {
        toasterFired = true;
        showSaveToaster();
      }, TEST_DELAY);
    };
    useStore.subscribe(tryStart);
    tryStart();
  } else {
    // Standard production trigger: 5 min of active use + storyboard loaded.
    onActivityTick((ms) => {
      if (ms >= FIVE_MIN) maybeFireToaster();
    });
    // Also re-evaluate when the storyboard becomes non-empty after the
    // 5-minute mark has already passed.
    useStore.subscribe(() => {
      if (state().frames.length > 0 && getActiveMs() >= FIVE_MIN) {
        maybeFireToaster();
      }
    });
  }

  // Hide view-bar on initial empty state
  const viewBarEl = document.querySelector('.view-bar') as HTMLElement | null;
  if (viewBarEl && !state().frames.length) viewBarEl.style.display = 'none';

  // Startup flow: if empty, show loading line while bootstrap checks for
  // saved work / session.  Only show the Signpost modal if still empty after.
  if (!state().frames.length) {
    const loadingLine = document.getElementById('startupLoadingLine');
    if (loadingLine) loadingLine.classList.remove('hidden');

    bootstrapAccountSystem().then(() => {
      if (loadingLine) loadingLine.classList.add('hidden');
      // Bootstrap already handled the "logged in + no frames" case by
      // opening the project list (and the list's close handler re-opens
      // the Signpost if the user cancels). So we only need the Signpost
      // here for the NOT-logged-in-and-still-empty case.
      // DON'T re-open if a project load is in flight (frames not yet populated).
    }).catch(() => {}).finally(() => {
      if (loadingLine) loadingLine.classList.add('hidden');
      // Auto-open sign-in modal when arriving from landing page with ?signin=1
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('signin') === '1') {
        // Clean the URL so refreshing doesn't re-trigger
        const clean = new URL(window.location.href);
        clean.searchParams.delete('signin');
        window.history.replaceState({}, '', clean.pathname + clean.hash);
        if (!isLoggedIn()) {
          void flowAccountOrSignIn();
          return; // skip new-project modal
        }
      }
      if (!state().frames.length && !isNewProjectModalOpen() && !isLoggedIn()) {
        openNewProjectModal();
      }
    });
  } else {
    // Already have frames (shouldn't happen on fresh load, but be safe)
    void bootstrapAccountSystem();
  }
}
