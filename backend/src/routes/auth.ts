import { Hono } from "hono";
import type { AppVariables, Env } from "../types";
import {
  generateToken,
  hashPassword,
  hashToken,
  newId,
  verifyPassword,
} from "../lib/crypto";
import { sendPasswordResetEmail, sendWelcomeEmail, sendVerifyEmail } from "../lib/email";
import { requireUser } from "../lib/auth";
import { isEmail, isNonEmptyString, jsonError } from "../lib/response";
import { allow, clear, ipOf } from "../lib/rateLimit";

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
  // 5 new accounts per address per hour (rate limits, 9 Nov).
  if (!await allow(c.env, "signup", `ip:${ipOf(c.req)}`, c.req)) {
    return jsonError(c, 429, "rate_limited", "Too many new accounts from here. Please try again later.");
  }

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

  // THE ADDRESS STAYS RESERVED WHILE AN ACCOUNT IS ON ITS WAY OUT (22 Sept).
  //
  // Roman's rule: a deleted account is kept for seven days so it can be
  // brought back, and its address is free again only once it is erased.
  // This used to ignore deleted accounts, so the same person could register
  // again the next minute — and then two rows held one address, one of them
  // still carrying all the projects we promised to keep for a week.
  const existing = await c.env.DB
    .prepare(
      "SELECT id, deleted_at FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
    )
    .bind(email)
    .first<{ id: string; deleted_at: number | null }>();
  if (existing) {
    return jsonError(
      c,
      409,
      "email_taken",
      existing.deleted_at
        ? "This email belonged to an account that was deleted recently. It can be used again once the deletion is complete."
        : "An account with this email already exists.",
    );
  }

  const now = Date.now();
  const userId = newId();
  const passwordHash = await hashPassword(password);
  const verifyToken = generateToken();
  const verifyTokenHash = await hashToken(verifyToken);
  const verifyExpiresAt = now + ttlMs(c.env, "EMAIL_VERIFY_TTL_HOURS");

  // WHEN THEY AGREED (22 Sept). The app sends the moment the box was ticked;
  // anything odd (missing, or a time that is not a time) is recorded as the
  // moment the account was made, which is never later than the truth.
  const claimed = Number((body as { terms_agreed_at?: unknown }).terms_agreed_at);
  const termsAgreedAt = Number.isFinite(claimed) && claimed > 0 && claimed <= now + 60_000 ? claimed : now;
  // NEWS AND UPDATES (9 Nov): the tick is optional; its moment is the consent record.
  const newsletterAt = (body as { newsletter?: unknown }).newsletter === true ? now : null;

  await c.env.DB
    .prepare(
      `INSERT INTO users
         (id, name, email, password_hash, profession, email_verified,
          email_verification_token_hash, email_verification_expires_at,
          terms_agreed_at, newsletter_consent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(userId, name, email, passwordHash, profession, verifyTokenHash, verifyExpiresAt, termsAgreedAt, newsletterAt, now, now)
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

  // WELCOME, AND NOTHING WAITS FOR IT (9 Oct). The session above is already
  // issued: the account works this second whether the mail arrives, is slow,
  // or never goes at all. No address is confirmed during the beta.
  await sendWelcomeEmail(c.env, email, name, verifyToken, typeof b.app === "string" ? b.app : null);

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

  // 10 wrong passwords per email per 15 minutes (rate limits, 9 Nov); the
  // right one clears the count below.
  if (!await allow(c.env, "login", email, c.req)) {
    return jsonError(c, 429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
  }

  // SIGNING IN BRINGS A DELETED ACCOUNT BACK (A11, 9 Nov, Roman: "the easiest
  // is they sign back themselves within 7 days"). A deleted account is kept
  // for seven days (users.deleted_at; the nightly sweep erases it after). Until
  // today only Roman could restore it, from the analytics page, while the app
  // said "cannot be undone". Now the right password within those seven days
  // IS the undo: the account and the projects that went with it come back,
  // and the answer says so (`restored: true`) so the app can tell the person.
  // Past the seven days the row may still be there until 03:00 — it is treated
  // as gone, exactly as the Terms promise.
  const user = await c.env.DB
    .prepare(
      `SELECT id, name, email, password_hash, profession, email_verified, preferences, deleted_at
         FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    )
    .bind(email)
    .first<{
      id: string;
      name: string;
      email: string;
      password_hash: string;
      profession: string | null;
      email_verified: number;
      preferences: string | null;
      deleted_at: number | null;
    }>();

  // Always do the password verify work to mitigate user-enumeration via timing.
  const stored = user?.password_hash ?? "pbkdf2$1$AAAA$AAAA";
  const ok = await verifyPassword(password, stored);
  const now = Date.now();
  const RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
  const gone = !!user?.deleted_at && now - user.deleted_at > RECOVERY_MS;
  if (!user || !ok || gone) {
    return jsonError(c, 401, "invalid_credentials", "Email or password is incorrect.");
  }
  await clear(c.env, "login", email);
  let restored = false;
  if (user.deleted_at) {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE users SET deleted_at = NULL, updated_at = ? WHERE id = ?`).bind(now, user.id),
      // Only the projects that went with the account deletion — they all carry
      // that same moment. A project the person had deleted earlier stays deleted.
      c.env.DB.prepare(`UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE user_id = ? AND deleted_at = ?`).bind(now, user.id, user.deleted_at),
    ]);
    restored = true;
    console.log(`[auth] account ${user.id} brought back by signing in, ${Math.round((now - user.deleted_at) / 3600000)} h after deletion`);
  }

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
      preferences: user.preferences ?? null,
    },
    session: { token: sessionToken, expires_at: sessionExpiresAt },
    restored,
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
  // 3 mails per email per hour, 20 per address per hour (rate limits, 9 Nov).
  if (!await allow(c.env, "forgotEmail", email, c.req) || !await allow(c.env, "forgotIp", `ip:${ipOf(c.req)}`, c.req)) {
    return jsonError(c, 429, "rate_limited", "Too many requests. Please wait an hour and try again.");
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
    // The app says which address it is speaking from, so a dev link points at
    // dev; it is trusted only against the list the server holds (lib/email).
    const from = typeof b.app === "string" ? b.app : null;
    await sendPasswordResetEmail(c.env, user.email, user.name, token, from);
    // The token is echoed back ONLY on the simulator's own worker, never on a
    // real one, so a test can follow the link without reading mail.
    if (c.env.FH_E2E === "1") response.dev_token = token;
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

  // THEY ARE SIGNED IN WHEN THEY ARE DONE (9 Oct, Roman).
  //
  // This used to drop every session and leave the person at the sign-in box,
  // typing the password they had chosen one second earlier. Every OTHER device
  // is still signed out — whoever asked for this link may be locked out of
  // their own account by someone else — but THIS one carries straight on.
  const sessionToken = generateToken();
  const sessionTokenHash = await hashToken(sessionToken);
  const sessionExpiresAt = now + ttlMs(c.env, "SESSION_TTL_DAYS");
  const deviceInfo = c.req.header("User-Agent") ?? null;

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
    c.env.DB
      .prepare(`INSERT INTO sessions (id, user_id, token_hash, device_info, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(newId(), reset.user_id, sessionTokenHash, deviceInfo, sessionExpiresAt, now),
  ]);

  const me = await c.env.DB
    .prepare("SELECT id, name, email, profession, email_verified FROM users WHERE id = ? LIMIT 1")
    .bind(reset.user_id)
    .first<{ id: string; name: string; email: string; profession: string | null; email_verified: number }>();

  return c.json({
    ok: true,
    user: me ? { ...me, email_verified: me.email_verified === 1 } : null,
    session: { token: sessionToken, expires_at: sessionExpiresAt },
  });
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

// ---------------------------------------------------------------------------
// POST /auth/resend-verification (9 Nov) — a fresh link, for the signed-in
// person who did not get or lost the first mail. 3 per hour per email.
// ---------------------------------------------------------------------------
auth.post("/resend-verification", requireUser, async (c) => {
  const me = c.get("user");
  const asked = await c.req.json().then((j: unknown) => (j && typeof (j as { app?: unknown }).app === "string" ? (j as { app: string }).app : null)).catch(() => null);
  if (me.email_verified) return c.json({ ok: true, already: true });
  if (!await allow(c.env, "forgotEmail", me.email, c.req)) {
    return jsonError(c, 429, "rate_limited", "Too many requests. Please wait an hour and try again.");
  }
  const token = generateToken();
  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE users SET email_verification_token_hash = ?, email_verification_expires_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(await hashToken(token), now + ttlMs(c.env, "EMAIL_VERIFY_TTL_HOURS"), now, me.id).run();
  await sendVerifyEmail(c.env, me.email, me.name, token, asked);
  return c.json({ ok: true, ...devTokenEcho(c.env, token) });
});

export default auth;
