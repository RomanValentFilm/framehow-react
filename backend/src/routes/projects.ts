import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppVariables, Env } from "../types";
import { loadOwnedProject, requireUser } from "../lib/auth";
import { newId } from "../lib/crypto";
import { isNonEmptyString, jsonError } from "../lib/response";
import { decideFrame, decideVersion } from "../lib/syncDecide";

/**
 * D1 refuses a query with more than 100 bound values ("too many SQL variables").
 * A push of 45 frames carries well over 100 versions, so asking about them in
 * one `WHERE id IN (...)` threw — and the whole push came back as a bare 500,
 * for ever, with the device retrying every few seconds. Ask in batches. (#276)
 */
const SQL_VARS = 90;
function inChunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += SQL_VARS) out.push(items.slice(i, i + SQL_VARS));
  return out;
}

// Per-account storage limit (beta), see ACCOUNT_SYNC_SPEC.md.
const ACCOUNT_STORAGE_LIMIT_BYTES = 350 * 1024 * 1024;

const MAX_PROJECT_NAME_LEN = 200;
const MAX_LABEL_LEN = 200;
const MAX_VERSION_TYPE_LEN = 40;
const MAX_DRAWING_BYTES = 1 * 1024 * 1024; // 1 MB JSON cap per drawing — generous

const projects = new Hono<{ Bindings: Env; Variables: AppVariables }>();
projects.use("*", requireUser);

// ---------------------------------------------------------------------------
// GET /projects — list (includes recently soft-deleted so UI can show them
// grayed out; hides projects deleted more than 24 h ago)
// ---------------------------------------------------------------------------
projects.get("/", async (c) => {
  const me = c.get("user");
  // Deleted projects stay listed — greyed out and recoverable — for the whole
  // week they exist on the server. Showing them for one day while keeping them
  // for seven meant six days of storage nobody could reach.
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const result = await c.env.DB
    .prepare(
      `SELECT id, name, created_at, updated_at, deleted_at
         FROM projects
        WHERE user_id = ? AND (deleted_at IS NULL OR deleted_at > ?)
        ORDER BY updated_at DESC`,
    )
    .bind(me.id, cutoff)
    .all<{ id: string; name: string; created_at: number; updated_at: number; deleted_at: number | null }>();
  return c.json({ projects: result.results });
});

// ---------------------------------------------------------------------------
// POST /projects — create
// ---------------------------------------------------------------------------
projects.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!isNonEmptyString(name, MAX_PROJECT_NAME_LEN)) {
    return jsonError(c, 400, "invalid_name", "Project name is required.");
  }
  const me = c.get("user");
  const now = Date.now();
  const id = newId();
  await c.env.DB
    .prepare(
      `INSERT INTO projects (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, me.id, name, now, now)
    .run();
  return c.json({ project: { id, name, created_at: now, updated_at: now } }, 201);
});

// ---------------------------------------------------------------------------
// GET /projects/:id — full tree
// ---------------------------------------------------------------------------
projects.get("/:id", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");
  const tree = await loadProjectTree(c.env.DB, project.id);
  return c.json(tree);
});

// ---------------------------------------------------------------------------
// PUT /projects/:id — rename
// ---------------------------------------------------------------------------
projects.put("/:id", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!isNonEmptyString(name, MAX_PROJECT_NAME_LEN)) {
    return jsonError(c, 400, "invalid_name", "Project name is required.");
  }
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");
  const now = Date.now();
  await c.env.DB
    .prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?")
    .bind(name, now, project.id)
    .run();
  return c.json({ project: { id: project.id, name, updated_at: now } });
});

// ---------------------------------------------------------------------------
// DELETE /projects/:id — soft delete (10-day purge by cron)
// ---------------------------------------------------------------------------
projects.delete("/:id", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");
  const now = Date.now();
  await c.env.DB
    .prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, project.id)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/recover — undo soft delete
// ---------------------------------------------------------------------------
projects.post("/:id/recover", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB
    .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL")
    .bind(id, me.id)
    .first<{ id: string }>();
  if (!row) return jsonError(c, 404, "not_found", "Project not found or not deleted.");
  const now = Date.now();
  await c.env.DB
    .prepare("UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ?")
    .bind(now, row.id)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /projects/:id/status — lightweight check: heartbeat + device info (~150 bytes).
// Returns server_now so the client can compute age without clock drift.
// ---------------------------------------------------------------------------
projects.get("/:id/status", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB
    .prepare("SELECT updated_at, last_device_id, last_device_name, heartbeat_at, heartbeat_device_id, heartbeat_device_name FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(id, me.id)
    .first<{ updated_at: number; last_device_id: string | null; last_device_name: string | null; heartbeat_at: number | null; heartbeat_device_id: string | null; heartbeat_device_name: string | null }>();
  if (!row) return jsonError(c, 404, "not_found", "Project not found.");
  return c.json({ ...row, server_now: Date.now() });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/heartbeat — "I'm actively working on this project"
// Tiny request (~100 bytes). Server sets its own timestamp.
// ---------------------------------------------------------------------------
projects.post("/:id/heartbeat", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ device_id: string; device_name: string }>();
  const now = Date.now();
  const result = await c.env.DB
    .prepare("UPDATE projects SET heartbeat_at = ?, heartbeat_device_id = ?, heartbeat_device_name = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .bind(now, body.device_id, body.device_name, id, me.id)
    .run();
  if (!result.meta.changes) return jsonError(c, 404, "not_found", "Project not found.");

  // The heartbeat already runs every few seconds while someone is working, and
  // already talks to us — so it is the cheapest place to say "a decision is
  // waiting". No extra polling, no timer, and the user finds out within a few
  // seconds even while only scrolling or presenting.
  const open = await c.env.DB
    .prepare("SELECT COUNT(*) AS n FROM frame_conflicts WHERE project_id = ? AND resolved_at IS NULL")
    .bind(id)
    .first<{ n: number }>();
  const openSettings = await c.env.DB
    .prepare("SELECT COUNT(*) AS n FROM setting_conflicts WHERE project_id = ? AND resolved_at IS NULL")
    .bind(id)
    .first<{ n: number }>();

  // For the same reason, say WHEN the project last changed and WHO changed it.
  // Without this a device only finds out on focus, visibility or boot — so
  // someone sitting in front of an open window, scrolling, never learns that
  // the other device saved anything. No new request, no timer: the heartbeat
  // is already here.
  const proj = await c.env.DB
    .prepare("SELECT updated_at, last_device_id FROM projects WHERE id = ?")
    .bind(id)
    .first<{ updated_at: number; last_device_id: string | null }>();

  return c.json({
    ok: true,
    heartbeat_at: now,
    open_conflicts: open?.n ?? 0,
    open_setting_conflicts: openSettings?.n ?? 0,
    project_updated_at: proj?.updated_at ?? null,
    project_last_device_id: proj?.last_device_id ?? null,
  });
});

// ---------------------------------------------------------------------------
// GET /projects/:id/sync — download cloud state
// ---------------------------------------------------------------------------
projects.get("/:id/sync", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");
  // ?since=<server time> — only what has reached the server after that moment.
  // Without it, the whole project, exactly as before (#280).
  const raw = c.req.query("since");
  const since = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;
  return c.json(await loadProjectTree(c.env.DB, project.id, since));
});

// ---------------------------------------------------------------------------
// POST /projects/:id/sync — upload local state with project-level LWW
//
// Spec: "Only the latest state is synced — current strips, frames, latest
// version of each frame, drawings." + "last write wins". So we accept the
// client's full project tree and replace the server's children atomically
// when the client's project.updated_at is >= server's. If the server is
// newer, we return the server tree with `conflict: true` so the caller can
// reconcile and retry.
// ---------------------------------------------------------------------------
projects.post("/:id/sync", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "invalid_json", "Body must be JSON.");
  }

  const parsed = parseSyncPayload(body);
  if ("error" in parsed) {
    return jsonError(c, 400, parsed.error.code, parsed.error.message);
  }
  const payload = parsed.value;

  // Conflict detection: if the client sends a base_updated_at that is older
  // than the server's updated_at AND the push is from a different device,
  // that means the client hasn't seen the latest server version. Reject so
  // the client can pull, show the conflict dialog, and reconcile.
  const serverDevice = project.last_device_id;
  const clientDevice = payload.project.device_id;
  const baseUpdatedAt = payload.project.base_updated_at;

  // ---------------------------------------------------------------------
  // PER-FRAME conflict detection.
  //
  // Used when the client tells us, for each frame, what it believed that
  // frame's server timestamp was. Only frames that actually moved underneath
  // it are refused; everything else is applied. Two people working on
  // different frames never block each other, and an offline device coming
  // back can land all its untouched frames in one go.
  //
  // A client that sends no per-frame base falls through to the old
  // whole-project check below, so nothing breaks while the app catches up.
  // ---------------------------------------------------------------------
  // Who put the current version there — read BEFORE the write, which sets the
  // project's last device to whoever is pushing now. Reading it afterwards gave
  // both sides of the picker the same name.
  const winnerRow = await c.env.DB
    .prepare("SELECT last_device_name FROM projects WHERE id = ?")
    .bind(project.id)
    .first<{ last_device_name: string | null }>();
  const winnerDevice = winnerRow?.last_device_name ?? null;

  // A push carrying NO frames has nothing the whole-project check can protect —
  // and taking that path 409s it, which sends the device off to pull, which it
  // refuses to do while holding unsent work. Push, refuse, retry, for ever.
  // That is exactly the deadlock described below, reached by a settings-only
  // push instead of a frame one. Settings merge item by item and need no
  // blanket conflict.
  const perFrame = payload.frames.length === 0
    || payload.frames.some((f) => f.base_updated_at !== undefined);
  let rejectedFrames: Array<{ id: string; server_updated_at: number; server_offline: boolean;
    /** When the WINNING side was actually changed, so the picker can show the
     *  time of the edit instead of the time of the connection (#266). */
    server_changed_at: number }> = [];
  const refusedPayloads: Array<{ frame: unknown; versions: unknown[]; images: unknown[]; drawings: unknown[] }> = [];
  // Frames and versions this push carried that were OLDER than the server's
  // copy, so they were not written. The pusher must be told, or it records
  // itself as matching the server and keeps a stale copy for ever — a reload
  // does not help, because it restores its own copy and pushes it again.
  const staleFrames: string[] = [];
  const staleVersions: string[] = [];

  if (perFrame) {
    const ids = payload.frames.map((f) => f.id);
    type ServerFrame = { id: string; updated_at: number; changed_offline: number; text_content: string | null; table_data: string | null; content_changed_at: number | null };
    const existingResults: ServerFrame[] = [];
    for (const part of inChunks(ids)) {
      const r = await c.env.DB.prepare(
        `SELECT id, updated_at, changed_offline, text_content, table_data, content_changed_at FROM frames WHERE id IN (${part.map(() => "?").join(",")})`,
      ).bind(...part).all<ServerFrame>();
      existingResults.push(...r.results);
    }
    const existing = { results: existingResults };

    // What the frame's MAIN version holds on the server: its picture and its
    // strokes. Only these — with the text — can be contested. Needs, notes,
    // setups and tags settle by time and must never raise the picker.
    const serverMain = new Map<string, { r2_key: string | null; drawing: string | null }>();
    for (const part of inChunks(ids)) {
      const mains = await c.env.DB.prepare(
        `SELECT v.frame_id AS fid, i.r2_key AS r2_key, d.drawing_data AS drawing
           FROM versions v
           LEFT JOIN images   i ON i.version_id = v.id
           LEFT JOIN drawings d ON d.version_id = v.id
          WHERE v.frame_id IN (${part.map(() => "?").join(",")}) AND v.type = 'main'`,
      ).bind(...part).all<{ fid: string; r2_key: string | null; drawing: string | null }>();
      for (const m of mains.results) serverMain.set(m.fid, { r2_key: m.r2_key, drawing: m.drawing });
    }

    /**
     * Is this a change worth STOPPING the user for?
     *
     * Only two things are: the frame's picture, and the strokes drawn on it.
     * Those cannot be merged and cannot be judged by a clock — losing either
     * one loses work that was drawn by hand.
     *
     * Everything else settles by time, including all the writing (#282): the
     * text under the frame and the notes card. Text used to raise the picker
     * too, which meant being interrupted over a typo fixed in two places. The
     * later wording wins, as it does for needs, labels and tags.
     */
    const touchesContested = (f: typeof payload.frames[number]): boolean => {
      const mainV = payload.versions.find((v) => v.frame_id === f.id && v.type === "main");
      const here = serverMain.get(f.id) ?? { r2_key: null, drawing: null };
      const inR2 = mainV ? (payload.images.find((i) => i.version_id === mainV.id)?.r2_key ?? null) : null;
      const inDraw = mainV ? (payload.drawings.find((d) => d.version_id === mainV.id)?.drawing_data ?? null) : null;
      if (inR2 !== (here.r2_key ?? null)) return true;
      if (inDraw !== (here.drawing ?? null)) return true;
      return false;
    };

    // THE DEAD STAY DEAD (#293).
    //
    // A frame deleted on one device, and edited on another that had not heard
    // yet, used to come back: the tombstone was applied, then the other push
    // wrote the row again. The edit is real work, but it is work on something
    // that no longer exists — and a frame reappearing after being deleted is
    // worse than an edit being dropped, because nobody can tell why it is there.
    const tombstoned = new Set<string>();
    for (const part of inChunks(payload.frames.map((f) => f.id))) {
      const rows = await c.env.DB.prepare(
        `SELECT entity_id FROM project_deletions
          WHERE project_id = ? AND entity_type = 'frame'
            AND entity_id IN (${part.map(() => "?").join(",")})`,
      ).bind(project.id, ...part).all<{ entity_id: string }>();
      for (const r of rows.results) tombstoned.add(r.entity_id);
    }
    const deadVersions = new Set<string>();
    for (const part of inChunks(payload.versions.map((v) => v.id))) {
      const rows = await c.env.DB.prepare(
        `SELECT entity_id FROM project_deletions
          WHERE project_id = ? AND entity_type = 'version'
            AND entity_id IN (${part.map(() => "?").join(",")})`,
      ).bind(project.id, ...part).all<{ entity_id: string }>();
      for (const r of rows.results) deadVersions.add(r.entity_id);
    }
    if (tombstoned.size > 0 || deadVersions.size > 0) {
      payload.frames = payload.frames.filter((f) => !tombstoned.has(f.id));
      payload.versions = payload.versions.filter(
        (v) => !deadVersions.has(v.id) && !tombstoned.has(v.frame_id));
      const liveVersionIds = new Set(payload.versions.map((v) => v.id));
      payload.images = payload.images.filter((i) => liveVersionIds.has(i.version_id));
      payload.drawings = payload.drawings.filter((d) => liveVersionIds.has(d.version_id));
    }

    const serverFrame = new Map(existing.results.map((r) => [r.id, r]));
    const accepted: typeof payload.frames = [];
    for (const f of payload.frames) {
      const sf = serverFrame.get(f.id);
      // The rule itself lives in lib/syncDecide.ts so it can be tested on a
      // bench instead of on two devices. Only the consequences are here.
      const outcome = decideFrame(f, sf, () => touchesContested(f));

      if (outcome === 'ask') {
        rejectedFrames.push({
          id: f.id,
          server_updated_at: sf!.updated_at,
          server_offline: !!sf!.changed_offline,
          server_changed_at: sf!.content_changed_at ?? sf!.updated_at,
        });
        // Keep the version we would not take, with everything needed to show
        // and apply it later. Without this it exists only on the device that
        // made it.
        refusedPayloads.push({
          frame: f,
          versions: payload.versions.filter((v) => v.frame_id === f.id),
          images: payload.images,
          drawings: payload.drawings,
        });
        continue;
      }
      // Only the frame's own row is refused when it is stale. Its versions
      // still go in, so a LOOK made here is still added.
      if (outcome === 'stale') { staleFrames.push(f.id); continue; }

      accepted.push(f);
    }
    payload.frames = accepted;

    // Same rule for versions, one at a time. A version this push carries is
    // only written if it is not older than the server's copy of THAT version.
    // Versions the server has never seen are added — keeping work from either
    // device is the whole point — and its images and drawings follow whatever
    // its version did, so a newer picture cannot end up under an older row.
    if (payload.versions.length > 0) {
      const vids = payload.versions.map((v) => v.id);
      const heldById = new Map<string, { id: string; updated_at: number; content_changed_at: number | null }>();
      for (const part of inChunks(vids)) {
        const held = await c.env.DB.prepare(
          `SELECT id, updated_at, content_changed_at FROM versions WHERE id IN (${part.map(() => "?").join(",")})`,
        ).bind(...part).all<{ id: string; updated_at: number; content_changed_at: number | null }>();
        for (const r of held.results) heldById.set(r.id, r);
      }

      const staleVersionIds = new Set<string>();
      for (const v of payload.versions) {
        if (decideVersion(v, heldById.get(v.id)) === 'stale') staleVersionIds.add(v.id);
      }
      if (staleVersionIds.size > 0) {
        staleVersions.push(...staleVersionIds);
        payload.versions = payload.versions.filter((v) => !staleVersionIds.has(v.id));
        payload.images = payload.images.filter((i) => !staleVersionIds.has(i.version_id));
        payload.drawings = payload.drawings.filter((d) => !staleVersionIds.has(d.version_id));
      }
    }

    // A refused frame's children must go too. Its rows on the server were not
    // deleted (the frame was not applied), so re-inserting its versions and
    // images collides with what is already there and the whole write fails.
    if (rejectedFrames.length > 0) {
      const refusedIds = new Set(rejectedFrames.map((r) => r.id));
      const keptVersionIds = new Set<string>();
      payload.versions = payload.versions.filter((v) => {
        if (refusedIds.has(v.frame_id)) return false;
        keptVersionIds.add(v.id);
        return true;
      });
      payload.images = payload.images.filter((i) => keptVersionIds.has(i.version_id));
      payload.drawings = payload.drawings.filter((d) => keptVersionIds.has(d.version_id));
    }

    // NOTE: no 409 here, even when every frame is refused. A blanket conflict
    // sends the client down the old whole-project path, which resolves by
    // pulling — and a client that is holding unsent work refuses to pull, so
    // the two deadlock and the push retries for ever. A per-frame client gets
    // the tree plus the list of refusals and settles them itself.
  } else {
    if (baseUpdatedAt !== undefined && baseUpdatedAt < project.updated_at
        && serverDevice && clientDevice && serverDevice !== clientDevice) {
      const remote = await loadProjectTree(c.env.DB, project.id);
      return c.json({ conflict: true, remote }, 409);
    }

    // Fallback: server is newer (same-device case or no base_updated_at).
    if (payload.project.updated_at < project.updated_at) {
      const remote = await loadProjectTree(c.env.DB, project.id);
      return c.json({ conflict: true, remote }, 409);
    }
  }

  // Storage quota: total of new images + existing images on this user's other
  // projects. We delete + reinsert the syncing project's images, so its old
  // bytes don't count; everyone else's do.
  const otherImagesUsed = await sumOtherProjectImageBytes(c.env.DB, me.id, project.id);
  const incomingBytes = payload.images.reduce((sum, img) => sum + (img.size_bytes ?? 0), 0);
  if (otherImagesUsed + incomingBytes > ACCOUNT_STORAGE_LIMIT_BYTES) {
    return jsonError(
      c,
      413,
      "storage_full",
      "Storage full — the beta version of Framehow has limited storage. Delete a project to free up space.",
    );
  }

  const now = Date.now();

  // Snapshot: save a copy of the current state before overwriting,
  // but only if 10+ minutes have passed since the last snapshot.
  // The user has edited since restoring, so they are no longer standing on that
  // restore point. Note on the point itself that the work carried on from there
  // — the snapshot stays exactly as it was — and stop marking it as "here".
  const standing = await c.env.DB
    .prepare("SELECT restored_snapshot_id FROM projects WHERE id = ?")
    .bind(project.id)
    .first<{ restored_snapshot_id: string | null }>();
  if (standing?.restored_snapshot_id) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE project_snapshots SET continued_at = ? WHERE id = ? AND continued_at IS NULL",
      ).bind(now, standing.restored_snapshot_id),
      c.env.DB.prepare("UPDATE projects SET restored_snapshot_id = NULL WHERE id = ?").bind(project.id),
    ]);
  }

  await maybeCreateSnapshot(c.env.DB, project.id, now);

  // If ANY per-frame decision was made — a frame refused, or skipped as older —
  // this push must not be treated as "replace the project". Full mode deletes
  // every frame and re-inserts only what survived, leaving the dropped frames'
  // versions pointing at nothing: FOREIGN KEY constraint failed, on every
  // retry, for ever. A push that merges parts cannot also be a wholesale
  // replacement.
  if (rejectedFrames.length > 0 || staleFrames.length > 0) {
    payload.partial = true;
  }

  await applySync(c.env.DB, project.id, payload, now);

  // Project settings merge ITEM BY ITEM on time of change, so it stops
  // mattering who pushed last. An item that is older here than what the server
  // already holds is refused by the WHERE clause and leaves the server's copy
  // alone — that is the whole point: an offline device pushing an old group
  // name must not undo a newer rename it never saw.
  if (payload.settings && payload.settings.length > 0) {
    // A SORT ORDER is not a value, it is an arrangement somebody made by hand.
    // If both devices changed the same one without either having seen the
    // other's, taking the newer throws away real work — so that one is kept
    // and asked about, exactly like a frame's drawing. Everything else merges
    // on time of change and never asks.
    const orders = payload.settings.filter((it) => it.kind === "sortOrder" && it.value);
    const held = new Map<string, { value: string | null; changed_at: number }>();
    // Batched for the same reason as the frames and versions above (#276): one
    // project_id plus one value per sort order, and D1 stops at 100.
    for (const part of inChunks(orders.map((o) => o.item_id))) {
      const rows = await c.env.DB.prepare(
        `SELECT item_id, value, changed_at FROM project_settings
          WHERE project_id = ? AND kind = 'sortOrder' AND item_id IN (${part.map(() => "?").join(",")})`,
      ).bind(project.id, ...part)
        .all<{ item_id: string; value: string | null; changed_at: number }>();
      for (const r of rows.results) held.set(r.item_id, { value: r.value, changed_at: r.changed_at });
    }

    const contestedOrders = new Set<string>();
    const conflictStmts: D1PreparedStatement[] = [];
    for (const it of orders) {
      const mine = held.get(it.item_id);
      if (!mine || it.base_changed_at === undefined) continue;   // new, or an older client
      if (mine.changed_at <= it.base_changed_at) continue;       // built on top of theirs
      if (mine.value === it.value) continue;                     // same arrangement, nothing to argue
      contestedOrders.add(it.item_id);
      conflictStmts.push(
        c.env.DB.prepare(
          `INSERT INTO setting_conflicts
             (id, project_id, kind, item_id, losing_json, device_name, made_at,
              winner_device, winner_made_at, created_at)
           VALUES (?, ?, 'sortOrder', ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(newId(), project.id, it.item_id, it.value ?? "",
               payload.project.device_name ?? null, it.changed_at,
               winnerDevice, mine.changed_at, now),
      );
    }

    await c.env.DB.batch([
      ...payload.settings
        .filter((it) => !contestedOrders.has(it.item_id) || it.kind !== "sortOrder")
        .map((it) =>
          c.env.DB.prepare(
            `INSERT INTO project_settings (project_id, kind, item_id, value, changed_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(project_id, kind, item_id) DO UPDATE SET
               value      = excluded.value,
               changed_at = excluded.changed_at,
               deleted_at = excluded.deleted_at
             WHERE excluded.changed_at > project_settings.changed_at`,
          ).bind(project.id, it.kind, it.item_id, it.value ?? null,
                 it.changed_at, it.deleted_at ?? null)),
      ...conflictStmts,
    ]);
  }

  // Record the refused versions so the question can be answered from any
  // device, and so the losing work is not stranded on the device that made it.
  if (rejectedFrames.length > 0) {
    const nowTs = Date.now();
    await c.env.DB.batch(rejectedFrames.map((r, i) => {
      const p = refusedPayloads[i];
      const versionIds = new Set((p.versions as Array<{ id: string }>).map((v) => v.id));
      const body = JSON.stringify({
        frame: p.frame,
        versions: p.versions,
        images: (p.images as Array<{ version_id: string }>).filter((im) => versionIds.has(im.version_id)),
        drawings: (p.drawings as Array<{ version_id: string }>).filter((d) => versionIds.has(d.version_id)),
      });
      return c.env.DB.prepare(
        `INSERT INTO frame_conflicts
           (id, project_id, frame_id, losing_json, device_name, made_at,
            winner_device, winner_made_at, made_offline, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newId(), project.id, r.id, body,
             payload.project.device_name ?? null,
             // WHEN it was changed, not when it was sent. Both sides used to
             // carry the push time, so the picker could offer you "iPad 14:32"
             // for a drawing you made at 09:10 on a plane (#266).
             (p.frame as { content_changed_at?: number | null }).content_changed_at
               ?? (p.frame as { updated_at?: number }).updated_at ?? nowTs,
             winnerDevice,
             r.server_changed_at,
             (p.frame as { changed_offline?: boolean }).changed_offline ? 1 : 0,
             nowTs);
    }));
  }

  const tree = await loadProjectTree(c.env.DB, project.id);
  // Some frames were refused because they moved underneath this device. The
  // rest went in. The client shows the picker for these and nothing else.
  if (rejectedFrames.length > 0) {
    return c.json({ ...tree, rejected_frames: rejectedFrames, stale_frames: staleFrames, stale_versions: staleVersions });
  }
  if (staleFrames.length > 0 || staleVersions.length > 0) {
    return c.json({ ...tree, stale_frames: staleFrames, stale_versions: staleVersions });
  }
  return c.json(tree);
});

// ---------------------------------------------------------------------------
// GET /projects/:id/conflicts — frames with a decision still open
//
// Any device can ask, and any device can answer. The losing version is stored
// with the conflict, so it is not stranded on the device that made it.
// ---------------------------------------------------------------------------
projects.get("/:id/conflicts", async (c) => {
  const me = c.get("user");
  const project = await loadOwnedProject(c.env.DB, me.id, c.req.param("id"));
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  const rows = await c.env.DB.prepare(
    `SELECT id, frame_id, losing_json, device_name, made_at,
            winner_device, winner_made_at, made_offline, created_at
       FROM frame_conflicts
      WHERE project_id = ? AND resolved_at IS NULL
      ORDER BY created_at ASC`,
  ).bind(project.id).all<{
    id: string; frame_id: string; losing_json: string;
    device_name: string | null; made_at: number | null;
    winner_device: string | null; winner_made_at: number | null;
    made_offline: number; created_at: number;
  }>();

  return c.json({ conflicts: rows.results });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/conflicts/:conflictId — answer one
//
// choice: 'mine'   — keep what the server already has, discard the losing side
//         'theirs' — replace the frame with the losing side
//         'both'   — keep the server's frame AND add the losing side as an
//                    extra version on it
//
// First answer wins. A later one is TOLD what was already decided rather than
// silently doing nothing.
// ---------------------------------------------------------------------------
projects.post("/:id/conflicts/:conflictId", async (c) => {
  const me = c.get("user");
  const project = await loadOwnedProject(c.env.DB, me.id, c.req.param("id"));
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  let choice = "";
  let deviceId: string | null = null;
  let deviceName: string | null = null;
  try {
    const b = (await c.req.json()) as {
      choice?: string; device_id?: string; device_name?: string;
    };
    choice = b?.choice ?? "";
    deviceId = b?.device_id ?? null;
    deviceName = b?.device_name ?? null;
  } catch { /* handled below */ }
  if (choice !== "mine" && choice !== "theirs" && choice !== "both") {
    return jsonError(c, 400, "invalid_choice", "choice must be mine, theirs or both.");
  }

  const row = await c.env.DB.prepare(
    `SELECT id, frame_id, losing_json, resolved_at, resolution, device_name, made_at, winner_made_at
       FROM frame_conflicts WHERE id = ? AND project_id = ?`,
  ).bind(c.req.param("conflictId"), project.id).first<{
    id: string; frame_id: string; losing_json: string;
    resolved_at: number | null; resolution: string | null;
    device_name: string | null; made_at: number | null; winner_made_at: number | null;
  }>();
  if (!row) return jsonError(c, 404, "not_found", "No such conflict.");

  if (row.resolved_at !== null) {
    // Someone answered first. Say so plainly instead of pretending.
    return c.json({ already_resolved: true, resolution: row.resolution });
  }

  const now = Date.now();
  const losing = JSON.parse(row.losing_json) as {
    frame: Record<string, unknown>;
    versions: Array<Record<string, unknown>>;
    images: Array<Record<string, unknown>>;
    drawings: Array<Record<string, unknown>>;
  };

  const stmts: D1PreparedStatement[] = [];

  if (choice === "theirs") {
    // Replace the frame's contents with the version that was refused.
    stmts.push(
      c.env.DB.prepare(`DELETE FROM drawings WHERE version_id IN (SELECT id FROM versions WHERE frame_id = ?)`).bind(row.frame_id),
      c.env.DB.prepare(`DELETE FROM images   WHERE version_id IN (SELECT id FROM versions WHERE frame_id = ?)`).bind(row.frame_id),
      c.env.DB.prepare(`DELETE FROM versions WHERE frame_id = ?`).bind(row.frame_id),
    );
    appendLosingVersions(c.env.DB, stmts, losing, now);
  } else if (choice === "both") {
    // KEEP BOTH puts the refused frame in the MAIN strip beside the one that
    // is already there — frame 2 becomes 2#1 and 2#2 — each carrying its own
    // versions, notes, tags and strips. It is not an extra version inside one
    // frame: the two are whole frames, and you delete the one you don't want.
    const orig = await c.env.DB.prepare(
      `SELECT id, strip_id, label, sort_order FROM frames WHERE id = ?`,
    ).bind(row.frame_id).first<{
      id: string; strip_id: string; label: string | null; sort_order: number;
    }>();

    if (orig) {
      const lf = losing.frame as Record<string, unknown>;
      const newFrameId = newId();

      // Oldest first, by when the change was MADE — so a morning edit made
      // offline keeps its place ahead of an afternoon one that arrived first.
      const losingIsOlder = (row.made_at ?? 0) < (row.winner_made_at ?? row.made_at ?? 0);

      // Strip any #n already on the label so deciding twice cannot give 2#1#1.
      const base = (orig.label ?? "").replace(/#\d+$/, "");
      const newSort = losingIsOlder ? orig.sort_order : orig.sort_order + 1;

      stmts.push(
        // Make room. Only sort_order moves; nobody's LABEL changes, so frame 3
        // is still called 3.
        c.env.DB.prepare(
          `UPDATE frames SET sort_order = sort_order + 1
             WHERE strip_id = ? AND sort_order >= ?`,
        ).bind(orig.strip_id, newSort),
        c.env.DB.prepare(
          `UPDATE frames SET label = ?, updated_at = ? WHERE id = ?`,
        ).bind(`${base}#${losingIsOlder ? 2 : 1}`, now, orig.id),
        c.env.DB.prepare(
          `INSERT INTO frames (id, strip_id, label, sort_order, crop_w, crop_h,
                               text_content, table_data, version_label, strip_labels,
                               hidden, note, scribbles, updated_at, changed_offline,
                               needs, notes, setup_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        ).bind(
          newFrameId, orig.strip_id, `${base}#${losingIsOlder ? 1 : 2}`, newSort,
          (lf.crop_w as number) ?? 16, (lf.crop_h as number) ?? 9,
          (lf.text_content as string) ?? null, (lf.table_data as string) ?? null,
          (lf.version_label as string) ?? null, (lf.strip_labels as string) ?? null,
          lf.hidden ? 1 : 0, (lf.note as string) ?? null,
          (lf.scribbles as string) ?? null, now,
          // The refused side brings its OWN package with it.
          (lf.needs as string) ?? null, (lf.notes as string) ?? null,
          (lf.setup_id as string) ?? null,
        ),
      );

      const idMap = appendLosingVersions(c.env.DB, stmts, losing, now, newFrameId);

      // Needs, notes, setups and version tags are not stored on the frame —
      // they live in a project-wide list keyed by the frame's (or version's)
      // id. A brand new frame has no entry in any of them, which is why the
      // copy arrived with its picture but nothing else. Give the new ids the
      // same entries as the ones they were copied from.
      const metaRow = await c.env.DB.prepare(
        `SELECT metadata FROM projects WHERE id = ?`,
      ).bind(project.id).first<{ metadata: string | null }>();
      if (metaRow?.metadata) {
        try {
          const meta = JSON.parse(metaRow.metadata) as Record<string, unknown>;
          let touched = false;

          for (const key of ["frameNeeds", "frameNotes", "frameSetups"]) {
            const map = meta[key] as Record<string, unknown> | undefined;
            if (map && map[row.frame_id] !== undefined) {
              map[newFrameId] = JSON.parse(JSON.stringify(map[row.frame_id]));
              touched = true;
            }
          }

          const tags = meta.versionTags as Record<string, unknown> | undefined;
          if (tags) {
            for (const [oldVid, newVid] of idMap) {
              if (tags[oldVid] !== undefined) {
                tags[newVid] = JSON.parse(JSON.stringify(tags[oldVid]));
                touched = true;
              }
            }
          }

          if (touched) {
            stmts.push(
              c.env.DB.prepare(`UPDATE projects SET metadata = ? WHERE id = ?`)
                .bind(JSON.stringify(meta), project.id),
            );
          }
        } catch { /* unreadable metadata is not worth failing the decision for */ }
      }
    }
  }
  // 'mine' writes nothing — the server already holds the winning version.

  stmts.push(
    c.env.DB.prepare(
      `UPDATE frame_conflicts SET resolved_at = ?, resolution = ? WHERE id = ?`,
    ).bind(now, choice, row.id),
    // Record WHO settled it. Left unset, the project still named the device
    // that pushed last — so that device pulled, saw its own name against the
    // change, concluded "this is my own data coming back" and threw the
    // decision away. That is why the losing side never showed the result.
    c.env.DB.prepare(
      `UPDATE projects SET updated_at = ?,
              last_device_id = COALESCE(?, last_device_id),
              last_device_name = COALESCE(?, last_device_name)
         WHERE id = ?`,
    ).bind(now, deviceId, deviceName, project.id),
  );

  if (stmts.length > 0) await c.env.DB.batch(stmts);
  return c.json(await loadProjectTree(c.env.DB, project.id));
});

/** Write the refused side's versions, images and drawings. */
function appendLosingVersions(
  db: D1Database,
  stmts: D1PreparedStatement[],
  losing: {
    versions: Array<Record<string, unknown>>;
    images: Array<Record<string, unknown>>;
    drawings: Array<Record<string, unknown>>;
  },
  now: number,
  /** Given, the rows are copied onto that NEW frame with fresh ids — keep both.
   *  Omitted, they replace the frame's own rows in place — keep theirs. */
  ontoFrameId?: string,
): Map<string, string> {
  const copy = !!ontoFrameId;
  const idMap = new Map<string, string>();
  for (const v of losing.versions) {
    const oldId = v.id as string;
    const id = copy ? newId() : oldId;
    idMap.set(oldId, id);
    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO versions (id, frame_id, label, type, hidden, starred, note, updated_at, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, ontoFrameId ?? (v.frame_id as string),
             (v.label as string) ?? null,
             v.type as string,
             v.hidden ? 1 : 0, Number(v.starred) || 0, (v.note as string) ?? null, now,
             (v.tags as string) ?? null),
    );
  }
  for (const im of losing.images) {
    const vid = idMap.get(im.version_id as string);
    if (!vid) continue;
    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO images (id, version_id, r2_key, size_bytes, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(copy ? newId() : (im.id as string), vid, im.r2_key as string,
             (im.size_bytes as number) ?? 0, now),
    );
  }
  for (const d of losing.drawings) {
    const vid = idMap.get(d.version_id as string);
    if (!vid) continue;
    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO drawings (id, version_id, drawing_data, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(copy ? newId() : (d.id as string), vid, d.drawing_data as string, now),
    );
  }
  return idMap;
}

// ---------------------------------------------------------------------------
// GET /projects/:id/setting-conflicts — sort orders with a decision still open
// ---------------------------------------------------------------------------
projects.get("/:id/setting-conflicts", async (c) => {
  const me = c.get("user");
  const project = await loadOwnedProject(c.env.DB, me.id, c.req.param("id"));
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  const rows = await c.env.DB.prepare(
    `SELECT id, kind, item_id, losing_json, device_name, made_at,
            winner_device, winner_made_at, created_at
       FROM setting_conflicts
      WHERE project_id = ? AND resolved_at IS NULL
      ORDER BY created_at`,
  ).bind(project.id).all();

  return c.json({ conflicts: rows.results ?? [] });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/setting-conflicts/:conflictId — answer one
//
// mine   → keep what the server holds; the losing side stays recorded
// theirs → take the losing side
// both   → keep the server's AND add the other as a copy called NAME#2
// ---------------------------------------------------------------------------
projects.post("/:id/setting-conflicts/:conflictId", async (c) => {
  const me = c.get("user");
  const project = await loadOwnedProject(c.env.DB, me.id, c.req.param("id"));
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  let choice = "";
  let deviceId: string | null = null;
  let deviceName: string | null = null;
  try {
    const b = (await c.req.json()) as { choice?: string; device_id?: string; device_name?: string };
    choice = b?.choice ?? "";
    deviceId = b?.device_id ?? null;
    deviceName = b?.device_name ?? null;
  } catch { /* handled below */ }
  if (choice !== "mine" && choice !== "theirs" && choice !== "both") {
    return jsonError(c, 400, "invalid_choice", "choice must be mine, theirs or both.");
  }

  const row = await c.env.DB.prepare(
    `SELECT id, kind, item_id, losing_json, resolved_at, resolution
       FROM setting_conflicts WHERE id = ? AND project_id = ?`,
  ).bind(c.req.param("conflictId"), project.id).first<{
    id: string; kind: string; item_id: string; losing_json: string;
    resolved_at: number | null; resolution: string | null;
  }>();
  if (!row) return jsonError(c, 404, "not_found", "No such conflict.");
  if (row.resolved_at !== null) {
    return c.json({ already_resolved: true, resolution: row.resolution });
  }

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];

  if (choice === "theirs") {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE project_settings SET value = ?, changed_at = ?, deleted_at = NULL
          WHERE project_id = ? AND kind = ? AND item_id = ?`,
      ).bind(row.losing_json, now, project.id, row.kind, row.item_id),
    );
  } else if (choice === "both") {
    // The losing arrangement survives as its own order, named NAME#2, so the
    // user can look at both and delete the one they do not want.
    try {
      const parsed = JSON.parse(row.losing_json) as { idx: number; data: Record<string, unknown> };
      const copyId = newId();
      const name = String(parsed.data.name ?? "");
      parsed.data.id = copyId;
      parsed.data.name = `${name.replace(/#\d+$/, "")}#2`;
      // Fresh ids for the copy's breaks. They live inside their own order and
      // must never be mistakable for the original's — moving a break in #2 has
      // nothing to do with #1.
      if (Array.isArray(parsed.data.breaks)) {
        parsed.data.breaks = (parsed.data.breaks as Array<Record<string, unknown>>)
          .map((b) => ({ ...b, id: newId() }));
      }
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO project_settings (project_id, kind, item_id, value, changed_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, NULL)`,
        ).bind(project.id, row.kind, copyId,
               JSON.stringify({ idx: (parsed.idx ?? 0) + 1, data: parsed.data }), now),
      );
    } catch { /* unreadable losing side — the decision still gets recorded */ }
  }
  // 'mine' writes nothing: the server already holds the winning arrangement.

  stmts.push(
    c.env.DB.prepare(
      `UPDATE setting_conflicts SET resolved_at = ?, resolution = ? WHERE id = ?`,
    ).bind(now, choice, row.id),
    c.env.DB.prepare(
      `UPDATE projects SET updated_at = ?,
              last_device_id = COALESCE(?, last_device_id),
              last_device_name = COALESCE(?, last_device_name)
         WHERE id = ?`,
    ).bind(now, deviceId, deviceName, project.id),
  );

  if (stmts.length > 0) await c.env.DB.batch(stmts);
  return c.json(await loadProjectTree(c.env.DB, project.id));
});

// ---------------------------------------------------------------------------
// GET /projects/:id/snapshots — list available restore points
// ---------------------------------------------------------------------------
projects.get("/:id/snapshots", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  const result = await c.env.DB
    .prepare(
      `SELECT id, created_at, reason, continued_at FROM project_snapshots
       WHERE project_id = ? ORDER BY created_at DESC`,
    )
    .bind(project.id)
    .all<{ id: string; created_at: number; reason: string; continued_at: number | null }>();

  const cur = await c.env.DB
    .prepare("SELECT restored_snapshot_id FROM projects WHERE id = ?")
    .bind(project.id)
    .first<{ restored_snapshot_id: string | null }>();

  return c.json({ snapshots: result.results, currentSnapshotId: cur?.restored_snapshot_id ?? null });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/snapshots — capture the current state as a restore point.
// Called when the restore list is opened, so "where you are now" is always in
// the list and the user can always come back to it.
// ---------------------------------------------------------------------------
projects.post("/:id/snapshots", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  // Work made offline is stamped with the time it was actually made, not the
  // time it reached us — otherwise the restore list would misreport it.
  let reason: 'pre_restore' | 'offline' = 'pre_restore';
  let at = Date.now();
  try {
    const b = (await c.req.json()) as { reason?: string; madeAt?: number };
    if (b?.reason === 'offline') reason = 'offline';
    if (typeof b?.madeAt === 'number' && b.madeAt > 0 && b.madeAt <= Date.now()) at = b.madeAt;
  } catch { /* no body — ordinary "where you are now" point */ }

  await forceCreateSnapshot(c.env.DB, project.id, at, reason);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /projects/:id/restore/:snapshotId — restore project to a snapshot
// ---------------------------------------------------------------------------
projects.post("/:id/restore/:snapshotId", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const snapshotId = c.req.param("snapshotId");
  const project = await loadOwnedProject(c.env.DB, me.id, id);
  if (!project) return jsonError(c, 404, "not_found", "Project not found.");

  const snap = await c.env.DB
    .prepare("SELECT tree_json, created_at FROM project_snapshots WHERE id = ? AND project_id = ?")
    .bind(snapshotId, project.id)
    .first<{ tree_json: string; created_at: number }>();
  if (!snap) return jsonError(c, 404, "not_found", "Snapshot not found.");

  // Save a snapshot of the CURRENT state before restoring, marked so the modal
  // can always offer it back by name — this is the user's way out of a restore
  // they did not like.
  const now = Date.now();
  await forceCreateSnapshot(c.env.DB, project.id, now, 'pre_restore');

  // Parse the snapshot tree and re-apply it as a full sync
  const tree: ProjectTree = JSON.parse(snap.tree_json);

  // Delete all current project content and rebuild from snapshot
  const stripIds = tree.strips.map((s) => s.id);
  if (stripIds.length > 0) {
    // Delete existing content first
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM strips WHERE project_id = ?").bind(project.id),
    ]);
  } else {
    await c.env.DB.prepare("DELETE FROM strips WHERE project_id = ?").bind(project.id).run();
  }

  // Re-insert strips, frames, versions, images, drawings from snapshot
  const stmts: D1PreparedStatement[] = [];

  for (const s of tree.strips) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO strips (id, project_id, label, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(s.id, project.id, s.label, s.sort_order, now),
    );
  }
  for (const f of tree.frames) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO frames (id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label, strip_labels, hidden, note, scribbles, updated_at, needs, notes, setup_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(f.id, f.strip_id, f.label, f.sort_order, f.crop_w, f.crop_h, f.text_content, f.table_data, f.version_label, f.strip_labels, f.hidden, f.note ?? null, f.scribbles ?? null, now, f.needs ?? null, f.notes ?? null, f.setup_id ?? null),
    );
  }
  for (const v of tree.versions) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO versions (id, frame_id, label, type, hidden, starred, note, updated_at, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(v.id, v.frame_id, v.label, v.type, v.hidden, v.starred, v.note ?? null, now, v.tags ?? null),
    );
  }
  for (const img of tree.images) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO images (id, version_id, r2_key, width, height, size_bytes, content_type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(img.id, img.version_id, img.r2_key, img.width, img.height, img.size_bytes, img.content_type, now),
    );
  }
  for (const d of tree.drawings) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO drawings (id, version_id, drawing_data, updated_at) VALUES (?, ?, ?, ?)",
      ).bind(d.id, d.version_id, d.drawing_data, now),
    );
  }

  // Update project metadata + timestamp
  stmts.push(
    c.env.DB.prepare(
      "UPDATE projects SET metadata = ?, updated_at = ? WHERE id = ?",
    ).bind(tree.project.metadata, now, project.id),
  );

  if (stmts.length > 0) await c.env.DB.batch(stmts);

  // Remember where the user now stands, so the list can mark it.
  await c.env.DB
    .prepare("UPDATE projects SET restored_snapshot_id = ? WHERE id = ?")
    .bind(snapshotId, project.id)
    .run();

  // Thin snapshots after restore
  await thinSnapshots(c.env.DB, project.id, now);

  return c.json(await loadProjectTree(c.env.DB, project.id));
});

export default projects;

// ===========================================================================
// Helpers
// ===========================================================================

interface ProjectTree {
  project: { id: string; name: string; created_at: number; updated_at: number; last_device_id: string | null; last_device_name: string | null; metadata: string | null };
  strips: Array<{ id: string; project_id: string; label: string | null; sort_order: number; updated_at: number }>;
  frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: number; note: string | null; scribbles: string | null; updated_at: number;
    /** Owned by the frame, not by a project-wide list. */
    needs: string | null; notes: string | null; setup_id: string | null;
    content_changed_at: number | null }>;
  versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: number; starred: number; note: string | null; updated_at: number; tags: string | null; content_changed_at: number | null }>;
  images: Array<{
    id: string;
    version_id: string;
    r2_key: string;
    width: number | null;
    height: number | null;
    size_bytes: number | null;
    content_type: string | null;
    updated_at: number;
  }>;
  drawings: Array<{ id: string; version_id: string; drawing_data: string; updated_at: number }>;
  deletions: Array<{ id: string; entity_type: string; entity_id: string; deleted_at: number; device_id: string | null }>;
  settings: Array<{ kind: string; item_id: string; value: string | null; changed_at: number; deleted_at: number | null }>;
  /** The server's own clock at the moment it answered. A device stores this and
   *  sends it back as `since` next time — never its own clock, which may be
   *  minutes out and would silently skip changes (#280). */
  server_now: number;
  /** false = only what changed since `since`. true = the whole project. */
  full: boolean;
}

/** Deletions are swept after 30 days, so beyond that we can no longer tell
 *  "deleted while you were away" from "never existed". A device that has been
 *  gone longer has to take the whole project again. */
const TOMBSTONE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @param since  Only rows that reached the server AFTER this moment. Undefined,
 *   zero, or older than the tombstone window means the whole project.
 *
 * The filter is on ARRIVAL, not on when the change was made — deliberately. A
 * frame edited on an offline iPad on Monday and delivered on Wednesday must
 * still reach a device that pulled on Tuesday. Filtering on the edit time would
 * leave that work sitting on the server, visible to nobody.
 */
async function loadProjectTree(db: D1Database, projectId: string, since?: number): Promise<ProjectTree> {
  const usable = typeof since === 'number' && since > 0 && since > Date.now() - TOMBSTONE_WINDOW_MS;
  const from = usable ? since : 0;
  // AT or later, not later. A row written in the very millisecond the last
  // answer was given would otherwise fall between the two and never be
  // delivered — rare, silent, and impossible to reproduce on demand. The cost
  // of >= is that a row on the boundary can arrive twice, which changes
  // nothing: applying the same row again leaves the same result.
  const only = (column: string) => (usable ? ` AND ${column} >= ?` : '');
  const arg = usable ? [from] : [];

  // Use subqueries instead of IN (?, ?, ...) to avoid D1's 100-variable limit.
  // All queries filter through project_id, so only 1 bind param each.
  const [projectResult, stripsResult, framesResult, versionsResult, imagesResult, drawingsResult, deletionsResult, settingsResult] = await db.batch([
    db.prepare(
      "SELECT id, name, created_at, updated_at, last_device_id, last_device_name, metadata FROM projects WHERE id = ?",
    ).bind(projectId),
    db.prepare(
      `SELECT id, project_id, label, sort_order, updated_at
         FROM strips WHERE project_id = ? ORDER BY sort_order`,
    ).bind(projectId),
    db.prepare(
      `SELECT id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label, strip_labels, hidden, note, scribbles, updated_at, needs, notes, setup_id, content_changed_at
         FROM frames WHERE strip_id IN (SELECT id FROM strips WHERE project_id = ?)${only('updated_at')}
        ORDER BY sort_order`,
    ).bind(projectId, ...arg),
    db.prepare(
      `SELECT id, frame_id, label, type, hidden, starred, note, updated_at, tags, content_changed_at
         FROM versions WHERE frame_id IN (
           SELECT f.id FROM frames f JOIN strips s ON s.id = f.strip_id WHERE s.project_id = ?
         )${only('updated_at')} ORDER BY updated_at`,
    ).bind(projectId, ...arg),
    db.prepare(
      `SELECT id, version_id, r2_key, width, height, size_bytes, content_type, updated_at
         FROM images WHERE version_id IN (
           SELECT v.id FROM versions v
           JOIN frames f ON f.id = v.frame_id
           JOIN strips s ON s.id = f.strip_id
           WHERE s.project_id = ?
         )${only('updated_at')}`,
    ).bind(projectId, ...arg),
    db.prepare(
      `SELECT id, version_id, drawing_data, updated_at
         FROM drawings WHERE version_id IN (
           SELECT v.id FROM versions v
           JOIN frames f ON f.id = v.frame_id
           JOIN strips s ON s.id = f.strip_id
           WHERE s.project_id = ?
         )${only('updated_at')}`,
    ).bind(projectId, ...arg),
    // Tombstones: only return deletions from the last 30 days
    db.prepare(
      `SELECT id, entity_type, entity_id, deleted_at, device_id
         FROM project_deletions
        WHERE project_id = ? AND deleted_at > ?`,
    ).bind(projectId, Math.max(from - 1, Date.now() - TOMBSTONE_WINDOW_MS)),
    db.prepare(
      `SELECT kind, item_id, value, changed_at, deleted_at
         FROM project_settings WHERE project_id = ?${only('changed_at')}`,
    ).bind(projectId, ...arg),
  ]);

  const project = (projectResult.results as any[])[0] as ProjectTree["project"];
  return {
    project,
    strips: stripsResult.results as ProjectTree["strips"],
    frames: framesResult.results as ProjectTree["frames"],
    versions: versionsResult.results as ProjectTree["versions"],
    images: imagesResult.results as ProjectTree["images"],
    drawings: drawingsResult.results as ProjectTree["drawings"],
    deletions: deletionsResult.results as ProjectTree["deletions"],
    settings: settingsResult.results as ProjectTree["settings"],
    server_now: Date.now(),
    full: !usable,
  };
}

async function sumOtherProjectImageBytes(
  db: D1Database,
  userId: string,
  excludeProjectId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(i.size_bytes), 0) AS used
         FROM images i
         JOIN versions v ON v.id = i.version_id
         JOIN frames   f ON f.id = v.frame_id
         JOIN strips   s ON s.id = f.strip_id
         JOIN projects p ON p.id = s.project_id
        WHERE p.user_id = ?
          AND p.id != ?
          AND p.deleted_at IS NULL`,
    )
    .bind(userId, excludeProjectId)
    .first<{ used: number }>();
  return row?.used ?? 0;
}

// ---------------------------------------------------------------------------
// Sync payload parsing + apply
// ---------------------------------------------------------------------------

interface SyncPayload {
  project: { name: string; updated_at: number; base_updated_at?: number; device_id?: string; device_name?: string; metadata?: string | null };
  /** When true, only dirty frames are included — server UPSERTs instead of full replace. */
  partial: boolean;
  strips: Array<{ id: string; label: string | null; sort_order: number; updated_at: number }>;
  frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: boolean; note: string | null; scribbles: string | null; updated_at: number;
    /** What this device believed the frame's server timestamp was when it
     *  started changing it. Present only from clients that do per-frame sync;
     *  absent means fall back to the whole-project check. */
    base_updated_at?: number;
    /** The change was made with no connection. */
    changed_offline?: boolean;
    /** Owned by the frame now, not by the project's metadata blob. */
    needs?: string | null; notes?: string | null; setup_id?: string | null;
    /** When this device CHANGED the frame, not when it sent it. `updated_at` is
     *  stamped at push time, so it orders reconnections, not edits. */
    content_changed_at?: number | null }>;
  versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: boolean; starred: number; note: string | null; updated_at: number; tags?: string | null; content_changed_at?: number | null }>;
  images: Array<{
    id: string;
    version_id: string;
    r2_key: string;
    width: number | null;
    height: number | null;
    size_bytes: number | null;
    content_type: string | null;
    updated_at: number;
  }>;
  drawings: Array<{ id: string; version_id: string; drawing_data: string; updated_at: number }>;
  deletions: Array<{ id: string; entity_type: string; entity_id: string; deleted_at: number; device_id: string | null }>;
  /** Project settings, one entry per item, each with the time IT changed.
   *  Absent from older clients, which still send everything in metadata. */
  settings?: Array<{ kind: string; item_id: string; value: string | null; changed_at: number; deleted_at?: number | null;
    /** What this device believed the server's stamp for this item was. Lets the
     *  server tell "I edited on top of theirs" from "we both edited blind". */
    base_changed_at?: number }>;
}

type Parsed<T> = { value: T } | { error: { code: string; message: string } };

function asStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}
function asNullableStr(v: unknown, max: number): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.length <= max) return v;
  return undefined;
}

function parseSyncPayload(body: unknown): Parsed<SyncPayload> {
  if (!body || typeof body !== "object") {
    return { error: { code: "invalid_payload", message: "Body must be an object." } };
  }
  const b = body as Record<string, unknown>;

  const projObj = b.project as Record<string, unknown> | undefined;
  if (!projObj) return err("project");
  const projName = asStr(projObj.name)?.trim();
  const projUpdated = asInt(projObj.updated_at);
  if (!projName || projName.length === 0 || projName.length > MAX_PROJECT_NAME_LEN) return err("project.name");
  if (projUpdated === null) return err("project.updated_at");
  const baseUpdatedAt = typeof projObj.base_updated_at === "number" && Number.isFinite(projObj.base_updated_at) ? projObj.base_updated_at : undefined;
  const deviceId = typeof projObj.device_id === "string" ? projObj.device_id.slice(0, 100) : undefined;
  const deviceName = typeof projObj.device_name === "string" ? projObj.device_name.slice(0, 100) : undefined;
  const metadata = typeof projObj.metadata === "string" ? projObj.metadata : null;

  const partial = b.partial === true;

  const strips: SyncPayload["strips"] = [];
  for (const raw of asArray(b.strips)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const sort_order = asInt(r.sort_order);
    const updated_at = asInt(r.updated_at);
    const label = asNullableStr(r.label, MAX_LABEL_LEN);
    if (!id || sort_order === null || updated_at === null || label === undefined) return err("strips[]");
    strips.push({ id, label, sort_order, updated_at });
  }

  const stripIdSet = new Set(strips.map((s) => s.id));

  const frames: SyncPayload["frames"] = [];
  for (const raw of asArray(b.frames)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const strip_id = asStr(r.strip_id);
    const sort_order = asInt(r.sort_order);
    const updated_at = asInt(r.updated_at);
    const label = asNullableStr(r.label, MAX_LABEL_LEN);
    const crop_w = r.crop_w === null || r.crop_w === undefined ? null : asInt(r.crop_w);
    const crop_h = r.crop_h === null || r.crop_h === undefined ? null : asInt(r.crop_h);
    const text_content = r.text_content === null || r.text_content === undefined ? null : asStr(r.text_content);
    const table_data = r.table_data === null || r.table_data === undefined ? null : asStr(r.table_data);
    const version_label = asNullableStr(r.version_label, MAX_LABEL_LEN);
    const strip_labels = r.strip_labels === null || r.strip_labels === undefined ? null : asStr(r.strip_labels);
    const hidden = r.hidden === true || r.hidden === 1;
    const note = r.note === null || r.note === undefined ? null : asStr(r.note);
    const scribbles = r.scribbles === null || r.scribbles === undefined ? null : asStr(r.scribbles);
    if (!id || !strip_id || sort_order === null || updated_at === null || label === undefined || version_label === undefined) return err("frames[]");
    if (!stripIdSet.has(strip_id)) return err("frames[].strip_id (unknown)");
    const base_updated_at = typeof r.base_updated_at === "number" && Number.isFinite(r.base_updated_at)
      ? r.base_updated_at : undefined;
    const changed_offline = r.changed_offline === true || r.changed_offline === 1;
    // The frame's own package. This parser rebuilds the payload field by
    // field, so anything not named here is silently dropped — which is exactly
    // what happened to needs, notes and setup: the columns existed, the client
    // sent them, and they never arrived.
    const needs = r.needs === null || r.needs === undefined ? null : asStr(r.needs);
    const notes = r.notes === null || r.notes === undefined ? null : asStr(r.notes);
    const setup_id = r.setup_id === null || r.setup_id === undefined ? null : asStr(r.setup_id);
    const frameChangedAt = typeof r.content_changed_at === "number" ? r.content_changed_at : null;
    frames.push({ id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label: version_label ?? null, strip_labels, hidden, note, scribbles, updated_at, base_updated_at, changed_offline, needs, notes, setup_id, content_changed_at: frameChangedAt });
  }

  const frameIdSet = new Set(frames.map((f) => f.id));

  const versions: SyncPayload["versions"] = [];
  for (const raw of asArray(b.versions)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const frame_id = asStr(r.frame_id);
    const type = asStr(r.type);
    const updated_at = asInt(r.updated_at);
    const label = asNullableStr(r.label, MAX_LABEL_LEN);
    const hidden = r.hidden === true || r.hidden === 1;
    // 0-3 rating. Older clients only ever sent 0/1, which still reads as 0/1.
    const starred = Number(r.starred) || 0;
    const note = r.note === null || r.note === undefined ? null : asStr(r.note);
    if (!id || !frame_id || !type || type.length > MAX_VERSION_TYPE_LEN || updated_at === null || label === undefined) {
      return err("versions[]");
    }
    if (!frameIdSet.has(frame_id)) return err("versions[].frame_id (unknown)");
    const tags = r.tags === null || r.tags === undefined ? null : asStr(r.tags);
    const verChangedAt = typeof r.content_changed_at === "number" ? r.content_changed_at : null;
    versions.push({ id, frame_id, label, type, hidden, starred, note, updated_at, tags, content_changed_at: verChangedAt });
  }

  const versionIdSet = new Set(versions.map((v) => v.id));

  const images: SyncPayload["images"] = [];
  const seenImageVersionIds = new Set<string>();
  for (const raw of asArray(b.images)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const version_id = asStr(r.version_id);
    const r2_key = asStr(r.r2_key);
    const updated_at = asInt(r.updated_at);
    const width = r.width === null || r.width === undefined ? null : asInt(r.width);
    const height = r.height === null || r.height === undefined ? null : asInt(r.height);
    const size_bytes = r.size_bytes === null || r.size_bytes === undefined ? null : asInt(r.size_bytes);
    const content_type = asStr(r.content_type) ?? null;
    if (!id || !version_id || !r2_key || updated_at === null) return err("images[]");
    if (!versionIdSet.has(version_id)) return err("images[].version_id (unknown)");
    if (seenImageVersionIds.has(version_id)) return err("images[]: duplicate version_id");
    seenImageVersionIds.add(version_id);
    images.push({ id, version_id, r2_key, width, height, size_bytes, content_type, updated_at });
  }

  const drawings: SyncPayload["drawings"] = [];
  const seenDrawingVersionIds = new Set<string>();
  for (const raw of asArray(b.drawings)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const version_id = asStr(r.version_id);
    const drawing_data = asStr(r.drawing_data);
    const updated_at = asInt(r.updated_at);
    if (!id || !version_id || drawing_data === null || updated_at === null) return err("drawings[]");
    if (drawing_data.length > MAX_DRAWING_BYTES) return err("drawings[].drawing_data (too large)");
    if (!versionIdSet.has(version_id)) return err("drawings[].version_id (unknown)");
    if (seenDrawingVersionIds.has(version_id)) return err("drawings[]: duplicate version_id");
    seenDrawingVersionIds.add(version_id);
    drawings.push({ id, version_id, drawing_data, updated_at });
  }

  const deletions: SyncPayload["deletions"] = [];
  for (const raw of asArray(b.deletions)) {
    const r = raw as Record<string, unknown>;
    const id = asStr(r.id);
    const entity_type = asStr(r.entity_type);
    const entity_id = asStr(r.entity_id);
    const deleted_at = asInt(r.deleted_at);
    const device_id = typeof r.device_id === "string" ? r.device_id.slice(0, 100) : null;
    if (!id || !entity_type || !entity_id || deleted_at === null) return err("deletions[]");
    if (entity_type !== "frame" && entity_type !== "version") return err("deletions[].entity_type");
    deletions.push({ id, entity_type, entity_id, deleted_at, device_id });
  }

  const settings: NonNullable<SyncPayload["settings"]> = [];
  for (const raw of asArray(b.settings)) {
    const r = raw as Record<string, unknown>;
    const kind = asStr(r.kind);
    const item_id = asStr(r.item_id);
    const changed_at = asInt(r.changed_at);
    if (!kind || !item_id || changed_at === null) return err("settings[]");
    settings.push({
      kind: kind.slice(0, 40),
      item_id: item_id.slice(0, 100),
      value: typeof r.value === "string" ? r.value : null,
      changed_at,
      deleted_at: typeof r.deleted_at === "number" ? r.deleted_at : null,
      base_changed_at: typeof r.base_changed_at === "number" ? r.base_changed_at : undefined,
    });
  }

  return {
    value: {
      project: { name: projName, updated_at: projUpdated, base_updated_at: baseUpdatedAt, device_id: deviceId, device_name: deviceName, metadata },
      partial,
      strips,
      frames,
      versions,
      images,
      drawings,
      deletions,
      settings,
    },
  };

  function err(field: string): Parsed<SyncPayload> {
    return { error: { code: "invalid_payload", message: `Invalid sync payload at: ${field}` } };
  }
  function asArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
  }
}

async function applySync(db: D1Database, projectId: string, payload: SyncPayload, now: number) {
  if (payload.partial) {
    await applySyncPartial(db, projectId, payload, now);
  } else {
    await applySyncFull(db, projectId, payload, now);
  }
}

// ---------------------------------------------------------------------------
// FULL SYNC — delete everything for this project, re-insert from payload.
// Used for first push, fallback, or backward-compatible full pushes.
// ---------------------------------------------------------------------------
async function applySyncFull(db: D1Database, projectId: string, payload: SyncPayload, now: number) {
  const stmts: D1PreparedStatement[] = [
    // bottom-up delete
    db.prepare(
      `DELETE FROM drawings
        WHERE version_id IN (
          SELECT v.id FROM versions v
          JOIN frames f ON f.id = v.frame_id
          JOIN strips s ON s.id = f.strip_id
          WHERE s.project_id = ?
        )`,
    ).bind(projectId),
    db.prepare(
      `DELETE FROM images
        WHERE version_id IN (
          SELECT v.id FROM versions v
          JOIN frames f ON f.id = v.frame_id
          JOIN strips s ON s.id = f.strip_id
          WHERE s.project_id = ?
        )`,
    ).bind(projectId),
    db.prepare(
      `DELETE FROM versions
        WHERE frame_id IN (
          SELECT f.id FROM frames f
          JOIN strips s ON s.id = f.strip_id
          WHERE s.project_id = ?
        )`,
    ).bind(projectId),
    db.prepare(
      `DELETE FROM frames
        WHERE strip_id IN (SELECT id FROM strips WHERE project_id = ?)`,
    ).bind(projectId),
    db.prepare("DELETE FROM strips WHERE project_id = ?").bind(projectId),
    // project name + bumped updated_at + device tracking
    db.prepare("UPDATE projects SET name = ?, updated_at = ?, last_device_id = COALESCE(?, last_device_id), last_device_name = COALESCE(?, last_device_name), metadata = ? WHERE id = ?")
      .bind(payload.project.name, Math.max(payload.project.updated_at, now), payload.project.device_id ?? null, payload.project.device_name ?? null, payload.project.metadata ?? null, projectId),
  ];

  // Inserts
  for (const s of payload.strips) {
    stmts.push(
      db.prepare(
        `INSERT INTO strips (id, project_id, label, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(s.id, projectId, s.label, s.sort_order, s.updated_at),
    );
  }
  appendFrameInserts(db, stmts, payload, now);

  // Tombstones: INSERT OR IGNORE — idempotent, same tombstone may arrive multiple times
  appendTombstoneInserts(db, stmts, payload, projectId);

  if (stmts.length > 0) await db.batch(stmts);
}

// ---------------------------------------------------------------------------
// PARTIAL (DELTA) SYNC — only dirty frames are in the payload.
// Server deletes+reinserts those specific frames and their children.
// All other frames are left untouched.
// ---------------------------------------------------------------------------
async function applySyncPartial(db: D1Database, projectId: string, payload: SyncPayload, now: number) {
  // Look up the existing strip for this project. In partial mode, the
  // frontend may generate a new strip UUID each push. We remap to the
  // existing one so frames reference the correct strip_id.
  const existingStrip = await db.prepare(
    "SELECT id FROM strips WHERE project_id = ? LIMIT 1",
  ).bind(projectId).first<{ id: string }>();

  const stmts: D1PreparedStatement[] = [];

  if (existingStrip) {
    // Remap all incoming frames to the existing strip
    for (const f of payload.frames) {
      f.strip_id = existingStrip.id;
    }
  } else {
    // First push — insert the strip
    if (payload.strips.length > 0) {
      const s = payload.strips[0];
      stmts.push(
        db.prepare(
          `INSERT INTO strips (id, project_id, label, sort_order, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(s.id, projectId, s.label, s.sort_order, s.updated_at),
      );
    }
  }

  // NOTHING is deleted here any more.
  //
  // This used to wipe every version, image and drawing of each frame in the
  // push and re-insert only what the pushing device sent. A device that had
  // never heard of the other one's new LOOK therefore ERASED it — the SKETCH
  // and REFS versions made on the desktop vanished the moment the iPad pushed
  // that frame. Absence from a push is not a deletion: it means "I do not know
  // about this", which is the normal state of a device that was away.
  //
  // Real deletions travel as TOMBSTONES, which the app already records for
  // frames and for versions, and which are applied a few lines below. The rows
  // the push does describe are updated in place by appendFrameInserts.

  // Apply tombstones: actively delete the entities they reference.
  // In full mode this isn't needed (everything is deleted). In partial mode
  // we must explicitly remove tombstoned frames/versions that aren't in the
  // dirty set.
  for (const del of payload.deletions) {
    if (del.entity_type === "frame") {
      stmts.push(
        db.prepare(
          `DELETE FROM drawings WHERE version_id IN (SELECT id FROM versions WHERE frame_id = ?)`,
        ).bind(del.entity_id),
      );
      stmts.push(
        db.prepare(
          `DELETE FROM images WHERE version_id IN (SELECT id FROM versions WHERE frame_id = ?)`,
        ).bind(del.entity_id),
      );
      stmts.push(
        db.prepare("DELETE FROM versions WHERE frame_id = ?").bind(del.entity_id),
      );
      stmts.push(
        db.prepare("DELETE FROM frames WHERE id = ?").bind(del.entity_id),
      );
    } else if (del.entity_type === "version") {
      stmts.push(
        db.prepare("DELETE FROM drawings WHERE version_id = ?").bind(del.entity_id),
      );
      stmts.push(
        db.prepare("DELETE FROM images WHERE version_id = ?").bind(del.entity_id),
      );
      stmts.push(
        db.prepare("DELETE FROM versions WHERE id = ?").bind(del.entity_id),
      );
    }
  }

  // Re-insert dirty frames and their children
  appendFrameInserts(db, stmts, payload, now);

  // Record tombstones for future pulls by other devices
  appendTombstoneInserts(db, stmts, payload, projectId);

  // Update project metadata
  stmts.push(
    db.prepare(
      "UPDATE projects SET name = ?, updated_at = ?, last_device_id = COALESCE(?, last_device_id), last_device_name = COALESCE(?, last_device_name), metadata = ? WHERE id = ?",
    ).bind(
      payload.project.name,
      Math.max(payload.project.updated_at, now),
      payload.project.device_id ?? null,
      payload.project.device_name ?? null,
      payload.project.metadata ?? null,
      projectId,
    ),
  );

  if (stmts.length > 0) await db.batch(stmts);
}

// ---------------------------------------------------------------------------
// Shared helpers for both full and partial sync
// ---------------------------------------------------------------------------
function appendFrameInserts(db: D1Database, stmts: D1PreparedStatement[], payload: SyncPayload, now: number) {
  for (const f of payload.frames) {
    stmts.push(
      db.prepare(
        `INSERT INTO frames (id, strip_id, label, sort_order, crop_w, crop_h, text_content, table_data, version_label, strip_labels, hidden, note, scribbles, updated_at, changed_offline, needs, notes, setup_id, content_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content_changed_at = excluded.content_changed_at,
           strip_id = excluded.strip_id, label = excluded.label,
           sort_order = excluded.sort_order, crop_w = excluded.crop_w,
           crop_h = excluded.crop_h, text_content = excluded.text_content,
           table_data = excluded.table_data, version_label = excluded.version_label,
           strip_labels = excluded.strip_labels, hidden = excluded.hidden,
           note = excluded.note, scribbles = excluded.scribbles,
           updated_at = excluded.updated_at, changed_offline = excluded.changed_offline,
           needs = excluded.needs, notes = excluded.notes, setup_id = excluded.setup_id`,
      ).bind(f.id, f.strip_id, f.label, f.sort_order, f.crop_w, f.crop_h, f.text_content, f.table_data, f.version_label, f.strip_labels, f.hidden ? 1 : 0, f.note ?? null, f.scribbles ?? null, f.updated_at, f.changed_offline ? 1 : 0, f.needs ?? null, f.notes ?? null, f.setup_id ?? null, f.content_changed_at ?? null),
    );
  }
  for (const v of payload.versions) {
    stmts.push(
      db.prepare(
        `INSERT INTO versions (id, frame_id, label, type, hidden, starred, note, updated_at, tags, content_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content_changed_at = excluded.content_changed_at,
           frame_id = excluded.frame_id, label = excluded.label, type = excluded.type,
           hidden = excluded.hidden, starred = excluded.starred, note = excluded.note,
           updated_at = excluded.updated_at, tags = excluded.tags`,
      ).bind(v.id, v.frame_id, v.label, v.type, v.hidden ? 1 : 0, Number(v.starred) || 0, v.note ?? null, v.updated_at, v.tags ?? null, v.content_changed_at ?? null),
    );
  }
  for (const img of payload.images) {
    stmts.push(
      db.prepare(
        `INSERT INTO images
           (id, version_id, r2_key, width, height, size_bytes, content_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(version_id) DO UPDATE SET
           r2_key = excluded.r2_key, width = excluded.width, height = excluded.height,
           size_bytes = excluded.size_bytes, content_type = excluded.content_type,
           updated_at = excluded.updated_at`,
      ).bind(
        img.id, img.version_id, img.r2_key, img.width, img.height,
        img.size_bytes, img.content_type, now, img.updated_at,
      ),
    );
  }
  for (const d of payload.drawings) {
    stmts.push(
      db.prepare(
        `INSERT INTO drawings (id, version_id, drawing_data, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(version_id) DO UPDATE SET
           drawing_data = excluded.drawing_data, updated_at = excluded.updated_at`,
      ).bind(d.id, d.version_id, d.drawing_data, d.updated_at),
    );
  }
}

function appendTombstoneInserts(db: D1Database, stmts: D1PreparedStatement[], payload: SyncPayload, projectId: string) {
  for (const del of payload.deletions) {
    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO project_deletions (id, project_id, entity_type, entity_id, deleted_at, device_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(del.id, projectId, del.entity_type, del.entity_id, del.deleted_at, del.device_id),
    );
  }
}

// ===========================================================================
// SNAPSHOTS — automatic restore points
// ===========================================================================

const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Save a snapshot of the current project state if 10+ minutes since last snapshot.
 * Called before each sync push so the pre-push state is preserved.
 */
async function maybeCreateSnapshot(db: D1Database, projectId: string, now: number): Promise<void> {
  const latest = await db.prepare(
    "SELECT created_at FROM project_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
  ).bind(projectId).first<{ created_at: number }>();

  if (latest && (now - latest.created_at) < SNAPSHOT_INTERVAL_MS) return;

  await forceCreateSnapshot(db, projectId, now);

  // Thin old snapshots after creating a new one
  await thinSnapshots(db, projectId, now);
}

/**
 * Unconditionally save a snapshot (used before restore and when interval elapsed).
 */
async function forceCreateSnapshot(
  db: D1Database,
  projectId: string,
  now: number,
  reason: 'auto' | 'pre_restore' | 'offline' = 'auto',
): Promise<void> {
  const tree = await loadProjectTree(db, projectId);
  // Skip snapshot if project is empty (no frames)
  if (tree.frames.length === 0) return;

  const json = JSON.stringify(tree);

  // Don't stack up identical "where you left off" points. Opening the restore
  // list and then restoring from it happens seconds apart with nothing changed
  // in between, so compare the actual content rather than guessing at a delay.
  if (reason === 'pre_restore' || reason === 'offline') {
    // Match against EVERY point, not just the newest: right after a restore the
    // project is identical to the point it was restored to, and stamping that
    // same content with the present time is what made the list nonsense.
    const same = await db.prepare(
      "SELECT 1 AS hit FROM project_snapshots WHERE project_id = ? AND tree_json = ? LIMIT 1",
    ).bind(projectId, json).first<{ hit: number }>();
    if (same) return;
  }

  const id = newId();
  await db.prepare(
    "INSERT INTO project_snapshots (id, project_id, tree_json, created_at, reason) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, projectId, json, now, reason).run();
}

/**
 * Enforce the retention policy by deleting snapshots that fall outside the
 * allowed buckets:
 *   - Last hour: every 10 min (5 max)
 *   - 1–4 hours: one per hour (3 max)
 *   - 5–24 hours: one per 4 hours (2 max)
 *   - Older than 24h: one ("yesterday")
 *   - Older than 48h: delete all
 */
async function thinSnapshots(db: D1Database, projectId: string, now: number): Promise<void> {
  const all = await db.prepare(
    "SELECT id, created_at, reason FROM project_snapshots WHERE project_id = ? ORDER BY created_at DESC",
  ).bind(projectId).all<{ id: string; created_at: number; reason: string }>();

  const snaps = all.results;
  if (snaps.length <= 1) return;

  const keep = new Set<string>();

  // Pre-restore points are the user's way back out of a restore. Keep every one
  // of them for the full 48h window — they are never thinned into a bucket.
  for (const s of snaps) {
    if ((s.reason === 'pre_restore' || s.reason === 'offline')
        && now - s.created_at <= 48 * 60 * 60 * 1000) keep.add(s.id);
  }

  // Bucket boundaries in ms
  const ONE_HOUR   = 60 * 60 * 1000;
  const FOUR_HOURS = 4 * ONE_HOUR;
  const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;
  const FORTY_EIGHT_HOURS = 48 * ONE_HOUR;

  // Last hour: keep every 10-min snapshot (max 5 by natural creation interval)
  // 1–4 hours: keep one per hour (3 buckets: 1h, 2h, 3h)
  // 5–24 hours: keep one per 4 hours (2 buckets: ~5h, ~15h)
  // 24–48 hours: keep one ("yesterday")
  // Older than 48h: delete

  // Last hour — keep all
  for (const s of snaps) {
    const age = now - s.created_at;
    if (age <= ONE_HOUR) keep.add(s.id);
  }

  // 1–4 hours — one per hour
  for (let h = 1; h < 4; h++) {
    const bucketStart = now - (h + 1) * ONE_HOUR;
    const bucketEnd   = now - h * ONE_HOUR;
    const best = snaps.find((s) => s.created_at > bucketStart && s.created_at <= bucketEnd);
    if (best) keep.add(best.id);
  }

  // 5–24 hours — one per 4 hours (buckets at ~5h and ~15h roughly)
  // Bucket 1: 4–12 hours
  const b1 = snaps.find((s) => {
    const age = now - s.created_at;
    return age > FOUR_HOURS && age <= 12 * ONE_HOUR;
  });
  if (b1) keep.add(b1.id);

  // Bucket 2: 12–24 hours
  const b2 = snaps.find((s) => {
    const age = now - s.created_at;
    return age > 12 * ONE_HOUR && age <= TWENTY_FOUR_HOURS;
  });
  if (b2) keep.add(b2.id);

  // Older than 24h — keep the most recent one
  const yesterday = snaps.find((s) => (now - s.created_at) > TWENTY_FOUR_HOURS);
  if (yesterday) keep.add(yesterday.id);

  // Delete everything not in keep, plus anything older than 48h
  const toDelete = snaps.filter((s) =>
    !keep.has(s.id) || (now - s.created_at) > FORTY_EIGHT_HOURS,
  );
  if (toDelete.length === 0) return;

  const stmts = toDelete.map((s) =>
    db.prepare("DELETE FROM project_snapshots WHERE id = ?").bind(s.id),
  );
  if (stmts.length > 0) await db.batch(stmts);
}
