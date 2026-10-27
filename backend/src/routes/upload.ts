import { Hono } from "hono";
import { resolveAllowedOrigin } from "../cors";
import type { AppVariables, Env } from "../types";
import { requireUser } from "../lib/auth";
import { newId } from "../lib/crypto";
import { jsonError } from "../lib/response";
import { storageLimitBytes } from "../lib/storage";
import { addBytes, addThumbBytes, ceilingBytes, mailIfStepCrossed, totalBytes, userBytes } from "../lib/totals";
import { thumbOfPicture } from "../lib/cleaner";

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
// THE WALL AND THE CEILING ARE AT THIS DOOR (12 Oct, Roman). Until today the
// account limit was checked only when a project was SAVED; this door refused
// nothing but a single picture over 10 MB, so an account could hold any amount
// for a day until the sweep. Now, before a byte is stored: this account under
// its limit, and the whole of Framehow under the ceiling Roman set. Both refuse
// with the storage-full answer the app already understands. See lib/totals.ts.
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

  // THE WALL: this account, orphans included, may not pass its limit.
  const limit = storageLimitBytes(c.env, c.req.header("X-FH-Storage-Limit-MB"));
  const mine = await userBytes(c.env.DB, me.id);
  if (mine + buf.byteLength > limit) {
    console.log(`[upload] refused: account ${me.id} at ${mine} + ${buf.byteLength} > ${limit}`);
    return c.json({
      error: { code: "storage_full", message: "This account's storage is full." },
      storage: { used: mine, limit, pending: buf.byteLength },
    }, 413);
  }
  // THE CEILING: the whole of Framehow may not pass the number Roman set.
  const ceiling = ceilingBytes(c.env, c.req.header("X-FH-Global-Limit-MB"));
  const all = await totalBytes(c.env.DB);
  if (all + buf.byteLength > ceiling) {
    console.log(`[upload] REFUSED AT THE CEILING: Framehow holds ${all} + ${buf.byteLength} > ${ceiling}`);
    return c.json({
      error: { code: "storage_full", message: "Framehow's storage is full for the moment." },
      storage: { used: mine, limit, pending: buf.byteLength },
    }, 413);
  }

  const r2Key = `users/${me.id}/${newId()}.${extForContentType(contentType)}`;

  await c.env.IMAGES_BUCKET.put(r2Key, buf, {
    httpMetadata: { contentType },
    customMetadata: { user_id: me.id },
  });
  await addBytes(c.env.DB, me.id, buf.byteLength);
  // AT ONCE, if this upload crossed a step Roman wants to hear about. Never in
  // the way of the answer: a mail that fails is logged, the upload stands.
  c.executionCtx.waitUntil(mailIfStepCrossed(c.env, c.env.DB, all + buf.byteLength).catch((e) => console.log(`[upload] step mail failed: ${String(e)}`)));

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

// ---------------------------------------------------------------------------
// THE PICTS LIBRARY'S PREVIEWS (27 Oct, Roman).
//
// A small JPEG of each picture, made by the app the first time the library
// shows it, kept beside the picture in the account's own folder:
//   users/<id>/thumbs/<file>.jpg   for   users/<id>/<file>
// It counts in the account's storage like any picture, and lives exactly as
// long as its picture: the nightly cleaner takes it with it, an erased
// account takes it along.
// ---------------------------------------------------------------------------
const MAX_THUMB_BYTES = 200 * 1024;

function ownThumbKey(c: { req: { url: string } }, userId: string, route: string): { pic: string; thumb: string } | null {
  const url = new URL(c.req.url);
  if (!url.pathname.startsWith(route)) return null;
  const pic = decodeURIComponent(url.pathname.slice(route.length));
  if (!pic.startsWith(`users/${userId}/`)) return null;   // only one's own
  const thumb = thumbOfPicture(pic);
  return thumb ? { pic, thumb } : null;
}

function withCors(c: { req: { header(n: string): string | undefined }; env: Env }, headers: Headers): Headers {
  const allowed = resolveAllowedOrigin(c.req.header("Origin"), c.env.APP_URL);
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", allowed);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  headers.set("Vary", "Origin");
  return headers;
}

// PUT /thumbs/<picture key> — the app sends the preview it made.
upload.put("/thumbs/*", requireUser, async (c) => {
  if (!c.env.IMAGES_BUCKET) return jsonError(c, 503, "r2_unavailable", "Storage is not available.");
  const me = c.get("user");
  const k = ownThumbKey(c, me.id, "/thumbs/");
  if (!k) return jsonError(c, 404, "not_found", "Picture not found.");
  if ((c.req.header("Content-Type") ?? "") !== "image/jpeg") return jsonError(c, 415, "unsupported_media_type", "A preview is a JPEG.");
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) return jsonError(c, 400, "empty_body", "Upload body is empty.");
  if (buf.byteLength > MAX_THUMB_BYTES) return jsonError(c, 413, "image_too_large", "A preview is at most 200 KB.");
  const pic = await c.env.IMAGES_BUCKET.head(k.pic);
  if (!pic) return jsonError(c, 404, "not_found", "Picture not found.");
  const old = await c.env.IMAGES_BUCKET.head(k.thumb);
  const delta = buf.byteLength - (old?.size ?? 0);
  // The same wall as any picture: a full account gets no new previews (the
  // library then shows the picture itself).
  const limit = storageLimitBytes(c.env, c.req.header("X-FH-Storage-Limit-MB"));
  if (delta > 0 && (await userBytes(c.env.DB, me.id)) + delta > limit) {
    return c.json({ error: { code: "storage_full", message: "This account's storage is full." } }, 413);
  }
  await c.env.IMAGES_BUCKET.put(k.thumb, buf, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { user_id: me.id } });
  await addBytes(c.env.DB, me.id, delta);
  await addThumbBytes(c.env.DB, me.id, delta);
  return c.json({ thumb_key: k.thumb, size_bytes: buf.byteLength }, 201);
});

// GET /thumbs/<picture key> — the preview, to its owner only.
upload.get("/thumbs/*", requireUser, async (c) => {
  if (!c.env.IMAGES_BUCKET) return jsonError(c, 503, "r2_unavailable", "Storage is not available.");
  const me = c.get("user");
  const k = ownThumbKey(c, me.id, "/thumbs/");
  if (!k) return jsonError(c, 404, "not_found", "Preview not found.");
  const obj = await c.env.IMAGES_BUCKET.get(k.thumb);
  if (!obj) return jsonError(c, 404, "not_found", "Preview not found.");
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("Cache-Control", "private, max-age=86400");
  return new Response(obj.body as unknown as ReadableStream, { headers: withCors(c, headers) });
});

export default upload;
