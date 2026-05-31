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
  await applySync(c.env.DB, project.id, payload, now);

  return c.json(await loadProjectTree(c.env.DB, project.id));
});

export default projects;

// ===========================================================================
// Helpers
// ===========================================================================

interface ProjectTree {
  project: { id: string; name: string; created_at: number; updated_at: number; last_device_id: string | null; last_device_name: string | null; metadata: string | null };
  strips: Array<{ id: string; project_id: string; label: string | null; sort_order: number; updated_at: number }>;
  frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: number; updated_at: number }>;
  versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: number; starred: number; updated_at: number }>;
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
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

async function loadProjectTree(db: D1Database, projectId: string): Promise<ProjectTree> {
  // Use subqueries instead of IN (?, ?, ...) to avoid D1's 100-variable limit.
  // All queries filter through project_id, so only 1 bind param each.
  const [projectResult, stripsResult, framesResult, versionsResult, imagesResult, drawingsResult] = await db.batch([
    db.prepare(
      "SELECT id, name, created_at, updated_at, last_device_id, last_device_name, metadata FROM projects WHERE id = ?",
    ).bind(projectId),
    db.prepare(
      `SELECT id, project_id, label, sort_order, updated_at
         FROM strips WHERE project_id = ? ORDER BY sort_order`,
    ).bind(projectId),
    db.prepare(
      `SELECT id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label, strip_labels, hidden, updated_at
         FROM frames WHERE strip_id IN (SELECT id FROM strips WHERE project_id = ?)
        ORDER BY sort_order`,
    ).bind(projectId),
    db.prepare(
      `SELECT id, frame_id, label, type, hidden, starred, updated_at
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
  ]);

  const project = (projectResult.results as any[])[0] as ProjectTree["project"];
  return {
    project,
    strips: stripsResult.results as ProjectTree["strips"],
    frames: framesResult.results as ProjectTree["frames"],
    versions: versionsResult.results as ProjectTree["versions"],
    images: imagesResult.results as ProjectTree["images"],
    drawings: drawingsResult.results as ProjectTree["drawings"],
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
  strips: Array<{ id: string; label: string | null; sort_order: number; updated_at: number }>;
  frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: boolean; updated_at: number }>;
  versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: boolean; starred: boolean; updated_at: number }>;
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
    if (!id || !strip_id || sort_order === null || updated_at === null || label === undefined || version_label === undefined) return err("frames[]");
    if (!stripIdSet.has(strip_id)) return err("frames[].strip_id (unknown)");
    frames.push({ id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label: version_label ?? null, strip_labels, hidden, updated_at });
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
    const starred = r.starred === true || r.starred === 1;
    if (!id || !frame_id || !type || type.length > MAX_VERSION_TYPE_LEN || updated_at === null || label === undefined) {
      return err("versions[]");
    }
    if (!frameIdSet.has(frame_id)) return err("versions[].frame_id (unknown)");
    versions.push({ id, frame_id, label, type, hidden, starred, updated_at });
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

  return {
    value: {
      project: { name: projName, updated_at: projUpdated, base_updated_at: baseUpdatedAt, device_id: deviceId, device_name: deviceName, metadata },
      strips,
      frames,
      versions,
      images,
      drawings,
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
  // Full replacement of children. With FK ON DELETE CASCADE and D1's default
  // PRAGMA foreign_keys=OFF, we must delete bottom-up explicitly.
  const stmts = [
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
      db
        .prepare(
          `INSERT INTO strips (id, project_id, label, sort_order, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(s.id, projectId, s.label, s.sort_order, s.updated_at),
    );
  }
  for (const f of payload.frames) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO frames (id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label, strip_labels, hidden, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(f.id, f.strip_id, f.label, f.sort_order, f.crop_w, f.crop_h, f.text_content, f.table_data, f.version_label, f.strip_labels, f.hidden ? 1 : 0, f.updated_at),
    );
  }
  for (const v of payload.versions) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO versions (id, frame_id, label, type, hidden, starred, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(v.id, v.frame_id, v.label, v.type, v.hidden ? 1 : 0, v.starred ? 1 : 0, v.updated_at),
    );
  }
  for (const img of payload.images) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO images
             (id, version_id, r2_key, width, height, size_bytes, content_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          img.id,
          img.version_id,
          img.r2_key,
          img.width,
          img.height,
          img.size_bytes,
          img.content_type,
          now,
          img.updated_at,
        ),
    );
  }
  for (const d of payload.drawings) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO drawings (id, version_id, drawing_data, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(d.id, d.version_id, d.drawing_data, d.updated_at),
    );
  }

  await db.batch(stmts);
}
