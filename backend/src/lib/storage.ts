// ACCOUNT STORAGE (#533).
//
// Roman, 21 September: the beta has a per-account limit (350 MB). The user must
// SEE it — the figure in the OPEN modal, a notice at 80 / 90 / 95 % — and when
// the account is full there must be a way to free space at once ("Delete now",
// which skips the 7-day recovery window).
//
// Everything about storage lives here: the limit, the sum, and the one path
// that deletes a project's picture files FOR GOOD. That path is shared by the
// nightly sweep and by Delete now, and it has one rule that protects work:
//
//   A FILE IS DELETED ONLY WHEN NOTHING ELSE NAMES IT. A project saved as new
//   keeps its pictures' file names (the client reuses a key it already has), so
//   two projects can point at the same file. Before this, the sweep deleted the
//   old project's files and the new project's pictures went with them.
//
// The check is per file: any picture row of ANOTHER project (live or
// recoverable) or any restore point of another live project of the same user
// naming the key keeps the file. The project's own rows and restore points go
// with the project (cascade), so they do not count.

import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { Env } from "../types";
import { addBytes } from "./totals";

const DEFAULT_LIMIT_MB = 350;

/** The account limit in bytes. `STORAGE_LIMIT_MB` (wrangler var) overrides the
 *  350 MB default; the simulator's local worker (`FH_E2E=1`) may lower it per
 *  request with the `X-FH-Storage-Limit-MB` header so a test can fill an
 *  account in seconds. The header is ignored everywhere else. */
export function storageLimitBytes(env: Env, requestHeader?: string | null): number {
  if (env.FH_E2E === "1" && requestHeader) {
    const mb = Number(requestHeader);
    if (Number.isFinite(mb) && mb > 0) return Math.round(mb * 1024 * 1024);
  }
  const mb = Number(env.STORAGE_LIMIT_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_LIMIT_MB) * 1024 * 1024;
}

/** Bytes of pictures in the user's LIVE projects (deleted-but-recoverable ones
 *  do not count against the limit — they are on their way out). Pictures
 *  uploaded before sizes were recorded count as 0 until the cleaner measures
 *  them. `excludeProjectId` leaves one project out (the sync route counts the
 *  incoming pictures instead of that project's old rows). */
export async function sumUserImageBytes(
  db: D1Database,
  userId: string,
  excludeProjectId?: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(i.size_bytes), 0) AS used
         FROM images i
         JOIN versions v ON v.id = i.version_id
         JOIN frames   f ON f.id = v.frame_id
         JOIN strips   s ON s.id = f.strip_id
         JOIN projects p ON p.id = s.project_id
        WHERE p.user_id = ?
          AND p.deleted_at IS NULL
          AND (? IS NULL OR p.id != ?)`,
    )
    .bind(userId, excludeProjectId ?? null, excludeProjectId ?? null)
    .first<{ used: number }>();
  // The PICTS library's previews count too (27 Oct, Roman).
  const { thumbBytes } = await import("./totals");
  return (row?.used ?? 0) + await thumbBytes(db, userId);
}

export interface StorageFigure { used: number; limit: number }

export async function storageFigure(db: D1Database, env: Env, userId: string, header?: string | null): Promise<StorageFigure> {
  return { used: await sumUserImageBytes(db, userId), limit: storageLimitBytes(env, header) };
}

/** Of these keys, which are still named by another project's picture rows or
 *  by a restore point of another live project of this user. */
export async function keysNamedElsewhere(
  db: D1Database,
  userId: string,
  projectId: string,
  keys: string[],
): Promise<Set<string>> {
  const named = new Set<string>();
  const STEP = 50;
  for (let i = 0; i < keys.length; i += STEP) {
    const chunk = keys.slice(i, i + STEP);
    const stmts = chunk.map((key) =>
      db.prepare(
        `SELECT ? AS k,
                (EXISTS (SELECT 1 FROM images i
                           JOIN versions v ON v.id = i.version_id
                           JOIN frames   f ON f.id = v.frame_id
                           JOIN strips   s ON s.id = f.strip_id
                          WHERE i.r2_key = ? AND s.project_id != ?)
                 OR
                 EXISTS (SELECT 1 FROM project_snapshots ps
                           JOIN projects p ON p.id = ps.project_id
                          WHERE p.user_id = ? AND p.id != ? AND p.deleted_at IS NULL
                            AND instr(ps.tree_json, ?) > 0)) AS named`,
      ).bind(key, key, projectId, userId, projectId, key),
    );
    const results = await db.batch<{ k: string; named: number }>(stmts);
    for (const r of results) {
      const row = r.results?.[0];
      if (row && Number(row.named) > 0) named.add(row.k);
    }
  }
  return named;
}

export interface PurgeResult { deletedFiles: number; keptShared: number; bytesFreed: number }

/** Delete a project FOR GOOD: its picture files (unless named elsewhere), then
 *  its rows (cascade takes strips, frames, versions, images, drawings,
 *  restore points). Used by the nightly sweep and by Delete now. */
export async function deleteProjectForGood(
  db: D1Database,
  bucket: R2Bucket,
  userId: string,
  projectId: string,
): Promise<PurgeResult> {
  const images = await db
    .prepare(
      `SELECT i.r2_key, i.size_bytes FROM images i
         JOIN versions v ON i.version_id = v.id
         JOIN frames f ON v.frame_id = f.id
         JOIN strips s ON f.strip_id = s.id
        WHERE s.project_id = ?`,
    )
    .bind(projectId)
    .all<{ r2_key: string; size_bytes: number | null }>();

  const byKey = new Map<string, number>();
  for (const im of images.results) if (im.r2_key) byKey.set(im.r2_key, im.size_bytes ?? 0);
  const keys = Array.from(byKey.keys());
  const shared = await keysNamedElsewhere(db, userId, projectId, keys);
  const toDelete = keys.filter((k) => !shared.has(k));

  let bytesFreed = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    await Promise.all(batch.map((key) => bucket.delete(key)));
    for (const k of batch) bytesFreed += byKey.get(k) ?? 0;
  }

  // THE DELETION RECORDS DO NOT CASCADE (Roman, 21 Sept: "Uboot and Workflow
  // do not want to delete"). `project_deletions` points at the project without
  // ON DELETE CASCADE, so a project holding any record of a deleted shot or
  // version could not be deleted at all — the database refused, the app said
  // "Something went wrong", and the nightly sweep failed the same way for
  // every such project. They go first, explicitly.
  await db.batch([
    db.prepare(`DELETE FROM project_deletions WHERE project_id = ?`).bind(projectId),
    db.prepare(`DELETE FROM projects WHERE id = ?`).bind(projectId),
  ]);
  if (shared.size > 0) {
    console.log(`[storage] project ${projectId}: ${shared.size} picture file(s) kept — named by another project or restore point`);
  }
  // The running totals come down with the files (12 Oct), so Delete now frees
  // room at the upload door at once, not only after the nightly recount.
  await addBytes(db, userId, -bytesFreed);
  return { deletedFiles: toDelete.length, keptShared: shared.size, bytesFreed };
}

/**
 * A PICTURE'S SIZE MUST NOT BE FORGOTTEN (#533). The app records a size only
 * on the push that uploads the picture; every later push re-sends the picture
 * with the size unknown, and the server wrote that unknown over the recorded
 * size. The 350 MB count has been counting almost nothing. Now a missing size
 * is filled in before the rows are written: from a row that already knows it,
 * else from the file itself (one HEAD per unknown key, in parallel).
 */
export async function fillImageSizes(
  db: D1Database,
  bucket: R2Bucket | undefined,
  images: Array<{ r2_key: string; size_bytes: number | null }>,
): Promise<void> {
  const unknown = Array.from(new Set(images.filter((i) => i.size_bytes == null && i.r2_key).map((i) => i.r2_key)));
  if (unknown.length === 0) return;
  const sizes = new Map<string, number>();
  const STEP = 90;
  for (let i = 0; i < unknown.length; i += STEP) {
    const chunk = unknown.slice(i, i + STEP);
    const rows = await db
      .prepare(`SELECT r2_key, size_bytes FROM images WHERE size_bytes IS NOT NULL AND r2_key IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<{ r2_key: string; size_bytes: number }>();
    for (const r of rows.results) sizes.set(r.r2_key, r.size_bytes);
  }
  const stillUnknown = unknown.filter((k) => !sizes.has(k));
  if (bucket && stillUnknown.length > 0) {
    for (let i = 0; i < stillUnknown.length; i += 20) {
      const chunk = stillUnknown.slice(i, i + 20);
      const heads = await Promise.all(chunk.map((k) => bucket.head(k).catch(() => null)));
      chunk.forEach((k, j) => { const h = heads[j]; if (h) sizes.set(k, h.size); });
    }
  }
  for (const im of images) {
    if (im.size_bytes == null) { const sz = sizes.get(im.r2_key); if (sz != null) im.size_bytes = sz; }
  }
}

/**
 * A PARTIAL PUSH CARRIES ONLY THE CHANGED SHOTS (#533, run 305). The old
 * check counted the pictures in the push plus the other projects — and
 * assumed the push carried the whole project, which stopped being true when
 * partial pushes came in. So the pictures already sitting in the pushed
 * project's OTHER shots were never counted. This is that remainder: the
 * project's picture bytes outside the shots the push replaces. In full mode
 * every row is replaced, so it is 0.
 */
export async function sumProjectImageBytesOutsideFrames(
  db: D1Database,
  projectId: string,
  frameIds: string[],
): Promise<number> {
  let total = 0;
  // The sum over the whole project, minus the sum inside the pushed shots —
  // two sums, no IN list longer than the bind limit.
  const whole = await db
    .prepare(
      `SELECT COALESCE(SUM(i.size_bytes), 0) AS used
         FROM images i
         JOIN versions v ON v.id = i.version_id
         JOIN frames   f ON f.id = v.frame_id
         JOIN strips   s ON s.id = f.strip_id
        WHERE s.project_id = ?`,
    )
    .bind(projectId)
    .first<{ used: number }>();
  total = whole?.used ?? 0;
  const STEP = 90;
  for (let i = 0; i < frameIds.length; i += STEP) {
    const chunk = frameIds.slice(i, i + STEP);
    const inside = await db
      .prepare(
        `SELECT COALESCE(SUM(i.size_bytes), 0) AS used
           FROM images i
           JOIN versions v ON v.id = i.version_id
          WHERE v.frame_id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(...chunk)
      .first<{ used: number }>();
    total -= inside?.used ?? 0;
  }
  return Math.max(0, total);
}

// ---------------------------------------------------------------------------
// PICTURES DELETED IN THE PICTS LIBRARY (28 October, Roman).
// ---------------------------------------------------------------------------

/** Of these keys, the ones this account deleted in the library. */
export async function deletedKeysAmong(db: D1Database, userId: string, keys: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const uniq = Array.from(new Set(keys.filter(Boolean)));
  const STEP = 90;
  for (let i = 0; i < uniq.length; i += STEP) {
    const chunk = uniq.slice(i, i + STEP);
    const rows = await db
      .prepare(`SELECT r2_key FROM deleted_pictures WHERE user_id = ? AND r2_key IN (${chunk.map(() => "?").join(",")})`)
      .bind(userId, ...chunk)
      .all<{ r2_key: string }>();
    for (const r of rows.results) out.add(r.r2_key);
  }
  return out;
}

export interface DeletePicturesResult { deleted: string[]; bytesFreed: number; cardsMarked: number }

/** Delete these pictures of this account for good: the file and its preview go
 *  from storage, the figures come down, every card that used one keeps its
 *  drawings and text and is marked "deleted", and the key is remembered so an
 *  offline device cannot bring the picture back. Only the account's own keys. */
export async function deletePictures(db: D1Database, bucket: R2Bucket | undefined, userId: string, keys: string[]): Promise<DeletePicturesResult> {
  const { addBytes, addThumbBytes } = await import("./totals");
  const { thumbOfPicture } = await import("./cleaner");
  const own = Array.from(new Set(keys.filter((k) => k.startsWith(`users/${userId}/`) && !k.includes("/thumbs/"))));
  const now = Date.now();
  let bytesFreed = 0, thumbsFreed = 0, cardsMarked = 0;
  const deleted: string[] = [];
  for (const key of own) {
    const thumb = thumbOfPicture(key);
    let size = 0, tsize = 0;
    if (bucket) {
      const [h, th] = await Promise.all([bucket.head(key), thumb ? bucket.head(thumb) : Promise.resolve(null)]);
      size = h?.size ?? 0; tsize = th?.size ?? 0;
      await bucket.delete(thumb ? [key, thumb] : [key]);
    }
    const marked = await db
      // size 0: the file is gone, the account's figure must not count it.
      .prepare(`UPDATE images SET deleted_at = ?, updated_at = ?, size_bytes = 0 WHERE r2_key = ? AND deleted_at IS NULL`)
      .bind(now, now, key)
      .run();
    cardsMarked += marked.meta.changes ?? 0;
    await db
      .prepare(`INSERT OR REPLACE INTO deleted_pictures (r2_key, user_id, deleted_at) VALUES (?, ?, ?)`)
      .bind(key, userId, now)
      .run();
    bytesFreed += size + tsize; thumbsFreed += tsize;
    deleted.push(key);
    console.log(`[pictures] deleted ${key} (${size} B + preview ${tsize} B), cards marked: ${marked.meta.changes ?? 0}`);
  }
  if (bytesFreed) await addBytes(db, userId, -bytesFreed);
  if (thumbsFreed) await addThumbBytes(db, userId, -thumbsFreed);
  return { deleted, bytesFreed, cardsMarked };
}
