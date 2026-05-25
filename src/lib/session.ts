// Session and current-user state. Token is persisted in localStorage so it
// survives reloads; the `loadCurrentUser()` bootstrap re-validates it against
// /user/me at app start and clears it if the server rejects it.

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

let token: string | null = readStoredToken();
let user: SessionUser | null = null;
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
  setTrackingUser(u.id);
  emit();
}

export function setUser(u: SessionUser): void {
  user = u;
  emit();
}

export function clearSession(): void {
  token = null;
  user = null;
  writeStoredToken(null);
  setTrackingUser(null);
  emit();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * On boot: if a token is in localStorage, validate it against /user/me.
 * On 401, the token is silently cleared. Other failures (network) leave the
 * token intact so the user isn't bumped out of an offline session.
 */
export async function loadCurrentUser(): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const res = await api.get<{ user: SessionUser }>('/user/me', token);
    user = res.user;
    setTrackingUser(user.id);
    emit();
    return user;
  } catch (e) {
    const err = e as { status?: number };
    if (err.status === 401) clearSession();
    return null;
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
