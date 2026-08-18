// Session and current-user state.
//
// BEING OFFLINE IS NOT BEING SIGNED OUT (#304).
//
// The token has always been kept in localStorage, but WHO you are was not: the
// user was only known after /user/me answered. And `isLoggedIn()` needs both.
// So an app that started with no connection — an iPad on set, airplane mode, a
// dead hotel wifi — was signed out for the whole session. Nothing pushed,
// nothing pulled, and the only sign of it was a note asking you to save the
// project first, which reads like a nag rather than "I do not know who you are".
// It did not even recover when the connection came back, because /user/me is
// only asked at boot: the app had to be reloaded, online, to sync again.
//
// So the user is remembered next to the token. Both are written on sign-in, both
// are restored at boot, and only the server SAYING NO (401) clears them. A
// network failure changes nothing — it is not an answer.

import { api } from './api';
import { setTrackingUser } from './tracking';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  profession: string | null;
  email_verified: boolean;
}

const TOKEN_STORAGE_KEY = 'fh_session_token';
const USER_STORAGE_KEY = 'fh_session_user';

let token: string | null = readStoredToken();
let user: SessionUser | null = readStoredUser();
const listeners = new Set<() => void>();

function readStoredToken(): string | null {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch { return null; }
}

function writeStoredToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_STORAGE_KEY, t);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch { /* private mode etc. — fine to ignore */ }
}

/** Who was signed in last time. Only trusted alongside a token, and thrown away
 *  the moment the server rejects that token. */
function readStoredUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as SessionUser;
    return u && typeof u.id === 'string' ? u : null;
  } catch { return null; }
}

function writeStoredUser(u: SessionUser | null): void {
  try {
    if (u) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_STORAGE_KEY);
  } catch { /* private mode etc. */ }
}

function emit(): void {
  for (const l of listeners) {
    try { l(); } catch (e) { console.error('[session] listener', e); }
  }
}

export function getToken(): string | null { return token; }
export function getUser(): SessionUser | null { return user; }
export function isLoggedIn(): boolean { return user !== null && token !== null; }

export function setSession(t: string, u: SessionUser): void {
  token = t;
  user = u;
  writeStoredToken(t);
  writeStoredUser(u);
  setTrackingUser(u.id);
  emit();
}

export function setUser(u: SessionUser): void {
  user = u;
  writeStoredUser(u);
  emit();
}

export function clearSession(): void {
  token = null;
  user = null;
  writeStoredToken(null);
  writeStoredUser(null);
  setTrackingUser(null);
  emit();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * Check with the server who this token belongs to.
 *
 * Called at boot and again whenever the connection comes back, so a device that
 * started offline does not have to be reloaded to sync.
 *
 * Three outcomes, and only one of them signs you out:
 *   - the server answers      → take its copy of the user
 *   - the server says 401     → the token is dead; sign out
 *   - no answer at all        → keep what was remembered; being unreachable is
 *                               not a verdict
 */
export async function loadCurrentUser(): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const res = await api.get<{ user: SessionUser }>('/user/me', token);
    user = res.user;
    writeStoredUser(user);
    setTrackingUser(user.id);
    emit();
    return user;
  } catch (e) {
    const err = e as { status?: number };
    if (err.status === 401) clearSession();
    // Unreachable: the remembered user stands, so an offline start can still
    // save, queue and sync the moment the connection returns.
    return user;
  }
}

/** Best-effort server logout. Local state is cleared regardless. */
export async function logout(): Promise<void> {
  const t = token;
  clearSession();
  if (t) {
    try { await api.post('/auth/logout', undefined, t); } catch { /* ignore */ }
  }
}
