// Tracks how many milliseconds the user has been *actively* using the app.
// "Active" = at least one input event (mouse / key / touch / scroll / wheel)
// within the last `IDLE_AFTER_MS`. Idle gaps don't count toward the total —
// so a user who opens the tab, walks away for an hour, and comes back has
// not been "active for 5 minutes". Matches the toaster spec's intent.

const IDLE_AFTER_MS = 30_000;
const TICK_MS = 1_000;

const INPUT_EVENTS: Array<keyof WindowEventMap> = [
  'mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove', 'wheel', 'scroll',
];

let lastInputAt = Date.now();
let lastTickAt = Date.now();
let activeMs = 0;
let started = false;
let intervalId: number | null = null;

const listeners = new Set<(ms: number) => void>();

function onInput(): void {
  lastInputAt = Date.now();
}

function tick(): void {
  const now = Date.now();
  const delta = now - lastTickAt;
  lastTickAt = now;
  // Only credit time when the user has been recently active. This naturally
  // pauses the counter while the page is hidden / the user is idle.
  if (now - lastInputAt < IDLE_AFTER_MS && document.visibilityState !== 'hidden') {
    activeMs += delta;
    for (const cb of listeners) {
      try { cb(activeMs); } catch (e) { console.error('[activity] listener', e); }
    }
  }
}

export function startActivityTracking(): void {
  if (started) return;
  started = true;
  for (const ev of INPUT_EVENTS) {
    window.addEventListener(ev, onInput, { passive: true });
  }
  // Reset the tick clock when the page comes back into focus, so a long
  // hidden gap doesn't suddenly credit minutes of "active" time.
  document.addEventListener('visibilitychange', () => {
    lastTickAt = Date.now();
    if (document.visibilityState === 'visible') lastInputAt = Date.now();
  });
  intervalId = window.setInterval(tick, TICK_MS);
}

export function stopActivityTracking(): void {
  if (!started) return;
  started = false;
  for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput);
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function getActiveMs(): number { return activeMs; }

export function onActivityTick(cb: (ms: number) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
