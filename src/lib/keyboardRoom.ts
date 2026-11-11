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

/** THE FRAMEHOW APP SAYS HOW TALL THE KEYBOARD IS (4 Nov). In the app shell
 *  the keyboard lies over the page but the page is not told — the visual
 *  viewport keeps its full height. The shell's keyboard plugin reports the
 *  height instead (window events keyboardWillShow / keyboardWillHide), and
 *  while it is set, the free area is the window minus that. Never set in
 *  Safari or on the iPad home-screen version — those read as before. */
let _shellKeyboardPx: number | null = null;
export function setShellKeyboardHeight(px: number | null): void {
  _shellKeyboardPx = px && px > 0 ? px : null;
  setTimeout(fit, 0);
}
/** The free part of the screen: what the browser says, or what the shell says. */
function freeArea(): { top: number; height: number } | null {
  const vv = window.visualViewport;
  if (_shellKeyboardPx !== null) return { top: 0, height: window.innerHeight - _shellKeyboardPx };
  if (!vv) return null;
  return { top: vv.offsetTop, height: vv.height };
}

let _held: HTMLElement | null = null;
let _was: { top: string; height: string; bottom: string; paddingTop: string } | null = null;

/** The top safe-area inset in pixels (the clock / Dynamic Island), measured
 *  through a throw-away element so it works wherever env() does. */
function safeTopPx(): number {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);';
  document.body.appendChild(p);
  const px = parseFloat(getComputedStyle(p).paddingTop) || 0;
  p.remove();
  return px;
}
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
  // HANDS OFF A PAGE SOMEBODY ELSE HOLDS (19 Oct, Roman's log 15:47): the
  // break name on the SORT BY page holds the page its own way (25 % from the
  // top, since #496). The pin then wrote its own position over that one — the
  // field jumped off the screen and every key scrolled the held page.
  if (document.body.style.position === 'fixed') return;
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
    const fa = freeArea();
    const stillUp = !!fa && fa.height >= 100 && window.innerHeight - fa.height >= KEYBOARD_MIN_PX;
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
    _held.style.paddingTop = _was.paddingTop;
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

/** Where the line being typed sits inside a text area, from the area's top
 *  edge (what is scrolled away inside the area already taken off). Measured
 *  with a throw-away copy of the text up to the cursor. */
function typingLine(ta: HTMLTextAreaElement): { top: number; bottom: number } {
  const cs = getComputedStyle(ta);
  const m = document.createElement('div');
  m.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;';
  m.style.width = `${ta.clientWidth}px`;
  m.style.font = cs.font;
  m.style.lineHeight = cs.lineHeight;
  m.style.letterSpacing = cs.letterSpacing;
  m.style.padding = cs.padding;
  m.textContent = ta.value.slice(0, ta.selectionStart ?? ta.value.length);
  const mark = document.createElement('span');
  mark.textContent = '​';
  m.appendChild(mark);
  document.body.appendChild(m);
  const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20;
  const top = mark.offsetTop + (parseFloat(cs.borderTopWidth) || 0) - ta.scrollTop;
  m.remove();
  return { top, bottom: top + lineH };
}

/** What scrolls a field on the page: the nearest column that can scroll, or
 *  the window. */
function scrollerOf(el: HTMLElement): { scrollBy(x: number, y: number): void } {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return window;
}

function fit(): void {
  const vv = freeArea();
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
  if (!overlay) {
    release();
    // A FIELD ON THE PAGE, UNDER THE KEYS (5 Nov, Roman: a NEEDS item — the
    // keyboard came up over it and nothing moved; every box moves, the page
    // did not). Safari's own nudge does not reach a field inside the app's
    // scroll column, and the shell (resize 'none') nudges nothing. Only when
    // the field is actually outside the free area, so a visible field is
    // never moved (#363); the same brings back a field lost to a turn (F9).
    const r = (active as HTMLElement).getBoundingClientRect();
    const low = vv.top + vv.height;
    // A FIELD TALLER THAN THE FREE AREA (11 Nov, Roman: NOTES on the iPhone —
    // "they move too much up, you can't see where you type"). Centring showed
    // the middle of the field; the line being typed was above the top edge.
    // Such a field is moved by its TYPING LINE instead: only when that line
    // is outside the free area, and only as far as needed.
    if (active.tagName === 'TEXTAREA' && r.height > vv.height - 16) {
      const line = typingLine(active as HTMLTextAreaElement);
      const top = r.top + line.top, bottom = r.top + line.bottom;
      let by = 0;
      if (bottom > low - 12) by = bottom - (low - 12);
      else if (top < vv.top + 12) by = top - (vv.top + 12);
      if (Math.abs(by) > 1) scrollerOf(active as HTMLElement).scrollBy(0, by);
      return;
    }
    if (r.bottom > low - 8 || r.top < vv.top + 8) {
      (active as HTMLElement).scrollIntoView({ block: 'center', behavior: 'auto' });
    }
    return;
  }
  keepHeld();
  if (_held !== overlay) {
    release();
    _held = overlay;
    _was = { top: overlay.style.top, height: overlay.style.height, bottom: overlay.style.bottom, paddingTop: overlay.style.paddingTop };
  }
  overlay.style.top = `${vv.top}px`;
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
    // PORTRAIT, A BOX TALLER THAN THE FREE AREA (5 Nov, Roman: the Groups box —
    // its title and name field slid up under the clock, nothing to see where
    // you type). The box keeps its width and its size when it fits; only when
    // it is taller than the free area is it capped, with its own scroll, and
    // the overlay leaves the clock / island clear above it.
    const sat = safeTopPx();
    const padTop = 16 + sat;
    overlay.style.paddingTop = `${padTop}px`;
    const room = Math.max(120, vv.height - padTop - 16);
    box.style.maxHeight = `${room}px`;
    box.style.overflowY = 'auto';
  }
  // THE FIELD ITSELF IN VIEW (4 Nov, Roman: the Groups box — ticked shots
  // down the list, tapped the name field at the top, and the field was
  // scrolled out of the fitted box). 'nearest' moves nothing when it is
  // already visible.
  if (box) (active as HTMLElement).scrollIntoView({ block: 'nearest' });
}

/** Wire once at start. Harmless where there is no on-screen keyboard. */
export function keepBoxesAboveTheKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  // The app shell's keyboard plugin (see setShellKeyboardHeight above).
  window.addEventListener('keyboardWillShow', (e: any) => setShellKeyboardHeight(e?.keyboardHeight ?? null));
  window.addEventListener('keyboardDidShow', (e: any) => setShellKeyboardHeight(e?.keyboardHeight ?? null));
  window.addEventListener('keyboardWillHide', () => setShellKeyboardHeight(null));
  window.addEventListener('keyboardDidHide', () => setShellKeyboardHeight(null));
  document.addEventListener('focusin', () => setTimeout(fit, 50));
  // A text area's typing line moves down as it is written (11 Nov): looked at
  // on every key; nothing moves while the line is in view.
  document.addEventListener('input', (e) => { if ((e.target as Element | null)?.tagName === 'TEXTAREA') fit(); });
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
