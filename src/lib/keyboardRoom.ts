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

function overlayOf(el: Element | null): HTMLElement | null {
  let node = el as HTMLElement | null;
  while (node && node !== document.body) {
    if (getComputedStyle(node).position === 'fixed') return node;
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
  _held = null; _was = null;
}

function fit(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const active = document.activeElement;
  const typing = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
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
}

/** Wire once at start. Harmless where there is no on-screen keyboard. */
export function keepBoxesAboveTheKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  document.addEventListener('focusin', () => setTimeout(fit, 50));
  document.addEventListener('focusout', () => setTimeout(fit, 50));
}
