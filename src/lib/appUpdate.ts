// THE NEWEST VERSION — ASKED, NOT DONE TO YOU (Roman, 10 November).
//
// The app looked for a new version only when it STARTED. A phone app is not
// started, it is brought back to the front — so the simulator sat on a
// five-day-old version, and so would every phone. The first answer was to
// switch by itself at a quiet moment; on a real phone that restarted the app
// in the person's face, right as they began. So now:
//
//   - the first time the app comes to the front each day (the person's own
//     clock) it asks the server which build is out, once the project is up;
//   - a newer build is fetched WHOLE in the background — a bad line, or none,
//     changes nothing and it is tried again next time;
//   - after FIVE MINUTES OF USE a small card asks:
//         "A new version of Framehow is available — update?"  TOMORROW · NOW
//     It waits its turn like the save reminder (quietMoment.ts) and never
//     shows together with it;
//   - NOW: the work is saved (and sent, where there is somewhere to send it),
//     a box says UPDATING FRAMEHOW, the app restarts and comes back to the
//     same project, shot, view, lit buttons and versions;
//   - TOMORROW: not asked again today. A fresh start of the app in between is
//     on the new build anyway.
//
// "Which build is out" is the name of the app's main file in a fresh copy of
// the page — every build renames it. No extra file to publish, and it works
// the same in a browser, as a home-screen app and in the iPhone app's shell.

import { useStore } from '../store/state';
import { trace, isDebugDevice } from './syncTrace';
import { busyNow } from './quietMoment';
import { getActiveMs } from './activity';
import { framesNeedingPush, projectSettingsUnsent, isToasterShowing } from './accountFlow';
import { captureFrameAnchor, scrollAnchorToRel, setViewMode } from './view';
import { getStripActiveTab, setStripActiveTab, getStripVersions } from './helpers';
import { flushSyncNow, getCurrentProject, saveLocalNow } from './currentProject';
import { isLoggedIn } from './session';
import { enterGroup, updateGroupButtonState } from './groups';

const DAY_KEY = 'fh_update_checked_day';
/** Everything in the app that scrolls on its own, besides the window. */
const SCROLLERS = ['.columns', '#mainScroll', '#versionsScroll', '#floorScroll', '#refsScroll', '#needsScroll', '#notesScroll', '#overviewScroll'];
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
const LATER_KEY = 'fh_update_later_day';
const CARD_ID = 'updateCard';
/** Use before the card may show: five minutes; a debug device, twenty seconds. */
const useBeforeAsking = () => (isDebugDevice() ? 20_000 : 5 * 60_000);

/** Where the person is — written down for the page that comes back. */
function rememberThePlace(): void {
  try {
    const a = captureFrameAnchor();
    const i = a ? useStore.getState().frames.findIndex((f) => String(f.id) === String(a.fid)) : -1;
    // ...and the VIEW (Roman, 10 Nov: "3x2 view would be best"): whoever was
    // in 3×2, the overview or a single strip comes back in it.
    const st = useStore.getState();
    // WHICH VERSION EACH CARD WAS SHOWING (Roman, 10 Nov), by the shot's place
    // in the project: the strip's own tab, and the one the main card / 3×2
    // card had swiped to. Only where it is not the first — a short note.
    const shown: Array<[number, number, number, number, number, string]> = [];
    st.frames.forEach((f, at) => {
      const t = (['ver', 'floor', 'refs'] as const).map((k) => getStripActiveTab(f.id, k));
      const cc = st.crossCompare[f.id] ?? -1;
      if (t.some((x) => x > 0) || cc >= 0) shown.push([at, t[0], t[1], t[2], cc, String(st.crossCompareStrip[f.id] || 'ver')]);
    });
    if (i >= 0) sessionStorage.setItem(PLACE_KEY, JSON.stringify({
      i, rel: a ? a.rel : null,
      // HOW FAR EVERYTHING WAS SCROLLED, as plain numbers (run 638): the same
      // view comes back with the same bars and the same cards, so the same
      // numbers put the page exactly where it was — the card-and-offset way
      // came out 20 px off, measured on one column's card and put back on another's.
      sc: [Math.round(window.scrollY), ...SCROLLERS.map((q) => Math.round((document.querySelector(q) as HTMLElement | null)?.scrollTop ?? 0))],
      view: st.currentViewMode, strips: st.activeStrips, needs: st.needsStripVisible, notes: st.notesStripVisible,
      group: st.activeGroupId, shown,
    }));
  } catch { /* it opens at the top, then */ }
}

/** NOW was pressed: say so, save, send what can be sent, switch. */
async function switchNow(): Promise<void> {
  if (planned) return;
  planned = true;
  rememberThePlace();
  trace('new version: NOW — saving, then switching');
  // SAY SO: until the new page arrives the old one stays on the screen — on a
  // slow line that is a frozen app with no word. A box, no button: there is
  // nothing to press. It goes when the new page comes.
  const overlay = document.createElement('div');
  overlay.id = 'updatingNote';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.75);display:flex;'
    + 'align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
  overlay.innerHTML = '<div style="background:#1a1a1a;border-radius:12px;padding:24px;max-width:380px;width:100%;color:#fff;text-align:center;">'
    + '<div style="color:#d52632;font-weight:700;font-size:15px;line-height:1.5;margin-bottom:12px;">UPDATING FRAMEHOW</div>'
    + '<div style="font-size:13px;line-height:1.5;">Loading the newest version — one moment.</div></div>';
  document.body.appendChild(overlay);
  const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p.catch(() => undefined), new Promise((r) => window.setTimeout(r, ms))]);
  // EVERYTHING ON THE DEVICE FIRST (rule one: never lose work) — the app's own
  // local save, now, so the page that comes back finds this second's work.
  await within(saveLocalNow(), 3000);
  // ...and to the server, where there is one to send to: signed in, a project
  // that has been saved, a line. Eight seconds at most — what does not go now
  // is on the device and goes after the restart, as any unsent work does.
  if (navigator.onLine && isLoggedIn() && getCurrentProject().projectId !== null
    && (framesNeedingPush().size > 0 || projectSettingsUnsent())) {
    trace('new version: something still to send — sending first');
    await within(flushSyncNow(), 8000);
    await within(saveLocalNow(), 3000);
  }
  trace('new version: reloading now');
  window.setTimeout(() => window.location.reload(), 300);
}

let ready = false;
let watching = false;
let cardUp = false;
let benchSaysUsedEnough = false;
function laterToday(): boolean {
  try { return localStorage.getItem(LATER_KEY) === today(); } catch { return false; }
}

/** The card. Small, in the middle like the save reminder, blocking nothing. */
function showCard(): void {
  if (cardUp || planned) return;
  cardUp = true;
  const card = document.createElement('div');
  card.id = CARD_ID;
  card.className = 'save-toaster hidden';
  card.setAttribute('role', 'status');
  card.innerHTML = '<div class="save-toaster-card"><div class="save-toaster-msg" style="text-align:center">A new version of Framehow is available — update?</div>'
    + '<div class="save-toaster-btns" style="justify-content:center"><button class="btn" type="button" id="updateCardLater">TOMORROW</button>'
    + '<button class="btn btn-accent" type="button" id="updateCardNow">NOW</button></div></div>';
  document.body.appendChild(card);
  requestAnimationFrame(() => card.classList.remove('hidden'));
  trace('new version: asking — TOMORROW or NOW');
  const gone = () => { window.clearInterval(aside); card.remove(); cardUp = false; };
  // It steps aside for a box, the keyboard, DRAW, the camera — and comes back.
  const aside = window.setInterval(() => {
    if (!busyNow()) return;
    trace(`new version: the question steps aside (${busyNow()})`);
    gone();
  }, 500);
  (card.querySelector('#updateCardLater') as HTMLElement).onclick = () => {
    try { localStorage.setItem(LATER_KEY, today()); } catch { /* asked again sooner, no harm */ }
    trace('new version: TOMORROW — not asked again today');
    gone();
  };
  (card.querySelector('#updateCardNow') as HTMLElement).onclick = () => { gone(); void switchNow(); };
}

/** A newer build is on the device: ask, when the time is right. */
export function offerUpdate(why: string): void {
  if (planned) return;
  if (!ready) trace(`new version: ${why} — asking after ${Math.round(useBeforeAsking() / 1000)} s of use`);
  ready = true;
  if (watching) return;
  watching = true;
  let quietLooks = 0;
  window.setInterval(() => {
    if (!ready || planned || cardUp || laterToday()) { quietLooks = 0; return; }
    if (document.visibilityState !== 'visible') { quietLooks = 0; return; }
    if (!benchSaysUsedEnough && getActiveMs() < useBeforeAsking()) return;
    // One question at a time: the save reminder first — it protects work.
    if (busyNow() || isToasterShowing()) { quietLooks = 0; return; }
    if (++quietLooks < 2) return;
    quietLooks = 0;
    showCard();
  }, 2000);
}

/** THE BENCH (test 63): the five minutes of use have passed. */
export function benchUsedEnough(): void { benchSaysUsedEnough = true; }

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
  // ...and its TOMORROW lasts only until it next comes to the front.
  if (isDebugDevice()) { try { localStorage.removeItem(LATER_KEY); } catch { /* fine */ } }
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
    offerUpdate(`${out} is on the device`);
  } catch (e) { trace(`new version: not fetched (${e instanceof Error ? e.message : 'no answer'}) — tried again next time`); }
  finally { asking = false; }
}

/** Back on the shot the page was on before the reload. */
function backToThePlace(): void {
  // THE SAME VIEW, NOT THE OPENING ONE (Roman, 10 Nov): "the user who does not
  // look at the phone in the moment of the update does not feel any
  // difference". The view, the strips that were lit, NEEDS or NOTES open.
  let i = -1;
  let was: { view?: string; strips?: string[]; needs?: boolean; notes?: boolean; group?: number | null;
    rel?: number | null; sc?: number[]; shown?: Array<[number, number, number, number, number, string]> } = {};
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
        // EVERY BUTTON LIT AS IT WAS (Roman, 10 Nov: "do not miss any buttons
        // lit"). So nothing is painted here by hand: each piece goes through
        // the app's OWN door, the one that lights its button —
        //   the view and the strips: setViewMode (lights 3×2 / M+2 / M+3 and
        //     every strip button from what is on);
        //   NEEDS and NOTES: their own buttons, pressed, if they were on;
        //   the group: enterGroup (the red name beside GROUP, the red button).
        const views = ['main', 'ver', 'both', 'overview', 'grid4', 'grid3x2'];
        if (was.view && views.includes(was.view)) {
          if (Array.isArray(was.strips) && was.strips.length > 0) useStore.setState({ activeStrips: was.strips } as never);
          setViewMode(was.view as never);
          const press = (id: string, want: boolean | undefined, on: boolean) => {
            if (typeof want === 'boolean' && want !== on) document.getElementById(id)?.click();
          };
          press('needsStripBtn', was.needs, useStore.getState().needsStripVisible);
          press('notesStripBtn', was.notes, useStore.getState().notesStripVisible);
        }
        if (typeof was.group === 'number' && useStore.getState().groups.some((g) => g.id === was.group)
          && useStore.getState().activeGroupId !== was.group) {
          enterGroup(was.group);
          updateGroupButtonState();
        }
        // THE VERSION EACH CARD WAS SHOWING — after the view is set (setting a
        // view lets go of the swiped-to version), then drawn once more with it.
        if (Array.isArray(was.shown) && was.shown.length > 0) {
          const now = useStore.getState();
          for (const [at, ver, floor, refs, cc, ccStrip] of was.shown) {
            const f = frames[at];
            if (!f) continue;
            ([['ver', ver], ['floor', floor], ['refs', refs]] as const).forEach(([k, idx]) => {
              if (idx > 0 && idx < (getStripVersions(f.id, k)?.length ?? 0)) setStripActiveTab(f.id, k, idx);
            });
            if (cc >= 0 && cc < (getStripVersions(f.id, ccStrip as never)?.length ?? 0)) {
              now.crossCompare[f.id] = cc;
              (now.crossCompareStrip as Record<number, string>)[f.id] = ccStrip;
            }
          }
          if (was.view && views.includes(was.view)) setViewMode(was.view as never, true);
          (window as unknown as { __fh_renderAll?: () => void }).__fh_renderAll?.();
        }
        window.setTimeout(() => {
          // THE SAME SHOT AT THE SAME HEIGHT (Roman, 10 Nov) — not centred.
          const put = () => {
            if (Array.isArray(was.sc) && was.sc.length === SCROLLERS.length + 1) {
              SCROLLERS.forEach((q, k) => { const e = document.querySelector(q) as HTMLElement | null; if (e) e.scrollTop = was.sc![k + 1]; });
              window.scrollTo(0, was.sc[0]);
              return;
            }
            scrollAnchorToRel(frames[i].id, typeof was.rel === 'number' ? was.rel : null);
          };
          put();
          trace(`new version: running — back on shot ${i + 1}, view ${useStore.getState().currentViewMode}`);
          // ...AND AGAIN ONCE THE CARDS HAVE THEIR HEIGHTS (run 636: 20 px off).
          // Pictures and the equal-height pass land after the first placing and
          // move every card; the page is put on its shot again when they have —
          // unless the person has already moved it themselves.
          let touched = false;
          const mine = () => { touched = true; };
          window.addEventListener('wheel', mine, { once: true, passive: true });
          window.addEventListener('touchstart', mine, { once: true, passive: true });
          [900, 2000].forEach((ms) => window.setTimeout(() => { if (!touched) put(); }, ms));
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
