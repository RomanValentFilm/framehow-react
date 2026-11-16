// A BOX ON TOP: THE BOX MOVES, NEVER THE PAGE BEHIND IT (16 Nov, Roman, iPad:
// "when I want to move the project list, the page behind it moves instead").
//
// The boxes ask the browser to keep a scroll to themselves (overscroll-behavior
// — 4 Nov). The iPad only honours that for something that can actually scroll:
// a list short enough to fit, or one already at its end, hands the finger on to
// the page behind. So it is said in one place, for every such box: while one is
// open, a finger or a wheel moves what can move INSIDE the box in that
// direction — and if nothing can, nothing moves.

function openBox(): HTMLElement | null {
  // (the one on top: a question may stand over the project list)
  const open = document.querySelectorAll<HTMLElement>('.account-modal:not(.hidden)');
  return open.length ? open[open.length - 1] : null;
}

/** Something between the touched element and the box that can still scroll that way. */
function canScrollInside(from: EventTarget | null, box: HTMLElement, dy: number): boolean {
  let el = from instanceof Element ? (from as HTMLElement) : null;
  while (el && box.contains(el)) {
    const room = el.scrollHeight - el.clientHeight;
    if (room > 1) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        if (dy > 0 && el.scrollTop < room - 1) return true;    // content can still go up
        if (dy < 0 && el.scrollTop > 0) return true;           // content can still go down
      }
    }
    if (el === box) break;
    el = el.parentElement;
  }
  return false;
}

// …AND THE PAGE ITSELF IS HELD (16 Nov, an hour later — Roman, v5.0.286: "why is
// the page moving behind the box? we said we don't want that"). The guard below
// was not enough on his iPad, and I do not know which way the swipe got past
// it. So the page is held the way it is held behind the export boxes, where
// the same fault was cured before (exports.ts, lockPageScroll): while a box is
// open the page is pinned in place and CANNOT scroll, whatever reaches it. It
// is let go, at the same place, when the last box closes.
let _held = false;
function holdOrLetGo(): void {
  const open = !!openBox();
  if (open === _held) return;
  _held = open;
  void import('./exports').then(({ lockPageScroll, unlockPageScroll }) => {
    if (open) lockPageScroll(); else unlockPageScroll();
    void import('./syncTrace').then(({ trace }) => trace(open ? `box open: the page behind is held at ${Math.round(parseFloat(document.body.dataset.fhLockTop || '0'))} px` : 'box closed: the page is let go'));
  });
}
function watchTheBoxes(): void {
  const boxes = document.querySelectorAll<HTMLElement>('.account-modal');
  if (!boxes.length) { window.setTimeout(watchTheBoxes, 1000); return; }
  const mo = new MutationObserver(holdOrLetGo);
  boxes.forEach((b) => mo.observe(b, { attributes: true, attributeFilter: ['class'] }));
  holdOrLetGo();
}

let _wired = false;
export function wireModalScrollGuard(): void {
  if (_wired) return;
  _wired = true;
  watchTheBoxes();
  let startY = 0;
  document.addEventListener('touchstart', (e) => { startY = e.touches[0]?.clientY ?? 0; }, { passive: true, capture: true });
  document.addEventListener('touchmove', (e) => {
    const box = openBox();
    if (!box || e.touches.length !== 1) return;
    if (!box.contains(e.target as Node)) return;               // something above the box (a notice): its own business
    const dy = startY - e.touches[0].clientY;                   // > 0: the finger goes up, the content should too
    if (Math.abs(dy) < 2) return;
    if (!canScrollInside(e.target, box, dy) && e.cancelable) e.preventDefault();
  }, { passive: false, capture: true });
  document.addEventListener('wheel', (e) => {
    const box = openBox();
    if (!box || !box.contains(e.target as Node) || e.ctrlKey) return;
    if (!canScrollInside(e.target, box, e.deltaY) && e.cancelable) e.preventDefault();
  }, { passive: false, capture: true });
}
