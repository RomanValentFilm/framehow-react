// Thin fetch wrapper around the Framehow backend (Cloudflare Workers).
// Base URL is configurable via VITE_API_BASE_URL (see .env.example).
//
// All errors normalize to ApiError so callers can `catch (e: ApiError)` and
// surface `e.message` to the UI without further parsing.

// Default to production API. Override with VITE_API_BASE_URL in .env.local for local dev.
const RAW = (import.meta.env.VITE_API_BASE_URL ?? 'https://framehow-api.roman-cbd.workers.dev').trim();
export const API_BASE_URL: string = RAW.replace(/\/+$/, '');

export interface ApiError {
  status: number;
  code: string;
  message: string;
  /** The account's storage figure, when the refusal is about storage (#533). */
  storage?: { used: number; limit: number; pending?: number };
}

interface ServerErrorEnvelope {
  error?: { code?: string; message?: string };
  storage?: { used: number; limit: number; pending?: number };
}

function toApiError(status: number, body: unknown, fallbackMessage = 'Something went wrong.'): ApiError {
  const env = (body ?? {}) as ServerErrorEnvelope;
  return {
    status,
    code: env.error?.code ?? 'unknown',
    message: env.error?.message ?? fallbackMessage,
    ...(env.storage ? { storage: env.storage } : {}),
  };
}

// A STEP THAT CAN BE STOPPED (13 Nov, Roman: "at that very same moment the
// background upload is interrupted … the open project never waits"). While
// unsent work of another project takes its short step, every request made
// carries this signal; a touch stops them on the spot instead of leaving them
// in the air for the open project's own save to wait behind.
let _stepSignal: AbortSignal | null = null;
export function requestsBelongToAStep(signal: AbortSignal | null): void { _stepSignal = signal; }

async function request<T>(path: string, init: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    const stepSignal = _stepSignal;
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, ...(stepSignal ? { signal: stepSignal } : {}) });
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'AbortError') {
      throw { status: 0, code: 'stopped', message: 'Stopped: the open project comes first.' } as ApiError;
    }
    // Network-level failure — caller can show a generic offline message.
    throw {
      status: 0,
      code: 'network',
      message: 'Couldn’t reach the server. Check your connection and try again.',
    } as ApiError;
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { /* keep null */ }
  }

  if (!res.ok) throw toApiError(res.status, body);
  return body as T;
}

export const api = {
  get<T>(path: string, token?: string | null): Promise<T> {
    return request<T>(path, { method: 'GET' }, token);
  },
  post<T>(path: string, payload?: unknown, token?: string | null): Promise<T> {
    return request<T>(
      path,
      { method: 'POST', body: payload === undefined ? undefined : JSON.stringify(payload) },
      token,
    );
  },
  put<T>(path: string, payload: unknown, token?: string | null): Promise<T> {
    return request<T>(path, { method: 'PUT', body: JSON.stringify(payload) }, token);
  },
  delete<T>(path: string, token?: string | null): Promise<T> {
    return request<T>(path, { method: 'DELETE' }, token);
  },
};
