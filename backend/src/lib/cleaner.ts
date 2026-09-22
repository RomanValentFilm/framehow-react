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
