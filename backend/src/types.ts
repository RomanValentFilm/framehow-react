import type { D1Database, R2Bucket, SendEmail } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  // Optional: present only after R2 is activated (see wrangler.toml).
  IMAGES_BUCKET?: R2Bucket;
  // MAIL (9 Oct) — Cloudflare Email Sending. Absent on the simulator's local
  // worker, where mail is written to the log instead of sent.
  EMAIL?: SendEmail;

  // Vars
  APP_NAME: string;
  APP_URL: string;
  // Every app address a reset link may point at; the first is the live one and
  // the fallback. Nothing outside it is ever put in a mail (lib/email).
  APP_URLS?: string;
  SESSION_TTL_DAYS: string;
  PASSWORD_RESET_TTL_HOURS: string;
  EMAIL_VERIFY_TTL_HOURS: string;
  ADMIN_EMAIL: string;
  // Storage (#533): per-account limit in MB (default 350); FH_E2E="1" only on
  // the simulator's local worker — lets a test lower the limit per request.
  STORAGE_LIMIT_MB?: string;
  FH_E2E?: string;

  // Secrets (set via `wrangler secret put`)
  // Kept only so an older deployment's vars do not break the type. Mail goes
  // through the EMAIL binding above; there is no key any more.
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  ADMIN_API_TOKEN?: string;
}

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  profession: string | null;
  email_verified: boolean;
  /** The user's own defaults, as JSON text (#510). */
  preferences?: string | null;
}

export type AppVariables = {
  user: AuthedUser;
  sessionId: string;
};
