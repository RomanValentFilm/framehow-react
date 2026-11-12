// A NEW VERSION: THE PERSON IS TOLD, AND DECIDES (Roman, 10 November).
//
// The app looked for a new version only when it STARTED, and a phone app is
// brought back to the front far more often than it is started — the simulator
// sat on a five-day-old version. Three designs were built and thrown away on
// the same day (switch by itself at a quiet moment; download in the background
// and ask; ...) — each restarted, or fetched, behind the person's back. What
// stands, in Roman's words: "I hate updates myself — only inform, and let the
// user decide." So:
//
//   - NOTHING AT THE START. After FIVE MINUTES OF USE that day, the app asks
//     the server one small question: which build is out? Nothing is downloaded.
//   - If it is newer than the one running, a small card, in the middle, at a
//     quiet moment (quietMoment.ts), never together with the save reminder:
//         "A new version of Framehow is available.
//          Reload only if you are on a stable internet connection."
//                        NOT NOW  ·  RELOAD
//   - AT MOST TWICE PER VERSION: once, and once more on a later day. Then
//     silence until a newer version still exists.
//   - RELOAD: the work is saved to the device (and sent, where there is
//     somewhere to send it); the line is CHECKED — no line, nothing restarts,
//     and it says so; a box says UPDATING FRAMEHOW; the app restarts like any
//     opening (the project from the device, then the usual loading bar) and
//     comes back to the same shot, view, lit buttons and versions. In the
//     middle of the screen, for a moment: "Framehow is updated."
//   - NOT NOW, or no answer: a fresh start of the app is on the newest version
//     anyway — that is the main way, as it always was.
//
// "Which build is out" is the name of the app's main file in a fresh copy of
// the page — every build renames it. The same in a browser, as a home-screen
// app and inside the App Store shell (which opens the app from the server).

import { useStore } from '../store/state';
import { trace } from './syncTrace';
import { busyNow, busyToShow } from './quietMoment';
import { getActiveMs } from './activity';
import { framesNeedingPush, projectSettingsUnsent, isToasterShowing } from './accountFlow';
import { captureFrameAnchor, scrollAnchorToRel, setViewMode } from './view';
import { getStripActiveTab, setStripActiveTab, getStripVersions, setStripCrossCompare } from './helpers';
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
/** { build, days[] } — the days the card was answered NOT NOW for that build. */
const ASKED_KEY = 'fh_update_asked';
const FROM_KEY = 'fh_update_from';
const CARD_ID = 'updateCard';
/** Use before anything is asked or shown: five minutes — on every device, Roman's own too
 *  (the twenty-second shortcut for testing went on his nerves, 10 Nov). */
const useBeforeAsking = () => 5 * 60_000;

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
/**
 * IS THE NEW VERSION REALLY WITHIN REACH, THIS SECOND? (Roman, 10 Nov: "the app
 * downloads the update and then the phone goes offline — the project cannot be
 * reloaded. A big no go.")
 *
 * A restart needs the line: the page, and then the project's pictures. So NOW
 * asks the server for the page once more, five seconds at most, and goes on
 * only if the answer is the newer build. No line, a weak one, or a server that
 * does not answer: nothing is restarted, nothing is changed, and it says so.
 */
async function withinReach(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const stop = new AbortController();
    const t = window.setTimeout(() => stop.abort(), 5000);
    const res = await fetch(`${import.meta.env.BASE_URL}index.html?v=${Date.now()}`, { cache: 'no-store', signal: stop.signal });
    window.clearTimeout(t);
    if (!res.ok) return false;
    const out = (await res.text()).match(/assets\/(index-[\w-]+\.js)/)?.[1];
    return !!out && out !== runningBuild();
  } catch { return false; }
}

/** How long to stay quiet — the same on every device. */
const waitFor = (ms: number) => ms;
/** After a NOW that could not go on: not asked again for a while. */
let heldUntil = 0;

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
  if (!(await withinReach())) {
    trace('new version: NOW, but the new version is not within reach (no line?) — nothing restarted');
    overlay.remove();
    planned = false;
    heldUntil = Date.now() + waitFor(10 * 60_000);
    // The person WANTED the update — so this showing is not one of the two:
    // the card comes back (ten minutes on, with a line), as the box promises.
    if (newer) forgetToday(newer);
    try { sessionStorage.removeItem(PLACE_KEY); } catch { /* fine */ }
    void import('./modals').then((m) => m.showImportantNote('NO CONNECTION',
      'Framehow was not reloaded.'));
    return;
  }
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
  // THE APP MUST KNOW AFTERWARDS WHETHER IT WAS UPDATED (Roman, 10 Nov): which
  // build was running is written down; the page that comes back compares.
  try { sessionStorage.setItem(FROM_KEY, runningBuild() ?? ''); } catch { /* it cannot tell, then */ }
  trace('new version: reloading now');
  window.setTimeout(() => window.location.reload(), 300);
}

/** The first thing after a restart: was it updated, or did the old one come back? */
function learnWhetherUpdated(): void {
  let from = '';
  try { from = sessionStorage.getItem(FROM_KEY) ?? ''; sessionStorage.removeItem(FROM_KEY); } catch { return; }
  const now = runningBuild();
  if (!from || !now) return;
  if (now !== from) {
    trace(`new version: UPDATED — was ${from}, now ${now}`);
    try { localStorage.removeItem(ASKED_KEY); } catch { /* fine */ }
    // ...and ONLY that line: the "swipe over the image" hint every start shows
    // came up on top of it on Roman's phone (10 Nov) — two dark boxes with
    // white words, and the wrong one read. Not after an update.
    useStore.setState({ swipeHintShown: true });
    sayInTheMiddle('Framehow is updated.');
  } else {
    // The old build came back (the line went between the question and the
    // restart, and the device's own copy answered). Not updated — so it is
    // looked for again the next time the app comes to the front.
    trace(`new version: NOT updated — ${now} came back; asking again next time`);
    try { localStorage.removeItem(DAY_KEY); } catch { /* fine */ }
  }
}

/** A short line in the MIDDLE of the screen, gone by itself (Roman: "in the middle, not bottom"). */
function sayInTheMiddle(text: string): void {
  const el = document.createElement('div');
  el.id = 'updatedLine';
  el.textContent = text;
  el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:350000;'
    + 'background:#1a1a1a;border:1px solid #555;border-radius:10px;padding:14px 22px;color:#fff;'
    + 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;font-weight:600;text-align:center;'
    + 'box-shadow:0 12px 32px rgba(0,0,0,.5);pointer-events:none;transition:opacity .4s ease;';
  const put = () => {
    document.body.appendChild(el);
    window.setTimeout(() => { el.style.opacity = '0'; }, 2600);
    window.setTimeout(() => el.remove(), 3100);
  };
  // After the app is up, so it is read over the project and not over a blank page.
  const t0 = Date.now();
  const id = window.setInterval(() => {
    if ((window as unknown as { __fh_booted?: boolean }).__fh_booted || Date.now() - t0 > 20_000) { window.clearInterval(id); window.setTimeout(put, 800); }
  }, 300);
}

let newer: string | null = null;   // the build that is out, when it is not this one
let cardUp = false;
/** The card stepped aside for a box today, unanswered: it may come back today. */
let comesBackToday: string | null = null;
let benchSaysUsedEnough = false;

/** May the card show for this build today? At most twice per build, on two days. */
function mayAsk(build: string): boolean {
  try {
    const a = JSON.parse(localStorage.getItem(ASKED_KEY) ?? 'null') as { build?: string; days?: string[] } | null;
    if (!a || a.build !== build) return true;            // a build never asked about
    const days = a.days ?? [];
    return days.length < 2 && !days.includes(today());
  } catch { return true; }
}
function noteNotNow(build: string): void {
  try {
    const a = JSON.parse(localStorage.getItem(ASKED_KEY) ?? 'null') as { build?: string; days?: string[] } | null;
    const days = a && a.build === build ? (a.days ?? []) : [];
    if (!days.includes(today())) days.push(today());
    localStorage.setItem(ASKED_KEY, JSON.stringify({ build, days }));
  } catch { /* asked once more than meant, no harm */ }
}

/** RELOAD was wanted and could not be done (no line): that showing does not count. */
function forgetToday(build: string): void {
  try {
    const a = JSON.parse(localStorage.getItem(ASKED_KEY) ?? 'null') as { build?: string; days?: string[] } | null;
    if (!a || a.build !== build) return;
    localStorage.setItem(ASKED_KEY, JSON.stringify({ build, days: (a.days ?? []).filter((d) => d !== today()) }));
  } catch { /* fine */ }
}

/** The card. Small, in the middle like the save reminder, blocking nothing. */
function showCard(build: string): void {
  if (cardUp || planned) return;
  cardUp = true;
  const card = document.createElement('div');
  card.id = CARD_ID;
  card.className = 'save-toaster hidden';
  card.setAttribute('role', 'status');
  card.innerHTML = '<div class="save-toaster-card"><div class="save-toaster-msg" style="text-align:center">A new version of Framehow is available.<br>'
    + 'Reload only if you are on a stable internet connection.</div>'
    // NEITHER BUTTON IS LIT (Roman): this tells, it does not push.
    + '<div class="save-toaster-btns" style="justify-content:center"><button class="btn" type="button" id="updateCardLater">NOT NOW</button>'
    + '<button class="btn" type="button" id="updateCardNow">RELOAD</button></div></div>';
  document.body.appendChild(card);
  requestAnimationFrame(() => card.classList.remove('hidden'));
  trace('new version: telling the person — NOT NOW or RELOAD');
  // SHOWN IS TOLD (Roman: "if someone closes the iPad, the question disappears
  // and comes back next day?" — yes). The day counts from the moment the card
  // is on the screen, answered or not: left unanswered and the device put
  // away, it is gone, and comes once more on a later day.
  noteNotNow(build);
  const gone = () => { window.clearInterval(aside); document.removeEventListener('visibilitychange', away); window.removeEventListener('offline', lineGone); card.remove(); cardUp = false; };
  // It steps aside for a box, the keyboard, DRAW, the camera — and comes back
  // the same day when that is done (it was not answered, only in the way).
  const aside = window.setInterval(() => {
    if (!busyNow()) return;
    trace(`new version: the card steps aside (${busyNow()})`);
    comesBackToday = build;
    gone();
  }, 500);
  // The app put away (the iPad closed, another app): the card goes with it.
  const away = () => { if (document.visibilityState !== 'visible') { trace('new version: the app was put away — the card is gone until a later day'); comesBackToday = null; heldUntil = Date.now() + waitFor(2 * 60_000); gone(); } };
  document.addEventListener('visibilitychange', away);
  // NO LINE, NO QUESTION (Roman): the card is never shown offline — and if the
  // line goes while it is up, it goes too, uncounted, and returns with the line.
  const lineGone = () => { trace('new version: the line went — the card goes too'); comesBackToday = build; forgetToday(build); gone(); };
  window.addEventListener('offline', lineGone, { once: true });
  (card.querySelector('#updateCardLater') as HTMLElement).onclick = () => {
    comesBackToday = null;
    heldUntil = Date.now() + waitFor(2 * 60_000);   // a debug device is told every time — but not at once again
    trace('new version: NOT NOW');
    gone();
  };
  (card.querySelector('#updateCardNow') as HTMLElement).onclick = () => { gone(); void switchNow(); };
}

/** THE BENCH (test 63): the five minutes of use have passed. */
export function benchUsedEnough(): void { benchSaysUsedEnough = true; heldUntil = 0; }

let asking = false;
/** One small question to the server: which build is out? Nothing is downloaded. */
async function askTheServer(): Promise<void> {
  if (asking || planned) return;
  const mine = runningBuild();
  if (!mine) return;
  asking = true;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}index.html?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const out = (await res.text()).match(/assets\/(index-[\w-]+\.js)/)?.[1];
    if (!out) return;
    try { localStorage.setItem(DAY_KEY, today()); } catch { /* asked again sooner, no harm */ }
    if (out === mine) { newer = null; trace('new version: asked — this is the newest'); return; }
    newer = out;
    trace(`new version: ${out} is out, this is ${mine}${mayAsk(out) ? '' : ' — the person has been told twice, not again for this one'}`);
  } catch (e) { trace(`new version: no answer (${e instanceof Error ? e.message : '?'}) — asked again later`); }
  finally { asking = false; }
}

/**
 * THE ONE CLOCK. Every few seconds: is it time to ask the server (five minutes
 * of use, once a day)? Is there a newer build and may the card show (a quiet
 * moment, a line, not twice already, the save reminder not up)?
 */
function watch(): void {
  let quietLooks = 0;
  window.setInterval(() => {
    if (planned || cardUp) { quietLooks = 0; return; }
    if (document.visibilityState !== 'visible' || !navigator.onLine) { quietLooks = 0; return; }
    if (!(window as unknown as { __fh_booted?: boolean }).__fh_booted) return;
    // NOT AT THE START (Roman): five minutes of use first — the question too.
    if (!benchSaysUsedEnough && getActiveMs() < useBeforeAsking()) return;
    let said: string | null = null;
    try { said = localStorage.getItem(DAY_KEY); } catch { /* asked again, no harm */ }
    if (!newer && !asking && said !== today() && Date.now() - lastAsked > 60_000) {
      lastAsked = Date.now();
      void askTheServer();
      return;
    }
    if (!newer || !(mayAsk(newer) || comesBackToday === newer) || Date.now() < heldUntil) { quietLooks = 0; return; }
    // One thing at a time: the save reminder first — it protects work.
    if (busyToShow() || isToasterShowing()) { quietLooks = 0; return; }
    if (++quietLooks < 2) return;
    quietLooks = 0;
    showCard(newer);
  }, 2000);
}
let lastAsked = 0;

/** THE BENCH (test 63): say which build is "running", the five minutes have passed — ask now. */
export async function askNowAsIfRunning(build: string): Promise<void> {
  _benchBuild = build;
  benchSaysUsedEnough = true;
  heldUntil = 0;
  newer = null;
  lastAsked = Date.now();
  await askTheServer();
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
        // Put each card back on its version; says whether anything had to change.
        const showVersions = (): boolean => {
          if (!Array.isArray(was.shown) || was.shown.length === 0) return false;
          const now = useStore.getState();
          let changed = false;
          for (const [at, ver, floor, refs, cc, ccStrip] of was.shown) {
            const f = now.frames[at];
            if (!f) continue;
            ([['ver', ver], ['floor', floor], ['refs', refs]] as const).forEach(([k, idx]) => {
              if (idx > 0 && idx < (getStripVersions(f.id, k)?.length ?? 0) && getStripActiveTab(f.id, k) !== idx) { setStripActiveTab(f.id, k, idx); changed = true; }
            });
            if (cc >= 0 && cc < (getStripVersions(f.id, ccStrip as never)?.length ?? 0)
              && (now.crossCompare[f.id] !== cc || (now.crossCompareStrip[f.id] || 'ver') !== ccStrip)) {
              // IN BOTH PLACES THE APP KEEPS IT (Roman's phone, 10 Nov: back on the
              // shot, not on the version). The card reads one record of "which
              // version is on show"; the fetch from the server that follows
              // every start reads ANOTHER, and puts every card back on what
              // that one says. They are normally one and the same object, but
              // setting the view (just above) parts them. Written only to the
              // card's, the fetch a second later saw "nothing on show" — the
              // log said so: "noted -1, on screen -1" — and undid it. Written
              // to both, the fetch itself keeps the card where it is (#341).
              now.crossCompare[f.id] = cc;
              setStripCrossCompare(f.id, 'ver', cc);
              (now.crossCompareStrip as Record<number, string>)[f.id] = ccStrip;
              changed = true;
            }
          }
          if (changed) {
            if (was.view && views.includes(was.view) && was.view === useStore.getState().currentViewMode) setViewMode(was.view as never, true);
            (window as unknown as { __fh_renderAll?: () => void }).__fh_renderAll?.();
          }
          return changed;
        };
        showVersions();
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

export function startUpdateCheck(): void {
  learnWhetherUpdated();
  backToThePlace();
  watch();
}
