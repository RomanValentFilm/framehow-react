import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppVariables, Env } from "../types";
import { loadOwnedProject, requireUser } from "../lib/auth";
import { newId } from "../lib/crypto";
import { isNonEmptyString, jsonError } from "../lib/response";

// Per-account storage limit (beta), see ACCOUNT_SYNC_SPEC.md.
const ACCOUNT_STORAGE_LIMIT_BYTES = 350 * 1024 * 1024;

const MAX_PROJECT_NAME_LEN = 200;
const MAX_LABEL_LEN = 200;
const MAX_VERSION_TYPE_LEN = 40;
const MAX_DRAWING_BYTES = 1 * 1024 * 1024; // 1 MB JSON cap per drawing — generous

const projects = new Hono<{ Bindings: Env; Variables: AppVariables }>();
projects.use("*", requireUser);

// ---------------------------------------------------------------------------
// GET /projects — list (includes recently soft-deleted so UI can show them
// grayed out; hides projects deleted more than 24 h ago)
// ---------------------------------------------------------------------------
projects.get("/", async (c) => {
  const me = c.get("user");
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
  const result = await c.env.DB
    .prepare(
      `SELECT id, name, created_at, updated_at, deleted_at
         FROM projects
        WHERE user_id = ? AND (deleted_at IS NULL OR deleted_at > ?)
        ORDER BY updated_at DESC`,
    )
    .bind(me.id, cutoff)
    .all<{ id: string; name: string; created_at: number; updated_at: number; deleted_at: number | null }>();
  return c.json({ projects: result.results });
});

// ---------------------------------------------------------------------------
// POST /projects — create
// ---------------------------------------------------------------------------
projects.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!isNonEmptyString(name, MAX_PROJECT_NAME_LEN)) {
    return jsonError(c, 400, "invalid_name", "Project name is required.");
  }
  const me = c.get("user");
  const now = Date.now();
  const id = newId();
  await c.env.DB
    .prepare(
      `INSERT INTO projects (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, me.id, name, now, now)
    .run();
  return c.json({ project: { id, name, created_at: now, updated_at: now } }, 201);
});

// ---------------------------------------------------------------------------
// GET /projects/:id — full tree
// ---------------------------------------------------------------------------
projects.get("/:id", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");
  const tree = await loadProjectTree(c.env.DB, project.id);
  return c.json(tree);
});

// ---------------------------------------------------------------------------
// PUT /projects/:id — rename
// ---------------------------------------------------------------------------
projects.put("/:id", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!isNonEmptyString(name, MAX_PROJECT_NAME_LEN)) {
    return jsonError(c, 400, "invalid_name", "Project name is required.");
  }
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");
  const now = Date.now();
  await c.env.DB
    .prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?")
    .bind(name, now, project.id)
    .run();
  return c.json({ project: { id: project.id, name, updated_at: now } });
});

// ---------------------------------------------------------------------------
// DELETE /projects/:id — soft delete (10-day purge by cron)
// ---------------------------------------------------------------------------
projects.delete("/:id", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");
  const now = Date.now();
  await c.env.DB
    .prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, project.id)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/recover — undo soft delete
// ---------------------------------------------------------------------------
projects.post("/:id/recover", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB
    .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL")
    .bind(id, me.id)
    .first<{ id: string }>();
  if (!row) return jsonError(c, 404, "not_found", "Project not found or not deleted.");
  const now = Date.now();
  await c.env.DB
    .prepare("UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ?")
    .bind(now, row.id)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /projects/:id/status — lightweight check: heartbeat + device info (~150 bytes).
// Returns server_now so the client can compute age without clock drift.
// ---------------------------------------------------------------------------
projects.get("/:id/status", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB
    .prepare("SELECT updated_at, last_device_id, last_device_name, heartbeat_at, heartbeat_device_id, heartbeat_device_name FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(id, me.id)
    .first<{ updated_at: number; last_device_id: string | null; last_device_name: string | null; heartbeat_at: number | null; heartbeat_device_id: string | null; heartbeat_device_name: string | null }>();
  if (!row) return jsonError(c, 404, "not_found", "Project not found.");
  return c.json({ ...row, server_now: Date.now() });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/heartbeat — "I'm actively working on this project"
// Tiny request (~100 bytes). Server sets its own timestamp.
// ---------------------------------------------------------------------------
projects.post("/:id/heartbeat", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ device_id: string; device_name: string }>();
  const now = Date.now();
  const result = await c.env.DB
    .prepare("UPDATE projects SET heartbeat_at = ?, heartbeat_device_id = ?, heartbeat_device_name = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(now, body.device_id, body.device_name, id, me.id)
    .run();
  if (!result.meta.changes) return jsonError(c, 404, "not_found", "Project not found.");
  return c.json({ ok: true, heartbeat_at: now });
});

// ---------------------------------------------------------------------------
// GET /projects/:id/sync — download cloud state
// ---------------------------------------------------------------------------
projects.get("/:id/sync", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");
  return c.json(await loadProjectTree(c.env.DB, project.id));
});

// ---------------------------------------------------------------------------
// POST /projects/:id/sync — upload local state with project-level LWW
//
// Spec: "Only the latest state is synced — current strips, frames, latest
// version of each frame, drawings." + "last write wins". So we accept the
// client's full project tree and replace the server's children atomically
// when the client's project.updated_at is >= server's. If the server is
// newer, we return the server tree with `conflict: true` so the caller can
// reconcile and retry.
// ---------------------------------------------------------------------------
projects.post("/:id/sync", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }

  const parsed = parseSyncPayload(body);
  if ("error" in parsed) {
    return jsonError(c, 400, parsed.error.code, parsed.error.message);
  }
  const payload = parsed.value;

  // Conflict detection: if the client sends a base_updated_at that is older
  // than the server's updated_at AND the push is from a different device,
  // that means the client hasn't seen the latest server version. Reject so
  // the client can pull, show the conflict dialog, and reconcile.
  const serverDevice = project.last_device_id;
  const clientDevice = payload.project.device_id;
  const baseUpdatedAt = payload.project.base_updated_at;

  if (baseUpdatedAt !== undefined && baseUpdatedAt < project.updated_at
      && serverDevice && clientDevice && serverDevice !== clientDevice) {
    const remote = await loadProjectTree(c.env.DB, project.id);
    return c.json({ conflict: true, remote }, 409);
  }

  // Fallback: server is newer (same-device case or no base_updated_at).
  if (payload.project.updated_at < project.updated_at) {
    const remote = await loadProjectTree(c.env.DB, project.id);
    return c.json({ conflict: true, remote }, 409);
  }

  // Storage quota: total of new images + existing images on this user's other
  // projects. We delete + reinsert the syncing project's images, so its old
  // bytes don't count; everyone else's do.
  const otherImagesUsed = await sumOtherProjectImageBytes(c.env.DB, me.id, project.id);
  const incomingBytes = payload.images.reduce((sum, img) => sum + (img.size_bytes ?? 0), 0);
  if (otherImagesUsed + incomingBytes > ACCOUNT_STORAGE_LIMIT_BYTES) {
    return jsonError(
      c,
      413,
      "storage_full",
      "Storage full — the beta version of Framehow has limited storage. Delete a project to free up space.",
    );
  }

  const now = Date.now();

  // Snapshot: save a copy of the current state before overwriting,
  // but only if 10+ minutes have passed since the last snapshot.
  // The user has edited since restoring, so they are no longer standing on that
  // restore point. Note on the point itself that the work carried on from there
  // — the snapshot stays exactly as it was — and stop marking it as "here".
  const standing = await c.env.DB
    .prepare("SELECT restored_snapshot_id FROM projects WHERE id = ?")
    .bind(project.id)
    .first<{ restored_snapshot_id: string | null }>();
  if (standing?.restored_snapshot_id) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE project_snapshots SET continued_at = ? WHERE id = ? AND continued_at IS NULL",
      ).bind(now, standing.restored_snapshot_id),
      c.env.DB.prepare("UPDATE projects SET restored_snapshot_id = NULL WHERE id = ?").bind(project.id),
    ]);
  }

  await maybeCreateSnapshot(c.env.DB, project.id, now);

  await applySync(c.env.DB, project.id, payload, now);

  return c.json(await loadProjectTree(c.env.DB, project.id));
});

// ---------------------------------------------------------------------------
// GET /projects/:id/snapshots — list available restore points
// ---------------------------------------------------------------------------
projects.get("/:id/snapshots", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  const result = await c.env.DB
    .prepare(
      `SELECT id, created_at, reason, continued_at FROM project_snapshots
       WHERE project_id = ? ORDER BY created_at DESC`,
    )
    .bind(project.id)
    .all<{ id: string; created_at: number; reason: string; continued_at: number | null }>();

  const cur = await c.env.DB
    .prepare("SELECT restored_snapshot_id FROM projects WHERE id = ?")
    .bind(project.id)
    .first<{ restored_snapshot_id: string | null }>();

  return c.json({ snapshots: result.results, currentSnapshotId: cur?.restored_snapshot_id ?? null });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/snapshots — capture the current state as a restore point.
// Called when the restore list is opened, so "where you are now" is always in
// the list and the user can always come back to it.
// ---------------------------------------------------------------------------
projects.post("/:id/snapshots", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  // Work made offline is stamped with the time it was actually made, not the
  // time it reached us — otherwise the restore list would misreport it.
  let reason: 'pre_restore' | 'offline' = 'pre_restore';
  let at = Date.now();
  try {
    const b = (await c.req.json()) as { reason?: string; madeAt?: number };
    if (b?.reason === 'offline') reason = 'offline';
    if (typeof b?.madeAt === 'number' && b.madeAt > 0 && b.madeAt <= Date.now()) at = b.madeAt;
  } catch { /* no body — ordinary "where you are now" point */ }

  await forceCreateSnapshot(c.env.DB, project.id, at, reason);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/restore/:snapshotId — restore project to a snapshot
// ---------------------------------------------------------------------------
projects.post("/:id/restore/:snapshotId", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const snapshotId = c.req.param("snapshotId");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  const snap = await c.env.DB
    .prepare("SELECT tree_json, created_at FROM project_snapshots WHERE id = ? AND project_id = ?")
    .bind(snapshotId, project.id)
    .first<{ tree_json: string; created_at: number }>();
  if (!snap) return jsonError(c, 404, "not_found", "Snapshot not found.");

  // Save a snapshot of the CURRENT state before restoring, marked so the modal
  // can always offer it back by name — this is the user's way out of a restore
  // they did not like.
  const now = Date.now();
  await forceCreateSnapshot(c.env.DB, project.id, now, 'pre_restore');

  // Parse the snapshot tree and re-apply it as a full sync
  const tree: ProjectTree = JSON.parse(snap.tree_json);

  // Delete all current project content and rebuild from snapshot
  const stripIds = tree.strips.map((s) => s.id);
  if (stripIds.length > 0) {
    // Delete existing content first
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM strips WHERE project_id = ?").bind(project.id),
    ]);
  } else {
    await c.env.DB.prepare("DELETE FROM strips WHERE project_id = ?").bind(project.id).run();
  }

  // Re-insert strips, frames, versions, images, drawings from snapshot
  const stmts: D1PreparedStatement[] = [];

  for (const s of tree.strips) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO strips (id, project_id, label, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(s.id, project.id, s.label, s.sort_order, now),
    );
  }
  for (const f of tree.frames) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO frames (id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label, strip_labels, hidden, note, scribbles, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(f.id, f.strip_id, f.label, f.sort_order, f.crop_w, f.crop_h, f.text_content, f.table_data, f.version_label, f.strip_labels, f.hidden, f.note ?? null, f.scribbles ?? null, now),
    );
  }
  for (const v of tree.versions) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO versions (id, frame_id, label, type, hidden, starred, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(v.id, v.frame_id, v.label, v.type, v.hidden, v.starred, v.note ?? null, now),
    );
  }
  for (const img of tree.images) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO images (id, version_id, r2_key, width, height, size_bytes, content_type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(img.id, img.version_id, img.r2_key, img.width, img.height, img.size_bytes, img.content_type, now),
    );
  }
  for (const d of tree.drawings) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO drawings (id, version_id, drawing_data, updated_at) VALUES (?, ?, ?, ?)",
      ).bind(d.id, d.version_id, d.drawing_data, now),
    );
  }

  // Update project metadata + timestamp
  stmts.push(
    c.env.DB.prepare(
      "UPDATE projects SET metadata = ?, updated_at = ? WHERE id = ?",
    ).bind(tree.project.metadata, now, project.id),
  );

  if (stmts.length > 0) await c.env.DB.batch(stmts);

  // Remember where the user now stands, so the list can mark it.
  await c.env.DB
    .prepare("UPDATE projects SET restored_snapshot_id = ? WHERE id = ?")
    .bind(snapshotId, project.id)
    .run();

  // Thin snapshots after restore
  await thinSnapshots(c.env.DB, project.id, now);

  return c.json(await loadProjectTree(c.env.DB, project.id));
});

export default projects;

// ===========================================================================
// Helpers
// ===========================================================================

interface ProjectTree {
  project: { id: string; name: string; created_at: number; updated_at: number; last_device_id: string | null; last_device_name: string | null; metadata: string | null };
  strips: Array<{ id: string; project_id: string; label: string | null; sort_order: number; updated_at: number }>;
  frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: number; note: string | null; scribbles: string | null; updated_at: number }>;
  versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: number; starred: number; note: string | null; updated_at: number }>;
  images: Array<{
    id: string;
    version_id: string;
    r2_key: string;
    width: number | null;
    height: number | null;
    size_bytes: number | null;
    content_type: string | null;
    updated_at: number;
  }>;
  drawings: Array<{ id: string; version_id: string; drawing_data: string; updated_at: number }>;
  deletions: Array<{ id: string; entity_type: string; entity_id: string; deleted_at: number; device_id: string | null }>;
}

async function loadProjectTree(db: D1Database, projectId: string): Promise<ProjectTree> {
  // Use subqueries instead of IN (?, ?, ...) to avoid D1's 100-variable limit.
  // All queries filter through project_id, so only 1 bind param each.
  const [projectResult, stripsResult, framesResult, versionsResult, imagesResult, drawingsResult, deletionsResult] = await db.batch([
    db.prepare(
      "SELECT id, name, created_at, updated_at, last_device_id, last_device_name, metadata FROM projects WHERE id = ?",
    ).bind(projectId),
    db.prepare(
      `SELECT id, project_id, label, sort_order, updated_at
         FROM strips WHERE project_id = ? ORDER BY sort_order`,
    ).bind(projectId),
    db.prepare(
      `SELECT id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label, strip_labels, hidden, note, scribbles, updated_at
         FROM frames WHERE strip_id IN (SELECT id FROM strips WHERE project_id = ?)
        ORDER BY sort_order`,
    ).bind(projectId),
    db.prepare(
      `SELECT id, frame_id, label, type, hidden, starred, note, updated_at
         FROM versions WHERE frame_id IN (
           SELECT f.id FROM frames f JOIN strips s ON s.id = f.strip_id WHERE s.project_id = ?
         ) ORDER BY updated_at`,
    ).bind(projectId),
    db.prepare(
      `SELECT id, version_id, r2_key, width, height, size_bytes, content_type, updated_at
         FROM images WHERE version_id IN (
           SELECT v.id FROM versions v
           JOIN frames f ON f.id = v.frame_id
           JOIN strips s ON s.id = f.strip_id
           WHERE s.project_id = ?
         )`,
    ).bind(projectId),
    db.prepare(
      `SELECT id, version_id, drawing_data, updated_at
         FROM drawings WHERE version_id IN (
           SELECT v.id FROM versions v
           JOIN frames f ON f.id = v.frame_id
           JOIN strips s ON s.id = f.strip_id
           WHERE s.project_id = ?
         )`,
    ).bind(projectId),
    // Tombstones: only return deletions from the last 30 days
    db.prepare(
      `SELECT id, entity_type, entity_id, deleted_at, device_id
         FROM project_deletions
        WHERE project_id = ? AND deleted_at > ?`,
    ).bind(projectId, Date.now() - 30 * 24 * 60 * 60 * 1000),
  ]);

  const project = (projectResult.results as any[])[0] as ProjectTree["project"];
  return {
    project,
    strips: stripsResult.results as ProjectTree["strips"],
    frames: framesResult.results as ProjectTree["frames"],
    versions: versionsResult.results as ProjectTree["versions"],
    images: imagesResult.results as ProjectTree["images"],
    drawings: drawingsResult.results as ProjectTree["drawings"],
    deletions: deletionsResult.results as ProjectTree["deletions"],
  };
}

async function sumOtherProjectImageBytes(
  db: D1Database,
  userId: string,
  excludeProjectId: string,
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
          AND p.id != ?
          AND p.deleted_at IS NULL`,
    )
    .bind(userId, excludeProjectId)
    .first<{ used: number }>();
  return row?.used ?? 0;
}

// ---------------------------------------------------------------------------
// Sync payload parsing + apply
// ---------------------------------------------------------------------------

interface SyncPayload {
  project: { name: string; updated_at: number; base_updated_at?: number; device_id?: string; device_name?: string; metadata?: string | null };
  /** When true, only dirty frames are included — server UPSERTs instead of full replace. */
  partial: boolean;
  strips: Array<{ id: string; label: string | null; sort_order: number; updated_at: number }>;
  frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: boolean; note: string | null; scribbles: string | null; updated_at: number }>;
  versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: boolean; starred: number; note: string | null; updated_at: number }>;
  images: Array<{
    id: string;
    version_id: string;
    r2_key: string;
    width: number | null;
    height: number | null;
    size_bytes: number | null;
    content_type: string | null;
    updated_at: number;
  }>;
  drawings: Array<{ id: string; version_id: string; drawing_data: string; updated_at: number }>;
  deletions: Array<{ id: string; entity_type: string; entity_id: string; deleted_at: number; device_id: string | null }>;
}

type Parsed<T> = { value: T } | { error: { code: string; message: string } };

function asStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}
function asNullableStr(v: unknown, max: number): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.length <= max) return v;
  return undefined;
}

function parseSyncPayload(body: unknown): Parsed<SyncPayload> {
  if (!body || typeof body !== "object") {
    return { error: { code: "invalid_payload", message: "Body must be an object." } };
  }
  const b = body as Record<string, unknown>;

  const projObj = b.project as Record<string, unknown> | undefined;
  if (!projObj) return err("project");
  const projName = asStr(projObj.name)?.trim();
  const projUpdated = asInt(projObj.updated_at);
  if (!projName || projName.length === 0 || projName.length > MAX_PROJECT_NAME_LEN) return err("project.name");
  if (projUpdated === null) return err("project.updated_at");
  const baseUpdatedAt = typeof projObj.base_updated_at === "number" && Number.isFinite(projObj.base_updated_at) ? projObj.base_updated_at : undefined;
  const deviceId = typeof projObj.device_id === "string" ? projObj.device_id.slice(0, 100) : undefined;
  const deviceName = typeof projObj.device_name === "string" ? projObj.device_name.slice(0, 100) : undefined;
  const metadata = typeof projObj.metadata === "string" ? projObj.metadata : null;

  const partial = b.partial === true;

  const strips: SyncPayload["strips"] = [];
  for (const raw of asArray(b.strips)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const sort_order = asInt(r.sort_order);
    const updated_at = asInt(r.updated_at);
    const label = asNullableStr(r.label, MAX_LABEL_LEN);
    if (!id || sort_order === null || updated_at === null || label === undefined) return err("strips[]");
    strips.push({ id, label, sort_order, updated_at });
  }

  const stripIdSet = new Set(strips.map((s) => s.id));

  const frames: SyncPayload["frames"] = [];
  for (const raw of asArray(b.frames)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const strip_id = asStr(r.strip_id);
    const sort_order = asInt(r.sort_order);
    const updated_at = asInt(r.updated_at);
    const label = asNullableStr(r.label, MAX_LABEL_LEN);
    const crop_w = r.crop_w === null || r.crop_w === undefined ? null : asInt(r.crop_w);
    const crop_h = r.crop_h === null || r.crop_h === undefined ? null : asInt(r.crop_h);
    const text_content = r.text_content === null || r.text_content === undefined ? null : asStr(r.text_content);
    const table_data = r.table_data === null || r.table_data === undefined ? null : asStr(r.table_data);
    const version_label = asNullableStr(r.version_label, MAX_LABEL_LEN);
    const strip_labels = r.strip_labels === null || r.strip_labels === undefined ? null : asStr(r.strip_labels);
    const hidden = r.hidden === true || r.hidden === 1;
    const note = r.note === null || r.note === undefined ? null : asStr(r.note);
    const scribbles = r.scribbles === null || r.scribbles === undefined ? null : asStr(r.scribbles);
    if (!id || !strip_id || sort_order === null || updated_at === null || label === undefined || version_label === undefined) return err("frames[]");
    if (!stripIdSet.has(strip_id)) return err("frames[].strip_id (unknown)");
    frames.push({ id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label: version_label ?? null, strip_labels, hidden, note, scribbles, updated_at });
  }

  const frameIdSet = new Set(frames.map((f) => f.id));

  const versions: SyncPayload["versions"] = [];
  for (const raw of asArray(b.versions)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const frame_id = asStr(r.frame_id);
    const type = asStr(r.type);
    const updated_at = asInt(r.updated_at);
    const label = asNullableStr(r.label, MAX_LABEL_LEN);
    const hidden = r.hidden === true || r.hidden === 1;
    // 0-3 rating. Older clients only ever sent 0/1, which still reads as 0/1.
    const starred = Number(r.starred) || 0;
    const note = r.note === null || r.note === undefined ? null : asStr(r.note);
    if (!id || !frame_id || !type || type.length > MAX_VERSION_TYPE_LEN || updated_at === null || label === undefined) {
      return err("versions[]");
    }
    if (!frameIdSet.has(frame_id)) return err("versions[].frame_id (unknown)");
    versions.push({ id, frame_id, label, type, hidden, starred, note, updated_at });
  }

  const versionIdSet = new Set(versions.map((v) => v.id));

  const images: SyncPayload["images"] = [];
  const seenImageVersionIds = new Set<string>();
  for (const raw of asArray(b.images)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const version_id = asStr(r.version_id);
    const r2_key = asStr(r.r2_key);
    const updated_at = asInt(r.updated_at);
    const width = r.width === null || r.width === undefined ? null : asInt(r.width);
    const height = r.height === null || r.height === undefined ? null : asInt(r.height);
    const size_bytes = r.size_bytes === null || r.size_bytes === undefined ? null : asInt(r.size_bytes);
    const content_type = asStr(r.content_type) ?? null;
    if (!id || !version_id || !r2_key || updated_at === null) return err("images[]");
    if (!versionIdSet.has(version_id)) return err("images[].version_id (unknown)");
    if (seenImageVersionIds.has(version_id)) return err("images[]: duplicate version_id");
    seenImageVersionIds.add(version_id);
    images.push({ id, version_id, r2_key, width, height, size_bytes, content_type, updated_at });
  }

  const drawings: SyncPayload["drawings"] = [];
  const seenDrawingVersionIds = new Set<string>();
  for (const raw of asArray(b.drawings)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const version_id = asStr(r.version_id);
    const drawing_data = asStr(r.drawing_data);
    const updated_at = asInt(r.updated_at);
    if (!id || !version_id || drawing_data === null || updated_at === null) return err("drawings[]");
    if (drawing_data.length > MAX_DRAWING_BYTES) return err("drawings[].drawing_data (too large)");
    if (!versionIdSet.has(version_id)) return err("drawings[].version_id (unknown)");
    if (seenDrawingVersionIds.has(version_id)) return err("drawings[]: duplicate version_id");
    seenDrawingVersionIds.add(version_id);
    drawings.push({ id, version_id, drawing_data, updated_at });
  }

  const deletions: SyncPayload["deletions"] = [];
  for (const raw of asArray(b.deletions)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const entity_type = asStr(r.entity_type);
    const entity_id = asStr(r.entity_id);
    const deleted_at = asInt(r.deleted_at);
    const device_id = typeof r.device_id === "string" ? r.device_id.slice(0, 100) : null;
    if (!id || !entity_type || !entity_id || deleted_at === null) return err("deletions[]");
    if (entity_type !== "frame" && entity_type !== "version") return err("deletions[].entity_type");
    deletions.push({ id, entity_type, entity_id, deleted_at, device_id });
  }

  return {
    value: {
      project: { name: projName, updated_at: projUpdated, base_updated_at: baseUpdatedAt, device_id: deviceId, device_name: deviceName, metadata },
      partial,
      strips,
      frames,
      versions,
      images,
      drawings,
      deletions,
    },
  };

  function err(field: string): Parsed<SyncPayload> {
    return { error: { code: "invalid_payload", message: `Invalid sync payload at: ${field}` } };
  }
  function asArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
  }
}

async function applySync(db: D1Database, projectId: string, payload: SyncPayload, now: number) {
  if (payload.partial) {
    await applySyncPartial(db, projectId, payload, now);
  } else {
    await applySyncFull(db, projectId, payload, now);
  }
}

// ---------------------------------------------------------------------------
// FULL SYNC — delete everything for this project, re-insert from payload.
// Used for first push, fallback, or backward-compatible full pushes.
// ---------------------------------------------------------------------------
async function applySyncFull(db: D1Database, projectId: string, payload: SyncPayload, now: number) {
  const stmts: D1PreparedStatement[] = [
    // bottom-up delete
    db.prepare(
      `DELETE FROM drawings
        WHERE version_id IN (
          SELECT v.id FROM versions v
          JOIN frames f ON f.id = v.frame_id
          JOIN strips s ON s.id = f.strip_id
          WHERE s.project_id = ?
        )`,
    ).bind(projectId),
    db.prepare(
      `DELETE FROM images
        WHERE version_id IN (
          SELECT v.id FROM versions v
          JOIN frames f ON f.id = v.frame_id
          JOIN strips s ON s.id = f.strip_id
          WHERE s.project_id = ?
        )`,
    ).bind(projectId),
    db.prepare(
      `DELETE FROM versions
        WHERE frame_id IN (
          SELECT f.id FROM frames f
          JOIN strips s ON s.id = f.strip_id
          WHERE s.project_id = ?
        )`,
    ).bind(projectId),
    db.prepare(
      `DELETE FROM frames
        WHERE strip_id IN (SELECT id FROM strips WHERE project_id = ?)`,
    ).bind(projectId),
    db.prepare("DELETE FROM strips WHERE project_id = ?").bind(projectId),
    // project name + bumped updated_at + device tracking
    db.prepare("UPDATE projects SET name = ?, updated_at = ?, last_device_id = COALESCE(?, last_device_id), last_device_name = COALESCE(?, last_device_name), metadata = ? WHERE id = ?")
      .bind(payload.project.name, Math.max(payload.project.updated_at, now), payload.project.device_id ?? null, payload.project.device_name ?? null, payload.project.metadata ?? null, projectId),
  ];

  // Inserts
  for (const s of payload.strips) {
    stmts.push(
      db.prepare(
        `INSERT INTO strips (id, project_id, label, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(s.id, projectId, s.label, s.sort_order, s.updated_at),
    );
  }
  appendFrameInserts(db, stmts, payload, now);

  // Tombstones: INSERT OR IGNORE — idempotent, same tombstone may arrive multiple times
  appendTombstoneInserts(db, stmts, payload, projectId);

  await db.batch(stmts);
}

// ---------------------------------------------------------------------------
// PARTIAL (DELTA) SYNC — only dirty frames are in the payload.
// Server deletes+reinserts those specific frames and their children.
// All other frames are left untouched.
// ---------------------------------------------------------------------------
async function applySyncPartial(db: D1Database, projectId: string, payload: SyncPayload, now: number) {
  // Look up the existing strip for this project. In partial mode, the
  // frontend may generate a new strip UUID each push. We remap to the
  // existing one so frames reference the correct strip_id.
  const existingStrip = await db.prepare(
    "SELECT id FROM strips WHERE project_id = ? LIMIT 1",
  ).bind(projectId).first<{ id: string }>();

  const stmts: D1PreparedStatement[] = [];

  if (existingStrip) {
    // Remap all incoming frames to the existing strip
    for (const f of payload.frames) {
      f.strip_id = existingStrip.id;
    }
  } else {
    // First push — insert the strip
    if (payload.strips.length > 0) {
      const s = payload.strips[0];
      stmts.push(
        db.prepare(
          `INSERT INTO strips (id, project_id, label, sort_order, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(s.id, projectId, s.label, s.sort_order, s.updated_at),
      );
    }
  }

  // For each dirty frame: delete its children (bottom-up), then delete the frame.
  for (const f of payload.frames) {
    stmts.push(
      db.prepare(
        `DELETE FROM drawings WHERE version_id IN (SELECT id FROM versions WHERE frame_id = ?)`,
      ).bind(f.id),
    );
    stmts.push(
      db.prepare(
        `DELETE FROM images WHERE version_id IN (SELECT id FROM versions WHERE frame_id = ?)`,
      ).bind(f.id),
    );
    stmts.push(
      db.prepare("DELETE FROM versions WHERE frame_id = ?").bind(f.id),
    );
    stmts.push(
      db.prepare("DELETE FROM frames WHERE id = ?").bind(f.id),
    );
  }

  // Apply tombstones: actively delete the entities they reference.
  // In full mode this isn't needed (everything is deleted). In partial mode
  // we must explicitly remove tombstoned frames/versions that aren't in the
  // dirty set.
  for (const del of payload.deletions) {
    if (del.entity_type === "frame") {
      stmts.push(
        db.prepare(
          `DELETE FROM drawings WHERE version_id IN (SELECT id FROM versions WHERE frame_id = ?)`,
        ).bind(del.entity_id),
      );
      stmts.push(
        db.prepare(
          `DELETE FROM images WHERE version_id IN (SELECT id FROM versions WHERE frame_id = ?)`,
        ).bind(del.entity_id),
      );
      stmts.push(
        db.prepare("DELETE FROM versions WHERE frame_id = ?").bind(del.entity_id),
      );
      stmts.push(
        db.prepare("DELETE FROM frames WHERE id = ?").bind(del.entity_id),
      );
    } else if (del.entity_type === "version") {
      stmts.push(
        db.prepare("DELETE FROM drawings WHERE version_id = ?").bind(del.entity_id),
      );
      stmts.push(
        db.prepare("DELETE FROM images WHERE version_id = ?").bind(del.entity_id),
      );
      stmts.push(
        db.prepare("DELETE FROM versions WHERE id = ?").bind(del.entity_id),
      );
    }
  }

  // Re-insert dirty frames and their children
  appendFrameInserts(db, stmts, payload, now);

  // Record tombstones for future pulls by other devices
  appendTombstoneInserts(db, stmts, payload, projectId);

  // Update project metadata
  stmts.push(
    db.prepare(
      "UPDATE projects SET name = ?, updated_at = ?, last_device_id = COALESCE(?, last_device_id), last_device_name = COALESCE(?, last_device_name), metadata = ? WHERE id = ?",
    ).bind(
      payload.project.name,
      Math.max(payload.project.updated_at, now),
      payload.project.device_id ?? null,
      payload.project.device_name ?? null,
      payload.project.metadata ?? null,
      projectId,
    ),
  );

  await db.batch(stmts);
}

// ---------------------------------------------------------------------------
// Shared helpers for both full and partial sync
// ---------------------------------------------------------------------------
function appendFrameInserts(db: D1Database, stmts: D1PreparedStatement[], payload: SyncPayload, now: number) {
  for (const f of payload.frames) {
    stmts.push(
      db.prepare(
        `INSERT INTO frames (id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label, strip_labels, hidden, note, scribbles, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(f.id, f.strip_id, f.label, f.sort_order, f.crop_w, f.crop_h, f.text_content, f.table_data, f.version_label, f.strip_labels, f.hidden ? 1 : 0, f.note ?? null, f.scribbles ?? null, f.updated_at),
    );
  }
  for (const v of payload.versions) {
    stmts.push(
      db.prepare(
        `INSERT INTO versions (id, frame_id, label, type, hidden, starred, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(v.id, v.frame_id, v.label, v.type, v.hidden ? 1 : 0, Number(v.starred) || 0, v.note ?? null, v.updated_at),
    );
  }
  for (const img of payload.images) {
    stmts.push(
      db.prepare(
        `INSERT INTO images
           (id, version_id, r2_key, width, height, size_bytes, content_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        img.id, img.version_id, img.r2_key, img.width, img.height,
        img.size_bytes, img.content_type, now, img.updated_at,
      ),
    );
  }
  for (const d of payload.drawings) {
    stmts.push(
      db.prepare(
        `INSERT INTO drawings (id, version_id, drawing_data, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(d.id, d.version_id, d.drawing_data, d.updated_at),
    );
  }
}

function appendTombstoneInserts(db: D1Database, stmts: D1PreparedStatement[], payload: SyncPayload, projectId: string) {
  for (const del of payload.deletions) {
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO project_deletions (id, project_id, entity_type, entity_id, deleted_at, device_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(del.id, projectId, del.entity_type, del.entity_id, del.deleted_at, del.device_id),
    );
  }
}

// ===========================================================================
// SNAPSHOTS — automatic restore points
// ===========================================================================

const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Save a snapshot of the current project state if 10+ minutes since last snapshot.
 * Called before each sync push so the pre-push state is preserved.
 */
async function maybeCreateSnapshot(db: D1Database, projectId: string, now: number): Promise<void> {
  const latest = await db.prepare(
    "SELECT created_at FROM project_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
  ).bind(projectId).first<{ created_at: number }>();

  if (latest && (now - latest.created_at) < SNAPSHOT_INTERVAL_MS) return;

  await forceCreateSnapshot(db, projectId, now);

  // Thin old snapshots after creating a new one
  await thinSnapshots(db, projectId, now);
}

/**
 * Unconditionally save a snapshot (used before restore and when interval elapsed).
 */
async function forceCreateSnapshot(
  db: D1Database,
  projectId: string,
  now: number,
  reason: 'auto' | 'pre_restore' | 'offline' = 'auto',
): Promise<void> {
  const tree = await loadProjectTree(db, projectId);
  // Skip snapshot if project is empty (no frames)
  if (tree.frames.length === 0) return;

  const json = JSON.stringify(tree);

  // Don't stack up identical "where you left off" points. Opening the restore
  // list and then restoring from it happens seconds apart with nothing changed
  // in between, so compare the actual content rather than guessing at a delay.
  if (reason === 'pre_restore' || reason === 'offline') {
    // Match against EVERY point, not just the newest: right after a restore the
    // project is identical to the point it was restored to, and stamping that
    // same content with the present time is what made the list nonsense.
    const same = await db.prepare(
      "SELECT 1 AS hit FROM project_snapshots WHERE project_id = ? AND tree_json = ? LIMIT 1",
    ).bind(projectId, json).first<{ hit: number }>();
    if (same) return;
  }

  const id = newId();
  await db.prepare(
    "INSERT INTO project_snapshots (id, project_id, tree_json, created_at, reason) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, projectId, json, now, reason).run();
}

/**
 * Enforce the retention policy by deleting snapshots that fall outside the
 * allowed buckets:
 *   - Last hour: every 10 min (5 max)
 *   - 1–4 hours: one per hour (3 max)
 *   - 5–24 hours: one per 4 hours (2 max)
 *   - Older than 24h: one ("yesterday")
 *   - Older than 48h: delete all
 */
async function thinSnapshots(db: D1Database, projectId: string, now: number): Promise<void> {
  const all = await db.prepare(
    "SELECT id, created_at, reason FROM project_snapshots WHERE project_id = ? ORDER BY created_at DESC",
  ).bind(projectId).all<{ id: string; created_at: number; reason: string }>();

  const snaps = all.results;
  if (snaps.length <= 1) return;

  const keep = new Set<string>();

  // Pre-restore points are the user's way back out of a restore. Keep every one
  // of them for the full 48h window — they are never thinned into a bucket.
  for (const s of snaps) {
    if ((s.reason === 'pre_restore' || s.reason === 'offline')
        && now - s.created_at <= 48 * 60 * 60 * 1000) keep.add(s.id);
  }

  // Bucket boundaries in ms
  const ONE_HOUR   = 60 * 60 * 1000;
  const FOUR_HOURS = 4 * ONE_HOUR;
  const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;
  const FORTY_EIGHT_HOURS = 48 * ONE_HOUR;

  // Last hour: keep every 10-min snapshot (max 5 by natural creation interval)
  // 1–4 hours: keep one per hour (3 buckets: 1h, 2h, 3h)
  // 5–24 hours: keep one per 4 hours (2 buckets: ~5h, ~15h)
  // 24–48 hours: keep one ("yesterday")
  // Older than 48h: delete

  // Last hour — keep all
  for (const s of snaps) {
    const age = now - s.created_at;
    if (age <= ONE_HOUR) keep.add(s.id);
  }

  // 1–4 hours — one per hour
  for (let h = 1; h < 4; h++) {
    const bucketStart = now - (h + 1) * ONE_HOUR;
    const bucketEnd   = now - h * ONE_HOUR;
    const best = snaps.find((s) => s.created_at > bucketStart && s.created_at <= bucketEnd);
    if (best) keep.add(best.id);
  }

  // 5–24 hours — one per 4 hours (buckets at ~5h and ~15h roughly)
  // Bucket 1: 4–12 hours
  const b1 = snaps.find((s) => {
    const age = now - s.created_at;
    return age > FOUR_HOURS && age <= 12 * ONE_HOUR;
  });
  if (b1) keep.add(b1.id);

  // Bucket 2: 12–24 hours
  const b2 = snaps.find((s) => {
    const age = now - s.created_at;
    return age > 12 * ONE_HOUR && age <= TWENTY_FOUR_HOURS;
  });
  if (b2) keep.add(b2.id);

  // Older than 24h — keep the most recent one
  const yesterday = snaps.find((s) => (now - s.created_at) > TWENTY_FOUR_HOURS);
  if (yesterday) keep.add(yesterday.id);

  // Delete everything not in keep, plus anything older than 48h
  const toDelete = snaps.filter((s) =>
    !keep.has(s.id) || (now - s.created_at) > FORTY_EIGHT_HOURS,
  );
  if (toDelete.length === 0) return;

  const stmts = toDelete.map((s) =>
    db.prepare("DELETE FROM project_snapshots WHERE id = ?").bind(s.id),
  );
  await db.batch(stmts);
}
