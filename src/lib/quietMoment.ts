// A QUIET MOMENT (Roman, 10 November).
//
// Two things in the app arrive on a clock, not on a press: the reminder to
// save a project that lives only on this device, and the reload onto a new
// version. A clock does not know what the hand is doing — the reminder landed
// on top of the WRITE box the moment it opened and the write was lost (the
// simulator, 9 Nov); a reload in the middle of a drawing would be worse.
//
// So both ask here first. "Busy" is: a box is open, the keyboard is up, a
// drawing is in progress or only just ended. `whenQuiet` waits — it never
// gives up — and calls once the device has been quiet for two looks in a row.

import { useStore } from '../store/state';
import { handIsBusy } from './currentProject';

/** Boxes that sit on top of the page. The save reminder itself is not one. */
const ON_TOP = [
  '.account-modal:not(.hidden)', '.text-modal:not(.hidden)', '.export-modal:not(.hidden)',
  '.label-modal:not(.hidden)', '.confirm-modal:not(.hidden)', '.progress-overlay:not(.hidden)',
  '.crop-overlay:not(.hidden)', '#importantNote', '.fs-overlay', '.strip-tag-overlay',
  '#maxView', '#pictsLibrary',
].join(',');

/** Why this is not the moment — or null when it is. */
export function busyNow(): string | null {
  const s = useStore.getState();
  if (s.drawingInProgress || handIsBusy()) return 'drawing';
  if (Object.values(s.drawActive ?? {}).some((v) => v != null)) return 'draw mode';
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return 'typing';
  // The camera: a live picture on the page.
  for (const v of Array.from(document.querySelectorAll('video'))) if ((v as HTMLVideoElement).srcObject) return 'the camera';
  try { if (document.querySelector(ON_TOP)) return 'a box is open'; } catch { /* a selector the browser dislikes: not busy */ }
  return null;
}

/** Call `fn` once, at the first quiet moment (two quiet looks, 2 s apart).
 *  `also` may add its own reason to wait. Returns a function that cancels. */
export function whenQuiet(fn: () => void, also?: () => boolean): () => void {
  let quietLooks = 0;
  const id = window.setInterval(() => {
    if (document.visibilityState !== 'visible' || busyNow() || (also && !also())) { quietLooks = 0; return; }
    if (++quietLooks < 2) return;
    window.clearInterval(id);
    fn();
  }, 2000);
  return () => window.clearInterval(id);
}
