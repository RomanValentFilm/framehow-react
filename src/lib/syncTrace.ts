// On-screen sync log — visible only with ?fhsync=1 in the URL.
//
// Sync problems happen on devices with no console, across two machines, and
// often only in the offline hand-over. Reasoning about the code was not enough:
// every real cause found so far came from watching what the sync actually did.
// So this goes in FIRST, before any behaviour changes, and comes out when the
// per-frame work is finished.

import { APP_VERSION } from '../store/state';

/** Bumped with each change while the per-frame sync is in flight, so the log
 *  says which build is on screen. */
export const SYNC_BUILD_TAG = '#252';

let box: HTMLElement | null = null;

function enabled(): boolean {
  return location.search.includes('fhsync');
}

function ensureBox(): HTMLElement | null {
  if (!enabled()) return null;
  if (box) return box;

  box = document.createElement('div');
  box.style.cssText =
    // A FIXED height, not a share of the screen: at 42vh the log grew until it
    // covered the controls and the page could not be worked. It stays a strip
    // along the bottom and scrolls inside itself.
    'position:fixed;left:0;right:0;bottom:0;height:112px;overflow:auto;' +
    'z-index:2147483647;background:rgba(0,0,0,0.88);color:#6f6;' +
    'font:10px/1.35 ui-monospace,monospace;padding:24px 6px 6px;' +
    'white-space:pre-wrap;-webkit-user-select:text;user-select:text;';

  const tag = document.createElement('div');
  tag.textContent = `${APP_VERSION} · ${SYNC_BUILD_TAG}`;
  tag.style.cssText =
    'position:absolute;top:5px;left:8px;color:#fff;font:10px monospace;opacity:.85;';
  box.appendChild(tag);

  const copy = document.createElement('button');
  copy.textContent = 'COPY LOG';
  copy.style.cssText =
    'position:absolute;top:2px;right:6px;background:#d52632;color:#fff;border:none;' +
    'border-radius:4px;font:10px monospace;padding:3px 8px;cursor:pointer;';
  copy.onclick = () => {
    const lines = Array.from(box!.querySelectorAll('[data-line]'))
      .map((el) => el.textContent)
      .join('\n');
    void navigator.clipboard?.writeText(lines).then(
      () => { copy.textContent = 'COPIED'; setTimeout(() => (copy.textContent = 'COPY LOG'), 1200); },
      () => { copy.textContent = 'FAILED'; },
    );
  };
  box.appendChild(copy);

  document.body.appendChild(box);
  return box;
}

/** Write one line to the on-screen log. Does nothing without ?fhsync=1. */
export function trace(msg: string): void {
  const el = ensureBox();
  if (!el) return;
  const line = document.createElement('div');
  line.dataset.line = '1';
  line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  // Newest first, but always below the version tag and the copy button.
  const first = el.querySelector('[data-line]');
  el.insertBefore(line, first ?? null);

  // Keep the oldest lines from piling up forever. COPY LOG still takes
  // everything that is here.
  const lines = el.querySelectorAll('[data-line]');
  for (let i = 300; i < lines.length; i++) lines[i].remove();
}
