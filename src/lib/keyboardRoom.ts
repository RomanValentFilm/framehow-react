import { trace } from "./syncTrace";

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

let _held: HTMLElement | null = null;
let _was: { top: string; height: string; bottom: string } | null = null;
/** The box inside the overlay — capped to the free height so its bottom
 *  buttons stay above the keys (Roman, 13 Oct: the needs, notes and table
 *  boxes were pushed up and their buttons covered). Height only; the width is
 *  never touched, so in portrait nothing widens. */
let _box: HTMLElement | null = null;
let _boxWas: { maxHeight: string; overflowY: string } | null = null;

/** A field being typed into: a text field, OR AN EDITABLE BLOCK (15 Oct,
 *  Roman: the text under a card in 3x2 is one — it was never watched here, so
 *  the pin and the log lines never switched on for it, and it kept jumping
 *  while PIC/TXT, a plain field, had stopped). */
function isTyping(el: Element | null): el is HTMLElement {
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true;
}

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

/** The page, pinned while a field on it is typed into with a hardware
 *  keyboard: the body is fixed at the current scroll position, so the window
 *  has nothing to scroll. Unpinned on leaving the field, at the same place. */
let _pinned: { x: number; y: number } | null = null;
function pinPage(): void {
  if (_pinned) return;
  _pinned = { x: window.scrollX, y: window.scrollY };
  const b = document.body.style;
  b.position = 'fixed';
  b.top = `${-_pinned.y}px`;
  b.left = `${-_pinned.x}px`;
  b.width = '100%';
}
function unpinPage(): void {
  if (!_pinned) return;
  const back = _pinned;
  _pinned = null;
  const b = document.body.style;
  b.position = ''; b.top = ''; b.left = ''; b.width = '';
  window.scrollTo(back.x, back.y);
}

/** THE BOX STAYS PUT FOR A MOMENT AFTER THE KEYBOARD GOES (17 Oct, Roman:
 *  "press OK, the keyboard closes, the box jumps, you have to press OK
 *  again"). The tap on OK first takes the cursor out of the field, the
 *  keyboard drops, and the box re-centred under the finger before the tap
 *  itself landed. So the box is let go a moment later; a tap that was already
 *  on its way lands first. A field focused again within that moment (the
 *  colour dots, a second field in the same box) simply keeps the box. */
const RELEASE_GRACE_MS = 400;
let _releaseTimer: number | null = null;
function releaseSoon(): void {
  if (!_held) return;
  if (_releaseTimer !== null) return;
  _releaseTimer = window.setTimeout(() => {
    _releaseTimer = null;
    const vv = window.visualViewport;
    const stillUp = !!vv && vv.height >= 100 && window.innerHeight - vv.height >= KEYBOARD_MIN_PX;
    if (isTyping(document.activeElement) && stillUp) return;   // back in a field — keep the box
    release();
  }, RELEASE_GRACE_MS);
}
function keepHeld(): void {
  if (_releaseTimer !== null) { clearTimeout(_releaseTimer); _releaseTimer = null; }
}

function release(): void {
  keepHeld();
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
  // keyboard attached, iPadOS reports the visible area as 0 pixels high.
  // Taken at face value that is "a keyboard as tall as the screen", and the
  // box was fitted into nothing — zero height, at the top edge. No keyboard
  // leaves less than this; the reading is ignored, nothing changes.
  const active = document.activeElement;
  const typing = isTyping(active);
  // NOBODY IS TYPING → THE PAGE IS FREE (17 Oct, Roman: after writing, the
  // page would not scroll). The pin was let go on "field left" only — and when
  // a sync redraw rebuilt the card under the field, Safari never said so, and
  // the page stayed held. Now the pin is let go the moment no field is being
  // typed into, whoever took the field away.
  if (!typing) unpinPage();
  if (vv.height < 100) {
    // THE HARDWARE-KEYBOARD SIGNATURE (15 Oct, Roman's logs): the zero reading
    // comes right at focus, before the first key. Safari then scrolls the PAGE
    // on every key to lift the caret above a keyboard that is not there — the
    // boxes are spared only because a fixed thing cannot be scrolled. So a
    // field that lives on the page gets the same protection: the page is
    // pinned where it stands until the field is left.
    if (typing && !overlayOf(active)) pinPage();
    return;
  }
  const keyboardUp = window.innerHeight - vv.height >= KEYBOARD_MIN_PX;
  if (!typing || !keyboardUp) { releaseSoon(); return; }
  const overlay = overlayOf(active);
  if (!overlay) { release(); return; }
  keepHeld();
  if (_held !== overlay) {
    release();
    _held = overlay;
    _was = { top: overlay.style.top, height: overlay.style.height, bottom: overlay.style.bottom };
  }
  overlay.style.top = `${vv.offsetTop}px`;
  overlay.style.height = `${vv.height}px`;
  overlay.style.bottom = 'auto';
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

/** ONE LINE PER KEY (19 Oct, back in for the break-name trouble; removed in
 *  016, kept in v5.0.015 for reference). */
function keyLine(why: string): void {
  const vv = window.visualViewport;
  const active = document.activeElement as HTMLElement | null;
  if (!isTyping(active) || !active) return;
  const r = active.getBoundingClientRect();
  const scrolled: string[] = [];
  let node: HTMLElement | null = active;
  while (node) {
    if (node.scrollTop > 0) scrolled.push(`${node.id || node.className.toString().split(' ')[0] || node.tagName}@${Math.round(node.scrollTop)}`);
    node = node.parentElement;
  }
  trace(`kb ${why}: win ${window.innerWidth}×${window.innerHeight} · vv ${vv ? `${Math.round(vv.height)}h top${Math.round(vv.offsetTop)}` : 'none'} · page y${Math.round(window.scrollY)} · pin ${_pinned ? `on@${_pinned.y}` : 'off'} · body ${document.body.style.position || 'normal'} · field ${active.className.toString().split(' ')[0] || active.tagName} top${Math.round(r.top)} h${Math.round(r.height)} · scrolled [${scrolled.join(' ') || 'none'}]`);
}

/** Wire once at start. Harmless where there is no on-screen keyboard. */
export function keepBoxesAboveTheKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener('resize', () => { fit(); keyLine('vv resize'); });
  vv.addEventListener('scroll', () => { fit(); keyLine('vv scroll'); });
  window.addEventListener('scroll', () => keyLine('page scroll'));
  document.addEventListener('keydown', () => keyLine('key down'));
  document.addEventListener('focusin', () => setTimeout(() => { fit(); keyLine('focus'); }, 50));
  document.addEventListener('focusout', () => keyLine('leaving the field'));
  document.addEventListener('focusout', () => { unpinPage(); setTimeout(fit, 50); });
  // The first touch after the field went away: a pinned page with nobody
  // typing is let go before the finger moves (see fit).
  const freeIfIdle = () => { if (_pinned && !isTyping(document.activeElement)) unpinPage(); };
  document.addEventListener('touchstart', freeIfIdle, { passive: true, capture: true });
  document.addEventListener('pointerdown', freeIfIdle, { passive: true, capture: true });
  // And a redraw that removes the field without a word: looked at shortly after.
  new MutationObserver(() => { if (_pinned) setTimeout(freeIfIdle, 0); })
    .observe(document.body, { childList: true, subtree: true });
}
