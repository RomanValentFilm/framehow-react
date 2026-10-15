// THE BOX ABOVE THE KEYBOARD (13 October, Roman).
//
// On the iPad every box — name the project, rename, sign in, forgot password —
// is centred on the WHOLE screen, and the keyboard then takes the lower part:
// the box, and its text field, end up under the keys. Roman: "we need to push
// the modal up, or find another solution, so you can type into it" — and not
// glued to the top edge either, "which is weird".
//
// The browser says how much of the screen the keyboard leaves (the visual
// viewport). While a text field has focus and the keyboard is up, the overlay
// that holds it is sized to exactly that part, so the box is centred in the
// free area — on an iPad roughly the upper half. When the keyboard goes, the
// overlay is put back as it was. One mechanism, for every box there is and
// every box to come: it finds the overlay from the focused field itself.

const KEYBOARD_MIN_PX = 120;   // less than this is a toolbar, not a keyboard

// DIAGNOSTIC LINES (15 Oct): what the keyboard code sees and does, in the
// sync log — Roman's iPad with a hardware keyboard moves the frame-number box
// to the top at the first key, and nothing here can be reproduced elsewhere.
import { trace } from './syncTrace';
function seen(why: string): string {
  const vv = window.visualViewport;
  const a = document.activeElement as HTMLElement | null;
  const who = a ? `${a.tagName.toLowerCase()}#${a.id || '-'}` : 'nothing';
  return `kb ${why}: vv ${vv ? `${Math.round(vv.height)}h/${Math.round(vv.offsetTop)}top` : 'none'} · win ${window.innerHeight}h · page ${Math.round(window.scrollY)} · focus ${who}`;
}

let _held: HTMLElement | null = null;
let _was: { top: string; height: string; bottom: string } | null = null;
/** The box inside the overlay — capped to the free height so its bottom
 *  buttons stay above the keys (Roman, 13 Oct: the needs, notes and table
 *  boxes were pushed up and their buttons covered). Height only; the width is
 *  never touched, so in portrait nothing widens. */
let _box: HTMLElement | null = null;
let _boxWas: { maxHeight: string; overflowY: string } | null = null;
/** SAFARI'S HARDWARE-KEYBOARD GLITCH (15 Oct, Roman's log, PIC/TXT on a card):
 *  with a hardware keyboard, Safari briefly lays out as if a 491-pixel
 *  software keyboard had appeared (the window height drops to 297), scrolls
 *  the page to keep the caret above that imaginary keyboard, then the window
 *  is back to full height — and the page is left scrolled, the field out of
 *  the frame. Remembered at focus; put back once the glitch has been seen
 *  and the window is whole again. Only then, so a finger scroll while typing
 *  is never undone. */
let _atFocus: { x: number; y: number; winH: number } | null = null;
let _glitched = false;

function overlayOf(el: Element | null): HTMLElement | null {
  let node = el as HTMLElement | null;
  while (node && node !== document.body) {
    if (getComputedStyle(node).position === 'fixed') {
      // Not the big picture view: shrinking it would resize the drawing
      // surface under the note. Left alone until Roman asks.
      if (node.classList.contains('fs-overlay')) return null;
      // ONLY A BOX THAT COVERS THE SCREEN IS AN OVERLAY (14 Oct, Roman): the
      // SETUPS bar is fixed too, a thin strip — sizing it to the free screen
      // stretched it into a tall box. A bar is left alone.
      if (node === _held) return node;          // already fitted by us — still the overlay
      const r = node.getBoundingClientRect();
      const coversScreen = r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
      return coversScreen ? node : null;
    }
    node = node.parentElement;
  }
  return null;
}

function release(): void {
  if (_held) trace(`kb release: ${_held.id || _held.className} back to top=${_was?.top || 'auto'} height=${_was?.height || 'auto'}`);
  if (_held && _was) {
    _held.style.top = _was.top;
    _held.style.height = _was.height;
    _held.style.bottom = _was.bottom;
  }
  if (_box && _boxWas) {
    _box.style.maxHeight = _boxWas.maxHeight;
    _box.style.overflowY = _boxWas.overflowY;
  }
  _held = null; _was = null; _box = null; _boxWas = null;
}

/** The box is the overlay's child that contains the field being typed in. */
function boxOf(overlay: HTMLElement, field: Element): HTMLElement | null {
  let node = field as HTMLElement | null;
  while (node && node.parentElement !== overlay) node = node.parentElement;
  return node && node !== overlay ? node : null;
}

function fit(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  // A READING OF (NEAR) ZERO IS NOISE (15 Oct, Roman's log): with a hardware
  // keyboard attached, iPadOS reports the visible area as 0 pixels high for a
  // moment. Taken at face value that is "a keyboard as tall as the screen",
  // and the box was fitted into nothing — zero height, at the top edge. No
  // keyboard leaves less than this; the reading is ignored, nothing changes.
  const active = document.activeElement;
  const typing = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (typing && _atFocus && (vv.height < 100 || window.innerHeight < _atFocus.winH - KEYBOARD_MIN_PX)) _glitched = true;
  // THE WINDOW HEIGHT IS THE HONEST SIGNAL (second log, 18:20): the visible
  // area stays at 0 for the whole hardware-typing session, so it cannot be
  // waited for. A real keyboard shrinks the window (788 → 600 in the first
  // log); a window at full height means no keyboard, and the page may go back.
  // NO COUNTER-MOVE (18:22 log): with a hardware keyboard Safari does the
  // dance on EVERY key — window 820 → 635, page scrolled, window 820 again —
  // and scrolling back each time was a ping-pong the person could see. The
  // page is left to Safari, which keeps the caret in view; it comes back on
  // leaving the field. Only noted here.
  if (typing && _atFocus && _glitched && window.innerHeight >= _atFocus.winH - 10
      && Math.round(window.scrollY) !== _atFocus.y) {
    trace(`kb page moved by Safari: ${Math.round(window.scrollY)} (was ${_atFocus.y} at focus) — left alone`);
  }
  if (vv.height < 100) { trace(`kb ignored: visible area reported ${Math.round(vv.height)}px high`); return; }
  const keyboardUp = window.innerHeight - vv.height >= KEYBOARD_MIN_PX;
  if (!typing || !keyboardUp) { release(); return; }
  const overlay = overlayOf(active);
  if (!overlay) { release(); return; }
  if (_held !== overlay) {
    release();
    _held = overlay;
    _was = { top: overlay.style.top, height: overlay.style.height, bottom: overlay.style.bottom };
  }
  overlay.style.top = `${vv.offsetTop}px`;
  overlay.style.height = `${vv.height}px`;
  overlay.style.bottom = 'auto';
  trace(`kb fit: ${overlay.id || overlay.className} top=${Math.round(vv.offsetTop)} height=${Math.round(vv.height)}`);
  const box = boxOf(overlay, active!);
  if (box && _box !== box) {
    if (_box && _boxWas) { _box.style.maxHeight = _boxWas.maxHeight; _box.style.overflowY = _boxWas.overflowY; }
    _box = box;
    _boxWas = { maxHeight: box.style.maxHeight, overflowY: box.style.overflowY };
  }
  // LANDSCAPE ONLY (Roman, 13 Oct): in portrait the box keeps its size and is
  // only moved into the free part of the screen.
  const landscape = window.innerWidth > window.innerHeight;
  if (box && landscape) {
    box.style.maxHeight = `${Math.max(120, vv.height - 16)}px`;
    box.style.overflowY = 'auto';
  } else if (box && _boxWas) {
    box.style.maxHeight = _boxWas.maxHeight;
    box.style.overflowY = _boxWas.overflowY;
  }
}

/** Wire once at start. Harmless where there is no on-screen keyboard. */
export function keepBoxesAboveTheKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener('resize', () => { trace(seen('viewport resize')); fit(); });
  vv.addEventListener('scroll', () => { trace(seen('viewport scroll')); fit(); });
  window.addEventListener('scroll', () => { if (document.activeElement && document.activeElement !== document.body) { trace(seen('page scroll')); fit(); } }, { passive: true });
  document.addEventListener('focusin', (e) => {
    const t = e.target as Element | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      _atFocus = { x: window.scrollX, y: window.scrollY, winH: window.innerHeight };
      _glitched = false;
    }
    trace(seen('focus')); setTimeout(fit, 50);
  });
  document.addEventListener('focusout', () => { _atFocus = null; _glitched = false; trace(seen('blur')); setTimeout(fit, 50); });
  document.addEventListener('keydown', (e) => { if (!(e as KeyboardEvent).repeat) trace(seen(`key "${(e as KeyboardEvent).key}"`)); });
}
