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
/** Where the page stood when the keyboard came (15 Oct, Roman): Safari
 *  scrolls the whole page to keep the field in view while the keyboard is
 *  up, and leaves it there when the keyboard goes — with a hardware keyboard
 *  taking over at the first key, the app sat pushed up out of the frame. */
let _scrollWas: { x: number; y: number } | null = null;
let _sawKeyboard = false;

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

/** Is this field inside something fixed to the screen (a box, a bar, the
 *  big picture view)? Then Safari's page scroll for the keyboard is noise. */
function insideFixed(el: Element | null): boolean {
  let node = el as HTMLElement | null;
  while (node && node !== document.body) {
    if (getComputedStyle(node).position === 'fixed') return true;
    node = node.parentElement;
  }
  return false;
}

function pageBack(): void {
  if (!_scrollWas) return;
  const back = _scrollWas;
  _scrollWas = null;
  // After Safari has finished its own move, not before.
  setTimeout(() => window.scrollTo(back.x, back.y), 0);
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
  const active = document.activeElement;
  const typing = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  const keyboardUp = window.innerHeight - vv.height >= KEYBOARD_MIN_PX;
  // THE PAGE, for every field inside something fixed (the big view too):
  // remembered when the keyboard comes, put back when it goes.
  // The page goes back only once the keyboard has BEEN up and is gone again,
  // or the field is left — not in the moment between focus and the keyboard
  // rising, when nothing has moved yet.
  if (typing && keyboardUp && insideFixed(active)) _sawKeyboard = true;
  else if (!typing || (_sawKeyboard && !keyboardUp)) { pageBack(); _sawKeyboard = false; }
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
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  document.addEventListener('focusin', (e) => {
    // Remembered NOW, before Safari starts moving the page for the keyboard.
    const t = e.target as Element | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && insideFixed(t) && !_scrollWas) {
      _scrollWas = { x: window.scrollX, y: window.scrollY };
    }
    setTimeout(fit, 50);
  });
  document.addEventListener('focusout', () => setTimeout(fit, 50));
}
