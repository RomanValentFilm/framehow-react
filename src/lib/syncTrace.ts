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
export const SYNC_BUILD_TAG = '#829';

let box: HTMLElement | null = null;

/** Every line, whether the strip is showing or not (#272). The log is recorded
 *  always and merely DISPLAYED on request — so the strip can stay off while the
 *  app is being used (it covers the controls) and be turned on afterwards to
 *  read what just happened. Nothing has to be reproduced twice. */
const _recorded: string[] = [];
/** How many lines are kept. In the simulator far more: its tests COUNT lines
 *  ("one more 'arrangement arrived' than before"), and at 300 an old line
 *  falling off the end hid the new one — full run 720, test 31, after a day
 *  that added log lines. On a person's device 300 is plenty. */
function keepLines(): number {
  try { return localStorage.getItem('fh_test') === '1' || /fhtest=1/.test(location.search) ? 6000 : 300; } catch { return 300; }
}

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

/** The address is read ONCE (#501). It used to be read every time a line was
 *  written, so on a desktop whose address still said fhsync=1 the three taps
 *  hid the strip and the next star or stroke brought it straight back. */
let _addressRead = false;

/**
 * NOT ON THE PUBLIC ADDRESS (#522, Roman, 17 September). The sync log is for
 * us: dev, the simulator, a local build. On framehow.com (and any address
 * that is not dev/local) it never shows and the three taps do nothing —
 * unless the address says ?fhsync=1, which is how we would read a tester's
 * device if we ever had to.
 */
export function logAllowedHere(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (host.startsWith('dev.') || ['localhost', '127.0.0.1', '0.0.0.0'].includes(host)) return true;
  return urlSays() === true;
}

function enabled(): boolean {
  if (!logAllowedHere()) return false;
  if (!_addressRead) {
    _addressRead = true;
    const said = urlSays();
    if (said !== null) {
      write(SHOW_KEY, said);
      write(DEBUG_KEY, said);
      return said;
    }
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
/** How much of the screen's bottom the log strip covers right now (0 when it
 *  is not showing) — the PICTS library keeps its bar above it (run 486). */
export function logStripHeight(): number {
  return box && box.isConnected ? box.offsetHeight : 0;
}

export function toggleSyncLog(): boolean {
  if (!logAllowedHere()) return false;
  const on = !enabled();
  write(SHOW_KEY, on);
  // Showing it once puts the device in debug mode; hiding it again does NOT
  // take it out. Use ?fhsync=0 in the address to leave debug mode altogether.
  if (on) write(DEBUG_KEY, true);
  if (!on && box) { box.remove(); box = null; }
  document.body.classList.toggle('fh-log-on', on);
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
    // TWO LINES (25 Oct, Roman: the strip sat over the Save button; three
    // were still one too many): the
    // version line plus two log lines; the rest scrolls inside.
    'position:fixed;left:0;right:0;bottom:0;height:56px;overflow:auto;' +
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
    const said = (word: string) => { copy.textContent = word; setTimeout(() => (copy.textContent = 'COPY LOG'), 1500); };
    // The old way, for a browser that keeps the clipboard to itself: a hidden
    // text field, selected and copied.
    const byHand = (): boolean => {
      const ta = document.createElement('textarea');
      ta.value = lines;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, lines.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    };
    // IN THE APP THE WHOLE LOG GOES THROUGH THE SHARE SHEET (Roman, 11 Nov: in the
    // TestFlight app "the log does not want to copy … just the last sentence"). The
    // shell does not give a page the clipboard the way Safari does. The share sheet
    // is the system's own: Copy, AirDrop to the Mac, Notes, Mail — all of the log.
    const inTheApp = !!(window as any).Capacitor?.isNativePlatform?.();
    if (inTheApp && typeof navigator.share === 'function') {
      void navigator.share({ text: lines }).then(() => said('SENT'), () => said(byHand() ? 'COPIED' : 'FAILED'));
      return;
    }
    const write = navigator.clipboard?.writeText(lines);
    if (!write) { said(byHand() ? 'COPIED' : 'FAILED'); return; }
    void write.then(() => said('COPIED'), () => said(byHand() ? 'COPIED' : 'FAILED'));
  };
  box.appendChild(copy);

  document.body.appendChild(box);
  document.body.classList.add('fh-log-on');
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
/** A PHOTO IS LANDING: for the four seconds after the camera's live frame,
 *  every line says how many ms after it — the log's clock only has seconds, and
 *  what holds the page in that moment is a matter of tenths (11 Nov). */
let _landedAt = 0;
export function markLanding(): void { _landedAt = Date.now(); }
/** ms since the last photo's live frame came (a very big number when none has). */
export function msSinceLanding(): number { return _landedAt ? Date.now() - _landedAt : Number.MAX_SAFE_INTEGER; }

// THE LOG SURVIVES A RESTART OF THE PAGE (11 Nov, Roman's phone: after a photo the
// app came back in 3x2 and the log began at that moment — the page had started
// anew in the middle of the shot, and everything that led to it was gone). The
// newest lines are kept on the device; after a restart they stand below a line
// that says so. Camera lines are written at once, the rest twice a second.
const KEPT_KEY = 'fh_log_before';
let _keepTimer: number | null = null;
function writeKept(): void {
  _keepTimer = null;
  try { localStorage.setItem(KEPT_KEY, JSON.stringify(_recorded.slice(0, 150))); } catch { /* no room: the log is not worth it */ }
}
function keepAcrossRestart(now: boolean): void {
  if (!_inShell) return;
  if (now) { if (_keepTimer !== null) { clearTimeout(_keepTimer); } writeKept(); return; }
  if (_keepTimer === null) _keepTimer = window.setTimeout(writeKept, 500);
}
// Only in the app from the store: there the page can be restarted behind the
// user's back. In a browser a reload is the user's own, and the tests read the log.
const _inShell = (() => { try { return !!(window as any).Capacitor?.isNativePlatform?.(); } catch { return false; } })();
try {
  const before = _inShell ? JSON.parse(localStorage.getItem(KEPT_KEY) || '[]') as string[] : [];
  if (Array.isArray(before) && before.length) {
    _recorded.push(`${new Date().toLocaleTimeString()}  ===== THE PAGE STARTED ANEW HERE — the lines below are from before =====`, ...before.filter((l) => typeof l === 'string').slice(0, 150));
  }
} catch { /* nothing kept */ }

export function trace(msg: string): void {
  const since = _landedAt ? Date.now() - _landedAt : -1;
  const text = `${new Date().toLocaleTimeString()}  ${msg}${since >= 0 && since < 4000 ? `  [+${since}]` : ''}`;
  _recorded.unshift(text);                       // newest first
  if (_recorded.length > keepLines()) _recorded.length = keepLines();
  keepAcrossRestart(/camera|turn|^start:/.test(msg));

  // If the strip has to be built now, it draws the whole recorded history —
  // which already includes the line above. Drawing it again put every first line
  // in the log twice.
  const wasThere = box !== null;
  const el = ensureBox();
  if (!el) return;
  if (wasThere) appendLine(el, text);
  const lines = el.querySelectorAll('[data-line]');
  for (let i = keepLines(); i < lines.length; i++) lines[i].remove();
}
