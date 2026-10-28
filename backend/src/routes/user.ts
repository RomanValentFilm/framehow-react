import { Hono } from "hono";
import type { AppVariables, Env } from "../types";
import { requireUser } from "../lib/auth";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { isNonEmptyString, jsonError } from "../lib/response";
import { thumbOfPicture } from "../lib/cleaner";
import { deletePictures, storageFigure } from "../lib/storage";

const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200;
const MAX_NAME_LEN = 120;
const MAX_PROFESSION_LEN = 120;

const user = new Hono<{ Bindings: Env; Variables: AppVariables }>();

user.use("*", requireUser);

// GET /user/pictures — EVERY PICTURE OF THIS ACCOUNT (26 Oct, Roman: the PICTS
// library). The storage itself is the list: every file the account ever
// uploaded sits under users/<id>/, each with the moment it arrived. Joined
// with the cards that use it today (project, shot, version), so the app can
// say where a picture lives. A file no card uses any more is listed too —
// it is still the account's, and still counts against its storage.
// Read-only: nothing here changes or deletes anything.
user.get("/pictures", async (c) => {
  const me = c.get("user");
  if (!c.env.IMAGES_BUCKET) return c.json({ pictures: [] });
  const prefix = `users/${me.id}/`;
  const files: { key: string; uploaded_at: number; size: number }[] = [];
  const thumbs = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = await c.env.IMAGES_BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) {
      if (o.key.startsWith(`${prefix}thumbs/`)) { thumbs.set(o.key, o.size); continue; }   // the library's own previews
      files.push({ key: o.key, uploaded_at: o.uploaded.getTime(), size: o.size });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const uses = await c.env.DB.prepare(
    `SELECT i.r2_key AS key, i.width AS width, i.height AS height,
            p.id AS project_id, p.name AS project_name, f.label AS frame_label, v.label AS version_label
       FROM images i
       JOIN versions v ON v.id = i.version_id
       JOIN frames   f ON f.id = v.frame_id
       JOIN strips   s ON s.id = f.strip_id
       JOIN projects p ON p.id = s.project_id
      WHERE p.user_id = ? AND p.deleted_at IS NULL`,
  ).bind(me.id).all<{ key: string; width: number | null; height: number | null; project_id: string; project_name: string; frame_label: string | null; version_label: string | null }>();
  const byKey = new Map<string, { width: number | null; height: number | null; uses: { project_id: string; project: string; shot: string | null; version: string | null }[] }>();
  for (const u of uses.results ?? []) {
    const e = byKey.get(u.key) ?? { width: u.width, height: u.height, uses: [] };
    e.uses.push({ project_id: u.project_id, project: u.project_name, shot: u.frame_label, version: u.version_label });
    byKey.set(u.key, e);
  }
  // Deleted in the library: never listed, even if a file lingered (28 Oct).
  const goneRows = await c.env.DB.prepare(`SELECT r2_key FROM deleted_pictures WHERE user_id = ?`).bind(me.id).all<{ r2_key: string }>();
  const gone = new Set((goneRows.results ?? []).map((r) => r.r2_key));
  const live = files.filter((f) => !gone.has(f.key));
  files.length = 0; files.push(...live);
  files.sort((a, b) => a.uploaded_at - b.uploaded_at);   // oldest first: the app shows the newest at the bottom
  return c.json({
    pictures: files.map((f) => ({
      key: f.key, uploaded_at: f.uploaded_at, size: f.size,
      width: byKey.get(f.key)?.width ?? null, height: byKey.get(f.key)?.height ?? null,
      uses: byKey.get(f.key)?.uses ?? [],
      thumb: thumbs.has(thumbOfPicture(f.key) ?? ''),   // a preview is there (27 Oct)
      thumb_size: thumbs.get(thumbOfPicture(f.key) ?? '') ?? null,
    })),
  });
});

// POST /user/pictures/delete — DELETE IN THE PICTS LIBRARY (28 Oct, Roman).
// Body: { keys: string[] }. For good: file and preview gone, storage freed, the
// cards keep their drawings and text and say "You deleted this picture", and
// the key is remembered so an offline device cannot bring the picture back.
user.post("/pictures/delete", async (c) => {
  const me = c.get("user");
  let body: unknown;
  try { body = await c.req.json(); } catch { return jsonError(c, 400, "invalid_json", "Body must be JSON."); }
  const keys = (body as { keys?: unknown }).keys;
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string") || keys.length > 500) {
    return jsonError(c, 400, "invalid_keys", "keys must be a list of up to 500 picture keys.");
  }
  const r = await deletePictures(c.env.DB, c.env.IMAGES_BUCKET, me.id, keys as string[]);
  const storage = await storageFigure(c.env.DB, c.env, me.id, c.req.header("X-FH-Storage-Limit-MB"));
  return c.json({ deleted: r.deleted, bytes_freed: r.bytesFreed, cards_marked: r.cardsMarked, storage });
});

// GET /user/me — current profile
user.get("/me", (c) => {
  return c.json({ user: c.get("user") });
});

// PUT /user/me — update name / profession
user.put("/me", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }
  const b = body as Record<string, unknown>;
  const me = c.get("user");

  // Both fields are optional — caller sends only what they want to change.
  let name = me.name;
  let profession = me.profession;

  if (b.name !== undefined) {
    if (typeof b.name !== "string" || !isNonEmptyString(b.name.trim(), MAX_NAME_LEN)) {
      return jsonError(c, 400, "invalid_name", "Name must be a non-empty string.");
    }
    name = b.name.trim();
  }
  if (b.profession !== undefined) {
    if (b.profession === null || b.profession === "") {
      profession = null;
    } else if (typeof b.profession === "string" && b.profession.trim().length <= MAX_PROFESSION_LEN) {
      profession = b.profession.trim();
    } else {
      return jsonError(c, 400, "invalid_profession", "Profession is too long.");
    }
  }

  // The user's own defaults — a small JSON object, or null to clear (#510).
  let preferences = me.preferences ?? null;
  if (b.preferences !== undefined) {
    if (b.preferences === null) {
      preferences = null;
    } else if (typeof b.preferences === "object" && !Array.isArray(b.preferences)) {
      const json = JSON.stringify(b.preferences);
      if (json.length > 8_000) return jsonError(c, 400, "invalid_preferences", "Preferences are too large.");
      preferences = json;
    } else {
      return jsonError(c, 400, "invalid_preferences", "Preferences must be an object.");
    }
  }

  const now = Date.now();
  await c.env.DB
    .prepare("UPDATE users SET name = ?, profession = ?, preferences = ?, updated_at = ? WHERE id = ?")
    .bind(name, profession, preferences, now, me.id)
    .run();

  return c.json({
    user: { ...me, name, profession, preferences },
  });
});

// PUT /user/password — change password (requires current password)
user.put("/password", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }
  const b = body as Record<string, unknown>;
  const current = typeof b.current_password === "string" ? b.current_password : "";
  const next = typeof b.new_password === "string" ? b.new_password : "";

  if (current.length === 0) {
    return jsonError(c, 400, "invalid_password", "Current password is required.");
  }
  if (next.length < MIN_PASSWORD_LEN || next.length > MAX_PASSWORD_LEN) {
    return jsonError(
      c,
      400,
      "invalid_password",
      `New password must be ${MIN_PASSWORD_LEN}-${MAX_PASSWORD_LEN} characters.`,
    );
  }

  const me = c.get("user");
  const row = await c.env.DB
    .prepare("SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(me.id)
    .first<{ password_hash: string }>();
  if (!row) return jsonError(c, 401, "unauthorized", "Authentication required.");

  const ok = await verifyPassword(current, row.password_hash);
  if (!ok) {
    return jsonError(c, 401, "invalid_password", "Current password is incorrect.");
  }

  const newHash = await hashPassword(next);
  const now = Date.now();
  // Invalidate all other sessions; keep the current one alive so the caller
  // doesn't have to re-login on the device they just confirmed from.
  const currentSessionId = c.get("sessionId");
  await c.env.DB.batch([
    c.env.DB
      .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
      .bind(newHash, now, me.id),
    c.env.DB
      .prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
      .bind(me.id, currentSessionId),
  ]);

  return c.json({ ok: true });
});

// DELETE /user/me — GDPR account deletion
//   - Soft-deletes the user (deleted_at set) — frees email for re-registration
//   - Soft-deletes all of the user's projects (10-day purge handled by cron)
//   - Invalidates every session for the user
user.delete("/me", async (c) => {
  const me = c.get("user");
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB
      .prepare("UPDATE users SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, me.id),
    c.env.DB
      .prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND deleted_at IS NULL")
      .bind(now, now, me.id),
    c.env.DB
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .bind(me.id),
  ]);
  return c.json({ ok: true });
});

export default user;
