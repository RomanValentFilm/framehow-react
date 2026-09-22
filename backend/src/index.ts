import { Hono } from "hono";
import { resolveAllowedOrigin } from "./cors";
import type { AppVariables, Env } from "./types";
import authRouter from "./routes/auth";
import userRouter from "./routes/user";
import projectsRouter from "./routes/projects";
import uploadRouter from "./routes/upload";
import analyticsRouter from "./routes/analytics";
import cleanupRouter, { purgeExpiredProjects, purgeDeletedAccounts } from "./routes/cleanup";
import { deleteDeadPictures } from "./lib/cleaner";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// CORS — only origins we own (see ./cors.ts).
app.use("*", async (c, next) => {
  const allowed = resolveAllowedOrigin(c.req.header("Origin"), c.env.APP_URL);
  c.header("Vary", "Origin");
  if (allowed) {
    c.header("Access-Control-Allow-Origin", allowed);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-FH-Storage-Limit-MB");
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
        // Accounts deleted more than seven days ago are erased for good,
        // with their projects, pictures and visit history (22 Sept).
        try {
          const accounts = await purgeDeletedAccounts(env.DB, env.IMAGES_BUCKET);
          console.log("[cron] accounts erased:", JSON.stringify(accounts));
        } catch (e) {
          console.error("[cron] account erase failed:", e);
        }
        // THE DEAD-PICTURE CLEANER RUNS HERE TOO (22 Sept). Roman: "I don't
        // want to press buttons to delete dead pictures." Every night, every
        // account, the same rule as the page: no project, no restore point
        // names the file, and it is older than 24 hours. After the expired
        // projects, so what they leave behind is judged in the same pass.
        // Every file it deletes is in the log; the buttons stay for a look.
        try {
          const dead = await deleteDeadPictures(env.DB, env.IMAGES_BUCKET, null);
          console.log(`[cron] dead pictures: deleted=${dead.deleted} freed=${Math.round(dead.bytesFreed / 1048576)}MB`);
        } catch (e) {
          console.error("[cron] dead pictures failed:", e);
        }
      })(),
    );
  },
};
