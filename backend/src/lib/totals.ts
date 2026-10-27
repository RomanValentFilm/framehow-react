// WHAT FRAMEHOW HOLDS AT CLOUDFLARE (12 October, Roman).
//
// Roman: "how can I prevent being billed zillions, if something happens? can I
// limit the storage Framehow uses?" Cloudflare cannot — it has no storage cap,
// only a money alert the morning after. So the cap is ours:
//
//   THE WALL      an account never holds more than its limit (350 MB) — checked
//                 at the upload door now, not only when a project is saved.
//                 Before today the door only refused single pictures over
//                 10 MB; a found door could have been poured into for a day.
//   THE CEILING   the whole of Framehow never holds more than a number Roman
//                 sets (GLOBAL_STORAGE_LIMIT_GB, 50 by default). Above the free
//                 10 GB that is at most 60 cents a month. Above the ceiling the
//                 door refuses with the storage-full answer the app knows;
//                 nothing anyone already has is touched.
//   THE MAILS     one every night after the sweep with the exact figure, and
//                 one AT ONCE when the total crosses 8 GB, 9 GB, and then every
//                 250 MB — never twice for the same step.
//
// The figures are a running total in one small table (storage_totals): uploads
// add, deletions subtract, and the nightly sweep lists the bucket and writes
// the exact numbers over whatever drift the day left. Reading two rows is all
// the upload door costs.

import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { Env } from "../types";
import { ownerOfKey, pictureOfThumb } from "./cleaner";

export const GB = 1024 * 1024 * 1024;
export const MB = 1024 * 1024;
/** Cloudflare R2: the first 10 GB a month are free, then $0.015 per GB-month
 *  (their pricing page, read 5 and 12 October 2026). */
export const FREE_GB = 10;
export const USD_PER_GB_MONTH = 0.015;

const DEFAULT_CEILING_GB = 50;

export function ceilingBytes(env: Env, requestHeader?: string | null): number {
  if (env.FH_E2E === "1" && requestHeader) {
    const mb = Number(requestHeader);
    if (Number.isFinite(mb) && mb > 0) return Math.round(mb * MB);
  }
  const gb = Number(env.GLOBAL_STORAGE_LIMIT_GB);
  return (Number.isFinite(gb) && gb > 0 ? gb : DEFAULT_CEILING_GB) * GB;
}

/** What the bucket would cost per month at its size: nothing up to 10 GB. */
export function estimatedUsdPerMonth(bytes: number): number {
  const over = Math.max(0, bytes - FREE_GB * GB);
  return Math.round((over / GB) * USD_PER_GB_MONTH * 100) / 100;
}

/** The step a total has reached: 0 below 8 GB, then 8 GB, 9 GB, and every
 *  250 MB above 9 GB. Roman is mailed once per step. */
export function alertStep(bytes: number): number {
  if (bytes < 8 * GB) return 0;
  if (bytes < 9 * GB) return 8 * GB;
  return 9 * GB + Math.floor((bytes - 9 * GB) / (250 * MB)) * 250 * MB;
}

export function gbText(bytes: number): string {
  return `${(bytes / GB).toFixed(2)} GB`;
}

async function readScope(db: D1Database, scope: string): Promise<number> {
  const row = await db.prepare(`SELECT bytes FROM storage_totals WHERE scope = ?`).bind(scope).first<{ bytes: number }>();
  return row?.bytes ?? 0;
}

export async function totalBytes(db: D1Database): Promise<number> {
  return readScope(db, "all");
}

export async function userBytes(db: D1Database, userId: string): Promise<number> {
  return readScope(db, `user:${userId}`);
}

/** Add (or, negative, take away) bytes for one account and for the whole. */
export async function addBytes(db: D1Database, userId: string | null, delta: number): Promise<void> {
  if (!delta) return;
  const now = Date.now();
  const up = (scope: string) => db
    .prepare(
      `INSERT INTO storage_totals (scope, bytes, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET bytes = MAX(0, storage_totals.bytes + excluded.bytes), updated_at = excluded.updated_at`,
    )
    .bind(scope, delta, now);
  const stmts = [up("all")];
  if (userId) stmts.push(up(`user:${userId}`));
  await db.batch(stmts);
}

/** THE LIBRARY'S PREVIEWS COUNT TOO (27 Oct, Roman: "put it in"). A preview
 *  belongs to no card, so the sum over the cards cannot see it; its bytes are
 *  kept per account here ('thumbs:<id>'): a new preview adds, a removed one
 *  takes away, the nightly sweep writes the exact figure from the bucket. */
export async function thumbBytes(db: D1Database, userId: string): Promise<number> {
  return readScope(db, `thumbs:${userId}`);
}
export async function addThumbBytes(db: D1Database, userId: string, delta: number): Promise<void> {
  if (!delta) return;
  await db.prepare(
    `INSERT INTO storage_totals (scope, bytes, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(scope) DO UPDATE SET bytes = MAX(0, storage_totals.bytes + excluded.bytes), updated_at = excluded.updated_at`,
  ).bind(`thumbs:${userId}`, delta, Date.now()).run();
}

export interface BucketTotals { files: number; bytes: number; byOwner: Map<string, number> }

/** The truth, from the bucket itself: every file, page by page. Writes the
 *  exact figures over the running ones. Nightly, after the sweep. */
export async function recalibrate(db: D1Database, bucket: R2Bucket): Promise<BucketTotals> {
  const byOwner = new Map<string, number>();
  const thumbsByOwner = new Map<string, number>();
  let files = 0, bytes = 0;
  let cursor: string | undefined;
  let pages = 0;
  do {
    const listed = await bucket.list({ limit: 1000, cursor });
    for (const o of listed.objects) {
      files++; bytes += o.size;
      const owner = ownerOfKey(o.key);
      byOwner.set(owner, (byOwner.get(owner) ?? 0) + o.size);
      if (pictureOfThumb(o.key)) thumbsByOwner.set(owner, (thumbsByOwner.get(owner) ?? 0) + o.size);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
    pages++;
  } while (cursor && pages < 1000);

  const now = Date.now();
  const stmts = [
    db.prepare(`DELETE FROM storage_totals WHERE scope LIKE 'user:%' OR scope LIKE 'thumbs:%'`),
    db.prepare(`INSERT INTO storage_totals (scope, bytes, updated_at) VALUES ('all', ?, ?)
                ON CONFLICT(scope) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at`).bind(bytes, now),
  ];
  for (const [owner, b] of byOwner) {
    stmts.push(db.prepare(`INSERT INTO storage_totals (scope, bytes, updated_at) VALUES (?, ?, ?)`).bind(`user:${owner}`, b, now));
  }
  for (const [owner, b] of thumbsByOwner) {
    stmts.push(db.prepare(`INSERT INTO storage_totals (scope, bytes, updated_at) VALUES (?, ?, ?)`).bind(`thumbs:${owner}`, b, now));
  }
  // D1 batches are limited in size; write in slices.
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { files, bytes, byOwner };
}

// ---------------------------------------------------------------------------
// THE MAILS TO ROMAN
// ---------------------------------------------------------------------------

async function lastMailedStep(db: D1Database): Promise<number> {
  return readScope(db, "alert:step");
}

async function rememberStep(db: D1Database, step: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO storage_totals (scope, bytes, updated_at) VALUES ('alert:step', ?, ?)
       ON CONFLICT(scope) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at`,
    )
    .bind(step, Date.now())
    .run();
}

/**
 * AT ONCE, when a step is crossed (8 GB, 9 GB, then every 250 MB). Called
 * after every upload and after the nightly recalibration. Mails once per
 * step; a total that falls and rises again past the same step mails again
 * only if it went below the previous step first.
 */
export async function mailIfStepCrossed(env: Env, db: D1Database, bytes: number): Promise<boolean> {
  const step = alertStep(bytes);
  const last = await lastMailedStep(db);
  if (step <= last) {
    if (step < last) await rememberStep(db, step);   // it went down: arm the step again
    return false;
  }
  await rememberStep(db, step);
  const { sendAdminMail } = await import("./email");
  const ceiling = ceilingBytes(env);
  await sendAdminMail(env,
    `Framehow storage: ${gbText(bytes)}`,
    `Framehow now holds ${gbText(bytes)} at Cloudflare.\n\n`
    + `Free allowance: ${FREE_GB} GB. Ceiling: ${gbText(ceiling)}. `
    + `Estimated cost at this size: $${estimatedUsdPerMonth(bytes).toFixed(2)} a month.\n\n`
    + `Framehow\n`);
  return true;
}

/** EVERY NIGHT, after the sweep: the exact figure, whatever it is. */
export async function mailNightlyReport(env: Env, t: BucketTotals, deadFreed: number): Promise<void> {
  const { sendAdminMail } = await import("./email");
  const ceiling = ceilingBytes(env);
  const top = Array.from(t.byOwner.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([owner, b]) => `  ${owner.slice(0, 8)}…  ${(b / MB).toFixed(0)} MB`).join("\n");
  await sendAdminMail(env,
    `Framehow tonight: ${gbText(t.bytes)}`,
    `Framehow holds ${gbText(t.bytes)} in ${t.files} files at Cloudflare.\n\n`
    + `Free allowance: ${FREE_GB} GB. Ceiling: ${gbText(ceiling)}. `
    + `Estimated cost at this size: $${estimatedUsdPerMonth(t.bytes).toFixed(2)} a month.\n`
    + `Dead pictures cleared tonight: ${(deadFreed / MB).toFixed(0)} MB.\n\n`
    + `Largest accounts:\n${top || "  (none)"}\n\n`
    + `Framehow\n`);
}
