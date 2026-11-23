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

// ── The App Store app (23 Nov, Roman: "we do not need the PWA, but the real
// app then"). Until today the app from the App Store was counted as a phone
// in a browser. Now it says what it is: pwa 2 = the App Store app, 1 = the
// web app on the home screen, 0 = a browser. Asked at each event, not once at
// load: the bridge may come up a moment after this file.
const _installed = (): number =>
  (window as any).Capacitor?.isNativePlatform?.() ? 2 : _PWA ? 1 : 0;

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
      pwa: _installed(),
    };
    if (_uid) payload.uid = _uid;
    if (meta) payload.meta = meta;
    navigator.sendBeacon(_TRACK_URL, JSON.stringify(payload));
  } catch {}
}

// ── A feature was used (23 Nov) ─────────────────────────────────────────────
// Told ONCE per session and feature: the page counts sessions, and a star
// given forty times is still one session that uses stars.
const _told = new Set<string>();
export function fhUsed(event: string, meta?: Record<string, any>): void {
  const key = meta ? `${event}:${JSON.stringify(meta)}` : event;
  if (_told.has(key)) return;
  _told.add(key);
  fhTrack(event, meta);
}

// ── Heartbeat (tracks session duration) ────────────────────────────────────
let heartbeatStarted = false;
export function startHeartbeat(): void {
  if (heartbeatStarted) return;
  heartbeatStarted = true;
  fhTrack('app_opened');
  // Heartbeat every 2 minutes — only when tab is visible (skip background/suspended)
  setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    fhTrack('heartbeat');
  }, 2 * 60 * 1000);
}
