import { Hono } from "hono";
import type { Env, AppVariables } from "../types";

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ─── POST /track ───────────────────────────────────────────────────────────
// Receives events from the frontend. No auth required (anonymous users too).
// Body: { event, sid, device, browser, pwa, uid?, meta? }
// Country is extracted from Cloudflare's cf-ipcountry header automatically.
router.post("/track", async (c) => {
  try {
    const body = await c.req.json();
    const { event, sid, device, browser, pwa, uid, meta } = body;
    if (!event || !sid) return c.json({ ok: false }, 400);

    const now = Date.now();
    const country = c.req.header("cf-ipcountry") || null;
    const metaStr = meta ? JSON.stringify(meta) : null;

    // Insert event
    await c.env.DB.prepare(
      `INSERT INTO analytics_events (ts, event, uid, sid, device, browser, pwa, country, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(now, event, uid || null, sid, device || null, browser || null, pwa ? 1 : 0, country, metaStr)
      .run();

    // Upsert session
    await c.env.DB.prepare(
      `INSERT INTO analytics_sessions (sid, uid, device, browser, pwa, country, started_at, last_seen, events)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(sid) DO UPDATE SET
         uid = COALESCE(excluded.uid, analytics_sessions.uid),
         last_seen = excluded.last_seen,
         events = analytics_sessions.events + 1`
    )
      .bind(sid, uid || null, device || null, browser || null, pwa ? 1 : 0, country, now, now)
      .run();

    return c.json({ ok: true });
  } catch (err) {
    console.error("[analytics/track]", err);
    return c.json({ ok: false }, 500);
  }
});

// ─── GET /analytics/summary ────────────────────────────────────────────────
// Quick overview: total sessions, users, events, top events.
// Protected by ADMIN_API_TOKEN.
router.get("/analytics/summary", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token || token !== c.env.ADMIN_API_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const db = c.env.DB;
  const [sessions, users, events, topEvents, recentSessions] = await Promise.all([
    db.prepare("SELECT COUNT(*) as n FROM analytics_sessions").first<{ n: number }>(),
    db.prepare("SELECT COUNT(DISTINCT uid) as n FROM analytics_sessions WHERE uid IS NOT NULL").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) as n FROM analytics_events").first<{ n: number }>(),
    db
      .prepare(
        "SELECT event, COUNT(*) as n FROM analytics_events GROUP BY event ORDER BY n DESC LIMIT 20"
      )
      .all(),
    db
      .prepare(
        `SELECT s.sid, s.uid, u.name, u.email, s.device, s.browser, s.pwa, s.country,
                s.started_at, s.last_seen, s.events,
                (s.last_seen - s.started_at) as duration_ms
         FROM analytics_sessions s
         LEFT JOIN users u ON s.uid = u.id
         ORDER BY s.last_seen DESC LIMIT 50`
      )
      .all(),
  ]);

  return c.json({
    total_sessions: sessions?.n || 0,
    identified_users: users?.n || 0,
    total_events: events?.n || 0,
    top_events: topEvents.results,
    recent_sessions: recentSessions.results,
  });
});

// ─── GET /analytics/users ──────────────────────────────────────────────────
// List all identified users with their activity summary.
router.get("/analytics/users", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token || token !== c.env.ADMIN_API_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const result = await c.env.DB.prepare(
    `SELECT
       u.id, u.name, u.email, u.profession, u.created_at as user_created,
       COUNT(DISTINCT s.sid) as session_count,
       SUM(s.events) as total_events,
       MIN(s.started_at) as first_seen,
       MAX(s.last_seen) as last_seen,
       SUM(s.last_seen - s.started_at) as total_time_ms,
       GROUP_CONCAT(DISTINCT s.device) as devices,
       GROUP_CONCAT(DISTINCT s.country) as countries
     FROM users u
     LEFT JOIN analytics_sessions s ON s.uid = u.id
     GROUP BY u.id
     ORDER BY last_seen DESC`
  ).all();

  return c.json({ users: result.results });
});

// ─── GET /analytics/funnel ─────────────────────────────────────────────────
// How far users get: landing → app → signup → project → export
router.get("/analytics/funnel", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token || token !== c.env.ADMIN_API_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const db = c.env.DB;
  const steps = [
    { name: "landing_visit", label: "Visited landing page" },
    { name: "app_opened", label: "Opened app" },
    { name: "signup", label: "Created account" },
    { name: "project_created", label: "Created a project" },
    { name: "draw_used", label: "Used draw" },
    { name: "write_used", label: "Used write" },
    { name: "camera_used", label: "Used camera" },
    { name: "export_pdf", label: "Exported PDF (landscape)" },
    { name: "export_pptx", label: "Exported PPTX (landscape)" },
    { name: "export_images", label: "Exported Images (landscape)" },
    { name: "export_portrait_pdf", label: "Exported PDF (portrait)" },
    { name: "export_portrait_pptx", label: "Exported PPTX (portrait)" },
    { name: "export_portrait_images", label: "Exported Images (portrait)" },
  ];

  const counts = await Promise.all(
    steps.map(async (step) => {
      const r = await db
        .prepare("SELECT COUNT(DISTINCT sid) as n FROM analytics_events WHERE event = ?")
        .bind(step.name)
        .first<{ n: number }>();
      return { ...step, sessions: r?.n || 0 };
    })
  );

  return c.json({ funnel: counts });
});

// ─── Shared helpers ───────────────────────────────────────────────────────
function fmtDuration(ms: number): string {
  if (ms < 60000) return Math.round(ms / 1000) + "s";
  if (ms < 3600000) return Math.round(ms / 60000) + "m";
  return (ms / 3600000).toFixed(1) + "h";
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).replace(",", "");
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });
}
function flag(country: string | null): string {
  if (!country || country.length !== 2) return "";
  return String.fromCodePoint(...[...country.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}
function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const PAGE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 20px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 20px; color: #fff; }
  h2 { font-size: 18px; margin: 30px 0 12px; color: #ccc; border-bottom: 1px solid #333; padding-bottom: 6px; }
  a { color: #4fc3f7; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .back { display: inline-block; margin-bottom: 16px; font-size: 13px; color: #888; }
  .back:hover { color: #4fc3f7; }
  .cards { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .card { background: #1a1a1a; border-radius: 12px; padding: 20px; min-width: 140px; }
  .card .num { font-size: 32px; font-weight: 700; color: #4fc3f7; }
  .card .label { font-size: 13px; color: #888; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px; color: #888; border-bottom: 1px solid #333; font-weight: 500; }
  td { padding: 8px; border-bottom: 1px solid #1a1a1a; }
  tr:hover td { background: #1a1a1a; }
  .funnel-bar { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .funnel-track { background: #222; border-radius: 4px; height: 24px; position: relative; flex: 1; min-width: 0; }
  .funnel-fill { background: #4fc3f7; height: 100%; border-radius: 4px; min-width: 2px; }
  .funnel-label { position: absolute; left: 8px; top: 3px; font-size: 12px; color: #fff; z-index: 1; }
  .funnel-count { font-size: 12px; color: #aaa; min-width: 24px; text-align: right; }
  .signpost { display: flex; gap: 10px; flex-wrap: wrap; }
  .signpost .chip { background: #1a1a1a; border-radius: 8px; padding: 8px 14px; font-size: 14px; }
  .signpost .chip b { color: #4fc3f7; }
  .pwa { color: #81c784; font-size: 11px; }
  .tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; background: #222; }
  .meta { color: #666; font-size: 11px; }
  .timeline { position: relative; padding-left: 24px; margin: 16px 0; }
  .timeline::before { content: ''; position: absolute; left: 8px; top: 0; bottom: 0; width: 2px; background: #333; }
  .tl-item { position: relative; margin-bottom: 12px; }
  .tl-item::before { content: ''; position: absolute; left: -20px; top: 6px; width: 10px; height: 10px; border-radius: 50%; background: #4fc3f7; }
  .tl-item .tl-time { font-size: 11px; color: #666; }
  .tl-item .tl-event { font-size: 14px; color: #e0e0e0; margin-top: 2px; }
  .tl-item .tl-meta { font-size: 11px; color: #888; margin-top: 2px; }
  .tl-item.session-start::before { background: #81c784; width: 12px; height: 12px; left: -21px; top: 5px; }
  .user-header { background: #1a1a1a; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  .user-header .name { font-size: 20px; font-weight: 700; color: #fff; }
  .user-header .detail { font-size: 13px; color: #888; margin-top: 4px; }
  .user-header .detail b { color: #ccc; }
  .session-block { background: #111; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .session-header { font-size: 13px; color: #888; margin-bottom: 8px; display: flex; gap: 12px; flex-wrap: wrap; }
  .session-header b { color: #ccc; }
  @media (max-width: 600px) { .cards { flex-direction: column; } table { font-size: 12px; } }
`;

// ─── GET /analytics — HTML Dashboard ───────────────────────────────────────
// Visual dashboard. Auth via ?token= query param so it's bookmarkable.
router.get("/analytics", async (c) => {
  const token = c.req.query("token");
  if (!token || token !== c.env.ADMIN_API_TOKEN) {
    return c.html("<h2>Enter token: <form><input name=token><button>Go</button></form></h2>");
  }

  const db = c.env.DB;
  const [sessionsR, activeUsersR, totalUsersR, eventsR, topEventsR,
    desktopSessionsR, tabletSessionsR, phoneSessionsR,
    desktopUsersR, pwaTabletUsersR, pwaPhoneUsersR, browserMobileSessionsR,
    totalProjectsR, projectBreakdownR,
    recentSessionsR, funnelSteps, recentEventsR, topUsersR] = await Promise.all([
    db.prepare("SELECT COUNT(*) as n FROM analytics_sessions").first<{ n: number }>(),
    db.prepare("SELECT COUNT(DISTINCT uid) as n FROM analytics_sessions WHERE uid IS NOT NULL").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) as n FROM users").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) as n FROM analytics_events").first<{ n: number }>(),
    db.prepare("SELECT event, COUNT(*) as n FROM analytics_events GROUP BY event ORDER BY n DESC LIMIT 20").all(),
    // Device session counts
    db.prepare("SELECT COUNT(*) as n FROM analytics_sessions WHERE device = 'desktop'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) as n FROM analytics_sessions WHERE device = 'tablet'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) as n FROM analytics_sessions WHERE device = 'phone'").first<{ n: number }>(),
    // Unique users by device/pwa
    db.prepare("SELECT COUNT(DISTINCT uid) as n FROM analytics_sessions WHERE uid IS NOT NULL AND device = 'desktop'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(DISTINCT uid) as n FROM analytics_sessions WHERE uid IS NOT NULL AND device = 'tablet' AND pwa = 1").first<{ n: number }>(),
    db.prepare("SELECT COUNT(DISTINCT uid) as n FROM analytics_sessions WHERE uid IS NOT NULL AND device = 'phone' AND pwa = 1").first<{ n: number }>(),
    // Browser mobile sessions (not PWA, phone or tablet)
    db.prepare("SELECT COUNT(*) as n FROM analytics_sessions WHERE device IN ('phone','tablet') AND pwa = 0").first<{ n: number }>(),
    // Projects
    db.prepare("SELECT COUNT(*) as n FROM projects").first<{ n: number }>(),
    db.prepare("SELECT meta FROM analytics_events WHERE event = 'signpost_choice'").all(),
    db.prepare(
      `SELECT s.sid, s.uid, u.name, u.email, s.device, s.browser, s.pwa, s.country,
              s.started_at, s.last_seen, s.events,
              (s.last_seen - s.started_at) as duration_ms
       FROM analytics_sessions s LEFT JOIN users u ON s.uid = u.id
       ORDER BY s.last_seen DESC LIMIT 50`
    ).all(),
    Promise.all(
      [
        { name: "app_opened", label: "Opened app" },
        { name: "signpost_choice", label: "Chose project type" },
        { name: "signup", label: "Created account" },
        { name: "project_created", label: "Created project" },
        { name: "draw_used", label: "Used draw" },
        { name: "write_used", label: "Used write" },
        { name: "camera_opened", label: "Used camera" },
        { name: "export_pdf", label: "Exported PDF (landscape)" },
        { name: "export_pptx", label: "Exported PPTX (landscape)" },
        { name: "export_images", label: "Exported Images (landscape)" },
        { name: "export_portrait_pdf", label: "Exported PDF (portrait)" },
        { name: "export_portrait_pptx", label: "Exported PPTX (portrait)" },
        { name: "export_portrait_images", label: "Exported Images (portrait)" },
      ].map(async (step) => {
        const r = await db.prepare("SELECT COUNT(DISTINCT sid) as n FROM analytics_events WHERE event = ?").bind(step.name).first<{ n: number }>();
        return { ...step, sessions: r?.n || 0 };
      })
    ),
    db.prepare("SELECT ts, event, uid, sid, device, browser, pwa, country, meta FROM analytics_events ORDER BY ts DESC LIMIT 100").all(),
    // Top users by session count
    db.prepare(
      `SELECT u.id, u.name, u.email, u.profession,
              COUNT(DISTINCT s.sid) as session_count,
              COALESCE(SUM(s.events), 0) as total_events,
              MAX(s.last_seen) as last_seen,
              GROUP_CONCAT(DISTINCT s.device) as devices
       FROM users u
       INNER JOIN analytics_sessions s ON s.uid = u.id
       GROUP BY u.id
       ORDER BY session_count DESC, total_events DESC
       LIMIT 20`
    ).all(),
  ]);

  const totalSessions = sessionsR?.n || 0;
  const activeUsers = activeUsersR?.n || 0;
  const totalUsers = totalUsersR?.n || 0;
  const totalEvents = eventsR?.n || 0;
  const desktopSessions = desktopSessionsR?.n || 0;
  const tabletSessions = tabletSessionsR?.n || 0;
  const phoneSessions = phoneSessionsR?.n || 0;
  const desktopUsers = desktopUsersR?.n || 0;
  const pwaTabletUsers = pwaTabletUsersR?.n || 0;
  const pwaPhoneUsers = pwaPhoneUsersR?.n || 0;
  const browserMobileSessions = browserMobileSessionsR?.n || 0;
  const totalProjects = totalProjectsR?.n || 0;
  // Project type breakdown from signpost choices
  const projectTypeCounts: Record<string, number> = {};
  for (const row of (projectBreakdownR.results as any[])) {
    try {
      const m = JSON.parse(row.meta);
      projectTypeCounts[m.choice] = (projectTypeCounts[m.choice] || 0) + 1;
    } catch {}
  }
  const allTopUsers = topUsersR.results as any[];
  const top10Users = allTopUsers.slice(0, 10);
  const restUsers = allTopUsers.slice(10);
  const topEvents = topEventsR.results as any[];
  const recentSessions = recentSessionsR.results as any[];
  const recentEvents = recentEventsR.results as any[];

  // Signpost choice breakdown with friendly names (reuse projectBreakdownR data)
  const signpostLabels: Record<string, string> = {
    pdf: "Load Storyboard from PDF",
    images: "Load Images from Folder",
    scratch: "16×9 Start from Scratch",
    portrait: "9×16 Portrait",
    open: "Open Project",
  };
  const signpostCounts: Record<string, number> = {};
  for (const row of (projectBreakdownR.results as any[])) {
    try {
      const m = JSON.parse(row.meta);
      const label = signpostLabels[m.choice] || m.choice;
      signpostCounts[label] = (signpostCounts[label] || 0) + 1;
    } catch {}
  }

  // Filter out heartbeat from top events and recent events
  const filteredTopEvents = topEvents.filter((e: any) => e.event !== 'heartbeat');
  const filteredRecentEvents = recentEvents.filter((e: any) => e.event !== 'heartbeat');

  const top10Events = filteredTopEvents.slice(0, 10);
  const restEvents = filteredTopEvents.slice(10);
  const top10Sessions = recentSessions.slice(0, 10);
  const restSessions = recentSessions.slice(10);
  const top10RecentEvents = filteredRecentEvents.slice(0, 10);
  const restRecentEvents = filteredRecentEvents.slice(10);

  // Funnel: max count for scaling bars
  const funnelMax = Math.max(...funnelSteps.map((s: any) => s.sessions), 1);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Framehow Analytics</title>
<style>${PAGE_STYLES}
  .expand-btn { display: inline-block; margin: 12px 0; padding: 8px 16px; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; color: #4fc3f7; font-size: 13px; cursor: pointer; text-decoration: none; }
  .expand-btn:hover { background: #222; border-color: #4fc3f7; }
  .hidden-rows { display: none; }
  .hidden-rows.show { display: table-row-group; }
  .hidden-items { display: none; }
  .hidden-items.show { display: block; }
</style></head><body>
<h1>Framehow Analytics</h1>

<div class="cards">
  <div class="card"><div class="num">${totalUsers}</div><div class="label">Registered users</div></div>
  <div class="card"><div class="num">${activeUsers}</div><div class="label">Active (tracked)</div></div>
  <div class="card"><div class="num">${totalSessions}</div><div class="label">Sessions</div></div>
  <div class="card"><div class="num">${desktopSessions}</div><div class="label">Desktop sessions</div></div>
  <div class="card"><div class="num">${tabletSessions}</div><div class="label">Tablet sessions</div></div>
  <div class="card"><div class="num">${phoneSessions}</div><div class="label">Phone sessions</div></div>
</div>

<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 28px">
  <a href="/analytics/users-list?token=${token}" class="expand-btn" style="font-size:13px;padding:8px 14px">All registered users (${totalUsers})</a>
  <a href="/analytics/projects?token=${token}" class="expand-btn" style="font-size:13px;padding:8px 14px">Projects created (${totalProjects})</a>
  <a href="/analytics/device-users?device=desktop&token=${token}" class="expand-btn" style="font-size:13px;padding:8px 14px">Desktop (${desktopUsers} users)</a>
  <a href="/analytics/device-users?device=tablet&pwa=1&token=${token}" class="expand-btn" style="font-size:13px;padding:8px 14px">PWA Tablet (${pwaTabletUsers} users)</a>
  <a href="/analytics/device-users?device=phone&pwa=1&token=${token}" class="expand-btn" style="font-size:13px;padding:8px 14px">PWA iPhone (${pwaPhoneUsers} users)</a>
  <a href="/analytics/browser-mobile?token=${token}" class="expand-btn" style="font-size:13px;padding:8px 14px">Browser Mobile (${browserMobileSessions})</a>
</div>

<h2>Funnel <span style="font-size:12px;color:#666;font-weight:400">(unique sessions per step, since tracking deployed)</span></h2>
${funnelSteps.map((s: any) => {
  const pct = funnelMax > 0 ? Math.max(2, (s.sessions / funnelMax) * 100) : 0;
  return `<div class="funnel-bar"><div class="funnel-track"><div class="funnel-fill" style="width:${pct}%"></div><span class="funnel-label">${s.label}</span></div><span class="funnel-count">${s.sessions}</span></div>`;
}).join("")}

<h2>Recent sessions</h2>
<table><thead><tr><th>Who</th><th>Device</th><th>Browser</th><th>Country</th><th>Duration</th><th>Events</th><th>Last seen</th></tr></thead>
<tbody>
${top10Sessions.map((s: any) => {
  const who = s.uid
    ? `<a href="/analytics/user/${s.uid}?token=${token}">${esc(s.name || s.email || s.uid)}</a>`
    : `<a href="/analytics/session/${s.sid}?token=${token}" class="meta">anonymous</a>`;
  return `<tr>
  <td>${who}${s.pwa ? ' <span class="pwa">PWA</span>' : ''}</td>
  <td>${esc(s.device) || '-'}</td>
  <td>${esc(s.browser) || '-'}</td>
  <td>${flag(s.country)} ${esc(s.country) || '-'}</td>
  <td>${fmtDuration(s.duration_ms || 0)}</td>
  <td>${s.events}</td>
  <td>${fmtTime(s.last_seen)}</td>
</tr>`;
}).join("")}
</tbody>
${restSessions.length > 0 ? `<tbody id="more-sessions" class="hidden-rows">
${restSessions.map((s: any) => {
  const who = s.uid
    ? `<a href="/analytics/user/${s.uid}?token=${token}">${esc(s.name || s.email || s.uid)}</a>`
    : `<a href="/analytics/session/${s.sid}?token=${token}" class="meta">anonymous</a>`;
  return `<tr>
  <td>${who}${s.pwa ? ' <span class="pwa">PWA</span>' : ''}</td>
  <td>${esc(s.device) || '-'}</td>
  <td>${esc(s.browser) || '-'}</td>
  <td>${flag(s.country)} ${esc(s.country) || '-'}</td>
  <td>${fmtDuration(s.duration_ms || 0)}</td>
  <td>${s.events}</td>
  <td>${fmtTime(s.last_seen)}</td>
</tr>`;
}).join("")}
</tbody>` : ''}
</table>
${restSessions.length > 0 ? `<a class="expand-btn" onclick="document.getElementById('more-sessions').classList.toggle('show');this.textContent=this.textContent.includes('more')?'Show less':'Show ${restSessions.length} more sessions &darr;'">Show ${restSessions.length} more sessions &darr;</a>` : ''}

<h2>Signpost choices</h2>
<div class="signpost">
${Object.entries(signpostCounts).map(([k, v]) => `<div class="chip"><b>${v}</b> ${k}</div>`).join("") || "<span class='meta'>No data yet</span>"}
</div>

<h2>Top users</h2>
<table><thead><tr><th>User</th><th>Sessions</th><th>Events</th><th>Devices</th><th>Last seen</th></tr></thead>
<tbody>
${top10Users.map((u: any) => `<tr>
  <td><a href="/analytics/user/${u.id}?token=${token}">${esc(u.name || u.email || u.id)}</a>${u.profession ? ` <span class="meta">${esc(u.profession)}</span>` : ''}</td>
  <td>${u.session_count}</td>
  <td>${u.total_events}</td>
  <td>${esc(u.devices) || '-'}</td>
  <td>${u.last_seen ? fmtTime(u.last_seen) : '-'}</td>
</tr>`).join("")}
</tbody>
${restUsers.length > 0 ? `<tbody id="more-users" class="hidden-rows">
${restUsers.map((u: any) => `<tr>
  <td><a href="/analytics/user/${u.id}?token=${token}">${esc(u.name || u.email || u.id)}</a>${u.profession ? ` <span class="meta">${esc(u.profession)}</span>` : ''}</td>
  <td>${u.session_count}</td>
  <td>${u.total_events}</td>
  <td>${esc(u.devices) || '-'}</td>
  <td>${u.last_seen ? fmtTime(u.last_seen) : '-'}</td>
</tr>`).join("")}
</tbody>` : ''}
</table>
${restUsers.length > 0 ? `<a class="expand-btn" onclick="document.getElementById('more-users').classList.toggle('show');this.textContent=this.textContent.includes('more')?'Show less':'Show ${restUsers.length} more users &darr;'">Show ${restUsers.length} more users &darr;</a>` : ''}

<h2>Top events</h2>
<table><thead><tr><th>Event</th><th>Count</th></tr></thead>
<tbody>
${top10Events.map((e: any) => `<tr><td>${e.event}</td><td>${e.n}</td></tr>`).join("")}
</tbody>
${restEvents.length > 0 ? `<tbody id="more-events" class="hidden-rows">
${restEvents.map((e: any) => `<tr><td>${e.event}</td><td>${e.n}</td></tr>`).join("")}
</tbody>` : ''}
</table>
${restEvents.length > 0 ? `<a class="expand-btn" onclick="document.getElementById('more-events').classList.toggle('show');this.textContent=this.textContent.includes('more')?'Show less':'Show ${restEvents.length} more events &darr;'">Show ${restEvents.length} more events &darr;</a>` : ''}

<h2>Recent events</h2>
<table><thead><tr><th>Time</th><th>Event</th><th>Device</th><th>Country</th><th>Session</th><th>Meta</th></tr></thead>
<tbody>
${top10RecentEvents.map((e: any) => `<tr>
  <td style="white-space:nowrap">${fmtTime(e.ts)}</td>
  <td>${esc(e.event)}</td>
  <td>${esc(e.device) || '-'}${e.pwa ? ' <span class="pwa">PWA</span>' : ''}</td>
  <td>${flag(e.country)} ${esc(e.country) || '-'}</td>
  <td class="meta">${esc((e.sid || '').slice(0, 8))}</td>
  <td class="meta">${esc(e.meta)}</td>
</tr>`).join("")}
</tbody>
${restRecentEvents.length > 0 ? `<tbody id="more-recent" class="hidden-rows">
${restRecentEvents.map((e: any) => `<tr>
  <td style="white-space:nowrap">${fmtTime(e.ts)}</td>
  <td>${esc(e.event)}</td>
  <td>${esc(e.device) || '-'}${e.pwa ? ' <span class="pwa">PWA</span>' : ''}</td>
  <td>${flag(e.country)} ${esc(e.country) || '-'}</td>
  <td class="meta">${esc((e.sid || '').slice(0, 8))}</td>
  <td class="meta">${esc(e.meta)}</td>
</tr>`).join("")}
</tbody>` : ''}
</table>
${restRecentEvents.length > 0 ? `<a class="expand-btn" onclick="document.getElementById('more-recent').classList.toggle('show');this.textContent=this.textContent.includes('more')?'Show less':'Show ${restRecentEvents.length} more &darr;'">Show ${restRecentEvents.length} more &darr;</a>` : ''}

</body></html>`;

  return c.html(html);
});

// ─── GET /analytics/user/:uid — User detail: profile + sessions list ──────
router.get("/analytics/user/:uid", async (c) => {
  const token = c.req.query("token");
  if (!token || token !== c.env.ADMIN_API_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const uid = c.req.param("uid");
  const db = c.env.DB;

  const [user, sessions] = await Promise.all([
    db.prepare("SELECT id, name, email, profession, created_at FROM users WHERE id = ?").bind(uid).first(),
    db.prepare(
      `SELECT sid, device, browser, pwa, country, started_at, last_seen, events,
              (last_seen - started_at) as duration_ms
       FROM analytics_sessions WHERE uid = ? ORDER BY started_at DESC`
    ).bind(uid).all(),
  ]);

  const u = user as any;
  const allSessions = sessions.results as any[];

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(u?.name || u?.email || uid)} — Framehow Analytics</title>
<style>${PAGE_STYLES}</style></head><body>
<a class="back" href="/analytics/users-list?token=${token}">&larr; All users</a>
<div class="user-header">
  <div class="name">${esc(u?.name || 'Unknown user')}</div>
  <div class="detail">${esc(u?.email || '')}</div>
  ${u?.profession ? `<div class="detail">Profession: <b>${esc(u.profession)}</b></div>` : ''}
  ${u?.created_at ? `<div class="detail">Registered: <b>${fmtDate(u.created_at)}</b></div>` : ''}
  <div class="detail">Sessions: <b>${allSessions.length}</b></div>
</div>

<h2>Sessions</h2>
<table>
<tr><th>Started</th><th>Device</th><th>Browser</th><th>Country</th><th>Duration</th><th>Events</th></tr>
${allSessions.map((s: any) => `<tr>
  <td><a href="/analytics/session/${s.sid}?token=${token}">${fmtTime(s.started_at)}</a></td>
  <td>${esc(s.device) || '-'}${s.pwa ? ' <span class="pwa">PWA</span>' : ''}</td>
  <td>${esc(s.browser) || '-'}</td>
  <td>${flag(s.country)} ${esc(s.country) || '-'}</td>
  <td>${fmtDuration(s.duration_ms || 0)}</td>
  <td>${s.events}</td>
</tr>`).join("")}
</table>

</body></html>`;

  return c.html(html);
});

// ─── GET /analytics/session/:sid — Anonymous session detail ───────────────
router.get("/analytics/session/:sid", async (c) => {
  const token = c.req.query("token");
  if (!token || token !== c.env.ADMIN_API_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const sid = c.req.param("sid");
  const db = c.env.DB;

  const [session, events] = await Promise.all([
    db.prepare("SELECT * FROM analytics_sessions WHERE sid = ?").bind(sid).first(),
    db.prepare("SELECT ts, event, device, browser, pwa, country, meta FROM analytics_events WHERE sid = ? ORDER BY ts ASC LIMIT 500").bind(sid).all(),
  ]);

  const s = session as any;
  const allEvents = events.results as any[];

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session ${esc(sid.slice(0, 8))} — Framehow Analytics</title>
<style>${PAGE_STYLES}</style></head><body>
<a class="back" href="/analytics?token=${token}">&larr; Dashboard</a>
<div class="user-header">
  <div class="name">Session ${esc(sid.slice(0, 12))}...</div>
  ${s ? `<div class="detail">${esc(s.device)} / ${esc(s.browser)} ${s.pwa ? '<span class="pwa">PWA</span>' : ''} &middot; ${flag(s.country)} ${esc(s.country)}</div>
  <div class="detail">Started: <b>${fmtTime(s.started_at)}</b> &middot; Duration: <b>${fmtDuration((s.last_seen || 0) - (s.started_at || 0))}</b> &middot; ${s.events} events</div>` : ''}
</div>

<h2>Event timeline</h2>
<div class="timeline">
${allEvents.map((e: any) => {
  let metaStr = '';
  if (e.meta) {
    try {
      const m = JSON.parse(e.meta);
      metaStr = Object.entries(m).map(([k, v]) => `${k}: ${v}`).join(', ');
    } catch { metaStr = e.meta; }
  }
  return `<div class="tl-item">
    <div class="tl-time">${fmtTime(e.ts)}</div>
    <div class="tl-event">${esc(e.event)}</div>
    ${metaStr ? `<div class="tl-meta">${esc(metaStr)}</div>` : ''}
  </div>`;
}).join('')}
</div>

</body></html>`;

  return c.html(html);
});

// ─── GET /analytics/users-list — All registered users ─────────────────────
router.get("/analytics/users-list", async (c) => {
  const token = c.req.query("token");
  if (!token || token !== c.env.ADMIN_API_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const db = c.env.DB;
  const result = await db.prepare(
    `SELECT
       u.id, u.name, u.email, u.profession, u.created_at as user_created,
       COUNT(DISTINCT s.sid) as session_count,
       COALESCE(SUM(s.events), 0) as total_events,
       MIN(s.started_at) as first_seen,
       MAX(s.last_seen) as last_seen,
       COALESCE(SUM(s.last_seen - s.started_at), 0) as total_time_ms,
       GROUP_CONCAT(DISTINCT s.device) as devices,
       GROUP_CONCAT(DISTINCT s.country) as countries
     FROM users u
     LEFT JOIN analytics_sessions s ON s.uid = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`
  ).all();

  const users = result.results as any[];

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>All Users — Framehow Analytics</title>
<style>${PAGE_STYLES}</style></head><body>
<a class="back" href="/analytics?token=${token}">&larr; Dashboard</a>
<h1>All Users (${users.length})</h1>

<table>
<tr><th>Name</th><th>Email</th><th>Profession</th><th>Registered</th><th>Sessions</th><th>Events</th><th>Time in app</th><th>Devices</th><th>Countries</th><th>Last seen</th></tr>
${users.map((u: any) => `<tr>
  <td><a href="/analytics/user/${u.id}?token=${token}">${esc(u.name) || '<span class="meta">—</span>'}</a></td>
  <td>${esc(u.email)}</td>
  <td>${esc(u.profession) || '-'}</td>
  <td style="white-space:nowrap">${u.user_created ? fmtDate(u.user_created) : '-'}</td>
  <td>${u.session_count}</td>
  <td>${u.total_events}</td>
  <td>${fmtDuration(u.total_time_ms || 0)}</td>
  <td>${esc(u.devices) || '-'}</td>
  <td>${(u.countries || '').split(',').filter(Boolean).map((cc: string) => flag(cc.trim())).join(' ') || '-'}</td>
  <td style="white-space:nowrap">${u.last_seen ? fmtTime(u.last_seen) : '<span class="meta">no activity</span>'}</td>
</tr>`).join("")}
</table>

</body></html>`;

  return c.html(html);
});

// ─── GET /analytics/projects — Projects breakdown ─────────────────────────
router.get("/analytics/projects", async (c) => {
  const token = c.req.query("token");
  if (!token || token !== c.env.ADMIN_API_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const db = c.env.DB;
  const [totalR, projectsR, signpostR] = await Promise.all([
    db.prepare("SELECT COUNT(*) as n FROM projects").first<{ n: number }>(),
    db.prepare(
      `SELECT p.id, p.name, p.orientation, p.created_at, u.name as user_name, u.email as user_email
       FROM projects p LEFT JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC`
    ).all(),
    db.prepare("SELECT meta FROM analytics_events WHERE event = 'signpost_choice'").all(),
  ]);

  const total = totalR?.n || 0;
  const projects = projectsR.results as any[];

  // Count by orientation
  const orientCounts: Record<string, number> = {};
  for (const p of projects) {
    const o = p.orientation || 'landscape';
    orientCounts[o] = (orientCounts[o] || 0) + 1;
  }

  // Count signpost choices
  const signpostLabels: Record<string, string> = {
    pdf: "From PDF", images: "From Images", scratch: "16×9 from Scratch",
    portrait: "9×16 Portrait", open: "Opened existing",
  };
  const choiceCounts: Record<string, number> = {};
  for (const row of signpostR.results as any[]) {
    try {
      const m = JSON.parse(row.meta);
      const label = signpostLabels[m.choice] || m.choice;
      choiceCounts[label] = (choiceCounts[label] || 0) + 1;
    } catch {}
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Projects — Framehow Analytics</title>
<style>${PAGE_STYLES}</style></head><body>
<a class="back" href="/analytics?token=${token}">&larr; Dashboard</a>
<h1>Projects (${total})</h1>

<div class="cards">
  ${Object.entries(orientCounts).map(([k, v]) => `<div class="card"><div class="num">${v}</div><div class="label">${esc(k)}</div></div>`).join('')}
</div>

<h2>How projects were started</h2>
<div class="signpost" style="margin-bottom:24px">
${Object.entries(choiceCounts).map(([k, v]) => `<div class="chip"><b>${v}</b> ${esc(k)}</div>`).join("") || "<span class='meta'>No data yet</span>"}
</div>

<h2>All projects</h2>
<table>
<tr><th>Name</th><th>Orientation</th><th>Owner</th><th>Created</th></tr>
${projects.map((p: any) => `<tr>
  <td>${esc(p.name) || '<span class="meta">untitled</span>'}</td>
  <td>${esc(p.orientation) || 'landscape'}</td>
  <td>${esc(p.user_name || p.user_email || '-')}</td>
  <td style="white-space:nowrap">${p.created_at ? fmtTime(p.created_at) : '-'}</td>
</tr>`).join("")}
</table>

</body></html>`;

  return c.html(html);
});

// ─── GET /analytics/device-users — Users filtered by device + pwa ──────────
router.get("/analytics/device-users", async (c) => {
  const token = c.req.query("token");
  if (!token || token !== c.env.ADMIN_API_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const device = c.req.query("device") || "desktop";
  const pwaFilter = c.req.query("pwa");
  const db = c.env.DB;

  let label = device.charAt(0).toUpperCase() + device.slice(1);
  let whereClause = `s.device = '${device}'`;
  if (pwaFilter === "1") {
    whereClause += " AND s.pwa = 1";
    label = `PWA ${label}`;
  } else if (pwaFilter === "0") {
    whereClause += " AND s.pwa = 0";
    label = `Browser ${label}`;
  }

  const result = await db.prepare(
    `SELECT DISTINCT u.id, u.name, u.email, u.profession, u.created_at,
            COUNT(DISTINCT s.sid) as session_count,
            COALESCE(SUM(s.events), 0) as total_events,
            MAX(s.last_seen) as last_seen,
            GROUP_CONCAT(DISTINCT s.browser) as browsers,
            GROUP_CONCAT(DISTINCT s.country) as countries
     FROM users u
     INNER JOIN analytics_sessions s ON s.uid = u.id
     WHERE ${whereClause}
     GROUP BY u.id
     ORDER BY session_count DESC`
  ).all();

  const users = result.results as any[];
  const emails = users.filter((u: any) => u.email).map((u: any) => u.email);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${label} Users — Framehow Analytics</title>
<style>${PAGE_STYLES}</style></head><body>
<a class="back" href="/analytics?token=${token}">&larr; Dashboard</a>
<h1>${label} Users (${users.length}) ${emails.length > 0
  ? `<a href="#" onclick="navigator.clipboard.writeText('${emails.join(',')}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy all emails',1500);return false" style="font-size:13px;font-weight:400;margin-left:12px">Copy all emails</a>`
  : ''}</h1>

<table>
<tr><th>Name</th><th>Email</th><th>Profession</th><th>Sessions</th><th>Events</th><th>Browsers</th><th>Countries</th><th>Last seen</th></tr>
${users.map((u: any) => `<tr>
  <td><a href="/analytics/user/${u.id}?token=${token}">${esc(u.name) || '<span class="meta">—</span>'}</a></td>
  <td>${esc(u.email)}</td>
  <td>${esc(u.profession) || '-'}</td>
  <td>${u.session_count}</td>
  <td>${u.total_events}</td>
  <td>${esc(u.browsers) || '-'}</td>
  <td>${(u.countries || '').split(',').filter(Boolean).map((cc: string) => flag(cc.trim())).join(' ') || '-'}</td>
  <td style="white-space:nowrap">${u.last_seen ? fmtTime(u.last_seen) : '-'}</td>
</tr>`).join("")}
</table>

</body></html>`;

  return c.html(html);
});

// ─── GET /analytics/browser-mobile — Mobile browser users (not PWA) ───────
router.get("/analytics/browser-mobile", async (c) => {
  const token = c.req.query("token");
  if (!token || token !== c.env.ADMIN_API_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const db = c.env.DB;
  const [sessionsR, usersR] = await Promise.all([
    db.prepare(
      `SELECT s.sid, s.uid, u.name, u.email, s.device, s.browser, s.pwa, s.country,
              s.started_at, s.last_seen, s.events,
              (s.last_seen - s.started_at) as duration_ms
       FROM analytics_sessions s LEFT JOIN users u ON s.uid = u.id
       WHERE s.device IN ('phone','tablet') AND s.pwa = 0
       ORDER BY s.last_seen DESC LIMIT 100`
    ).all(),
    db.prepare(
      `SELECT DISTINCT u.id, u.name, u.email, u.profession, s.device, s.browser, s.country
       FROM users u
       INNER JOIN analytics_sessions s ON s.uid = u.id
       WHERE s.device IN ('phone','tablet') AND s.pwa = 0
       AND u.id NOT IN (
         SELECT DISTINCT uid FROM analytics_sessions
         WHERE device IN ('phone','tablet') AND pwa = 1 AND uid IS NOT NULL
       )
       ORDER BY u.name`
    ).all(),
  ]);

  const sessions = sessionsR.results as any[];
  const browserOnlyUsers = usersR.results as any[];
  const emails = browserOnlyUsers.filter((u: any) => u.email).map((u: any) => u.email);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Browser Mobile — Framehow Analytics</title>
<style>${PAGE_STYLES}</style></head><body>
<a class="back" href="/analytics?token=${token}">&larr; Dashboard</a>
<h1>Browser Mobile (not PWA)</h1>
<p style="color:#888;font-size:13px;margin-bottom:20px">Users on phone or tablet who use the browser instead of the installed PWA. These users could benefit from adding the app to their home screen.</p>

<h2>Browser-only users (${browserOnlyUsers.length}) ${emails.length > 0
  ? `<a href="#" onclick="navigator.clipboard.writeText('${emails.join(',')}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy all emails',1500);return false" style="font-size:13px;font-weight:400;margin-left:12px">Copy all emails</a>`
  : ''}</h2>
<table>
<tr><th>Name</th><th>Email</th><th>Profession</th><th>Device</th><th>Browser</th><th>Country</th></tr>
${browserOnlyUsers.map((u: any) => `<tr>
  <td><a href="/analytics/user/${u.id}?token=${token}">${esc(u.name) || '<span class="meta">—</span>'}</a></td>
  <td>${esc(u.email)}</td>
  <td>${esc(u.profession) || '-'}</td>
  <td>${esc(u.device)}</td>
  <td>${esc(u.browser)}</td>
  <td>${flag(u.country)} ${esc(u.country) || '-'}</td>
</tr>`).join("")}
</table>

<h2>Recent browser mobile sessions</h2>
<table>
<tr><th>Who</th><th>Device</th><th>Browser</th><th>Country</th><th>Duration</th><th>Events</th><th>Last seen</th></tr>
${sessions.map((s: any) => {
  const who = s.uid
    ? `<a href="/analytics/user/${s.uid}?token=${token}">${esc(s.name || s.email || s.uid)}</a>`
    : `<a href="/analytics/session/${s.sid}?token=${token}" class="meta">anonymous</a>`;
  return `<tr>
  <td>${who}</td>
  <td>${esc(s.device) || '-'}</td>
  <td>${esc(s.browser) || '-'}</td>
  <td>${flag(s.country)} ${esc(s.country) || '-'}</td>
  <td>${fmtDuration(s.duration_ms || 0)}</td>
  <td>${s.events}</td>
  <td>${fmtTime(s.last_seen)}</td>
</tr>`;
}).join("")}
</table>

</body></html>`;

  return c.html(html);
});

export default router;
