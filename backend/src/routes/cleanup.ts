import { Hono } from "hono";
import type { Env, AppVariables } from "../types";

const cleanup = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ---------------------------------------------------------------------------
// Admin auth helper
// ---------------------------------------------------------------------------
function isAdmin(c: any): boolean {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  return !!token && token === c.env.ADMIN_API_TOKEN;
}

// ---------------------------------------------------------------------------
// POST /admin/cleanup/orphans — batched R2 orphan cleanup
// Processes up to 500 R2 objects per call. Returns a cursor — keep calling
// until `done: true`. This avoids Worker CPU timeout on large buckets.
// ---------------------------------------------------------------------------
cleanup.post("/admin/cleanup/orphans", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  if (!c.env.IMAGES_BUCKET) return c.json({ error: "R2 not configured" }, 500);

  const db = c.env.DB;
  const bucket = c.env.IMAGES_BUCKET;

  // Accept cursor from previous call (query param or JSON body)
  let inputCursor: string | undefined;
  try {
    const body = await c.req.json<{ cursor?: string }>().catch(() => ({}));
    inputCursor = (body as any)?.cursor || c.req.query("cursor") || undefined;
  } catch {
    inputCursor = c.req.query("cursor") || undefined;
  }

  const BATCH_SIZE = 500;
  let scanned = 0;
  let deleted = 0;
  let kept = 0;
  let bytesFreed = 0;

  const listed = await bucket.list({ limit: BATCH_SIZE, cursor: inputCursor });
  const objects = listed.objects;
  scanned = objects.length;

  // Check which keys exist in D1 (100 at a time)
  for (let i = 0; i < objects.length; i += 100) {
    const batch = objects.slice(i, i + 100);
    const placeholders = batch.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT r2_key FROM images WHERE r2_key IN (${placeholders})`)
      .bind(...batch.map((o) => o.key))
      .all<{ r2_key: string }>();
    const existingKeys = new Set(result.results.map((r) => r.r2_key));

    // Delete orphans in parallel (small batches)
    const toDelete = batch.filter((obj) => !existingKeys.has(obj.key));
    if (toDelete.length > 0) {
      await Promise.all(toDelete.map((obj) => bucket.delete(obj.key)));
      deleted += toDelete.length;
      bytesFreed += toDelete.reduce((sum, obj) => sum + obj.size, 0);
    }
    kept += batch.length - toDelete.length;
  }

  const nextCursor = listed.truncated ? listed.cursor : undefined;
  const done = !listed.truncated;
  const mbFreed = Math.round(bytesFreed / 1024 / 1024);

  console.log(`[cleanup] orphans batch: scanned=${scanned}, kept=${kept}, deleted=${deleted}, freed=${mbFreed}MB, done=${done}`);

  return c.json({ scanned, kept, deleted, bytesFreed, mbFreed, done, cursor: nextCursor });
});

// ---------------------------------------------------------------------------
// POST /admin/cleanup/expired-projects — delete projects where deleted_at > 7 days
// Removes D1 rows (cascade) AND their R2 images.
// Called by the daily cron trigger, or manually.
// ---------------------------------------------------------------------------
cleanup.post("/admin/cleanup/expired-projects", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  if (!c.env.IMAGES_BUCKET) return c.json({ error: "R2 not configured" }, 500);

  const result = await purgeExpiredProjects(c.env.DB, c.env.IMAGES_BUCKET);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /admin/cleanup/preview — dry-run: show what WOULD be cleaned up
// ---------------------------------------------------------------------------
cleanup.get("/admin/cleanup/preview", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "unauthorized" }, 401);

  const db = c.env.DB;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const expired = await db
    .prepare(
      `SELECT p.id, p.name, p.deleted_at,
              (SELECT COUNT(*) FROM images i
               JOIN versions v ON i.version_id = v.id
               JOIN frames f ON v.frame_id = f.id
               JOIN strips s ON f.strip_id = s.id
               WHERE s.project_id = p.id) as image_count,
              (SELECT COALESCE(SUM(i.size_bytes), 0) FROM images i
               JOIN versions v ON i.version_id = v.id
               JOIN frames f ON v.frame_id = f.id
               JOIN strips s ON f.strip_id = s.id
               WHERE s.project_id = p.id) as total_bytes
         FROM projects p
        WHERE p.deleted_at IS NOT NULL AND p.deleted_at < ?
        ORDER BY p.deleted_at ASC`,
    )
    .bind(cutoff)
    .all();

  return c.json({ cutoff, projects: expired.results });
});

export { purgeExpiredProjects };
export default cleanup;

// ---------------------------------------------------------------------------
// Shared logic — used by both the HTTP endpoint and the cron handler
// ---------------------------------------------------------------------------
async function purgeExpiredProjects(
  db: import("@cloudflare/workers-types").D1Database,
  bucket: import("@cloudflare/workers-types").R2Bucket,
): Promise<{ purgedProjects: number; deletedImages: number; bytesFreed: number; mbFreed: number }> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago

  // Find expired projects
  const expired = await db
    .prepare(
      `SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    )
    .bind(cutoff)
    .all<{ id: string }>();

  let deletedImages = 0;
  let bytesFreed = 0;

  for (const project of expired.results) {
    // 1. Collect all R2 keys for this project's images
    const images = await db
      .prepare(
        `SELECT i.r2_key, i.size_bytes FROM images i
         JOIN versions v ON i.version_id = v.id
         JOIN frames f ON v.frame_id = f.id
         JOIN strips s ON f.strip_id = s.id
         WHERE s.project_id = ?`,
      )
      .bind(project.id)
      .all<{ r2_key: string; size_bytes: number | null }>();

    // 2. Delete R2 objects in parallel
    const keys = images.results.map((i) => i.r2_key).filter(Boolean);
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100);
      await Promise.all(batch.map((key) => bucket.delete(key)));
    }
    deletedImages += keys.length;
    bytesFreed += images.results.reduce((sum, i) => sum + (i.size_bytes ?? 0), 0);

    // 3. Delete project from D1 (CASCADE removes strips, frames, versions, images, drawings, snapshots)
    await db.prepare(`DELETE FROM projects WHERE id = ?`).bind(project.id).run();
  }

  const mbFreed = Math.round(bytesFreed / 1024 / 1024);
  console.log(
    `[cleanup] expired projects: purged=${expired.results.length}, images=${deletedImages}, freed=${mbFreed}MB`,
  );

  return { purgedProjects: expired.results.length, deletedImages, bytesFreed, mbFreed };
}
