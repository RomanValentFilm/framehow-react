import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  // Optional: present only after R2 is activated (see wrangler.toml).
  IMAGES_BUCKET?: R2Bucket;

  // Vars
  APP_NAME: string;
  APP_URL: string;
  SESSION_TTL_DAYS: string;
  PASSWORD_RESET_TTL_HOURS: string;
  EMAIL_VERIFY_TTL_HOURS: string;
  ADMIN_EMAIL: string;

  // Secrets (set via `wrangler secret put`)
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
}

export type AppVariables = {
  user: AuthedUser;
  sessionId: string;
};
