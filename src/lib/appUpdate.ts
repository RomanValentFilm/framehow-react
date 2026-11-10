// THE NEWEST VERSION, BY ITSELF, ONCE A DAY (Roman, 10 November).
//
// The app looked for a new version only when it STARTED. A phone app is not
// started, it is brought back to the front — so the simulator sat on a
// five-day-old version, and so would every phone. Now:
//
//   - the first time the app comes to the front each day (the person's own
//     clock, so after midnight) it asks the server which build is out;
//   - if that is not the build running, it reloads — but only at a quiet
//     moment (quietMoment.ts: no box open, nobody typing or drawing, the
//     camera off) and with nothing waiting to be sent;
//   - the reload is silent: the session lives in the device's storage, so
//     nobody signs in again; the same project opens from the device, and the
//     page goes back to the shot it was on.
//
// "Which build is out" is the name of the app's main file in a fresh copy of
// the page — every build renames it. No extra file to publish, and it works
// the same in a browser, as a home-screen app and in the iPhone app's shell.

import { useStore } from '../store/state';
import { trace, isDebugDevice } from './syncTrace';
import { whenQuiet } from './quietMoment';
import { framesNeedingPush, projectSettingsUnsent } from './accountFlow';
import { captureFrameAnchor, scrollAnchorTo } from './view';

const DAY_KEY = 'fh_update_checked_day';
const PLACE_KEY = 'fh_after_update';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** The main file this page is running, e.g. "index-BwJL77Oe.js" — null on the
 *  bench, where the code is not built into one file. */
function runningBuild(): string | null {
  for (const s of Array.from(document.querySelectorAll('script[src]'))) {
    const m = (s as HTMLScriptElement).src.match(/assets\/(index-[\w-]+\.js)/);
    if (m) return m[1];
  }
  return null;
}

let planned = false;
/** Reload at the first quiet moment with nothing left to send. Once. */
export function reloadWhenQuiet(why: string): void {
  if (planned) return;
  planned = true;
  trace(`new version: ${why} — reloading at the next quiet moment`);
  whenQuiet(() => {
    try {
      const a = captureFrameAnchor();
      const i = a ? useStore.getState().frames.findIndex((f) => String(f.id) === String(a.fid)) : -1;
      if (i >= 0) sessionStorage.setItem(PLACE_KEY, String(i));
    } catch { /* it opens at the top, then */ }
    trace('new version: reloading now');
    window.location.reload();
  }, () => navigator.onLine && framesNeedingPush().size === 0 && !projectSettingsUnsent());
}

let asking = false;
async function askOncePerDay(): Promise<void> {
  if (asking || planned) return;
  if (document.visibilityState !== 'visible' || !navigator.onLine) return;
  const mine = runningBuild();
  if (!mine) return;
  let said: string | null = null;
  try { said = localStorage.getItem(DAY_KEY); } catch { /* asked again, no harm */ }
  // A debug device (three taps on the version) asks every time it comes to the
  // front — so the thing can be watched without waiting for midnight.
  if (said === today() && !isDebugDevice()) return;
  asking = true;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}index.html?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const out = (await res.text()).match(/assets\/(index-[\w-]+\.js)/)?.[1];
    if (!out) return;
    try { localStorage.setItem(DAY_KEY, today()); } catch { /* asked again tomorrow anyway */ }
    if (out === mine) { trace('new version: asked today — this is the newest'); return; }
    reloadWhenQuiet(`${out} is out, this is ${mine}`);
  } catch { /* no answer: asked again the next time it comes to the front */ }
  finally { asking = false; }
}

/** Back on the shot the page was on before the reload. */
function backToThePlace(): void {
  let i = -1;
  try { i = Number(sessionStorage.getItem(PLACE_KEY) ?? -1); sessionStorage.removeItem(PLACE_KEY); } catch { return; }
  if (!(i >= 0)) return;
  const t0 = Date.now();
  const id = window.setInterval(() => {
    const frames = useStore.getState().frames;
    if (frames.length > i) {
      window.clearInterval(id);
      window.setTimeout(() => { scrollAnchorTo(frames[i].id); trace(`new version: running — back on shot ${i + 1}`); }, 600);
    } else if (Date.now() - t0 > 15_000) window.clearInterval(id);
  }, 300);
}

export function startUpdateCheck(): void {
  backToThePlace();
  document.addEventListener('visibilitychange', () => { void askOncePerDay(); });
  window.addEventListener('focus', () => { void askOncePerDay(); });
  window.addEventListener('pageshow', () => { void askOncePerDay(); });
}
