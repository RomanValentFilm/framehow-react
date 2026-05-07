import type { Context, MiddlewareHandler } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppVariables, Env } from "../types";
import { hashToken } from "./crypto";
import { jsonError } from "./response";

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  profession: string | null;
  email_verified: number;
}

function readBearer(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : null;
}

/**
 * Look up the session for the request, if any. Returns null when the request
 * has no token, an unknown token, or an expired session. (Expired sessions are
 * not auto-deleted here — a scheduled task can sweep them; cheap to leave.)
 */
async function loadSession(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
): Promise<{ user: UserRow; session: SessionRow } | null> {
  const token = readBearer(c);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const session = await c.env.DB
    .prepare("SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<SessionRow>();
  if (!session) return null;
  if (session.expires_at <= Date.now()) return null;
  const user = await c.env.DB
    .prepare(
      "SELECT id, name, email, profession, email_verified FROM users WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(session.user_id)
    .first<UserRow>();
  if (!user) return null;
  return { user, session };
}

/**
 * Middleware that requires a valid session. Sets `user` and `sessionId` in the
 * Hono context for downstream handlers.
 */
export const requireUser: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (
  c,
  next,
) => {
  const result = await loadSession(c);
  if (!result) return jsonError(c, 401, "unauthorized", "Authentication required.");
  c.set("user", {
    id: result.user.id,
    name: result.user.name,
    email: result.user.email,
    profession: result.user.profession,
    email_verified: result.user.email_verified === 1,
  });
  c.set("sessionId", result.session.id);
  await next();
};

export { loadSession };

/**
 * Verify the given user owns the given (non-deleted) project. Returns the
 * project row on success, null on miss / not-owned / soft-deleted.
 *
 * project_members is intentionally not consulted yet — collaboration ships
 * later (see spec). When it does, extend this to also accept member rows.
 */
export async function loadOwnedProject(
  db: D1Database,
  userId: string,
  projectId: string,
): Promise<{ id: string; user_id: string; name: string; updated_at: number } | null> {
  return await db
    .prepare(
      `SELECT id, user_id, name, updated_at
         FROM projects
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        LIMIT 1`,
    )
    .bind(projectId, userId)
    .first();
}
