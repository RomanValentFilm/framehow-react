import { Hono } from "hono";
import type { AppVariables, Env } from "../types";
import {
  generateToken,
  hashPassword,
  hashToken,
  newId,
  verifyPassword,
} from "../lib/crypto";
import { sendPasswordResetEmail, sendVerificationEmail } from "../lib/email";
import { isEmail, isNonEmptyString, jsonError } from "../lib/response";

// Minimum password length. The spec doesn't pin a number; 8 is a sane floor
// and matches NIST 800-63B guidance (with provider-side breach checks layered
// in later if needed).
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200;
const MAX_NAME_LEN = 120;
const MAX_PROFESSION_LEN = 120;

const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function ttlMs(env: Env, key: "SESSION_TTL_DAYS" | "PASSWORD_RESET_TTL_HOURS" | "EMAIL_VERIFY_TTL_HOURS"): number {
  const raw = Number(env[key]);
  if (!Number.isFinite(raw) || raw <= 0) {
    // Sensible defaults if the var is missing/invalid.
    if (key === "SESSION_TTL_DAYS") return 30 * 24 * 60 * 60 * 1000;
    if (key === "PASSWORD_RESET_TTL_HOURS") return 60 * 60 * 1000;
    return 48 * 60 * 60 * 1000;
  }
  return key === "SESSION_TTL_DAYS"
    ? raw * 24 * 60 * 60 * 1000
    : raw * 60 * 60 * 1000;
}

/**
 * In non-production environments (no EMAIL_API_KEY configured), we surface
 * verification / reset tokens in the response so the flow can be exercised
 * without a real email provider. Strip in prod.
 */
function devTokenEcho(env: Env, token: string): { dev_token?: string } {
  return env.EMAIL_API_KEY ? {} : { dev_token: token };
}

// ---------------------------------------------------------------------------
// POST /auth/signup
// ---------------------------------------------------------------------------
auth.post("/signup", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password : "";
  const profession = typeof b.profession === "string" ? b.profession.trim() : null;

  if (!isNonEmptyString(name, MAX_NAME_LEN)) {
    return jsonError(c, 400, "invalid_name", "Name is required.");
  }
  if (!isEmail(email)) {
    return jsonError(c, 400, "invalid_email", "A valid email is required.");
  }
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    return jsonError(
      c,
      400,
      "invalid_password",
      `Password must be ${MIN_PASSWORD_LEN}-${MAX_PASSWORD_LEN} characters.`,
    );
  }
  if (profession && profession.length > MAX_PROFESSION_LEN) {
    return jsonError(c, 400, "invalid_profession", "Profession is too long.");
  }

  const existing = await c.env.DB
    .prepare(
      "SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND deleted_at IS NULL LIMIT 1",
    )
    .bind(email)
    .first<{ id: string }>();
  if (existing) {
    return jsonError(c, 409, "email_taken", "An account with this email already exists.");
  }

  const now = Date.now();
  const userId = newId();
  const passwordHash = await hashPassword(password);
  const verifyToken = generateToken();
  const verifyTokenHash = await hashToken(verifyToken);
  const verifyExpiresAt = now + ttlMs(c.env, "EMAIL_VERIFY_TTL_HOURS");

  await c.env.DB
    .prepare(
      `INSERT INTO users
         (id, name, email, password_hash, profession, email_verified,
          email_verification_token_hash, email_verification_expires_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .bind(userId, name, email, passwordHash, profession, verifyTokenHash, verifyExpiresAt, now, now)
    .run();

  // Issue a session immediately — spec: "account works immediately, but remind
  // user to verify".
  const sessionToken = generateToken();
  const sessionTokenHash = await hashToken(sessionToken);
  const sessionId = newId();
  const sessionExpiresAt = now + ttlMs(c.env, "SESSION_TTL_DAYS");
  const deviceInfo = c.req.header("User-Agent") ?? null;
  await c.env.DB
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, device_info, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(sessionId, userId, sessionTokenHash, deviceInfo, sessionExpiresAt, now)
    .run();

  await sendVerificationEmail(c.env, email, name, verifyToken);

  return c.json({
    user: { id: userId, name, email, profession, email_verified: false },
    session: { token: sessionToken, expires_at: sessionExpiresAt },
    ...devTokenEcho(c.env, verifyToken),
  }, 201);
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
auth.post("/login", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }
  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password : "";

  if (!isEmail(email) || password.length === 0) {
    return jsonError(c, 400, "invalid_credentials", "Email and password are required.");
  }

  const user = await c.env.DB
    .prepare(
      `SELECT id, name, email, password_hash, profession, email_verified
         FROM users WHERE LOWER(email) = LOWER(?) AND deleted_at IS NULL LIMIT 1`,
    )
    .bind(email)
    .first<{
      id: string;
      name: string;
      email: string;
      password_hash: string;
      profession: string | null;
      email_verified: number;
    }>();

  // Always do the password verify work to mitigate user-enumeration via timing.
  const stored = user?.password_hash ?? "pbkdf2$1$AAAA$AAAA";
  const ok = await verifyPassword(password, stored);
  if (!user || !ok) {
    return jsonError(c, 401, "invalid_credentials", "Email or password is incorrect.");
  }

  const now = Date.now();
  const sessionToken = generateToken();
  const sessionTokenHash = await hashToken(sessionToken);
  const sessionId = newId();
  const sessionExpiresAt = now + ttlMs(c.env, "SESSION_TTL_DAYS");
  const deviceInfo = c.req.header("User-Agent") ?? null;
  await c.env.DB
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, device_info, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(sessionId, user.id, sessionTokenHash, deviceInfo, sessionExpiresAt, now)
    .run();

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      profession: user.profession,
      email_verified: user.email_verified === 1,
    },
    session: { token: sessionToken, expires_at: sessionExpiresAt },
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------
auth.post("/logout", async (c) => {
  const header = c.req.header("Authorization");
  const m = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  if (!m) return c.json({ ok: true }); // idempotent: no token, nothing to do
  const tokenHash = await hashToken(m[1].trim());
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /auth/forgot-password
// ---------------------------------------------------------------------------
auth.post("/forgot-password", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }
  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!isEmail(email)) {
    return jsonError(c, 400, "invalid_email", "A valid email is required.");
  }

  const user = await c.env.DB
    .prepare(
      "SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?) AND deleted_at IS NULL LIMIT 1",
    )
    .bind(email)
    .first<{ id: string; name: string; email: string }>();

  // Always respond identically — don't reveal whether the email is registered.
  const response: { ok: true; dev_token?: string } = { ok: true };

  if (user) {
    const now = Date.now();
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const expiresAt = now + ttlMs(c.env, "PASSWORD_RESET_TTL_HOURS");
    await c.env.DB
      .prepare(
        `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(newId(), user.id, tokenHash, expiresAt, now)
      .run();
    await sendPasswordResetEmail(c.env, user.email, user.name, token);
    if (!c.env.EMAIL_API_KEY) response.dev_token = token;
  }

  return c.json(response);
});

// ---------------------------------------------------------------------------
// POST /auth/reset-password
// ---------------------------------------------------------------------------
auth.post("/reset-password", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }
  const b = body as Record<string, unknown>;
  const token = typeof b.token === "string" ? b.token : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!token) {
    return jsonError(c, 400, "invalid_token", "Reset token is required.");
  }
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    return jsonError(
      c,
      400,
      "invalid_password",
      `Password must be ${MIN_PASSWORD_LEN}-${MAX_PASSWORD_LEN} characters.`,
    );
  }

  const tokenHash = await hashToken(token);
  const now = Date.now();
  const reset = await c.env.DB
    .prepare(
      `SELECT id, user_id, expires_at, used_at
         FROM password_resets WHERE token_hash = ? LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();

  if (!reset || reset.used_at !== null || reset.expires_at <= now) {
    return jsonError(c, 400, "token_invalid", "This reset link is invalid or has expired.");
  }

  const passwordHash = await hashPassword(password);

  // Apply changes atomically: update password, mark reset consumed, kill all
  // existing sessions (force re-login on every device).
  await c.env.DB.batch([
    c.env.DB
      .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
      .bind(passwordHash, now, reset.user_id),
    c.env.DB
      .prepare("UPDATE password_resets SET used_at = ? WHERE id = ?")
      .bind(now, reset.id),
    c.env.DB
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .bind(reset.user_id),
  ]);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /auth/verify-email
// ---------------------------------------------------------------------------
auth.get("/verify-email", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!token) {
    return jsonError(c, 400, "invalid_token", "Verification token is required.");
  }
  const tokenHash = await hashToken(token);
  const now = Date.now();

  const user = await c.env.DB
    .prepare(
      `SELECT id, email_verification_expires_at
         FROM users WHERE email_verification_token_hash = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{ id: string; email_verification_expires_at: number | null }>();

  if (!user || !user.email_verification_expires_at || user.email_verification_expires_at <= now) {
    return jsonError(c, 400, "token_invalid", "This verification link is invalid or has expired.");
  }

  await c.env.DB
    .prepare(
      `UPDATE users
          SET email_verified = 1,
              email_verification_token_hash = NULL,
              email_verification_expires_at = NULL,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(now, user.id)
    .run();

  return c.json({ ok: true });
});

export default auth;
