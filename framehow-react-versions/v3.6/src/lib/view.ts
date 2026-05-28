// View modes (main / ver / both / overview), cross-strip swipe, desktop
// nav arrows, sync heights, hide-toolbar-on-scroll, orientation flip.

import { state, useStore, isTouch } from '../store/state';
import type { ViewMode } from '../store/state';

import { hasVisibleVer, nextVisibleVer, ovCollapseExpanded, clearAllDrawActive, clearReorder, relabelVersions, saveOpenTextEdits, saveOpenTableEdits } from './helpers';
import { fhTrack } from './tracking';

let _syncRAF: number | null = null;
export function scheduleSyncHeights(): void {
  if (!_syncRAF) {
    _syncRAF = requestAnimationFrame(() => {
      _syncRAF = null;
      syncCardHeights();
    });
  }
}

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
  const target = Math.floor((window.innerHeight - topChrome) * factor);

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
      if (s.portraitMode) {
        // Portrait: set --ph so CSS derives width from height (9:16 ratio)
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
    s.currentViewMode === 'overview'
      ? document.getElementById('overviewScroll')
      : s.currentViewMode === 'ver'
      ? document.getElementById('versionsScroll')
      : document.getElementById('mainScroll');
  if (!scrollEl || !s.frames.length) return;
  const sel = s.currentViewMode === 'overview' ? '.overview-row' : '.frame-card';
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
  if (s.currentViewMode === 'overview')
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
      s.currentViewMode === 'overview'
        ? document.getElementById('overviewScroll')
        : s.currentViewMode === 'ver'
        ? document.getElementById('versionsScroll')
        : document.getElementById('mainScroll');
    if (visibleScroll) {
      const cards =
        s.currentViewMode === 'overview'
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
  columnsEl.classList.remove('view-main', 'view-ver', 'view-overview');
  if (mode === 'main') columnsEl.classList.add('view-main');
  else if (mode === 'ver') columnsEl.classList.add('view-ver');
  else if (mode === 'overview') columnsEl.classList.add('view-overview');
  document.querySelectorAll('.view-btn').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.view === mode);
  });

  if (mode === 'overview') {
    const fn = (window as any).__fh_renderOverview;
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
  if (mode !== 'overview') syncCardHeights();

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
        }
      } else if (fromStrip === 'ver' && s.currentViewMode === 'ver') {
        if (dx > 0 && cur < 0) {
          s.crossCompare[fid] = 0;
          const div = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (div && renderVer) renderVer(div, fid);
        } else if (dx < 0 && cur >= 0) {
          s.crossCompare[fid] = -1;
          const div = document.querySelector(`#versionsScroll .frame-card[data-vfid="${fid}"]`) as HTMLElement | null;
          if (div && renderVer) renderVer(div, fid);
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

  const fid = state().centerFid;
  const isPhone = Math.min(newW, newH) <= 430;
  const isPhonePortrait = isPhone && newH > newW;
  if (isPhonePortrait && state().currentViewMode !== 'main') {
    setViewMode('main', false, fid);
  }
  syncCardHeights();
  if (!fid) return;
  [0, 50, 150, 300, 500, 800, 1200].forEach((delay) =>
    setTimeout(() => {
      syncCardHeights();
      scrollAnchorTo(fid);
    }, delay)
  );

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

  let resizeTimer: number | null = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      syncCardHeights();
      handleOrientationFlip();
    }, 150);
  });
  window.addEventListener('orientationchange', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(handleOrientationFlip, 200);
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
