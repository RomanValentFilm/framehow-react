// RATE LIMITS (audit 9 Nov, B3d — "no rate limiting anywhere").
//
// The numbers, agreed with Roman on 9 Nov:
//   sign-in         10 wrong passwords per email per 15 min
//   sign-up          5 accounts per internet address per hour
//   forgot mail      3 per email per hour, 20 per address per hour
//   upload          60 pictures per account per MINUTE — a burst guard only;
//                   no hourly cap, a fitting day is hundreds of photos
//   /track beacon  600 per address per hour
//
// A fixed window in one D1 row per (door, who): cheap, good enough, and it
// needs no new Cloudflare product. Over the limit the door answers 429 with
// code "rate_limited" and the app says "too many attempts". Rows older than a
// day are swept by the nightly cron.

import type { Env } from "../types";

export const LIMITS = {
  login: { n: 10, ms: 15 * 60_000 },
  signup: { n: 5, ms: 60 * 60_000 },
  forgotEmail: { n: 3, ms: 60 * 60_000 },
  forgotIp: { n: 20, ms: 60 * 60_000 },
  upload: { n: 60, ms: 60_000 },
  track: { n: 600, ms: 60 * 60_000 },
} as const;

/** The caller's address as Cloudflare saw it; "?" when there is none (tests). */
export function ipOf(req: { header(n: string): string | undefined }): string {
  return req.header("CF-Connecting-IP") ?? req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
}

/**
 * Count one knock on `door` by `who`. True = still allowed, false = over the
 * limit for this window. The count is kept even when refused, so hammering
 * does not reset anything.
 */
export async function allow(env: Env, door: keyof typeof LIMITS, who: string,
                            req?: { header(n: string): string | undefined }): Promise<boolean> {
  // THE TEST BENCH IS NOT A CROWD: the simulator makes accounts and signs in
  // many times a minute from one address. On the test worker the limits apply
  // only to requests that ask for them (header X-FH-Rate-Test), so one test
  // can prove a door while the others are never slowed.
  if (env.FH_E2E && req?.header("X-FH-Rate-Test") !== "1") return true;
  const { n, ms } = LIMITS[door];
  const k = `${door}:${who}`;
  const now = Date.now();
  try {
    const row = await env.DB.prepare(`SELECT window_start, n FROM rate_hits WHERE k = ?`).bind(k)
      .first<{ window_start: number; n: number }>();
    if (!row || now - row.window_start >= ms) {
      await env.DB.prepare(`INSERT OR REPLACE INTO rate_hits (k, window_start, n) VALUES (?, ?, 1)`).bind(k, now).run();
      return true;
    }
    await env.DB.prepare(`UPDATE rate_hits SET n = n + 1 WHERE k = ?`).bind(k).run();
    if (row.n + 1 > n) {
      console.log(`[rate] refused ${door} for ${door === "login" || door === "forgotEmail" ? "an email" : who}: ${row.n + 1} in the window`);
      return false;
    }
    return true;
  } catch (e) {
    // A counting fault must never close a door for everyone.
    console.error("[rate] counting failed — allowing", e);
    return true;
  }
}

/** Forget a door for one who — a successful sign-in clears the wrong tries. */
export async function clear(env: Env, door: keyof typeof LIMITS, who: string): Promise<void> {
  try { await env.DB.prepare(`DELETE FROM rate_hits WHERE k = ?`).bind(`${door}:${who}`).run(); } catch { /* fine */ }
}

/** Nightly: rows older than a day are of no use to any window. */
export async function sweepRateHits(env: Env): Promise<number> {
  const r = await env.DB.prepare(`DELETE FROM rate_hits WHERE window_start < ?`).bind(Date.now() - 24 * 60 * 60_000).run();
  return r.meta.changes ?? 0;
}
