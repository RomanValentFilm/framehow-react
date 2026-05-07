import { Hono } from "hono";
import type { AppVariables, Env } from "../types";
import { requireUser } from "../lib/auth";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { isNonEmptyString, jsonError } from "../lib/response";

const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200;
const MAX_NAME_LEN = 120;
const MAX_PROFESSION_LEN = 120;

const user = new Hono<{ Bindings: Env; Variables: AppVariables }>();

user.use("*", requireUser);

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

  const now = Date.now();
  await c.env.DB
    .prepare("UPDATE users SET name = ?, profession = ?, updated_at = ? WHERE id = ?")
    .bind(name, profession, now, me.id)
    .run();

  return c.json({
    user: { ...me, name, profession },
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
