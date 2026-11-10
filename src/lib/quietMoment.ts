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
import { trace } from './syncTrace';
import { handIsBusy } from './currentProject';
import { cameraBusy } from './camera';

/** Anything that sits on top of the page: every box, sheet, menu and overlay
 *  the app has is named ...Modal, ...Overlay, ...Sheet or is one of the few
 *  below. The save reminder itself and the log are not among them. */
const ON_TOP = [
  '[id$="Modal"]', '[id$="Overlay"]', '[id$="Sheet"]',
  '#importantNote', '.fs-overlay', '.strip-tag-overlay', '.new-project-overlay', '#maxView', '#pictsLibrary',
  '#mainMenu', '#sortDropdown', '#cameraModeMenu', '#cameraRatioMenu', '#cropModeMenu', '#cropRatioMenu',
].join(',');

function onScreen(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.classList.contains('hidden') || h.getClientRects().length === 0) return false;
  const cs = getComputedStyle(h);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01 && cs.pointerEvents !== 'none';
}

/**
 * Why this is not the moment — or null when it is.
 *
 * THE LIST (Roman, 10 Nov: "anything else to wait for?"):
 *   a drawing in progress, or DRAW mode open (card, big view, scribble);
 *   the keyboard: any text field being typed in (WRITE, a name, a note, a need);
 *   the camera, the app's own or the phone's;
 *   SETUPS open; a shooting order being edited (SORT BY); a shot or a version
 *   being moved (◀ ▶ / reorder);
 *   any box, sheet, menu or overlay on top of the page — WRITE, account, export,
 *   project list, crop, PDF adjust, the library, MAX view, a question, a notice.
 */
export function busyNow(): string | null {
  const s = useStore.getState();
  if (s.drawingInProgress || handIsBusy()) return 'drawing';
  if (Object.values(s.drawActive ?? {}).some((v) => v != null)) return 'DRAW mode';
  if (s.scribbleMode) return 'scribble';
  if (s.fsOverlayActive) return 'the big view';
  if (cameraBusy()) return 'the camera';
  if (s.setupMode || s.setupEditing) return 'SETUPS';
  if (s.sortEditingId) return 'a shooting order being edited';
  if (s.reorderFid != null || s.verReorderFid != null) return 'moving a shot or a version';
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)
    && (a as HTMLInputElement).type !== 'checkbox' && (a as HTMLInputElement).type !== 'file') return 'typing';
  for (const v of Array.from(document.querySelectorAll('video'))) if ((v as HTMLVideoElement).srcObject) return 'the camera';
  try {
    for (const el of Array.from(document.querySelectorAll(ON_TOP))) {
      if (el.id === 'updatingNote' || el.id === 'progressOverlay' && !onScreen(el)) continue;
      if (onScreen(el)) return `${el.id || 'a box'} is open`;
    }
  } catch { /* a selector the browser dislikes: not busy */ }
  return null;
}

/** Call `fn` once, at the first quiet moment (two quiet looks, 2 s apart).
 *  `also` may add its own reason to wait. Returns a function that cancels. */
export function whenQuiet(fn: () => void, also?: () => boolean): () => void {
  let quietLooks = 0;
  let saidAt = 0;
  const id = window.setInterval(() => {
    const why = document.visibilityState !== 'visible' ? 'the app is not in front' : busyNow() ?? (also && !also() ? 'something is still to be sent' : null);
    if (why) {
      quietLooks = 0;
      // Now and then, so a wait that never ends can be read in the log.
      if (Date.now() - saidAt > 30_000) { saidAt = Date.now(); trace(`  waiting for a quiet moment: ${why}`); }
      return;
    }
    if (++quietLooks < 2) return;
    window.clearInterval(id);
    fn();
  }, 2000);
  return () => window.clearInterval(id);
}
