// THE DEAD-PICTURE CLEANER — COUNTING MODE (22 Sept).
//
// Roman: "we cannot ever lose real work." So the cleaner is built in two
// steps, and this is the first: it only COUNTS. Nothing here deletes.
//
// A picture file in the bucket is DEAD when nobody can get back to it:
//
//   1. no picture row of any project names it — live or deleted-but-
//      recoverable (a recoverable project's pictures come back with it);
//   2. no restore point of any project names it (restoring would need it);
//   3. it is older than 24 hours — a file reaches the bucket a moment before
//      the database learns which shot it belongs to, and a count that runs in
//      that moment would call a brand-new picture unnamed.
//
// Everything else is IN USE. Two ways a picture dies: deleted from a live
// project (shot, version or picture removed, and no restore point still
// holds it), or its project was deleted for good and it went with it —
// unless another project or restore point names the same file, which
// happens when a project was saved as new.

import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export const YOUNG_MS = 24 * 60 * 60 * 1000;

export interface DeadCount {
  files: number; bytes: number;              // everything in the bucket
  inUse: number; inUseBytes: number;         // named by a row or a restore point, or young
  young: number; youngBytes: number;         // of the in-use ones: unnamed but under 24 h
  dead: number; deadBytes: number;
  /** Dead files per account (the key carries the owner). */
  deadByOwner: Array<{ userId: string; files: number; bytes: number }>;
  /** A handful of dead keys, for the eye. */
  deadSample: string[];
  /** Every dead key (the simulator checks names; the page shows the sample). */
  deadKeys: string[];
  /** The listing stopped early (too many files for one pass). */
  truncated: boolean;
  restorePoints: number;
}

/** Every file key a restore point mentions. Keys look like
 *  `users/<id>/<id>.<ext>`; the restore point's tree is JSON that carries them
 *  as plain strings, so a regex over the text finds them all. */
export function keysInText(text: string): string[] {
  return text.match(/users\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+/g) ?? [];
}

export function ownerOfKey(key: string): string {
  const m = key.match(/^users\/([A-Za-z0-9_-]+)\//);
  return m ? m[1] : "?";
}

/** The decision for one file, on its own so the bench can ask it. */
export function isDead(key: string, uploadedAt: number, now: number, named: ReadonlySet<string>): boolean {
  if (named.has(key)) return false;
  if (now - uploadedAt < YOUNG_MS) return false;
  return true;
}

export async function countDeadPictures(
  db: D1Database,
  bucket: R2Bucket,
  now = Date.now(),
): Promise<DeadCount> {
  // 1. Every key a picture row names — every project, deleted ones included.
  const named = new Set<string>();
  const rows = await db.prepare(`SELECT DISTINCT r2_key FROM images WHERE r2_key IS NOT NULL`).all<{ r2_key: string }>();
  for (const r of rows.results) named.add(r.r2_key);

  // 2. Every key a restore point names, one restore point at a time (the
  //    tree can be large; they are never all in memory together).
  const ids = await db.prepare(`SELECT id FROM project_snapshots`).all<{ id: string }>();
  for (const s of ids.results) {
    const snap = await db.prepare(`SELECT tree_json FROM project_snapshots WHERE id = ?`).bind(s.id).first<{ tree_json: string }>();
    if (snap?.tree_json) for (const k of keysInText(snap.tree_json)) named.add(k);
  }

  // 3. The bucket, page by page.
  const out: DeadCount = {
    files: 0, bytes: 0, inUse: 0, inUseBytes: 0, young: 0, youngBytes: 0, dead: 0, deadBytes: 0,
    deadByOwner: [], deadSample: [], deadKeys: [], truncated: false, restorePoints: ids.results.length,
  };
  const byOwner = new Map<string, { files: number; bytes: number }>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const listed = await bucket.list({ limit: 1000, cursor });
    for (const o of listed.objects) {
      out.files++; out.bytes += o.size;
      const uploadedAt = o.uploaded instanceof Date ? o.uploaded.getTime() : Number(o.uploaded ?? 0);
      if (isDead(o.key, uploadedAt, now, named)) {
        out.dead++; out.deadBytes += o.size;
        const owner = ownerOfKey(o.key);
        const b = byOwner.get(owner) ?? { files: 0, bytes: 0 };
        b.files++; b.bytes += o.size; byOwner.set(owner, b);
        if (out.deadSample.length < 20) out.deadSample.push(o.key);
        out.deadKeys.push(o.key);
      } else {
        out.inUse++; out.inUseBytes += o.size;
        if (!named.has(o.key)) { out.young++; out.youngBytes += o.size; }
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
    pages++;
  } while (cursor && pages < 100);
  out.truncated = !!cursor;
  out.deadByOwner = Array.from(byOwner, ([userId, v]) => ({ userId, ...v })).sort((a, b) => b.bytes - a.bytes);
  return out;
}

export interface DeleteResult { deleted: number; bytesFreed: number; keys: string[]; ownerId: string | null }

/**
 * DELETE MODE (22 Sept, after Roman read the live count: 1459 dead files,
 * 408 MB, 1452 of them his own test account's).
 *
 * The same decision, taken AGAIN at the moment of deleting — never from a
 * count made earlier, because a restore point or a push can land in between.
 * One account at a time when `ownerId` is given (Roman: the first pass is
 * his own test account only; other people's files wait until the cleaner
 * has run once and everything was well). Every key deleted is written to the
 * worker log. The 24-hour rule stays exactly as it is.
 */
export async function deleteDeadPictures(
  db: D1Database,
  bucket: R2Bucket,
  ownerId: string | null,
  now = Date.now(),
): Promise<DeleteResult> {
  const count = await countDeadPictures(db, bucket, now);
  const keys = count.deadKeys.filter((k) => ownerId === null || ownerOfKey(k) === ownerId);
  // Sizes for the report: the count did not keep per-key sizes, so a second
  // look at the listing is not worth it — heads are cheap and exact.
  let bytesFreed = 0;
  const done: string[] = [];
  for (let i = 0; i < keys.length; i += 50) {
    const batch = keys.slice(i, i + 50);
    const heads = await Promise.all(batch.map((k) => bucket.head(k).catch(() => null)));
    await Promise.all(batch.map((k) => bucket.delete(k)));
    batch.forEach((k, j) => { bytesFreed += heads[j]?.size ?? 0; done.push(k); console.log(`[cleaner] deleted dead picture ${k} (${heads[j]?.size ?? "?"} bytes)`); });
  }
  console.log(`[cleaner] delete mode: owner=${ownerId ?? "all"} deleted=${done.length} freed=${Math.round(bytesFreed / 1048576)}MB`);
  return { deleted: done.length, bytesFreed, keys: done, ownerId };
}
