// Telemetry — preserved verbatim from the single-file build.
const _TRACK_URL = 'https://framehow-tracker.roman-cbd.workers.dev/track';

const _SESSION_ID = (() => {
  let s = sessionStorage.getItem('fh_sid');
  if (!s) {
    s = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('fh_sid', s);
  }
  return s;
})();

const _TOUCH = 'ontouchstart' in window;
const _DEVICE = (() => {
  const w = Math.max(screen.width, screen.height);
  return w <= 430 ? 'phone' : _TOUCH ? 'tablet' : 'desktop';
})();

export function fhTrack(event: string): void {
  try {
    navigator.sendBeacon(_TRACK_URL, JSON.stringify({ event, device: _DEVICE, sid: _SESSION_ID }));
  } catch {}
}

let heartbeatStarted = false;
export function startHeartbeat(): void {
  if (heartbeatStarted) return;
  heartbeatStarted = true;
  fhTrack('app_opened');
  setInterval(() => fhTrack('heartbeat'), 5 * 60 * 1000);
}
