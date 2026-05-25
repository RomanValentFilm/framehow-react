// View modes (main / ver / both / overview), cross-strip swipe, desktop
// nav arrows, sync heights, hide-toolbar-on-scroll, orientation flip.

import { state, useStore, isTouch } from '../store/state';
import type { ViewMode } from '../store/state';

import { hasVisibleVer, nextVisibleVer, ovCollapseExpanded, clearAllDrawActive, clearReorder, relabelVersions, saveOpenTextEdits, saveOpenTableEdits, _actionAnchorTimers } from './helpers';
import { fhTrack } from './tracking';

let _syncRAF: number | null = null;
// Orientation-flip anchor timers — can be cancelled if user starts scrolling
const _orientAnchorTimers: number[] = [];
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
  const mainScroll = document.getElementById('mainScroll')!;
  const versionsScroll = document.getElementById('versionsScroll')!;
  const mainCards = mainScroll.querySelectorAll('.frame-card');
  const verCards = versionsScroll.querySelectorAll('.frame-card');

  // STEP 1: Reset all cards to natural height
  mainCards.forEach((c) => {
    (c as HTMLElement).style.height = 'auto';
    (c as HTMLElement).style.minHeight = 'auto';
  });
  verCards.forEach((c) => {
    (c as HTMLElement).style.height = 'auto';
    (c as HTMLElement).style.minHeight = 'auto';
  });

  // STEP 2: Measure non-canvas overhead per card and cap the canvas so the
  // full card (label + canvas + buttons) fits on screen without scrolling.
  // Works for both portrait (9:16) and landscape (16:9) projects.
  const s = state();
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
  const capLandscape = !s.portraitMode && !isTouch && (s.currentViewMode === 'main' || s.currentViewMode === 'ver');

  if (s.portraitMode || capLandscape) {
    [...mainCards, ...verCards].forEach((card) => {
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
    // TWIN/VRSN/GRID landscape: clear any stale caps from a previous MAIN view
    [...mainCards, ...verCards].forEach((card) => {
      const wrap = card.querySelector('.canvas-wrap') as HTMLElement;
      if (wrap) { wrap.style.maxHeight = ''; wrap.style.maxWidth = ''; }
    });
  }

  // STEP 3: Force layout, then sync main ↔ version card heights
  void document.body.offsetHeight;
  for (let i = 0; i < mainCards.length && i < verCards.length; i++) {
    const mRect = mainCards[i].getBoundingClientRect();
    const vRect = verCards[i].getBoundingClientRect();
    const max = Math.ceil(Math.max(mRect.height, vRect.height));
    (mainCards[i] as HTMLElement).style.height = max + 'px';
    (verCards[i] as HTMLElement).style.height = max + 'px';
    (mainCards[i] as HTMLElement).style.minHeight = max + 'px';
    (verCards[i] as HTMLElement).style.minHeight = max + 'px';
  }

  [...mainCards, ...verCards].forEach((card) => {
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
}

export function _updateCenterFid(): void {
  const s = state();
  const scrollEl =
    s.currentViewMode === 'overview' || s.currentViewMode === 'grid4'
      ? document.getElementById('overviewScroll')
      : s.currentViewMode === 'ver'
      ? document.getElementById('versionsScroll')
      : document.getElementById('mainScroll');
  if (!scrollEl || !s.frames.length) return;
  const sel = s.currentViewMode === 'overview' || s.currentViewMode === 'grid4' ? '.overview-row' : '.frame-card';
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
  if (best) useStore.setState({ centerFid: best.dataset.ofid || best.dataset.mfid || best.dataset.vfid || null });
}

export function scrollAnchorTo(fid: string | number | null): void {
  if (!fid) return;
  const s = state();
  let target: HTMLElement | null = null;
  if (s.currentViewMode === 'overview' || s.currentViewMode === 'grid4')
    target = document.querySelector(`#overviewScroll .overview-row[data-ofid="${fid}"]`) as HTMLElement | null;
  else if (s.currentViewMode === 'ver')
    target = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
  else target = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
}

export function setViewMode(mode: ViewMode, keepCompare?: boolean, forceAnchorFid?: string | null): void {
  fhTrack('view_' + mode);
  const s = state();
  ovCollapseExpanded();
  for (const k in s.drawActive) {
    if (s.drawActive[+k]) s.drawEraser[+k] = false;
  }
  clearAllDrawActive();

  let anchorFid: string | null = forceAnchorFid || null;
  if (!anchorFid) {
    const visibleScroll =
      s.currentViewMode === 'overview' || s.currentViewMode === 'grid4'
        ? document.getElementById('overviewScroll')
        : s.currentViewMode === 'ver'
        ? document.getElementById('versionsScroll')
        : document.getElementById('mainScroll');
    if (visibleScroll) {
      const cards =
        s.currentViewMode === 'overview' || s.currentViewMode === 'grid4'
          ? visibleScroll.querySelectorAll('.overview-row')
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
      anchorFid = anchorCard ? (anchorCard.dataset.ofid || anchorCard.dataset.mfid || anchorCard.dataset.vfid || null) : null;
    }
  }

  useStore.setState({ currentViewMode: mode });
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
  columnsEl.classList.remove('view-main', 'view-ver', 'view-overview', 'view-grid4');
  if (mode === 'main') columnsEl.classList.add('view-main');
  else if (mode === 'ver') columnsEl.classList.add('view-ver');
  else if (mode === 'overview') columnsEl.classList.add('view-overview');
  else if (mode === 'grid4') columnsEl.classList.add('view-grid4');
  document.querySelectorAll('.view-btn').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.view === mode);
  });

  if (mode === 'overview' || mode === 'grid4') {
    const fn = mode === 'grid4' ? (window as any).__fh_renderGrid4 : (window as any).__fh_renderOverview;
    if (fn) fn();
  } else {
    document.getElementById('overviewScroll')!.innerHTML = '';
    document.querySelectorAll('.frame-card[data-mfid]').forEach((div) => {
      const fn = (window as any).__fh_renderMainFrame;
      if (fn) fn(div, parseInt((div as HTMLElement).dataset.mfid!));
    });
    document.querySelectorAll('.frame-card[data-vfid]').forEach((div) => {
      const fn = (window as any).__fh_renderVersionFrame;
      if (fn) fn(div, parseInt((div as HTMLElement).dataset.vfid!));
    });
  }
  if (mode !== 'overview' && mode !== 'grid4') syncCardHeights();

  if (anchorFid) {
    void (columnsEl as HTMLElement).offsetHeight;
    scrollAnchorTo(anchorFid);
  }

  if (mode === 'main') setTimeout(showSwipeHint, 2000);
}

export function autoPhoneMainView(): void {
  const w = window.innerWidth,
    h = window.innerHeight;
  if (Math.min(w, h) <= 430 && h > w && state().currentViewMode !== 'main') setViewMode('main');
}

export function showSwipeHint(): void {
  if (!isTouch) return;
  if (state().swipeHintShown) return;
  const hint = document.getElementById('swipeHint');
  if (!hint) return;
  useStore.setState({ swipeHintShown: true });
  hint.classList.add('show');
  const dismiss = () => {
    hint.style.transition = 'none';
    hint.classList.remove('show');
    // Restore CSS transition after instant hide
    requestAnimationFrame(() => { hint.style.transition = ''; });
  };
  hint.addEventListener('click', dismiss, { once: true });
  hint.addEventListener('touchstart', dismiss, { once: true, passive: true });
  hint.addEventListener('touchmove', dismiss, { once: true, passive: true });
  setTimeout(() => {
    hint.classList.remove('show');
  }, 3000);
}

export function navigateStrip(fid: number, fromStrip: 'main' | 'ver', dir: 'left' | 'right'): void {
  saveOpenTextEdits();
  saveOpenTableEdits();
  const s = state();
  const cur = s.crossCompare[fid] ?? -1;
  const numVer = (s.versions[fid] || []).length;
  const renderMain = (window as any).__fh_renderMainFrame;
  const renderVer = (window as any).__fh_renderVersionFrame;
  if (s.currentViewMode === 'both' && fromStrip === 'ver') {
    const ai = s.activeTab[fid] || 0;
    if (dir === 'left' && ai > 0) {
      clearAllDrawActive();
      s.activeTab[fid] = ai - 1;
      useStore.setState({ swipeHighlightFid: fid });
      const div = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      if (div && renderVer) renderVer(div, fid);
    } else if (dir === 'right' && ai < numVer - 1) {
      clearAllDrawActive();
      s.activeTab[fid] = ai + 1;
      useStore.setState({ swipeHighlightFid: fid });
      const div = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
      if (div && renderVer) renderVer(div, fid);
    }
    requestAnimationFrame(() => scrollAnchorTo(fid));
    return;
  }
  if (fromStrip === 'main' && s.currentViewMode === 'main') {
    if (dir === 'right') {
      // Allow swiping to ALL versions (including hidden — they show dimmed)
      const nxt = cur + 1;
      if (nxt < numVer) {
        s.crossCompare[fid] = nxt;
        s.activeTab[fid] = nxt;
        useStore.setState({ swipeHighlightFid: fid });
        const div = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
        if (div && renderMain) renderMain(div, fid);
      }
    } else if (dir === 'left' && cur >= 0) {
      const prv = cur - 1;
      if (prv >= 0) {
        s.crossCompare[fid] = prv;
        s.activeTab[fid] = prv;
      } else {
        s.crossCompare[fid] = -1;
      }
      useStore.setState({ swipeHighlightFid: fid });
      const div = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
      if (div && renderMain) renderMain(div, fid);
    }
  } else if (fromStrip === 'ver' && s.currentViewMode === 'ver') {
    if (cur >= 0) {
      if (dir === 'right') {
        s.crossCompare[fid] = -1;
        useStore.setState({ swipeHighlightFid: fid });
        const div = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (div && renderVer) renderVer(div, fid);
      }
    } else {
      const ai = s.activeTab[fid] || 0;
      if (dir === 'left') {
        if (ai > 0) {
          clearAllDrawActive();
          s.activeTab[fid] = ai - 1;
          useStore.setState({ swipeHighlightFid: fid });
          const div = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (div && renderVer) renderVer(div, fid);
        } else {
          s.crossCompare[fid] = 0;
          useStore.setState({ swipeHighlightFid: fid });
          const div = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (div && renderVer) renderVer(div, fid);
        }
      } else if (dir === 'right' && ai < numVer - 1) {
        clearAllDrawActive();
        s.activeTab[fid] = ai + 1;
        useStore.setState({ swipeHighlightFid: fid });
        const div = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
        if (div && renderVer) renderVer(div, fid);
      }
    }
  }
  // Scroll-anchor the frame we just navigated so it stays centered (desktop 9:16)
  requestAnimationFrame(() => scrollAnchorTo(fid));
}

export function addNavArrows(wrapEl: HTMLElement, fid: number, fromStrip: 'main' | 'ver'): void {
  if (isTouch) return;
  const s = state();
  if (s.currentViewMode === 'both' && fromStrip === 'main') return;
  const numVer = (s.versions[fid] || []).length;
  const cur = s.crossCompare[fid] ?? -1;
  let showLeft = false,
    showRight = false;
  if (fromStrip === 'main') {
    showRight = cur + 1 < numVer;
    showLeft = cur >= 0;
  } else if (s.currentViewMode === 'both') {
    const ai = s.activeTab[fid] || 0;
    showLeft = ai > 0;
    showRight = ai < numVer - 1;
  } else {
    if (cur >= 0) {
      showRight = true;
      showLeft = false;
    } else {
      const ai = s.activeTab[fid] || 0;
      showLeft = true;
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

export function addCrossSwipe(el: HTMLElement, fid: number, fromStrip: 'main' | 'ver'): void {
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
        if (s.verReorderFid === fid && cur >= 0) {
          const tabs = s.versions[fid],
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
          relabelVersions(fid);
          const div = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
          if (div && renderMain) renderMain(div, fid);
          const vd = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (vd && renderVer) renderVer(vd, fid);
          return;
        }
        if (dx < 0) {
          // Allow swiping to ALL versions (including hidden — they show dimmed)
          const nxt = cur + 1;
          const numV = (s.versions[fid] || []).length;
          if (nxt < numV) {
            s.crossCompare[fid] = nxt;
            s.activeTab[fid] = nxt;
            useStore.setState({ swipeHighlightFid: fid });
            const div = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
            if (div && renderMain) renderMain(div, fid);
            requestAnimationFrame(() => scrollAnchorTo(fid));
          }
        } else if (dx > 0 && cur >= 0) {
          const prv = cur - 1;
          if (prv >= 0) {
            s.crossCompare[fid] = prv;
            s.activeTab[fid] = prv;
          } else {
            s.crossCompare[fid] = -1;
          }
          useStore.setState({ swipeHighlightFid: fid });
          const div = document.querySelector(`#mainScroll .frame-card[data-mfid="${fid}"]`) as HTMLElement | null;
          if (div && renderMain) renderMain(div, fid);
          requestAnimationFrame(() => scrollAnchorTo(fid));
        }
      } else if (fromStrip === 'ver' && s.currentViewMode === 'ver') {
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
    },
    { passive: true }
  );
}

export function resetToolbarState(): void {
  const isPhone = Math.min(window.innerWidth, window.innerHeight) <= 430;
  if (isPhone) return; // iPhone: toolbar scrolls naturally via CSS, no JS needed

  const toolbar = document.getElementById('mainToolbar');
  const viewBar = document.querySelector('.view-bar');

  // Clear everything
  if (toolbar) toolbar.classList.remove('tb-hide');
  if (viewBar) viewBar.classList.remove('tb-hide');

  const shouldHide = window.scrollY > 10;
  if (shouldHide) {
    // iPad: hide both
    if (toolbar) toolbar.classList.add('tb-hide');
    if (viewBar) viewBar.classList.add('tb-hide');
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
  if (isPhonePortrait && state().currentViewMode !== 'main') {
    setViewMode('main', false, fid);
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
  if (isPhoneAtInit) return;

  // iPad: JS-controlled show/hide
  let hidden = false;
  const toolbar = document.getElementById('mainToolbar');
  const viewBar = document.querySelector('.view-bar');
  if (!toolbar || !viewBar) return;
  (window as any)._scrollHideReset = function (h?: boolean) {
    hidden = h !== undefined ? h : false;
  };
  const TH = 10;

  // Apply initial state
  resetToolbarState();

  window.addEventListener(
    'scroll',
    () => {
      if (Date.now() < state().scrollHideGuard) return;
      if (document.querySelector('.fs-overlay')) return;
      const camOvl = document.getElementById('cameraOverlay');
      if (camOvl && !camOvl.classList.contains('hidden')) return;
      const y = window.scrollY;

      if (y <= TH && hidden) {
        // At top → show toolbar
        hidden = false;
        toolbar.classList.remove('tb-hide');
        viewBar.classList.remove('tb-hide');
      } else if (y > TH && !hidden) {
        // Scrolled away → hide toolbar
        hidden = true;
        toolbar.classList.add('tb-hide');
        viewBar.classList.add('tb-hide');
      }
    },
    { passive: true }
  );
}
