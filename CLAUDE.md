# Framehow React — Project Notes

## Deployment

Git branch is `dev` (working branch). Cloudflare Pages production branch is `main`.

### Testing (preview)
```
cd ~/Desktop/Framehow\ Files/framehow-react && npm run build && npx wrangler pages deploy dist --project-name framehow-react
```
- Deploys to preview URL (e.g. `https://<hash>.framehow-react.pages.dev`)
- Alias: `dev.framehow-react.pages.dev`

### Production (live — framehow.com/app)
```
cd ~/Desktop/Framehow\ Files/framehow-react && npm run build && npx wrangler pages deploy dist --project-name framehow-react --branch main
```
- Serves on **framehow.com/app** (custom domain)
- MUST use `--branch main` — without it, wrangler auto-detects the `dev` git branch and deploys to preview only

### Clean rebuild (if changes don't appear)
```
cd ~/Desktop/Framehow\ Files/framehow-react && rm -rf dist tsconfig.tsbuildinfo && npm run build && npx wrangler pages deploy dist --project-name framehow-react --branch main
```
- Use when TypeScript incremental build (`tsc -b`) caches stale output
- Deletes `dist` and `tsconfig.tsbuildinfo` to force full recompilation

## Build

- `npm run build` = `tsc -b && vite build && node scripts/postbuild.mjs`
- postbuild copies `landing.html` to `dist/index.html`, hero image to `dist/img/`, writes `_redirects` for SPA routing
- Build must run on Mac (node_modules are darwin-arm64)

## Versions

### v4.0 — 2026-05-26
**Fresh start from v3.8** — clean codebase, no v3.9 FLOOR/REFS changes.
Identical to v3.8 code. v3.9 (FLOOR/REFS strips experiment) preserved at `framehow-react-versions/v3.9` and on `dev2.framehow-react.pages.dev`.

### v3.8 — 2026-05-26 (live on framehow.com/app)
**Frame Groups + #-label system**

Files changed vs v3.7:
- `src/store/state.ts` — FrameGroup interface with `hiddenFrameIds`
- `src/lib/groups.ts` — group sidebar, editor, reorder, add/remove, getVisibleFrames
- `src/lib/actions.ts` — group-aware create/delete, #-label system
- `src/lib/render.ts` — hidden only in ALL view (groups ignore f.hidden)
- `src/lib/overview.ts` — same hidden-in-ALL-only logic
- `src/lib/modals.ts` — group delete choice modal (unused now), showConfirm for remove
- `src/lib/exports.ts` — group name in export titles (Project / GroupName)
- `src/lib/init.ts` — GROUP button wiring, image export modal
- `src/styles/globals.css` — view bar centering (flex:1), group label styling
- `src/components/Modals.tsx` — image export modal with group picker

Changes:
1. **Frame Groups** — create named groups (locations, scenes, cutdowns), toggle between ALL and groups, each group has its own frame order via `frameIds` array
2. **#-label system** — new frames get `3#1`, `3#2`, `3#3` labels (base = previous frame's number). Only #-labelled frames sync their ALL position when reordered in a group. Original/PDF frames keep fixed ALL position.
3. **Per-group independence** — hiding in ALL (`f.hidden`) does NOT affect groups. Groups only care about `frameIds` membership. Frames created inside a group are auto-hidden in ALL.
4. **Remove from group** — delete button inside a group removes frame from that group only (not from project or other groups)
5. **Group editor** — select/deselect all, 115×77px thumbnails with strokes visible (async rasterize), frame list from ALL
6. **Export with group name** — PDF, PPTX, image exports append " / GroupName" to project title when exporting from a group
7. **View bar centering** — vb-left/vb-right flex:1, group label inside vb-left as normal flex child, center buttons stay centered on all devices
8. **Removed letter-suffix dialog** — "5a" → next frame auto-gets "6" (no more popup asking "5b or 6?")

### v3.7 — 2026-05-24
**Custom analytics + tracking system**

Files changed vs v3.6:
- `src/lib/tracking.ts` (rewritten)
- `src/lib/session.ts`
- `src/lib/actions.ts`
- `src/lib/accountFlow.ts`
- `src/lib/init.ts`
- `src/lib/exports.ts`
- `backend/migrations/0006_analytics.sql` (new)
- `backend/src/routes/analytics.ts` (new)
- `backend/src/index.ts`

Changes:
1. **Frontend tracking rewrite** — `tracking.ts` sends rich events via `sendBeacon`: device (phone/tablet/desktop), browser, PWA status, user ID, country (from CF header), session ID, heartbeat every 2min
2. **User identity wiring** — `session.ts` calls `setTrackingUser()` on login/signup/load so events are tied to user accounts
3. **New tracked events** — signup, login, project_created, project_opened, project_saved, draw_used, write_used, signpost_choice (which project type), export_pdf, export_pptx, export_images, export_portrait_pdf, export_portrait_pptx, export_portrait_images
4. **D1 analytics tables** — `analytics_events` (timestamped event log) + `analytics_sessions` (upserted per session with duration/event count)
5. **Backend analytics API** — POST /track (event ingestion), GET endpoints for summary/users/funnel (Bearer auth)
6. **HTML analytics dashboard** — dark-themed dashboard at `/analytics?token=` with: overview cards (registered users, active users, sessions, device breakdown), clickable buttons (all users, projects, desktop/PWA tablet/PWA iPhone/browser mobile users), funnel visualization, signpost choices, top users by sessions, top events, recent sessions, recent events. All times in Prague timezone.
7. **Subpages** — user detail (profile + clickable sessions list), session timeline (step-by-step events), all users list, projects breakdown, device-filtered user lists with email copy, browser mobile users

### v3.6 — 2026-05-21
**Scroll anchoring + orientation snap-back fix**

Files changed vs v3.5:
- `src/lib/view.ts`
- `src/lib/helpers.ts`
- `src/lib/actions.ts`

Changes:
1. **Desktop 9:16 scroll anchoring** — `navigateStrip()` now calls `scrollAnchorTo(fid)` after cross-compare arrow clicks so the frame stays centered
2. **iPhone scroll anchoring after draw/write/camera** — frame re-centers after closing modals (multi-delay anchoring, iPhone only via `scrollFrameIntoView`)
3. **Removed aggressive anchoring from `clearAllDrawActive`** — was causing jumps on brush/color changes and other re-renders
4. **Removed redundant anchoring from resize/orientationchange handlers** — `handleOrientationFlip()` already does multi-delay anchoring; extra calls caused double-fire on iPad
5. **Orientation snap-back fix** — anchor timers cancelled on `touchstart` so user can scroll immediately after rotating without being yanked back
6. **iPhone TWIN→portrait frame tracking** — removed mid-transition `_updateCenterFid()` calls that picked wrong frame; now uses scroll-tracker value captured during normal scrolling

### v3.5 — 2026-05-21 (live on framehow.com/app)
**iOS portrait canvas stability + signpost fix**

Files changed vs v3.4:
- `src/lib/view.ts` (backup: `view_v3.4.ts`)
- `src/styles/globals.css` (backup: `globals_v3.4.css`)
- `src/lib/init.ts` (backup: `init_v3.4.ts`)

Changes:
1. **iOS Safari portrait 9:16 jump fix** — locked `window.innerHeight` on first use; blocked all resize events for iOS portrait projects (only real orientation changes get through)
2. **iPad detection** — fixed for iPadOS 13+ which spoofs Mac user agent (`navigator.platform === 'MacIntel' && maxTouchPoints > 1`)
3. **Per-device portrait 9:16 canvas sizing** — Safari iPhone +28%, Safari iPad +12%, PWA iPhone +3%, PWA iPad +6%
4. **Orientation change** — properly recalculates when rotating iPad between portrait/landscape
5. **iPhone portrait** — GRID/GRID4 buttons hidden; frame badge hidden for landscape projects
6. **Signpost modal race condition** — no more double-modal when loading a project while logged in (`.finally()` check now only fires for not-logged-in users)

### v3.4 — 2026-05-20
Previous stable version (GRID4 view mode, iOS fullscreen overlay fix, etc.)

## Backend

- Cloudflare Worker at `backend/`
- Separate wrangler.toml, separate deploy: `cd backend && npx wrangler deploy`
- D1 database: `framehow-db`
- R2 bucket: `framehow-storage`

## Analytics (DEPLOYED)

Custom analytics built on existing Cloudflare D1 + Worker. Tracks user journeys, feature usage, sessions.

Dashboard: `https://framehow-api.roman-cbd.workers.dev/analytics?token=ADMIN_API_TOKEN`

### Status
- [x] D1 migration: `0006_analytics.sql` (analytics_events + analytics_sessions tables)
- [x] Backend route: `src/routes/analytics.ts` (POST /track, HTML dashboard, subpages)
- [x] Wired into `src/index.ts`
- [x] Frontend `tracking.ts` rewritten — sends device, browser, PWA, user ID, country (from CF header)
- [x] `session.ts` wired to `setTrackingUser` on login/signup/load
- [x] Events: signup, login, project_created, project_opened, project_saved, draw_used, write_used, signpost_choice, export_pdf, export_pptx, export_images, export_portrait_pdf, export_portrait_pptx, export_portrait_images
- [x] HTML dashboard with subpages (user detail, session timeline, projects, device users, browser mobile)
- [x] D1 migration applied, backend + frontend deployed
- [ ] Landing page tracking (landing_visit, cta_click) — needs landing page changes
- [ ] PWA install tracking (pwa_installed)
- [ ] frame_added event

### Deploy steps
1. Deploy backend: `cd backend && npx wrangler deploy`
2. Build + deploy frontend: `cd ~/Desktop/Framehow\ Files/framehow-react && npm run build && npx wrangler pages deploy dist --project-name framehow-react --branch main`

### Analytics API (protected by ADMIN_API_TOKEN)
- `GET /analytics/summary` — overview stats, top events, recent sessions
- `GET /analytics/users` — all users with activity summary
- `GET /analytics/user/:uid` — single user's full journey
- `GET /analytics/funnel` — conversion funnel (landing → app → signup → project → export)
