// View modes (main / ver / both / overview), cross-strip swipe, desktop
// nav arrows, sync heights, hide-toolbar-on-scroll, orientation flip.

import { state, useStore, isTouch } from '../store/state';
import type { ViewMode, StripType } from '../store/state';

import { hasVisibleVer, nextVisibleVer, ovCollapseExpanded, clearAllDrawActive, clearReorder, relabelVersions, saveOpenTextEdits, saveOpenTableEdits, _actionAnchorTimers, getStripVersions, getStripActiveTab, setStripActiveTab, getStripCrossCompare, setStripCrossCompare, relabelStripVersions, stripScrollId } from './helpers';
import { fhTrack } from './tracking';
import { resetGrid3x2Zoom } from './overview';
import { cleanupScribble } from './scribble';

let _syncRAF: number | null = null;
// Orientation-flip anchor timers — can be cancelled if user starts scrolling
const _orientAnchorTimers: number[] = [];

/** Return the visible companion (non-main) scroll element. Falls back to versionsScroll. */
function activeCompanionScrollEl(): HTMLElement | null {
  const s = state();
  const companion = s.activeStrips.find((st: string) => st !== 'main') as StripType | undefined;
  if (companion) {
    const el = document.getElementById(stripScrollId(companion));
    if (el) return el;
  }
  return document.getElementById('versionsScroll');
}
export function scheduleSyncHeights(): void {
  if (!_syncRAF) {
    _syncRAF = requestAnimationFrame(() => {
      _syncRAF = null;
      syncCardHeights();
    });
  }
}

/* ── iOS touch-device detection ──
   On iOS Safari/PWA, scrolling hides/shows the URL bar + toolbar, which
   changes window.innerHeight. For portrait (9:16) projects this causes
   visible layout jumps because canvas width is derived from height.
   We detect iOS and standalone (PWA) mode separately to tune behaviour. */
// iPadOS 13+ spoofs "Macintosh" in the UA string, so also check for
// touch-capable Mac (= iPad pretending to be desktop Safari).
const _isIOS = isTouch
  && (/iPad|iPhone/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const _isPWA = !!(window.navigator as any).standalone;   // "Added to Home Screen"

/* Lock innerHeight on first call for iOS Safari portrait projects.
   Prevents jumps when bars hide and a later scheduleSyncHeights re-runs. */
let _lockedIH: number | null = null;
function _getLockedIH(): number {
  if (_lockedIH === null) _lockedIH = window.innerHeight;
  return _lockedIH;
}
/* Reset lock on real orientation change */
function _resetLockedIH(): void { _lockedIH = null; }

export function syncCardHeights(): void {
  const s = state();
  // Gather card lists from all visible strip columns
  const stripScrollIds = [
    { strip: 'main', scrollId: 'mainScroll' },
    { strip: 'ver', scrollId: 'versionsScroll' },
    { strip: 'floor', scrollId: 'floorScroll' },
    { strip: 'refs', scrollId: 'refsScroll' },
  ];
  const activeCardArrays: NodeListOf<Element>[] = [];
  for (const { strip, scrollId } of stripScrollIds) {
    if (!s.activeStrips.includes(strip as any)) continue;
    const el = document.getElementById(scrollId);
    if (!el) continue;
    const cards = el.querySelectorAll('.frame-card');
    activeCardArrays.push(cards);
  }
  // Tags column participates in height sync when visible
  if (s.needsStripVisible) {
    const tagsEl = document.getElementById('needsScroll');
    if (tagsEl) {
      const tagsCards = tagsEl.querySelectorAll('.needs-card');
      if (tagsCards.length) activeCardArrays.push(tagsCards);
    }
  }
  // Notes column participates in height sync when visible
  if (s.notesStripVisible) {
    const notesEl = document.getElementById('notesScroll');
    if (notesEl) {
      const notesCards = notesEl.querySelectorAll('.notes-card');
      if (notesCards.length) activeCardArrays.push(notesCards);
    }
  }
  // Aliases for backward compat in STEP 2 canvas capping
  const mainCards = document.getElementById('mainScroll')?.querySelectorAll('.frame-card') || document.querySelectorAll('#mainScroll .frame-card');
  const verCards = document.getElementById('versionsScroll')?.querySelectorAll('.frame-card') || document.querySelectorAll('#versionsScroll .frame-card');
  const allCards = activeCardArrays.flatMap((nl) => Array.from(nl));

  // STEP 1: Reset all cards to natural height
  allCards.forEach((c) => {
    (c as HTMLElement).style.height = 'auto';
    (c as HTMLElement).style.minHeight = 'auto';
    // Reset needs-body flex override from STEP 2b
    const nb = c.querySelector('.needs-body') as HTMLElement | null;
    if (nb) { nb.style.flex = ''; nb.style.height = ''; }
    delete (c as HTMLElement).dataset.needsBodyH;
    // Reset notes-body flex override from STEP 2b
    const notesB = c.querySelector('.notes-body') as HTMLElement | null;
    if (notesB) { notesB.style.flex = ''; notesB.style.height = ''; }
    delete (c as HTMLElement).dataset.notesBodyH;
  });

  // STEP 2: Measure non-canvas overhead per card and cap the canvas so the
  // full card (label + canvas + buttons) fits on screen without scrolling.
  // Works for both portrait (9:16) and landscape (16:9) projects.
  const toolbar = document.getElementById('mainToolbar');
  const viewBar = document.querySelector('.view-bar');
  const topChrome = (toolbar ? toolbar.getBoundingClientRect().height : 0)
                  + (viewBar ? viewBar.getBoundingClientRect().height : 0);
  // Touch devices: 90% (toolbar scrolls away). Desktop: 85%.
  const factor = isTouch ? 0.9 : 0.85;
  // iOS Safari + portrait: use locked innerHeight so bar toggling can't cause jumps.
  // Everything else (landscape, desktop, PWA): use live innerHeight.
  const vh = (_isIOS && !_isPWA && s.portraitMode) ? _getLockedIH() : window.innerHeight;
  const target = Math.floor((vh - topChrome) * factor);

  // Portrait: always cap (canvas is taller than wide, overflows everywhere).
  // Landscape: only cap in desktop MAIN view (full-width column causes overflow;
  //            TWIN/VRSN/GRID columns are narrow enough to self-constrain).
  const capLandscape = !s.portraitMode && !isTouch && s.activeStrips.length === 1;

  if (s.portraitMode || capLandscape) {
    allCards.forEach((card) => {
      const wrap = card.querySelector('.canvas-wrap') as HTMLElement;
      if (!wrap) return;
      // Hide canvas so card height = pure overhead (label + buttons + padding)
      wrap.style.display = 'none';
      void (card as HTMLElement).offsetHeight;
      const overhead = card.getBoundingClientRect().height;
      wrap.style.display = '';
      const avail = Math.max(80, target - overhead);
      if (s.portraitMode && isTouch) {
        // Portrait TOUCH on iOS — per-device size tuning.
        // "avail" = viewport minus toolbars minus card overhead × 90%.
        // Multipliers tuned by user testing on real devices:
        const isPhone = Math.min(window.innerWidth, window.innerHeight) <= 430;
        let ph = avail;
        if (_isIOS) {
          if (_isPWA) {
            ph = Math.floor(avail * (isPhone ? 1.03 : 1.06));  // PWA iPhone +3%, iPad +6%
          } else {
            ph = Math.floor(avail * (isPhone ? 1.28 : 1.12));  // Safari iPhone +28%, iPad +12%
          }
        }
        wrap.style.setProperty('--ph', ph + 'px');
        wrap.style.maxWidth = '';
        wrap.style.maxHeight = '';
      } else if (s.portraitMode) {
        // Portrait DESKTOP: height-first (fit card on screen)
        wrap.style.setProperty('--ph', avail + 'px');
        wrap.style.maxWidth = '';
        wrap.style.maxHeight = '';
      } else {
        // Landscape desktop MAIN: cap width (derived from height × aspect ratio)
        // so that aspect-ratio naturally produces the right height.
        const ar = wrap.style.aspectRatio || '16 / 9';
        const parts = ar.split('/').map(Number);
        const aspect = (parts[0] || 16) / (parts[1] || 9);
        wrap.style.maxWidth = Math.floor(avail * aspect) + 'px';
        wrap.style.margin = '0 auto';
        wrap.style.maxHeight = '';
      }
    });
  } else {
    // Multi-strip landscape: clear any stale caps from a previous single-strip view
    allCards.forEach((card) => {
      const wrap = card.querySelector('.canvas-wrap') as HTMLElement;
      if (wrap) { wrap.style.maxHeight = ''; wrap.style.maxWidth = ''; }
    });
  }

  // STEP 2b: Pre-cap needs-body height to match canvas bottom BEFORE height sync.
  // Without this, unconstrained needs content drives the max row height.
  void document.body.offsetHeight; // force layout after canvas cap
  if (s.needsStripVisible) {
    const needsEl = document.getElementById('needsScroll');
    if (needsEl) {
      const needsCards = needsEl.querySelectorAll('.needs-card');
      // Find a reference strip that has canvas-wraps
      let refCards: NodeListOf<Element> | null = null;
      for (const { strip, scrollId } of stripScrollIds) {
        if (!s.activeStrips.includes(strip as any)) continue;
        const el = document.getElementById(scrollId);
        if (!el) continue;
        const cards = el.querySelectorAll('.frame-card');
        if (cards.length && cards[0].querySelector('.canvas-wrap')) {
          refCards = cards;
          break;
        }
      }
      if (refCards) {
        const count = Math.min(needsCards.length, refCards.length);
        for (let i = 0; i < count; i++) {
          const refCard = refCards[i] as HTMLElement;
          const needsCard = needsCards[i] as HTMLElement;
          const wrap = refCard.querySelector('.canvas-wrap') as HTMLElement;
          const needsBody = needsCard.querySelector('.needs-body') as HTMLElement;
          if (!wrap || !needsBody) continue;

          // Canvas bottom offset from card top
          const cardRect = refCard.getBoundingClientRect();
          const wrapRect = wrap.getBoundingClientRect();
          const canvasBottomFromCardTop = wrapRect.bottom - cardRect.top;

          // Needs card top overhead (header + tabs)
          const needsCardRect = needsCard.getBoundingClientRect();
          const needsBodyRect = needsBody.getBoundingClientRect();
          const topOverhead = needsBodyRect.top - needsCardRect.top;

          // Set needs-body height so its bottom edge aligns with canvas bottom.
          // Store on card so renderNeedsCard can re-apply after re-render.
          const targetHeight = Math.max(50, canvasBottomFromCardTop - topOverhead);
          needsBody.style.flex = 'none';
          needsBody.style.height = targetHeight + 'px';
          needsCard.dataset.needsBodyH = String(Math.round(targetHeight));

          // Match needs-setup-pill height to the MAIN strip's setup-tag pill.
          const needsPill = needsCard.querySelector('.needs-setup-pill') as HTMLElement | null;
          if (needsPill) {
            const mainScroll = document.getElementById('mainScroll');
            const mainCard = mainScroll?.querySelectorAll('.frame-card')[i] as HTMLElement | undefined;
            const mainPill = mainCard?.querySelector('.setup-tag') as HTMLElement | null;
            if (mainPill) {
              const pillH = mainPill.getBoundingClientRect().height;
              needsPill.style.height = pillH + 'px';
              needsCard.dataset.needsPillH = String(pillH);
            }
          }
        }
      }
    }
  }

  // STEP 2c: Pre-cap notes-body height to match canvas bottom (mirrors STEP 2b for needs).
  if (s.notesStripVisible) {
    const notesEl = document.getElementById('notesScroll');
    if (notesEl) {
      const notesCards = notesEl.querySelectorAll('.notes-card');
      let refCards: NodeListOf<Element> | null = null;
      for (const { strip, scrollId } of stripScrollIds) {
        if (!s.activeStrips.includes(strip as any)) continue;
        const el = document.getElementById(scrollId);
        if (!el) continue;
        const cards = el.querySelectorAll('.frame-card');
        if (cards.length && cards[0].querySelector('.canvas-wrap')) {
          refCards = cards;
          break;
        }
      }
      if (refCards) {
        const count = Math.min(notesCards.length, refCards.length);
        for (let i = 0; i < count; i++) {
          const refCard = refCards[i] as HTMLElement;
          const notesCard = notesCards[i] as HTMLElement;
          const wrap = refCard.querySelector('.canvas-wrap') as HTMLElement;
          const notesBody = notesCard.querySelector('.notes-body') as HTMLElement;
          if (!wrap || !notesBody) continue;
          const cardRect = refCard.getBoundingClientRect();
          const wrapRect = wrap.getBoundingClientRect();
          const canvasBottomFromCardTop = wrapRect.bottom - cardRect.top;
          const notesCardRect = notesCard.getBoundingClientRect();
          const notesBodyRect = notesBody.getBoundingClientRect();
          const topOverhead = notesBodyRect.top - notesCardRect.top;
          const targetHeight = Math.max(50, canvasBottomFromCardTop - topOverhead);
          notesBody.style.flex = 'none';
          notesBody.style.height = targetHeight + 'px';
          notesCard.dataset.notesBodyH = String(Math.round(targetHeight));
        }
      }
    }
  }

  // STEP 3: Force layout, then sync card heights across all active strip columns
  void document.body.offsetHeight;
  if (activeCardArrays.length > 1) {
    const rowCount = Math.max(...activeCardArrays.map((a) => a.length));
    for (let i = 0; i < rowCount; i++) {
      let max = 0;
      for (const cards of activeCardArrays) {
        if (i < cards.length) {
          max = Math.max(max, Math.ceil(cards[i].getBoundingClientRect().height));
        }
      }
      for (const cards of activeCardArrays) {
        if (i < cards.length) {
          (cards[i] as HTMLElement).style.height = max + 'px';
          (cards[i] as HTMLElement).style.minHeight = max + 'px';
        }
      }
    }
  }

  allCards.forEach((card) => {
    const wrap = card.querySelector('.canvas-wrap');
    if (!wrap) return;
    const parent = wrap.parentElement;
    if (!parent) return;
    const pRect = parent.getBoundingClientRect();
    const wRect = wrap.getBoundingClientRect();
    const center = wRect.top + wRect.height / 2 - pRect.top;
    (card as HTMLElement).style.setProperty('--connector-top', Math.round(center * 100) / 100 + 'px');
    card.querySelectorAll('img').forEach((img) => {
      if (!(img as HTMLImageElement).complete && !(img as HTMLImageElement).dataset.syncBound) {
        (img as HTMLImageElement).dataset.syncBound = '1';
        img.addEventListener('load', scheduleSyncHeights, { once: true });
        img.addEventListener('error', scheduleSyncHeights, { once: true });
      }
    });
  });

  // iPhone: truncate labels after layout sync
  _truncatePhoneLabels();
}

/** On iPhone: truncate frame labels — keep identifier, show only first 3 chars of extra text.
 *  e.g. "1A OPTIONAL" → "1A OPT". Runs after every render/sync.
 *  Handles plain labels and combo labels (NEEDS/NOTES with child <span>). */
function _truncatePhoneLabels(): void {
  const w = window.innerWidth, h = window.innerHeight;
  if (Math.min(w, h) > 430) return; // not iPhone
  document.querySelectorAll('.frame-label-tag').forEach((el) => {
    const htm = el as HTMLElement;
    // Find the text node to truncate — either the first text node (combo labels) or the only one
    let targetNode: Text | null = null;
    for (let i = 0; i < htm.childNodes.length; i++) {
      if (htm.childNodes[i].nodeType === Node.TEXT_NODE && (htm.childNodes[i].textContent || '').trim()) {
        targetNode = htm.childNodes[i] as Text;
        break;
      }
    }
    if (!targetNode) return;
    const text = targetNode.textContent || '';
    // Store full text on first pass
    if (!htm.dataset.fullLabel && text) htm.dataset.fullLabel = text;
    const full = htm.dataset.fullLabel || text;
    if (!full) return;
    const spaceIdx = full.indexOf(' ');
    if (spaceIdx < 0) return; // no extra text
    const rest = full.substring(spaceIdx + 1);
    if (rest.length <= 3) return; // already short
    targetNode.textContent = full.substring(0, spaceIdx + 1) + rest.substring(0, 3);
  });
}

export function _updateCenterFid(): void {
  const s = state();
  const scrollEl =
    s.currentViewMode === 'overview' || s.currentViewMode === 'grid4' || s.currentViewMode === 'grid3x2'
      ? document.getElementById('overviewScroll')
      : s.currentViewMode === 'ver'
      ? activeCompanionScrollEl()
      : document.getElementById('mainScroll');
  if (!scrollEl || !s.frames.length) return;
  const sel = s.currentViewMode === 'grid3x2' ? '.grid3x2-card-wrap'
    : s.currentViewMode === 'overview' || s.currentViewMode === 'grid4' ? '.overview-row' : '.frame-card';
  const cards = scrollEl.querySelectorAll(sel);
  const screenMid = window.innerHeight / 2;
  let best: HTMLElement | null = null,
    bestDist = Infinity;
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const d = Math.abs(mid - screenMid);
    if (d < bestDist) {
      bestDist = d;
      best = card as HTMLElement;
    }
  }
  if (best) useStore.setState({ centerFid: best.dataset.g3fid || best.dataset.ofid || best.dataset.mfid || best.dataset.vfid || null });
}

export function scrollAnchorTo(fid: string | number | null): void {
  if (!fid) return;
  const s = state();
  let target: HTMLElement | null = null;
  if (s.currentViewMode === 'grid3x2')
    target = document.querySelector(`#overviewScroll .grid3x2-card-wrap[data-g3fid="${fid}"]`) as HTMLElement | null;
  else if (s.currentViewMode === 'overview' || s.currentViewMode === 'grid4')
    target = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
  else if (s.currentViewMode === 'ver') {
    const scrollEl = activeCompanionScrollEl();
    target = scrollEl ? scrollEl.querySelector(`.frame-card[data-vfid="${fid}"]`) as HTMLElement | null : null;
  }
  else target = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
}

export function setViewMode(mode: ViewMode, keepCompare?: boolean, forceAnchorFid?: string | null): void {
  fhTrack('view_' + mode);
  const s = state();
  // Reset pinch-zoom when leaving 3x2 grid view
  if (s.currentViewMode === 'grid3x2' && mode !== 'grid3x2') { resetGrid3x2Zoom(); cleanupScribble(); }
  ovCollapseExpanded();
  for (const k in s.drawActive) {
    if (s.drawActive[+k]) s.drawEraser[+k] = false;
  }
  clearAllDrawActive();

  let anchorFid: string | null = forceAnchorFid || null;
  if (!anchorFid) {
    const visibleScroll =
      s.currentViewMode === 'overview' || s.currentViewMode === 'grid4' || s.currentViewMode === 'grid3x2'
        ? document.getElementById('overviewScroll')
        : s.currentViewMode === 'ver'
        ? activeCompanionScrollEl()
        : document.getElementById('mainScroll');
    if (visibleScroll) {
      const cards =
        s.currentViewMode === 'overview' || s.currentViewMode === 'grid4'
          ? visibleScroll.querySelectorAll('.overview-row')
          : s.currentViewMode === 'grid3x2'
          ? visibleScroll.querySelectorAll('.grid3x2-card-wrap')
          : visibleScroll.querySelectorAll('.frame-card');
      let anchorCard: HTMLElement | null = null;
      const screenMid = window.innerHeight / 2;
      let bestDist = Infinity;
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const cardMid = rect.top + rect.height / 2;
        const dist = Math.abs(cardMid - screenMid);
        if (dist < bestDist) {
          bestDist = dist;
          anchorCard = card as HTMLElement;
        }
      }
      anchorFid = anchorCard ? (anchorCard.dataset.ofid || anchorCard.dataset.g3fid || anchorCard.dataset.mfid || anchorCard.dataset.vfid || null) : null;
    }
  }

  useStore.setState({ currentViewMode: mode });
  // Toggle body class so phone CSS can hide detail bar in 3×2
  document.body.classList.toggle('view-grid3x2', mode === 'grid3x2');
  // Show/hide OFF button for 1+2V / GRID4 modes
  const offBtn = document.getElementById('vbOffBtn') as HTMLElement | null;
  if (offBtn) offBtn.style.display = (mode === 'overview' || mode === 'grid4') ? '' : 'none';
  if (!keepCompare) {
    const affected = Object.keys(s.crossCompare).filter((k) => (s.crossCompare[+k] ?? -1) >= 0);
    affected.forEach((fid) => {
      const idx = s.crossCompare[+fid];
      if (idx >= 0 && s.versions[+fid] && idx < s.versions[+fid].length) s.activeTab[+fid] = idx;
    });
    useStore.setState({ crossCompare: {} });
    affected.forEach((fid) => {
      const md = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
      const renderMain = (window as any).__fh_renderMainFrame;
      if (md && renderMain) renderMain(md, +fid);
      const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      const renderVer = (window as any).__fh_renderVersionFrame;
      if (vd && renderVer) renderVer(vd, +fid);
    });
  }
  const columnsEl = document.querySelector('.columns')!;
  columnsEl.classList.remove('view-overview', 'view-grid4', 'view-grid3x2', 'strips-1', 'strips-2', 'strips-3', 'strips-4', 'strips-5');
  if (mode === 'overview') columnsEl.classList.add('view-overview');
  else if (mode === 'grid4') columnsEl.classList.add('view-grid4');
  else if (mode === 'grid3x2') columnsEl.classList.add('view-grid3x2');
  else {
    const totalCols = state().activeStrips.length + (state().needsStripVisible ? 1 : 0);
    columnsEl.classList.add(`strips-${totalCols}`);
  }
  document.querySelectorAll('.view-btn:not(.strip-toggle)').forEach((b) => {
    const bv = (b as HTMLElement).dataset.view;
    if (bv === 'detail') return; // managed by detail toggle, not view mode
    if (bv === 'needs') {
      b.classList.toggle('active', state().needsStripVisible);
    } else {
      b.classList.toggle('active', bv === mode || (bv === '3x2' && mode === 'grid3x2'));
    }
  });
  document.querySelectorAll('.strip-toggle').forEach((b) => {
    const strip = (b as HTMLElement).dataset.strip as string;
    const isGridMode = mode === 'grid3x2';
    b.classList.toggle('active', !isGridMode && state().activeStrips.includes(strip as any));
  });

  // Sync column visibility when entering strip modes (after exiting grid)
  if (mode !== 'overview' && mode !== 'grid4' && mode !== 'grid3x2') {
    const strips = state().activeStrips;
    const mc = document.getElementById('mainCol');
    const vc = document.getElementById('verCol');
    const fc = document.getElementById('floorCol');
    const rc = document.getElementById('refsCol');
    if (mc) mc.style.display = strips.includes('main') ? '' : 'none';
    if (vc) vc.style.display = strips.includes('ver' as any) ? '' : 'none';
    if (fc) fc.style.display = strips.includes('floor' as any) ? '' : 'none';
    if (rc) rc.style.display = strips.includes('refs' as any) ? '' : 'none';
    const tc = document.getElementById('needsCol');
    if (tc) tc.style.display = state().needsStripVisible ? '' : 'none';
  }

  if (mode === 'overview' || mode === 'grid4' || mode === 'grid3x2') {
    const fn = mode === 'grid4'
      ? (window as any).__fh_renderGrid4
      : mode === 'grid3x2'
      ? (window as any).__fh_renderGrid3x2
      : (window as any).__fh_renderOverview;
    if (fn) fn();
  } else {
    document.getElementById('overviewScroll')!.innerHTML = '';
    document.querySelectorAll('.frame-card[data-mfid]').forEach((div) => {
      const fn = (window as any).__fh_renderMainFrame;
      if (fn) fn(div, parseInt((div as HTMLElement).dataset.mfid!));
    });
    // Re-render version cards per scroll container with the correct strip type
    const renderVer = (window as any).__fh_renderVersionFrame;
    if (renderVer) {
      (['ver', 'floor', 'refs'] as const).forEach((strip) => {
        const scrollId = strip === 'ver' ? 'versionsScroll' : strip + 'Scroll';
        const scrollEl = document.getElementById(scrollId);
        if (scrollEl) scrollEl.querySelectorAll('.frame-card[data-vfid]').forEach((div) => {
          renderVer(div, parseInt((div as HTMLElement).dataset.vfid!), strip);
        });
      });
    }
  }
  if (mode !== 'overview' && mode !== 'grid4' && mode !== 'grid3x2') syncCardHeights();
  else _truncatePhoneLabels(); // overview/grid views skip syncCardHeights but still need label truncation

  if (anchorFid) {
    void (columnsEl as HTMLElement).offsetHeight;
    scrollAnchorTo(anchorFid);
  }

  if (mode === 'main') setTimeout(showSwipeHint, 2000);
}

export function autoPhoneMainView(): void {
  const s = state();
  // Never override view while the user is in SORT BY mode
  if (s.sortMode) return;
  const w = window.innerWidth,
    h = window.innerHeight;
  const isPhone = Math.min(w, h) <= 430;
  if (isPhone && h > w) {
    // iPhone portrait: single strip MAIN view
    if (s.currentViewMode !== 'main') {
      useStore.setState({ activeStrips: ['main'], currentViewMode: 'main' });
      setViewMode('main');
    }
  } else if (!s.portraitMode) {
    // Landscape project: default to 3x2 grid view
    if (s.currentViewMode !== 'grid3x2') setViewMode('grid3x2');
  }
}

export function showSwipeHint(): void {
  if (!isTouch) return;
  if (state().swipeHintShown) return;
  const hint = document.getElementById('swipeHint');
  if (!hint) return;
  useStore.setState({ swipeHintShown: true });
  hint.classList.add('show');
  const dismiss = (e?: Event) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    hint.style.transition = 'none';
    hint.classList.remove('show');
    // Restore CSS transition after instant hide
    requestAnimationFrame(() => { hint.style.transition = ''; });
  };
  hint.addEventListener('click', dismiss, { once: true });
  hint.addEventListener('touchstart', dismiss, { once: true });
  hint.addEventListener('touchmove', dismiss, { once: true });
  setTimeout(() => {
    hint.classList.remove('show');
  }, 3000);
}

// Ordered list of cross-swipeable companion strips
const CROSS_STRIP_ORDER: StripType[] = ['ver', 'floor', 'refs'];

/** Return the next/prev strip that has at least 1 version for this frame. */
function adjacentCrossStrip(fid: number, currentStrip: StripType, dir: 'next' | 'prev'): StripType | null {
  const idx = CROSS_STRIP_ORDER.indexOf(currentStrip);
  if (idx < 0) return null;
  const step = dir === 'next' ? 1 : -1;
  for (let i = idx + step; i >= 0 && i < CROSS_STRIP_ORDER.length; i += step) {
    const candidate = CROSS_STRIP_ORDER[i];
    if (getStripVersions(fid, candidate).length > 0) return candidate;
  }
  return null;
}

export function navigateStrip(fid: number, fromStrip: StripType, dir: 'left' | 'right'): void {
  saveOpenTextEdits();
  saveOpenTableEdits();
  const s = state();
  const cur = fromStrip === 'main' ? (s.crossCompare[fid] ?? -1) : (getStripCrossCompare(fid, fromStrip) ?? -1);
  const ccStrip = s.crossCompareStrip[fid] || 'ver';
  const numVer = getStripVersions(fid, fromStrip === 'main' ? ccStrip : fromStrip).length;
  const renderMain = (window as any).__fh_renderMainFrame;
  const renderVer = (window as any).__fh_renderVersionFrame;
  const scrollId = fromStrip === 'main' ? 'mainScroll' : stripScrollId(fromStrip);

  // Multi-column mode: navigate within the strip's versions
  if (s.activeStrips.length > 1 && fromStrip !== 'main') {
    const ai = getStripActiveTab(fid, fromStrip);
    if (dir === 'left' && ai > 0) {
      clearAllDrawActive();
      setStripActiveTab(fid, fromStrip, ai - 1);
      useStore.setState({ swipeHighlightFid: fid });
      const div = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      if (div && renderVer) renderVer(div, fid, fromStrip);
    } else if (dir === 'right' && ai < numVer - 1) {
      clearAllDrawActive();
      setStripActiveTab(fid, fromStrip, ai + 1);
      useStore.setState({ swipeHighlightFid: fid });
      const div = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      if (div && renderVer) renderVer(div, fid, fromStrip);
    }
    requestAnimationFrame(() => scrollAnchorTo(fid));
    return;
  }
  // Single-column main: cross-compare swipe across strips
  if (fromStrip === 'main' && s.currentViewMode === 'main') {
    if (dir === 'right') {
      const nxt = cur + 1;
      if (nxt < numVer) {
        // Navigate within current strip
        s.crossCompare[fid] = nxt;
        s.activeTab[fid] = nxt;
        useStore.setState({ swipeHighlightFid: fid });
        const div = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
        if (div && renderMain) renderMain(div, fid);
      } else {
        // End of current strip — jump to next strip's first version
        const nextStrip = adjacentCrossStrip(fid, ccStrip, 'next');
        if (nextStrip) {
          s.crossCompareStrip[fid] = nextStrip;
          s.crossCompare[fid] = 0;
          s.activeTab[fid] = 0;
          useStore.setState({ swipeHighlightFid: fid });
          const div = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
          if (div && renderMain) renderMain(div, fid);
        }
      }
    } else if (dir === 'left' && cur >= 0) {
      const prv = cur - 1;
      if (prv >= 0) {
        // Navigate within current strip
        s.crossCompare[fid] = prv;
        s.activeTab[fid] = prv;
      } else {
        // At first version of current strip — jump to previous strip's last version, or back to main
        const prevStrip = adjacentCrossStrip(fid, ccStrip, 'prev');
        if (prevStrip) {
          const prevLen = getStripVersions(fid, prevStrip).length;
          s.crossCompareStrip[fid] = prevStrip;
          s.crossCompare[fid] = prevLen - 1;
          s.activeTab[fid] = prevLen - 1;
        } else {
          // Back to main frame (no previous strip)
          s.crossCompare[fid] = -1;
          s.crossCompareStrip[fid] = 'ver';
        }
      }
      useStore.setState({ swipeHighlightFid: fid });
      const div = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
      if (div && renderMain) renderMain(div, fid);
    }
  } else if (fromStrip !== 'main' && s.currentViewMode === 'ver') {
    // Single-column version strip: cross-compare swipe to show main inline
    if (cur >= 0) {
      if (dir === 'right') {
        setStripCrossCompare(fid, fromStrip, -1);
        useStore.setState({ swipeHighlightFid: fid });
        const div = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (div && renderVer) renderVer(div, fid, fromStrip);
      }
    } else {
      const ai = getStripActiveTab(fid, fromStrip);
      if (dir === 'left') {
        if (ai > 0) {
          clearAllDrawActive();
          setStripActiveTab(fid, fromStrip, ai - 1);
          useStore.setState({ swipeHighlightFid: fid });
          const div = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (div && renderVer) renderVer(div, fid, fromStrip);
        } else if (fromStrip === 'ver') {
          // Cross-compare into main only for ver strip (at ai=0)
          s.crossCompare[fid] = 0;
          useStore.setState({ swipeHighlightFid: fid });
          const div = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (div && renderVer) renderVer(div, fid, fromStrip);
        }
      } else if (dir === 'right' && ai < numVer - 1) {
        clearAllDrawActive();
        setStripActiveTab(fid, fromStrip, ai + 1);
        useStore.setState({ swipeHighlightFid: fid });
        const div = document.querySelector(`#${scrollId} .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (div && renderVer) renderVer(div, fid, fromStrip);
      }
    }
  }
  requestAnimationFrame(() => scrollAnchorTo(fid));
}

export function addNavArrows(wrapEl: HTMLElement, fid: number, fromStrip: StripType): void {
  const s = state();
  if (s.activeStrips.length > 1 && fromStrip === 'main') return;
  const ccStrip = s.crossCompareStrip[fid] || 'ver';
  const strip = fromStrip === 'main' ? ccStrip : fromStrip;
  const numVer = getStripVersions(fid, strip).length;
  const cur = fromStrip === 'main' ? (s.crossCompare[fid] ?? -1) : (getStripCrossCompare(fid, strip) ?? -1);
  let showLeft = false,
    showRight = false;
  if (fromStrip === 'main') {
    // Can go right if more versions in current strip OR if there's a next strip
    showRight = (cur + 1 < numVer) || !!adjacentCrossStrip(fid, ccStrip, 'next');
    // Can go left if we're in a cross-compare state
    showLeft = cur >= 0;
  } else if (s.activeStrips.length > 1) {
    const ai = getStripActiveTab(fid, strip);
    showLeft = ai > 0;
    showRight = ai < numVer - 1;
  } else {
    if (cur >= 0) {
      showRight = true;
      showLeft = false;
    } else {
      const ai = getStripActiveTab(fid, strip);
      showLeft = ai > 0 || fromStrip === 'ver'; // ver: cross-compare to main at ai=0; others: just version nav
      showRight = ai < numVer - 1;
    }
  }
  if (!showLeft && !showRight) return;
  const leftHTML = showLeft ? '<button class="nav-arrow nav-arrow-left" data-navdir="left">‹</button>' : '';
  const rightHTML = showRight ? '<button class="nav-arrow nav-arrow-right" data-navdir="right">›</button>' : '';
  wrapEl.insertAdjacentHTML('beforeend', leftHTML + rightHTML);
  wrapEl.querySelectorAll('.nav-arrow').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dir = (btn as HTMLElement).dataset.navdir as 'left' | 'right';
      navigateStrip(fid, fromStrip, dir);
    })
  );
}

export function addCrossSwipe(el: HTMLElement, fid: number, fromStrip: StripType): void {
  if (!isTouch) return;
  let sx = 0,
    sy = 0;
  el.addEventListener(
    'touchstart',
    (e) => {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    },
    { passive: true }
  );
  el.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
      const s = state();
      if (s.currentViewMode !== 'main' && s.currentViewMode !== 'ver') return;
      if (s.reorderFid !== null) return;
      const cur = s.crossCompare[fid] ?? -1;
      const renderMain = (window as any).__fh_renderMainFrame;
      const renderVer = (window as any).__fh_renderVersionFrame;
      if (fromStrip === 'main' && s.currentViewMode === 'main') {
        const ccStrip = (s.crossCompareStrip[fid] || 'ver') as StripType;
        if (s.verReorderFid === fid && s.verReorderStrip === ccStrip && cur >= 0) {
          const tabs = getStripVersions(fid, ccStrip),
            ai = cur;
          if (dx < 0 && ai > 0) {
            [tabs[ai - 1], tabs[ai]] = [tabs[ai], tabs[ai - 1]];
            s.crossCompare[fid] = ai - 1;
            s.activeTab[fid] = ai - 1;
          } else if (dx > 0 && ai < tabs.length - 1) {
            [tabs[ai], tabs[ai + 1]] = [tabs[ai + 1], tabs[ai]];
            s.crossCompare[fid] = ai + 1;
            s.activeTab[fid] = ai + 1;
          } else return;
          relabelStripVersions(fid, ccStrip);
          const div = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
          if (div && renderMain) renderMain(div, fid);
          const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (vd && renderVer) renderVer(vd, fid);
          return;
        }
        // Delegate to navigateStrip for cross-strip continuation
        const dir = dx < 0 ? 'right' : 'left';
        navigateStrip(fid, fromStrip, dir);
      } else if (fromStrip === 'ver' && s.currentViewMode === 'ver') {
        // Ver strip cross-compare to main (swipe right to show main inline)
        if (dx > 0 && cur < 0) {
          s.crossCompare[fid] = 0;
          const div = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (div && renderVer) renderVer(div, fid);
          requestAnimationFrame(() => scrollAnchorTo(fid));
        } else if (dx < 0 && cur >= 0) {
          s.crossCompare[fid] = -1;
          const div = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (div && renderVer) renderVer(div, fid);
          requestAnimationFrame(() => scrollAnchorTo(fid));
        }
      }
      // Floor/refs strips don't do main-inline cross-compare
    },
    { passive: true }
  );
}

export function resetToolbarState(): void {
  const isPhone = Math.min(window.innerWidth, window.innerHeight) <= 430;
  if (isPhone) return; // iPhone: toolbar scrolls naturally via CSS, no JS needed
  // Respect scrollHideGuard — don't touch bars during guarded period
  if (Date.now() < state().scrollHideGuard) return;

  const toolbar = document.getElementById('mainToolbar');
  const viewBar = document.querySelector('.view-bar');
  const detailBar = document.getElementById('detailBar');

  // Clear everything
  if (toolbar) toolbar.classList.remove('tb-hide');
  if (viewBar) viewBar.classList.remove('tb-hide');
  if (detailBar) detailBar.classList.remove('tb-hide');

  const shouldHide = window.scrollY > 10;
  if (shouldHide) {
    // iPad: hide all bars
    if (toolbar) toolbar.classList.add('tb-hide');
    if (viewBar) viewBar.classList.add('tb-hide');
    if (detailBar) detailBar.classList.add('tb-hide');
  }

  if ((window as any)._scrollHideReset) (window as any)._scrollHideReset(shouldHide);
}

export function handleOrientationFlip(): void {
  const newW = window.innerWidth,
    newH = window.innerHeight;
  const lastW = (window as any)._lastWinW || newW;
  const lastH = (window as any)._lastWinH || newH;
  const wasLandscape = lastW > lastH,
    nowLandscape = newW > newH;
  const flipped = wasLandscape !== nowLandscape;
  (window as any)._lastWinW = newW;
  (window as any)._lastWinH = newH;

  document.getElementById('rotateMsg')!.classList.remove('show');
  const g3Overlay = document.getElementById('g3RotateMsg');
  // Only auto-dismiss g3RotateMsg if rotating back to landscape (not during portrait resize events)
  if (g3Overlay && nowLandscape) g3Overlay.classList.remove('show');
  if (!flipped) return;

  // Block scroll handler during the entire orientation transition.
  // Don't touch toolbar state now — scrollY is unreliable during resize.
  // Leave it as-is and do one clean reset after layout settles.
  useStore.setState({ scrollHideGuard: Date.now() + 1500 });

  // Use centerFid captured BEFORE the layout started shifting
  // (set by _updateCenterFid() in the resize/orientationchange handler)
  const fid = state().centerFid;
  const isPhone = Math.min(newW, newH) <= 430;
  const isPhonePortrait = isPhone && newH > newW;
  if (isPhonePortrait) {
    // iPhone portrait: always MAIN single strip (including 3x2 exit)
    useStore.setState({ activeStrips: ['main'], currentViewMode: 'main', crossCompare: {}, needsStripVisible: false, notesStripVisible: false });
    // Also update the NEEDS/NOTES button visuals
    const needsBtn = document.getElementById('needsStripBtn');
    if (needsBtn) needsBtn.classList.remove('active');
    const notesBtn = document.getElementById('notesStripBtn');
    if (notesBtn) notesBtn.classList.remove('active');
    // Keep detail bar active on phone (CSS manages visibility)
    document.body.classList.add('detail-open');
    const detailBtnEl = document.getElementById('detailBtn');
    if (detailBtnEl) detailBtnEl.classList.add('active');
    const renderAll = (window as any).__fh_renderAll;
    if (renderAll) renderAll();
  } else if (isPhone && newW > newH) {
    // iPhone landscape: enforce max 2 total columns (activeStrips + NEEDS + NOTES)
    const s = state();
    const totalVisible = s.activeStrips.length + (s.needsStripVisible ? 1 : 0) + (s.notesStripVisible ? 1 : 0);
    if (totalVisible > 2) {
      const specialCount = (s.needsStripVisible ? 1 : 0) + (s.notesStripVisible ? 1 : 0);
      const visualOrder: Record<string, number> = { main: 0, ver: 1, floor: 2, refs: 3 };
      const sorted = [...s.activeStrips].sort((a, b) => (visualOrder[a] ?? 9) - (visualOrder[b] ?? 9));
      const stripMax = Math.max(1, 2 - specialCount);
      useStore.setState({ activeStrips: sorted.slice(0, stripMax) });
    }
    // Keep detail bar active on phone (CSS manages visibility, hides in 3×2)
    document.body.classList.add('detail-open');
    const detailBtnLand = document.getElementById('detailBtn');
    if (detailBtnLand) detailBtnLand.classList.add('active');
  } else if (!isPhone && newH > newW && state().currentViewMode === 'grid3x2') {
    // iPad/tablet rotated to portrait while in 3x2:
    // Remember we came from 3x2 so rotating back restores it
    (window as any)._returnTo3x2 = true;
    // 1. Switch to MAIN+VERSN immediately (3x2 disappears)
    useStore.setState({ activeStrips: ['main', 'ver'] as any, currentViewMode: 'both', crossCompare: {} });
    // 2. Force detail bar visible with display + class + button
    const detailBar = document.getElementById('detailBar');
    if (detailBar) detailBar.style.display = '';
    document.body.classList.add('detail-open');
    const detailBtnEl = document.getElementById('detailBtn');
    if (detailBtnEl) detailBtnEl.classList.add('active');
    // 3. Render strips and set view mode (activates MAIN+VERSN toggle buttons)
    const renderAll = (window as any).__fh_renderAll;
    if (renderAll) renderAll();
    setViewMode('both');
    // 4. Force all bars visible — remove tb-hide AND reset scroll handler's hidden flag
    const toolbar = document.getElementById('mainToolbar');
    const viewBar = document.querySelector('.view-bar');
    if (toolbar) toolbar.classList.remove('tb-hide');
    if (viewBar) (viewBar as HTMLElement).classList.remove('tb-hide');
    if (detailBar) detailBar.classList.remove('tb-hide');
    if ((window as any)._scrollHideReset) (window as any)._scrollHideReset(false);
    useStore.setState({ scrollHideGuard: Date.now() + 2000 });
    // Scroll to top so bars stay visible naturally after guard expires
    window.scrollTo(0, 0);
    // 5. Show rotate overlay on top — user taps to dismiss
    const g3Msg = document.getElementById('g3RotateMsg');
    if (g3Msg) {
      g3Msg.classList.add('show');
      const dismiss = () => { g3Msg.classList.remove('show'); };
      g3Msg.addEventListener('click', dismiss, { once: true });
      setTimeout(dismiss, 5000);
    }
    syncCardHeights();
  } else if (!isPhone && newW > newH && (window as any)._returnTo3x2) {
    // iPad rotated back to landscape — restore 3x2 view
    (window as any)._returnTo3x2 = false;
    useStore.setState({ currentViewMode: 'grid3x2', crossCompare: {} });
    // Close detail bar (3x2 doesn't use it)
    const detailBar = document.getElementById('detailBar');
    if (detailBar) detailBar.style.display = 'none';
    document.body.classList.remove('detail-open');
    const detailBtnEl = document.getElementById('detailBtn');
    if (detailBtnEl) detailBtnEl.classList.remove('active');
    setViewMode('grid3x2');
    const renderAll = (window as any).__fh_renderAll;
    if (renderAll) renderAll();
    syncCardHeights();
  }
  // iPad (non-Pro): enforce strip limits on orientation change
  // Use maxTouchPoints instead of isTouch — works even with Magic Keyboard attached
  if (!isPhone && navigator.maxTouchPoints > 1 && Math.min(newW, newH) <= 830) {
    const s = state();
    const maxStrips = newH > newW ? 3 : 4;
    const totalVisible = s.activeStrips.length + (s.needsStripVisible ? 1 : 0);
    if (totalVisible > maxStrips) {
      const stripMax = maxStrips - (s.needsStripVisible ? 1 : 0);
      // Sort by visual position (MAIN→VER→FLOOR→REFS) before trimming rightmost
      const visualOrder: Record<string, number> = { main: 0, ver: 1, floor: 2, refs: 3 };
      const sorted = [...s.activeStrips].sort((a, b) => (visualOrder[a] ?? 9) - (visualOrder[b] ?? 9));
      useStore.setState({ activeStrips: sorted.slice(0, Math.max(1, stripMax)) });
      const renderAll = (window as any).__fh_renderAll;
      if (renderAll) renderAll();
    }
  }
  syncCardHeights();
  if (!fid) return;
  // Cancel any previous orientation-anchor timers
  _orientAnchorTimers.forEach(clearTimeout);
  _orientAnchorTimers.length = 0;
  [0, 50, 150, 300, 500, 800, 1200].forEach((delay) => {
    const tid = window.setTimeout(() => {
      syncCardHeights();
      scrollAnchorTo(fid);
    }, delay);
    _orientAnchorTimers.push(tid);
  });

  // Single toolbar reset after layout fully settles
  setTimeout(() => {
    resetToolbarState();
  }, 1600);
}

export function wireScrollHandlers(): void {
  let _scrollTrackTimer: number | null = null;
  window.addEventListener(
    'scroll',
    () => {
      if (_scrollTrackTimer) return;
      _scrollTrackTimer = window.setTimeout(() => {
        _scrollTrackTimer = null;
        _updateCenterFid();
      }, 100);
    },
    { passive: true }
  );

  // If user starts scrolling/touching, cancel any pending anchor timers
  // (both orientation and action) so they don't yank the scroll position back.
  window.addEventListener('touchstart', () => {
    if (_orientAnchorTimers.length) {
      _orientAnchorTimers.forEach(clearTimeout);
      _orientAnchorTimers.length = 0;
    }
    if (_actionAnchorTimers.length) {
      _actionAnchorTimers.forEach(clearTimeout);
      _actionAnchorTimers.length = 0;
    }
  }, { passive: true });

  let resizeTimer: number | null = null;
  let _lastOrient = window.innerWidth > window.innerHeight ? 'L' : 'P';
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const nowOrient = window.innerWidth > window.innerHeight ? 'L' : 'P';
      const orientChanged = nowOrient !== _lastOrient;
      _lastOrient = nowOrient;
      if (orientChanged) _resetLockedIH();   // new orientation → unlock height

      // On iOS with a portrait project, skip bar-toggle resize events.
      // But always allow real orientation changes through.
      if (_isIOS && state().portraitMode && !orientChanged) return;

      syncCardHeights();
      handleOrientationFlip();  // does its own multi-delay anchoring when flipped
      // Recalc grid3x2 margins on resize — wrap in rAF so layout is settled
      if (state().currentViewMode === 'grid3x2') {
        requestAnimationFrame(() => {
          const fn = (window as any).__fh_recalcGrid3x2Margins;
          if (fn) fn();
        });
      }
    }, 150);
  });
  window.addEventListener('orientationchange', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    _resetLockedIH();         // unlock so next sync picks up new orientation height
    // Don't call _updateCenterFid() here — window dimensions are mid-transition
    // and would pick the wrong frame. Use the value already tracked by the scroll listener.
    resizeTimer = window.setTimeout(() => {
      _lastOrient = window.innerWidth > window.innerHeight ? 'L' : 'P';
      syncCardHeights();
      handleOrientationFlip();  // does its own multi-delay anchoring when flipped
    }, 200);
  });

  if (!isTouch) return;

  // iPhone: toolbar scrolls naturally via CSS. No JS show/hide needed.
  const isPhoneAtInit = Math.min(window.innerWidth, window.innerHeight) <= 430;
  if (isPhoneAtInit) {
    // Landscape: toggle extra top padding on the view-bar when it's stuck at
    // the top (toolbar scrolled off). This pushes buttons below the iOS
    // status-bar tap zone that triggers scroll-to-top.
    const vb = document.querySelector('.view-bar') as HTMLElement | null;
    const tb = document.getElementById('mainToolbar');
    const db = document.getElementById('detailBar');
    // Sync detail bar sticky-top to sit right below the view bar
    const syncDetailTop = () => {
      if (vb && db) {
        // iPhone portrait: view-bar hidden via CSS, let detail-bar sticky handle itself
        if (window.innerWidth <= window.innerHeight && getComputedStyle(vb).display === 'none') {
          db.style.top = '';
          return;
        }
        const vbTop = parseFloat(getComputedStyle(vb).top) || 0;
        db.style.top = (vbTop + vb.offsetHeight - 1) + 'px';
      }
    };
    syncDetailTop();
    if (vb && tb) {
      window.addEventListener('scroll', () => {
        if (window.innerWidth <= window.innerHeight) {
          // Portrait: never stuck-pad
          vb.classList.remove('vb-stuck');
          syncDetailTop();
          return;
        }
        const tbBottom = tb.getBoundingClientRect().bottom;
        vb.classList.toggle('vb-stuck', tbBottom <= 0);
        syncDetailTop();
      }, { passive: true });
    }
    window.addEventListener('resize', syncDetailTop);
    return;
  }

  // iPad: JS-controlled show/hide
  let hidden = false;
  const toolbar = document.getElementById('mainToolbar');
  const viewBar = document.querySelector('.view-bar') as HTMLElement | null;
  const detailBar = document.getElementById('detailBar');
  if (!toolbar || !viewBar) return;
  (window as any)._scrollHideReset = function (h?: boolean) {
    hidden = h !== undefined ? h : false;
  };
  const TH = 10;

  // Sync detail bar position to sit right below the view bar
  const syncDetailTopIPad = () => {
    if (!detailBar) return;
    if (hidden) {
      if (document.body.classList.contains('detail-open')) {
        // Detail bar stays visible below the hidden view bar
        const vbRect = viewBar.getBoundingClientRect();
        detailBar.style.top = (vbRect.bottom - 1) + 'px';
      } else {
        // Detail bar off screen
        detailBar.style.top = '-200px';
      }
    } else {
      // Below visible view bar
      const vbTop = parseFloat(getComputedStyle(viewBar).top) || 0;
      detailBar.style.top = (vbTop + viewBar.offsetHeight - 1) + 'px';
    }
  };

  // Apply initial state
  resetToolbarState();
  syncDetailTopIPad();
  window.addEventListener('resize', syncDetailTopIPad);

  window.addEventListener(
    'scroll',
    () => {
      if (Date.now() < state().scrollHideGuard) return;
      if (document.querySelector('.fs-overlay')) return;
      const camOvl = document.getElementById('cameraOverlay');
      if (camOvl && !camOvl.classList.contains('hidden')) return;
      // Don't hide bars when sort-edit view is active — header sticks below them
      if (state().sortEditingId) return;
      const y = window.scrollY;

      if (y <= TH && hidden) {
        // At top → show all bars
        hidden = false;
        toolbar.classList.remove('tb-hide');
        viewBar.classList.remove('tb-hide');
        if (detailBar) detailBar.classList.remove('tb-hide');
        syncDetailTopIPad();
      } else if (y > TH && !hidden) {
        // Scrolled away → hide all bars
        hidden = true;
        toolbar.classList.add('tb-hide');
        viewBar.classList.add('tb-hide');
        if (detailBar) detailBar.classList.add('tb-hide');
        syncDetailTopIPad();
      }
    },
    { passive: true }
  );
}
