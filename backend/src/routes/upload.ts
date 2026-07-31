import { Hono } from "hono";
import { resolveAllowedOrigin } from "../cors";
import type { AppVariables, Env } from "../types";
import { requireUser } from "../lib/auth";
import { newId } from "../lib/crypto";
import { jsonError } from "../lib/response";

// Spec: 10 MB per image. Enforced here from Content-Length first, then again
// against the actual stream length below.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

function extForContentType(ct: string): string {
  switch (ct) {
    case "image/jpeg": return "jpg";
    case "image/png":  return "png";
    case "image/webp": return "webp";
    case "image/gif":  return "gif";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    default:           return "bin";
  }
}

const upload = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ---------------------------------------------------------------------------
// POST /upload — accept raw image bytes, store in R2, return r2_key
//
// Why raw bytes (not multipart): Workers don't have a built-in multipart parser
// and our client controls the upload — keeping the wire format simple keeps
// memory bounded.
//
// Quota / rate-limit are enforced at /sync time (when the image row actually
// lands in D1). Orphan R2 objects from rejected syncs get swept by a cron later.
// ---------------------------------------------------------------------------
upload.post("/upload", requireUser, async (c) => {
  if (!c.env.IMAGES_BUCKET) {
    return jsonError(
      c,
      503,
      "r2_unavailable",
      "Image upload is not yet available — R2 storage isn't activated. Images stay local for now.",
    );
  }

  const contentType = c.req.header("Content-Type") ?? "";
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return jsonError(c, 415, "unsupported_media_type", "Content-Type must be a supported image format.");
  }

  const declaredLen = Number(c.req.header("Content-Length") ?? "0");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_BYTES) {
    return jsonError(c, 413, "image_too_large", "Image exceeds the 10 MB per-image limit.");
  }

  // Buffer the body to confirm size; Workers caps request bodies at 100 MB but
  // we're stricter. Reading via arrayBuffer is fine at 10 MB.
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    return jsonError(c, 413, "image_too_large", "Image exceeds the 10 MB per-image limit.");
  }
  if (buf.byteLength === 0) {
    return jsonError(c, 400, "empty_body", "Upload body is empty.");
  }

  const me = c.get("user");
  const r2Key = `users/${me.id}/${newId()}.${extForContentType(contentType)}`;

  await c.env.IMAGES_BUCKET.put(r2Key, buf, {
    httpMetadata: { contentType },
    customMetadata: { user_id: me.id },
  });

  return c.json({
    r2_key: r2Key,
    size_bytes: buf.byteLength,
    content_type: contentType,
  }, 201);
});

// ---------------------------------------------------------------------------
// GET /images/:r2_key — serve from R2, owner-only
//
// `:r2_key` carries slashes (`users/<id>/<uuid>.<ext>`). Hono's wildcard `*`
// captures the rest of the path verbatim, which is what we want.
// ---------------------------------------------------------------------------
upload.get("/images/*", requireUser, async (c) => {
  if (!c.env.IMAGES_BUCKET) {
    return jsonError(c, 503, "r2_unavailable", "Image serving is not yet available — R2 isn't activated.");
  }

  // Strip the route prefix to recover the full r2_key.
  const url = new URL(c.req.url);
  const prefix = "/images/";
  if (!url.pathname.startsWith(prefix)) {
    return jsonError(c, 404, "not_found", "Image not found.");
  }
  const r2Key = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!r2Key) return jsonError(c, 404, "not_found", "Image not found.");

  // Ownership: the image must belong to a project owned by the caller.
  const me = c.get("user");
  const ownedRow = await c.env.DB
    .prepare(
      `SELECT 1 AS owned
         FROM images i
         JOIN versions v ON v.id = i.version_id
         JOIN frames   f ON f.id = v.frame_id
         JOIN strips   s ON s.id = f.strip_id
         JOIN projects p ON p.id = s.project_id
        WHERE i.r2_key = ? AND p.user_id = ? AND p.deleted_at IS NULL
        LIMIT 1`,
    )
    .bind(r2Key, me.id)
    .first<{ owned: number }>();
  if (!ownedRow) return jsonError(c, 404, "not_found", "Image not found.");

  const obj = await c.env.IMAGES_BUCKET.get(r2Key);
  if (!obj) return jsonError(c, 404, "not_found", "Image not found.");

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  // Private to the owner; no shared/public caching.
  headers.set("Cache-Control", "private, max-age=3600");
  // CORS: new Response() bypasses Hono's middleware headers, so add them here.
  const allowed = resolveAllowedOrigin(c.req.header("Origin"), c.env.APP_URL);
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", allowed);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  headers.set("Vary", "Origin");
  return new Response(obj.body as unknown as ReadableStream, { headers });
});

export default upload;
