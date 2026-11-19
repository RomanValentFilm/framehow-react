// THE SWITCH — A PIECE OF SAFETY CODE OF ITS OWN (Roman, 19 November).
//
// "If shit hits the fan, we want to be able to help people right away." And:
// "the switch should just never be mistaken with the 3rd card — the switch
// needs to be a totally separate piece of safety code in our app."
//
// So this file knows nothing of the update cards, their fourteen days or their
// memory, and they know nothing of it. It has its own question to the server,
// its own memory, its own box and its own restart. A fault in the one cannot
// take the other down.
//
// WHAT IT IS. One small file next to the app, update-rules.json:
//
//     "stop_and_update_below": null          ← off, the normal state
//     "stop_and_update_below": "v5.0.400"    ← ON for every app older than that
//
// WHAT AN APP DOES WHEN THE SWITCH IS ON FOR IT — and only when a newer version
// really is out (a switch set by mistake above the newest version must lock
// nobody in):
//   1. IT SENDS NOTHING MORE to the server. The work goes on being saved on the
//      device, as when offline, and goes up after the update — sent by the new
//      version, not by the one that was stopped.
//   2. At the first safe moment — the same quiet moment everything else in the
//      app waits for, and not while a fetch is being applied — a box over the
//      app: "This version is no longer supported. Please update Framehow to
//      continue." · UPDATE NOW. No other button.
//   3. UPDATE NOW: the project is saved on the device; the line is checked (no
//      line → nothing restarts, and it says so); the app restarts on the
//      newest version, the project comes from the device.
//
// WHEN IT ASKS. Once a day: the first time the app is in front, started up and
// online — and again when a new day begins on an app that was never put away.
// No five minutes of use, no waiting days. With no line it never blocks: it
// cannot ask, and the box is never shown offline.
//
// HOW WE USE IT. Change the one line in public/update-rules.json to the oldest
// version that may go on, deploy. Every app that is online follows within a
// day. Only for a version that does harm. Not on the day of a release.

import { APP_VERSION } from '../store/state';
import { trace } from './syncTrace';
import { busyToShow } from './quietMoment';
import { isLoadInFlight, registerSendingStopped, saveLocalNow } from './currentProject';

const DAY_KEY = 'fh_switch_asked_day';
const BOX_ID = 'safetySwitchOverlay';      // (…Overlay: every other card and reminder steps aside for it)

function today(): string { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
const parts = (v: string): number[] => (v.match(/\d+/g) ?? []).map(Number);
function older(a: string, b: string): boolean {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/** The version below which an app must stop — as last read; null = off. */
let below: string | null = null;
/** A newer version of the app is really out (asked by this file itself). */
let newerIsOut = false;
let askedAt = 0;
let boxUp = false;
let restarting = false;
/** THE BENCH names the build that is "running" (the tests run unbuilt code). */
let benchBuild: string | null = null;

function runningBuild(): string | null {
  if (benchBuild) return benchBuild;
  for (const s of Array.from(document.querySelectorAll('script[src]'))) {
    const m = (s as HTMLScriptElement).src.match(/assets\/(index-[\w-]+\.js)/);
    if (m) return m[1];
  }
  return null;
}
async function buildThatIsOut(): Promise<string | null> {
  try {
    const stop = new AbortController();
    const t = window.setTimeout(() => stop.abort(), 5000);
    const res = await fetch(`${import.meta.env.BASE_URL}index.html?v=${Date.now()}`, { cache: 'no-store', signal: stop.signal });
    window.clearTimeout(t);
    if (!res.ok) return null;
    return (await res.text()).match(/assets\/(index-[\w-]+\.js)/)?.[1] ?? null;
  } catch { return null; }
}

/** ON, for this app, now. */
export function switchIsOn(): boolean { return !!below && older(APP_VERSION, below) && newerIsOut; }

async function ask(): Promise<void> {
  askedAt = Date.now();
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}update-rules.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) { askedAt = Date.now() + 9 * 60_000; return; }           // no such file here: asked again in ten minutes
    const r = await res.json() as { stop_and_update_below?: unknown };
    const said = typeof r.stop_and_update_below === 'string' && /^v?\d+(\.\d+){1,3}$/.test(r.stop_and_update_below) ? r.stop_and_update_below : null;
    try { localStorage.setItem(DAY_KEY, today()); } catch { /* asked again sooner, no harm */ }
    if (said !== below) trace(`the switch: ${said ? `versions older than ${said} must stop sending and update — this is ${APP_VERSION}` : 'off'}`);
    below = said;
    if (!below || !older(APP_VERSION, below)) { newerIsOut = false; return; }
    // It is about this version. Is there really a newer one to go to?
    const mine = runningBuild();
    const out = await buildThatIsOut();
    newerIsOut = !!mine && !!out && out !== mine;
    trace(newerIsOut
      ? 'the switch: ON for this version — nothing more is sent; the box comes at the first safe moment'
      : 'the switch: it names this version, but no newer version is out (or no answer) — not obeyed; asked again in a minute');
    if (!newerIsOut) { try { localStorage.removeItem(DAY_KEY); } catch { /* fine */ } }
  } catch { /* no line: asked at the next chance */ }
}

function showBox(): void {
  if (boxUp || restarting) return;
  boxUp = true;
  const box = document.createElement('div');
  box.id = BOX_ID;
  box.style.cssText = 'position:fixed;inset:0;z-index:999990;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;'
    + 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
  box.innerHTML = '<div style="background:#1a1a1a;border-radius:12px;padding:24px;max-width:380px;width:100%;color:#fff;text-align:center;">'
    + '<div style="font-size:14px;line-height:1.5;margin-bottom:18px;">This version is no longer supported.<br>Please update Framehow to continue.</div>'
    + '<button class="btn" type="button" id="safetySwitchNow">UPDATE NOW</button>'
    + '<div id="safetySwitchSays" style="font-size:12px;line-height:1.5;color:#aaa;margin-top:12px;min-height:18px;"></div></div>';
  document.body.appendChild(box);
  trace('the switch: the box is up — UPDATE NOW is the only button');
  const gone = () => { window.removeEventListener('offline', lineGone); box.remove(); boxUp = false; };
  // NO LINE, NOTHING BLOCKS: the box goes if the line goes, and comes back with it.
  const lineGone = () => { trace('the switch: the line went — the box goes too'); gone(); };
  window.addEventListener('offline', lineGone, { once: true });
  const says = box.querySelector('#safetySwitchSays') as HTMLElement;
  (box.querySelector('#safetySwitchNow') as HTMLElement).onclick = () => { void updateNow(says); };
}

async function updateNow(says: HTMLElement): Promise<void> {
  if (restarting) return;
  restarting = true;
  says.textContent = 'Updating Framehow — one moment.';
  trace('the switch: UPDATE NOW — saving on the device, then restarting (nothing is sent by this version)');
  // THE PLACE, if the update's own code is there to note it (shot, view, lit buttons).
  // A help only: this file must work without it.
  try { (await import('./appUpdate')).rememberPlaceForReload?.(); } catch { /* it opens at the top, then */ }
  // RULE ONE: on the device first.
  await Promise.race([saveLocalNow().catch(() => undefined), new Promise((r) => window.setTimeout(r, 3000))]);
  // THE LINE, checked this second: no line, nothing restarts.
  const mine = runningBuild();
  const out = navigator.onLine ? await buildThatIsOut() : null;
  if (!out || out === mine) {
    trace('the switch: UPDATE NOW, but the new version is not within reach — nothing restarted');
    says.textContent = 'No connection — Framehow was not reloaded. Try again when you are online.';
    restarting = false;
    return;
  }
  trace('the switch: reloading now');
  window.setTimeout(() => window.location.reload(), 300);
}

/** Started once, with the app. */
export function startSafetySwitch(): void {
  // Asked before every push, retry and upload of unsent copies (currentProject).
  registerSendingStopped(() => switchIsOn());
  let quietLooks = 0;
  window.setInterval(() => {
    if (boxUp || restarting) { quietLooks = 0; return; }
    if (document.visibilityState !== 'visible' || !navigator.onLine) { quietLooks = 0; return; }
    if (!(window as unknown as { __fh_booted?: boolean }).__fh_booted) return;
    let day: string | null = null;
    try { day = localStorage.getItem(DAY_KEY); } catch { /* asked again, no harm */ }
    if (day !== today() && Date.now() - askedAt > 60_000) { void ask(); return; }
    if (!switchIsOn()) { quietLooks = 0; return; }
    // THE SAFE MOMENT: nothing in progress, no box open, no project being opened,
    // no save going up — and no fetch being applied. Two looks in a row.
    if (busyToShow() || isLoadInFlight()) { quietLooks = 0; return; }
    if (++quietLooks < 2) return;
    quietLooks = 0;
    showBox();
  }, 2000);
}

/** THE BENCH: read the switch now, as if this build were running. */
export async function benchAskTheSwitch(build: string): Promise<void> { benchBuild = build; askedAt = 0; await ask(); }
