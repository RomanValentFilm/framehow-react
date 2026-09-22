import { Hono } from "hono";
import type { Env, AppVariables } from "../types";
import { deleteProjectForGood } from "../lib/storage";

const cleanup = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ---------------------------------------------------------------------------
// Admin auth helper
// ---------------------------------------------------------------------------
function isAdmin(c: any): boolean {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  return !!token && token === c.env.ADMIN_API_TOKEN;
}

// The old "orphan cleanup" door lived here until 22 Sept: it deleted every
// file no picture row named, without asking the restore points and without an
// age. Gone. The cleaner with the full rule is lib/cleaner.ts (counting mode).

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

export { purgeExpiredProjects, purgeDeletedAccounts };
export default cleanup;

// ---------------------------------------------------------------------------
// DELETING AN ACCOUNT MEANS DELETING IT (22 Sept, Roman's rules)
//
//   press → signed out everywhere, cannot sign in, the space stops counting
//   seven days → everything still there, Roman can bring it back
//   after that → every project, every picture file, every restore point and
//                the account itself are erased. Nothing is kept, not even the
//                address, which is free again from that moment.
//
// Until now the account was only MARKED as deleted and stayed for ever: the
// name, the address and the profession sat in the database, and the pictures
// went only because the projects happened to be marked at the same moment.
// ---------------------------------------------------------------------------
async function purgeDeletedAccounts(
  db: import("@cloudflare/workers-types").D1Database,
  bucket: import("@cloudflare/workers-types").R2Bucket,
): Promise<{ purgedAccounts: number; deletedImages: number; bytesFreed: number }> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const expired = await db
    .prepare(`SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
    .bind(cutoff)
    .all<{ id: string }>();

  let deletedImages = 0;
  let bytesFreed = 0;
  for (const user of expired.results) {
    // The picture files first — deleting the account's row would take the
    // project rows with it (cascade) and leave every file behind for ever.
    const projects = await db
      .prepare(`SELECT id FROM projects WHERE user_id = ?`)
      .bind(user.id)
      .all<{ id: string }>();
    for (const p of projects.results) {
      const r = await deleteProjectForGood(db, bucket, user.id, p.id);
      deletedImages += r.deletedFiles;
      bytesFreed += r.bytesFreed;
    }
    // Their visit history is their data too, and it points at an account
    // that is about to stop existing.
    await db.batch([
      db.prepare(`DELETE FROM analytics_events WHERE uid = ?`).bind(user.id),
      db.prepare(`DELETE FROM analytics_sessions WHERE uid = ?`).bind(user.id),
      // Sessions, password resets and memberships go with the row (cascade).
      db.prepare(`DELETE FROM users WHERE id = ?`).bind(user.id),
    ]);
    console.log(`[cleanup] account ${user.id} erased: ${projects.results.length} project(s)`);
  }

  if (expired.results.length > 0) {
    console.log(`[cleanup] accounts erased: ${expired.results.length}, images=${deletedImages}, freed=${Math.round(bytesFreed / 1048576)}MB`);
  }
  return { purgedAccounts: expired.results.length, deletedImages, bytesFreed };
}

// ---------------------------------------------------------------------------
// Shared logic — used by both the HTTP endpoint and the cron handler
// ---------------------------------------------------------------------------
async function purgeExpiredProjects(
  db: import("@cloudflare/workers-types").D1Database,
  bucket: import("@cloudflare/workers-types").R2Bucket,
): Promise<{ purgedProjects: number; deletedImages: number; keptShared: number; bytesFreed: number; mbFreed: number }> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago

  // Find expired projects
  const expired = await db
    .prepare(
      `SELECT id, user_id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    )
    .bind(cutoff)
    .all<{ id: string; user_id: string }>();

  let deletedImages = 0;
  let keptShared = 0;
  let bytesFreed = 0;

  // ONE PATH for deleting a project for good (#533): files first, unless
  // another project or restore point still names them, then the rows.
  for (const project of expired.results) {
    const r = await deleteProjectForGood(db, bucket, project.user_id, project.id);
    deletedImages += r.deletedFiles;
    keptShared += r.keptShared;
    bytesFreed += r.bytesFreed;
  }

  const mbFreed = Math.round(bytesFreed / 1024 / 1024);
  console.log(
    `[cleanup] expired projects: purged=${expired.results.length}, images=${deletedImages}, keptShared=${keptShared}, freed=${mbFreed}MB`,
  );

  return { purgedProjects: expired.results.length, deletedImages, keptShared, bytesFreed, mbFreed };
}
