import { Hono } from "hono";
import type { AppVariables, Env } from "./types";
import authRouter from "./routes/auth";
import userRouter from "./routes/user";
import projectsRouter from "./routes/projects";
import uploadRouter from "./routes/upload";
import analyticsRouter from "./routes/analytics";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// CORS — wide-open during local dev. Lock down to APP_URL in production.
app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") ?? "*";
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
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

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found." } }, 404));

app.onError((err, c) => {
  console.error("[unhandled]", err);
  return c.json({ error: { code: "internal", message: "Something went wrong." } }, 500);
});

export default app;
