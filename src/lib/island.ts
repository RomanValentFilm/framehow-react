// THE DYNAMIC ISLAND (Roman, 10 November).
//
// An iPhone held sideways has its island (or, on older ones, the notch) on one
// short side of the screen, and the app ran underneath it: the outer 3×2 card,
// the GROUP panel, the SETUPS row, the LIBRARY. "All the buttons we press have
// to be off that island."
//
// ONE RULE FOR THE WHOLE APP, not panel by panel: sideways, the app starts
// where the island ends. Only on the island's side — the other side keeps its
// full width — and the strip beside the island stays black. Turned the other
// way round, the strip changes sides. Upright nothing changes (the island sits
// in the status bar's place), and an iPad has no island: its side insets are
// zero, so nothing happens there.
//
// How: the system reports how far in the safe area begins (the same number on
// both short sides); which side the island is really on comes from the way the
// phone is held. The two numbers go onto <html> as --il and --ir, with the
// class `island`; globals.css moves the page and everything fixed to it.

import { trace } from './syncTrace';

/** The system's side inset, in px — 0 on anything without an island or a notch. */
function sideInset(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;'
    + 'padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = Math.max(parseFloat(cs.paddingLeft) || 0, parseFloat(cs.paddingRight) || 0);
  probe.remove();
  return Math.round(px);
}

/** 'left' / 'right': the short side the island is on; null upright. */
function islandSide(): 'left' | 'right' | null {
  if (window.innerWidth <= window.innerHeight) return null;
  const type = (screen.orientation && screen.orientation.type) || '';
  if (type === 'landscape-primary') return 'left';      // turned anticlockwise: the top is on the left
  if (type === 'landscape-secondary') return 'right';
  const angle = (window as unknown as { orientation?: number }).orientation;
  if (angle === 90) return 'left';
  if (angle === -90 || angle === 270) return 'right';
  return null;
}

let last = '';
function apply(): void {
  const root = document.documentElement;
  const side = islandSide();
  const inset = side ? sideInset() : 0;
  const il = side === 'left' ? inset : 0;
  const ir = side === 'right' ? inset : 0;
  const now = `${il}/${ir}`;
  if (now === last) return;
  last = now;
  root.style.setProperty('--il', `${il}px`);
  root.style.setProperty('--ir', `${ir}px`);
  root.classList.toggle('island', il + ir > 0);
  trace(`island: ${il + ir > 0 ? `on the ${side}, the app starts ${inset} px in on that side` : 'none in the way'}`);
  // The page is narrower or wider than a moment ago: let the app lay itself out.
  window.dispatchEvent(new Event('resize'));
}

export function watchTheIsland(): void {
  if (!('ontouchend' in document)) return;   // a desk has no island
  const soon = () => { window.setTimeout(apply, 60); window.setTimeout(apply, 400); };
  apply();
  window.addEventListener('orientationchange', soon);
  window.addEventListener('resize', () => window.setTimeout(apply, 60));
  try { screen.orientation?.addEventListener('change', soon); } catch { /* older Safari: orientationchange above */ }
}
