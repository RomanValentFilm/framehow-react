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
  return document.querySelector<HTMLElement>('.account-modal:not(.hidden)');
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

let _wired = false;
export function wireModalScrollGuard(): void {
  if (_wired) return;
  _wired = true;
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
