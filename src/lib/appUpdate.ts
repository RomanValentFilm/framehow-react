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
import { captureFrameAnchor, scrollAnchorTo, setViewMode } from './view';

const DAY_KEY = 'fh_update_checked_day';
const PLACE_KEY = 'fh_after_update';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** The main file this page is running, e.g. "index-BwJL77Oe.js" — null on the
 *  bench, where the code is not built into one file. */
let _benchBuild: string | null = null;
function runningBuild(): string | null {
  if (_benchBuild) return _benchBuild;   // the bench names one (test 63)
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
      // ...and the VIEW (Roman, 10 Nov: "3x2 view would be best"): whoever was
      // in 3×2, the overview or a single strip comes back in it.
      const st = useStore.getState();
      if (i >= 0) sessionStorage.setItem(PLACE_KEY, JSON.stringify({
        i, view: st.currentViewMode, strips: st.activeStrips, needs: st.needsStripVisible, notes: st.notesStripVisible,
        group: st.activeGroupId,
      }));
    } catch { /* it opens at the top, then */ }
    trace('new version: reloading now');
    // SAY SO (Roman, 10 Nov): until the new page arrives the old one stays on
    // the screen — on a slow line that is a frozen app with no word. A box,
    // no button: there is nothing to press. It goes when the new page comes.
    const overlay = document.createElement('div');
    overlay.id = 'updatingNote';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.75);display:flex;'
      + 'align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    overlay.innerHTML = '<div style="background:#1a1a1a;border-radius:12px;padding:24px;max-width:380px;width:100%;color:#fff;text-align:center;">'
      + '<div style="color:#d52632;font-weight:700;font-size:15px;line-height:1.5;margin-bottom:12px;">UPDATING FRAMEHOW</div>'
      + '<div style="font-size:13px;line-height:1.5;">Loading the newest version — one moment.</div></div>';
    document.body.appendChild(overlay);
    window.setTimeout(() => window.location.reload(), 400);
  }, () => navigator.onLine && framesNeedingPush().size === 0 && !projectSettingsUnsent());
}

let asking = false;
async function askOncePerDay(): Promise<void> {
  if (asking || planned) return;
  if (document.visibilityState !== 'visible' || !navigator.onLine) return;
  // THE PROJECT FIRST (Roman, 10 Nov): the first opening of the day has to be
  // smooth — the app comes up and the project is on the screen before anything
  // is asked about versions. Not up yet: the next coming-to-front asks.
  if (!(window as unknown as { __fh_booted?: boolean }).__fh_booted) return;
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
    const page = await res.text();
    const out = page.match(/assets\/(index-[\w-]+\.js)/)?.[1];
    if (!out) return;
    if (out === mine) {
      try { localStorage.setItem(DAY_KEY, today()); } catch { /* asked again tomorrow anyway */ }
      trace('new version: asked today — this is the newest');
      return;
    }
    // ALL OF IT ON THE DEVICE FIRST (Roman, 10 Nov: "what if the connection is
    // bad, or it does not load fully?"). The new page's own files are fetched
    // whole, in the background, while the person works on. Only when every one
    // has arrived is the switch planned — it is then quick, and cannot leave a
    // half-loaded app. Any file missing: nothing happens, the day is not
    // marked, and it is tried again the next time the app comes to the front.
    const files = Array.from(new Set(Array.from(page.matchAll(/(?:src|href)="([^"]*assets\/[^"]+\.(?:js|mjs|css))"/g)).map((m) => m[1])));
    trace(`new version: ${out} is out, this is ${mine} — fetching ${files.length} file(s) first`);
    for (const f of files) {
      const r = await fetch(new URL(f, window.location.href).toString(), { cache: 'reload' });
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      await r.arrayBuffer();
    }
    // The offline copy (where there is one) takes the whole new build too.
    try { void (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* none here */ }
    try { localStorage.setItem(DAY_KEY, today()); } catch { /* asked again tomorrow anyway */ }
    reloadWhenQuiet(`${out} is on the device`);
  } catch (e) { trace(`new version: not fetched (${e instanceof Error ? e.message : 'no answer'}) — tried again next time`); }
  finally { asking = false; }
}

/** Back on the shot the page was on before the reload. */
function backToThePlace(): void {
  // THE SAME VIEW, NOT THE OPENING ONE (Roman, 10 Nov): "the user who does not
  // look at the phone in the moment of the update does not feel any
  // difference". The view, the strips that were lit, NEEDS or NOTES open.
  let i = -1;
  let was: { view?: string; strips?: string[]; needs?: boolean; notes?: boolean; group?: number | null } = {};
  try {
    const raw = sessionStorage.getItem(PLACE_KEY);
    sessionStorage.removeItem(PLACE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as typeof was & { i?: number };
    i = typeof p.i === 'number' ? p.i : -1;
    was = p;
  } catch { return; }
  if (!(i >= 0)) return;
  const t0 = Date.now();
  const id = window.setInterval(() => {
    const frames = useStore.getState().frames;
    if (frames.length > i) {
      window.clearInterval(id);
      window.setTimeout(() => {
        const views = ['main', 'ver', 'both', 'overview', 'grid4', 'grid3x2'];
        if (was.view && views.includes(was.view)) {
          const patch: Record<string, unknown> = {};
          if (Array.isArray(was.strips) && was.strips.length > 0) patch.activeStrips = was.strips;
          if (typeof was.needs === 'boolean') patch.needsStripVisible = was.needs;
          if (typeof was.notes === 'boolean') patch.notesStripVisible = was.notes;
          // The GROUP that was being looked at, if it is still there.
          if (typeof was.group === 'number' && useStore.getState().groups.some((g) => g.id === was.group)) patch.activeGroupId = was.group;
          useStore.setState(patch as never);
          setViewMode(was.view as never);
          (window as unknown as { __fh_renderAll?: () => void }).__fh_renderAll?.();
        }
        window.setTimeout(() => {
          scrollAnchorTo(frames[i].id);
          trace(`new version: running — back on shot ${i + 1}, view ${useStore.getState().currentViewMode}`);
        }, 300);
      }, 600);
    } else if (Date.now() - t0 > 15_000) window.clearInterval(id);
  }, 300);
}

/** THE BENCH (test 63): say which build is "running" and ask now. */
export function askNowAsIfRunning(build: string): Promise<void> {
  _benchBuild = build;
  try { localStorage.removeItem(DAY_KEY); } catch { /* fine */ }
  return askOncePerDay();
}

export function startUpdateCheck(): void {
  backToThePlace();
  document.addEventListener('visibilitychange', () => { void askOncePerDay(); });
  window.addEventListener('focus', () => { void askOncePerDay(); });
  window.addEventListener('pageshow', () => { void askOncePerDay(); });
}
