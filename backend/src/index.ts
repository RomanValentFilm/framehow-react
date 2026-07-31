import { Hono } from "hono";
import { resolveAllowedOrigin } from "./cors";
import type { AppVariables, Env } from "./types";
import authRouter from "./routes/auth";
import userRouter from "./routes/user";
import projectsRouter from "./routes/projects";
import uploadRouter from "./routes/upload";
import analyticsRouter from "./routes/analytics";
import cleanupRouter, { purgeExpiredProjects } from "./routes/cleanup";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// CORS — only origins we own (see ./cors.ts).
app.use("*", async (c, next) => {
  const allowed = resolveAllowedOrigin(c.req.header("Origin"), c.env.APP_URL);
  c.header("Vary", "Origin");
  if (allowed) {
    c.header("Access-Control-Allow-Origin", allowed);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  }
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

app.get("/", (c) => c.json({ name: c.env.APP_NAME, status: "ok" }));
app.get("/healthz", (c) => c.json({ ok: true }));

app.route("/auth", authRouter);
app.route("/user", userRouter);
app.route("/projects", projectsRouter);
// Upload router owns both /upload and /images/*; mount at root.
app.route("/", uploadRouter);
// Analytics: /track (public) + /analytics/* (admin-only)
app.route("/", analyticsRouter);
// Cleanup: /admin/cleanup/* (admin-only)
app.route("/", cleanupRouter);

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found." } }, 404));

app.onError((err, c) => {
  console.error("[unhandled]", err);
  return c.json({ error: { code: "internal", message: "Something went wrong." } }, 500);
});

// ---------------------------------------------------------------------------
// Cron trigger — runs daily, purges projects deleted > 7 days ago
// ---------------------------------------------------------------------------
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        if (!env.IMAGES_BUCKET) {
          console.log("[cron] IMAGES_BUCKET not configured, skipping cleanup");
          return;
        }
        const result = await purgeExpiredProjects(env.DB, env.IMAGES_BUCKET);
        console.log("[cron] daily cleanup done:", JSON.stringify(result));
      })(),
    );
  },
};
