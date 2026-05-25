// ── Framehow Analytics ─────────────────────────────────────────────────────
// Sends events to the main API worker (/track), which stores them in D1.
// Each event includes: device type, browser, PWA status, session ID, user ID.

import { API_BASE_URL } from './api';

const _TRACK_URL = `${API_BASE_URL}/track`;

// ── Session ID (persists per browser tab session) ──────────────────────────
const _SESSION_ID = (() => {
  let s = sessionStorage.getItem('fh_sid');
  if (!s) {
    s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    sessionStorage.setItem('fh_sid', s);
  }
  return s;
})();

// ── Device detection ───────────────────────────────────────────────────────
const _TOUCH = 'ontouchstart' in window;
const _DEVICE = (() => {
  const w = Math.min(screen.width, screen.height);
  return w <= 430 ? 'phone' : _TOUCH ? 'tablet' : 'desktop';
})();

// ── Browser detection ──────────────────────────────────────────────────────
const _BROWSER = (() => {
  const ua = navigator.userAgent;
  if (/CriOS|Chrome/.test(ua) && !/Edg/.test(ua)) return 'chrome';
  if (/Safari/.test(ua) && !/Chrome/.test(ua)) return 'safari';
  if (/Firefox|FxiOS/.test(ua)) return 'firefox';
  if (/Edg/.test(ua)) return 'edge';
  return 'other';
})();

// ── PWA detection ──────────────────────────────────────────────────────────
const _PWA = !!(window.navigator as any).standalone
  || window.matchMedia('(display-mode: standalone)').matches;

// ── User ID (set when user logs in) ────────────────────────────────────────
let _uid: string | null = null;

export function setTrackingUser(uid: string | null): void {
  _uid = uid;
}

// ── Core tracking function ─────────────────────────────────────────────────
// meta is optional event-specific data (e.g. { format: 'pdf', view: 'main' })
export function fhTrack(event: string, meta?: Record<string, any>): void {
  try {
    const payload: any = {
      event,
      sid: _SESSION_ID,
      device: _DEVICE,
      browser: _BROWSER,
      pwa: _PWA,
    };
    if (_uid) payload.uid = _uid;
    if (meta) payload.meta = meta;
    navigator.sendBeacon(_TRACK_URL, JSON.stringify(payload));
  } catch {}
}

// ── Heartbeat (tracks session duration) ────────────────────────────────────
let heartbeatStarted = false;
export function startHeartbeat(): void {
  if (heartbeatStarted) return;
  heartbeatStarted = true;
  fhTrack('app_opened');
  // Heartbeat every 2 minutes (was 5 — shorter interval = better duration accuracy)
  setInterval(() => fhTrack('heartbeat'), 2 * 60 * 1000);
}
