// On-screen sync log — turned on with ?fhsync=1 in the URL, or by tapping the
// version number in the toolbar three times.
//
// The URL was the only switch, and a home-screen app opens with no query string
// at all — so on the iPad, where most of the sync trouble happens, there was no
// log to read. The choice is now remembered on the device, and can be made from
// inside the app.
//
// Sync problems happen on devices with no console, across two machines, and
// often only in the offline hand-over. Reasoning about the code was not enough:
// every real cause found so far came from watching what the sync actually did.
// So this goes in FIRST, before any behaviour changes, and comes out when the
// per-frame work is finished.

import { APP_VERSION } from '../store/state';

/** Bumped with each change while the per-frame sync is in flight, so the log
 *  says which build is on screen.
 *
 *  It is bumped BY HAND, which is why it sat at #309 through #310, #311, #312
 *  and #313 — telling the screen a version of events that was four changes out
 *  of date. Worth remembering the next time it is trusted in a log. */
export const SYNC_BUILD_TAG = '#425';

let box: HTMLElement | null = null;

/** Every line, whether the strip is showing or not (#272). The log is recorded
 *  always and merely DISPLAYED on request — so the strip can stay off while the
 *  app is being used (it covers the controls) and be turned on afterwards to
 *  read what just happened. Nothing has to be reproduced twice. */
const _recorded: string[] = [];
const KEEP = 300;

// TWO separate things, because hiding the strip must not turn the offline cache
// off with it (#275):
//   SHOW_KEY  — is the strip on screen right now
//   DEBUG_KEY — is this device in debug mode at all, which is what lets the
//               offline cache live on the dev address
// Turning the strip off leaves debug mode on, so the app can be USED — the strip
// covers the buttons — while still being testable offline.
const SHOW_KEY = 'fh_sync_log';
const DEBUG_KEY = 'fh_debug';

function read(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function write(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private mode */ }
}

/** ?fhsync=1 turns everything on, ?fhsync=0 turns everything off, and the
 *  choice is remembered — a home-screen app has no address bar to put it in. */
function urlSays(): boolean | null {
  const m = /fhsync=([01])/.exec(location.search);
  if (m) return m[1] === '1';
  return location.search.includes('fhsync') ? true : null;
}

function enabled(): boolean {
  const said = urlSays();
  if (said !== null) {
    write(SHOW_KEY, said);
    write(DEBUG_KEY, said);
    return said;
  }
  return read(SHOW_KEY);
}

/** Is this device in debug mode? Read at startup to decide whether the offline
 *  cache may run on the dev address (#274), which is otherwise torn down on
 *  every load so dev always shows new code. Independent of whether the strip is
 *  currently on screen. */
export function isDebugDevice(): boolean {
  enabled();                      // lets ?fhsync= in the address take effect
  return read(DEBUG_KEY);
}

/** Turn the log on or off on THIS device, and say which it now is. */
export function toggleSyncLog(): boolean {
  const on = !enabled();
  write(SHOW_KEY, on);
  // Showing it once puts the device in debug mode; hiding it again does NOT
  // take it out. Use ?fhsync=0 in the address to leave debug mode altogether.
  if (on) write(DEBUG_KEY, true);
  if (!on && box) { box.remove(); box = null; }
  if (on) trace('log on');   // and everything recorded before it appears with it
  return on;
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
  // Everything recorded before the strip was opened. Walked oldest-first,
  // because each line is put in at the TOP — going the other way would show the
  // history upside down.
  for (let i = _recorded.length - 1; i >= 0; i--) appendLine(box, _recorded[i]);
  return box;
}

/** Put one already-formatted line in the strip, newest first, below the tag. */
function appendLine(el: HTMLElement, text: string): void {
  const line = document.createElement('div');
  line.dataset.line = '1';
  line.textContent = text;
  const first = el.querySelector('[data-line]');
  el.insertBefore(line, first ?? null);
}

/**
 * Write one line to the log. ALWAYS recorded; shown only while the strip is up.
 *
 * It used to be thrown away when the strip was hidden, so anything interesting
 * had to happen a second time with the log open — and on an iPad the strip
 * covers the buttons you need to make it happen.
 */
export function trace(msg: string): void {
  const text = `${new Date().toLocaleTimeString()}  ${msg}`;
  _recorded.unshift(text);                       // newest first
  if (_recorded.length > KEEP) _recorded.length = KEEP;

  // If the strip has to be built now, it draws the whole recorded history —
  // which already includes the line above. Drawing it again put every first line
  // in the log twice.
  const wasThere = box !== null;
  const el = ensureBox();
  if (!el) return;
  if (wasThere) appendLine(el, text);
  const lines = el.querySelectorAll('[data-line]');
  for (let i = KEEP; i < lines.length; i++) lines[i].remove();
}
