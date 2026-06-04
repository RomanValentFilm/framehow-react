// Top-level wiring — installs all global event handlers, button click
// handlers, file inputs, and exposes cross-module render hooks via
// window.__fh_* (used to break circular import cycles between render,
// overview, actions, and helpers).

import { state, useStore, isTouch, resetStoryboardState } from '../store/state';
import { renderAll, renderMainFrame, renderVersionFrame } from './render';
import { renderOverview, renderOverviewRow } from './overview';
import { handleAction, handleMainAction } from './actions';
import { setViewMode, autoPhoneMainView, wireScrollHandlers } from './view';
import {
  saveTableFromDOM,
  defaultTableData,
  toggleStar,
  clearAllDrawActive,
  updateFrameBadge,
  tableHTML,
  autoNewVersionIfNeeded,
} from './helpers';
import { snapshotFrame } from './drawing';
import { drawFit } from './drawing';
import { setupDrawing } from './drawing';
import { showToast, showNewProjectModal, isNewProjectModalOpen } from './modals';
import type { NewProjectChoice } from './modals';
import { handlePDF } from './pdf';
import { handleFolderImages, startFromScratch, startPortrait } from './files';
import { openExportModal, openPptxModal, runExport, runPptxExport, runImageExport, openPortraitExportModal, runPortraitExport, openPortraitImageExportModal, runPortraitImageExport } from './exports';
import { wireCameraEvents } from './camera';
import { openFullscreen } from './fullscreen';
import { startHeartbeat } from './tracking';
import {
  bootstrapAccountSystem,
  flowAccountOrSignIn,
  flowLoadProject,
  flowSaveProject,
  isToasterShowing,
  showSaveToaster,
} from './accountFlow';
import { getActiveMs, onActivityTick, startActivityTracking } from './activity';
import { startAutosave, getCurrentProject, clearCurrentProject } from './currentProject';
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
  (window as any).__fh_handleMainAction = handleMainAction;
  (window as any).__fh_handleAction = handleAction;
  (window as any).__fh_clearAllDrawActive = clearAllDrawActive;
  (window as any).__fh_setupDrawing = setupDrawing;

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
  document.addEventListener('input', (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.matches('textarea.frame-text-edit[data-textfid]')) {
      const fid = parseInt(target.dataset.textfid!);
      const f = state().frames.find((fr) => fr.id === fid);
      if (f) f.textContent = (target as HTMLTextAreaElement).value;
    }
    const tbl = target.closest('.frame-table[data-tblfid]') as HTMLElement | null;
    if (tbl) saveTableFromDOM(tbl);
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
  });

  // Star button delegated handler
  document.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('.star-btn') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    const fid = +btn.dataset.starfid!,
      vi = +btn.dataset.starvi!;
    const oldIdx = vi;
    toggleStar(fid, vi);
    const newIdx = state().activeTab[fid];
    renderAll();
    if (oldIdx !== newIdx) {
      const dir = newIdx < oldIdx ? '-20px' : '20px';
      setTimeout(() => {
        const activeVtab =
          (document.querySelector(`.vtab.active[data-fid="${fid}"]`) as HTMLElement | null) ||
          (document.querySelector(`.vtab.active[data-idx="${newIdx}"]`) as HTMLElement | null);
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

  // Fullscreen button delegated handler
  document.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('.fs-btn') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    const fid = +btn.dataset.fsfid!,
      vi = +btn.dataset.fsvi!,
      origin = btn.dataset.fsorigin as 'main' | 'ver';
    openFullscreen(fid, vi, origin);
  });

  // Main Menu dropdown
  document.getElementById('mainMenuBtn')!.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('mainMenu')!.classList.toggle('open');
  });
  document.addEventListener('click', () => document.getElementById('mainMenu')!.classList.remove('open'));
  // ── New Project modal handler ──────────────────────────────────────
  // Centralised handler: opens the New Project modal and acts on the
  // user's choice. The callback pattern (not Promise) preserves the
  // user-gesture chain so file-input .click() works on Safari / iOS.
  function openNewProjectModal(): void {
    showNewProjectModal((choice: NewProjectChoice) => {
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
  document.getElementById('menuNewProject')!.addEventListener('click', async () => {
    document.getElementById('mainMenu')!.classList.remove('open');
    const cp = getCurrentProject();
    if (state().frames.length > 0) {
      if (cp.projectId) {
        try { await flowSaveProject(); } catch { /* best effort */ }
      } else {
        const ok = await import('./modals').then(m => m.showConfirm('Save your current work before starting a new project?'));
        if (ok) {
          await flowSaveProject();
        }
      }
      resetStoryboardState();
      clearCurrentProject();
      renderAll();
      updateFrameBadge();
    }
    // If frames were cleared or already empty, renderAll shows the modal
    // But if renderAll already triggered the modal, we don't double-show
    // (showNewProjectModal guards against double-open)
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
    runImageExport();
  });

  // PDF export modal
  document.getElementById('exportCancel')!.addEventListener('click', () =>
    document.getElementById('exportModal')!.classList.add('hidden')
  );
  document.querySelectorAll('input[name="exportLayout"]').forEach((r) =>
    r.addEventListener('change', () => {
      const layout = (document.querySelector('input[name="exportLayout"]:checked') as HTMLInputElement).value;
      const isOverview = layout === 'overview';
      (document.getElementById('exportTableToggleWrap') as HTMLElement).style.display = isOverview ? 'block' : 'none';
      (document.getElementById('exportVersionPickerWrap') as HTMLElement).style.display = isOverview ? 'block' : 'none';
    })
  );
  document.getElementById('exportGo')!.addEventListener('click', runExport);

  // PPTX export modal
  document.getElementById('pptxCancel')!.addEventListener('click', () =>
    document.getElementById('pptxModal')!.classList.add('hidden')
  );
  document.querySelectorAll('input[name="pptxLayout"]').forEach((r) =>
    r.addEventListener('change', () => {
      const layout = (document.querySelector('input[name="pptxLayout"]:checked') as HTMLInputElement).value;
      const isOverview = layout === 'overview';
      (document.getElementById('pptxTableToggleWrap') as HTMLElement).style.display = isOverview ? 'block' : 'none';
      (document.getElementById('pptxVersionPickerWrap') as HTMLElement).style.display = isOverview ? 'block' : 'none';
    })
  );
  document.getElementById('pptxGo')!.addEventListener('click', runPptxExport);

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
  // Portrait export modal
  document.getElementById('portraitExportCancel')!.addEventListener('click', () =>
    document.getElementById('portraitExportModal')!.classList.add('hidden')
  );
  document.getElementById('portraitExportGo')!.addEventListener('click', runPortraitExport);

  // View mode buttons
  document.querySelectorAll('.view-btn').forEach((b) =>
    b.addEventListener('click', () => {
      const w = window.innerWidth,
        h = window.innerHeight;
      const isPhone = Math.min(w, h) <= 430;
      const isPhonePortrait = isPhone && h > w;
      const view = (b as HTMLElement).dataset.view as string;

      // Left-side buttons: iPad/Desktop only
      if (view === 'group') {
        if (isPhone) {
          showToast('This view is available only on iPad and Desktop');
          return;
        }
        showToast('Coming soon');
        return;
      }
      if (view === '3x2') {
        if (isPhone) {
          showToast('This view is available only on iPad and Desktop');
          return;
        }
        // TODO: wire up 3x2 function
        showToast('Coming soon');
        return;
      }

      if (isPhone && view === 'overview') {
        const om = document.getElementById('overviewPhoneMsg')!;
        om.classList.add('show');
        const dismiss = () => {
          om.classList.remove('show');
          om.removeEventListener('click', dismiss);
        };
        om.addEventListener('click', dismiss, { once: true });
        setTimeout(() => om.classList.remove('show'), 3000);
        return;
      }
      if (isPhonePortrait && view === 'both') {
        setViewMode('both');
        const rm = document.getElementById('rotateMsg')!;
        rm.classList.add('show');
        rm.addEventListener('click', () => rm.classList.remove('show'), { once: true });
        setTimeout(() => rm.classList.remove('show'), 3000);
        return;
      }
      setViewMode(view as any);
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
        if (state().currentViewMode === 'main') s.crossCompare[fid] = s.activeTab[fid];
        renderMainFrame(div, fid);
        const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (vd) renderVersionFrame(vd, fid);
        // toast removed
      } else {
        f.src = (ev.target as FileReader).result as string;
        f.drawMode = false;
        renderMainFrame(div, fid);
        const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (vd) renderVersionFrame(vd, fid);
      }
      if (fromOverview) {
        const ovRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
        if (ovRow) renderOverviewRow(ovRow, fid);
      }
    };
    reader.readAsDataURL(file);
    (e.target as HTMLInputElement).value = '';
    useStore.setState({ mainImgTarget: null });
  });

  document.getElementById('imgInput')!.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    const s = state();
    if (!file || !s.imgTarget) return;
    const { fid, div, fromCompare } = s.imgTarget;
    const reader = new FileReader();
    reader.onload = (ev) => {
      snapshotFrame(fid, 'ver');
      const target = autoNewVersionIfNeeded(fid);
      target.type = 'upload';
      target.bgImage = (ev.target as FileReader).result as string;
      if (fromCompare) {
        state().crossCompare[fid] = state().activeTab[fid];
        renderMainFrame(div, fid);
        const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (vd) renderVersionFrame(vd, fid);
      } else {
        renderVersionFrame(div, fid);
        const nai = state().activeTab[fid];
        const cvs = div.querySelector(`#cvs_${fid}_${nai}`) as HTMLCanvasElement | null;
        if (cvs) drawFit(cvs, (ev.target as FileReader).result as string);
      }
      if (state().currentViewMode === 'overview') {
        const ovRow = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
        if (ovRow) renderOverviewRow(ovRow, fid);
      }
      useStore.setState({ overviewAction: false });
    };
    reader.readAsDataURL(file);
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
              console.log('Framehow update available — reload to apply.');
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
    if (btn) btn.textContent = isLoggedIn() ? 'Account' : 'Sign In';
  }
  refreshAccountMenuLabel();
  subscribeSession(refreshAccountMenuLabel);

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

    bootstrapAccountSystem().catch(() => {}).finally(() => {
      if (loadingLine) loadingLine.classList.add('hidden');
      // If bootstrap didn't restore frames and no modal is already open, show Signpost
      if (!state().frames.length && !isNewProjectModalOpen()) {
        openNewProjectModal();
      }
    });
  } else {
    // Already have frames (shouldn't happen on fresh load, but be safe)
    void bootstrapAccountSystem();
  }
}
