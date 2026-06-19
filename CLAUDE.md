# Framehow React — Project Notes

## Deployment

Git branch is `v4.4`. Cloudflare Pages production branch is `main`.

### DEPLOY WORKFLOW — ALWAYS follow this order:
1. Claude bumps `APP_VERSION` in `src/store/state.ts` (e.g. `v4.6.010` → `v4.6.011`)
2. Claude gives user a single Terminal command that: commits → builds → deploys
3. User runs the command on their Mac

### Dev / preview (commit + build + deploy)
```
cd ~/Desktop/Framehow\ Files/framehow-react && git add -A && git commit -m "v4.6.0XX: description" && npm run build && npx wrangler pages deploy dist --project-name framehow-react --branch dev
```
- Deploys to preview URL (e.g. `dev.framehow-react.pages.dev`)
- Every deploy MUST be committed to git first so we can diff/rollback

### Production (live — framehow.com/app)
```
cd ~/Desktop/Framehow\ Files/framehow-react && git add -A && git commit -m "v4.6.0XX: description" && npm run build && npx wrangler pages deploy dist --project-name framehow-react --branch main
```
- Serves on **framehow.com/app** (custom domain)
- MUST use `--branch main` — without it, wrangler auto-detects the `dev` git branch and deploys to preview only
- Deploy to production ONLY when user explicitly says so

### Version numbering
- `APP_VERSION` constant in `src/store/state.ts` — displayed in toolbar next to logo
- Format: `v4.6.0XX` where XX increments with each deploy
- Current: `v4.6.018`
- Production: `v4.6.013`

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

## SAVE procedure (when user says "save", "new version", or "save everywhere")

When the user says save, do ALL 4 steps. Production deploy only when user explicitly says so.

### Step 1: Git commit + push to GitHub
```
# Done from sandbox (commit) + user runs push:
cd ~/Desktop/Framehow\ Files/framehow-react && git push origin v4.4
```

### Step 2: Desktop backup snapshot
Copy project to `framehow-react-versions/vX.Y.ZZZ/` excluding node_modules, dist, .git, etc:
```
cd ~/Desktop/Framehow\ Files/framehow-react-versions && cp -R ../framehow-react vX.Y.ZZZ && rm -rf vX.Y.ZZZ/node_modules vX.Y.ZZZ/dist vX.Y.ZZZ/.git vX.Y.ZZZ/framehow-react-versions vX.Y.ZZZ/backend/node_modules vX.Y.ZZZ/backend/.wrangler
```

### Step 3: Build + deploy to Cloudflare dev
```
cd ~/Desktop/Framehow\ Files/framehow-react && npm run build && npx wrangler pages deploy dist --project-name framehow-react --branch dev
```

### Step 4: Bump version — working copy is now vX.Y.ZZZ+1
Update the version entry in CLAUDE.md to the new version number. The working directory `framehow-react/` is now the next version, ready for new changes.

### Combined Terminal command (user runs this — steps 1+2+3 in one go):
```
cd ~/Desktop/Framehow\ Files/framehow-react && git push origin v4.4 && cd ../framehow-react-versions && cp -R ../framehow-react vX.Y.ZZZ && rm -rf vX.Y.ZZZ/node_modules vX.Y.ZZZ/dist vX.Y.ZZZ/.git vX.Y.ZZZ/framehow-react-versions vX.Y.ZZZ/backend/node_modules vX.Y.ZZZ/backend/.wrangler && cd ../framehow-react && npm run build && npx wrangler pages deploy dist --project-name framehow-react --branch dev
```
Replace `vX.Y.ZZZ` with the actual version number. User must run on Mac (sandbox can't do it).

## CRITICAL RULES
- User controls when to deploy. NEVER deploy without explicit permission.
- First-time import flow must NEVER be changed.
- `_v3.4` backup files must NOT be changed.
- Build must run on user's Mac — sandbox can't build.
- `isPhone = Math.min(w, h) <= 430` — iPad is NOT isPhone.
- Git can't use `git checkout --` due to mounted filesystem. Use `git show HEAD:file > /tmp/file && cat /tmp/file > file`.
- Git commit must run on user's Mac (sandbox can't write .git).
- `bumpRenderTick()` needed after in-place state mutations.
- `(window as any).__fh_renderAll` pattern for calling renderAll from imperative code.
- Chrome cache can serve stale JS bundles — fix with DevTools → Application → Storage → Clear site data.

## PENDING WORK (as of v4.6.013)

### Implemented (needs testing on device):
1. **iPad: setup-bar follows view-bar on scroll** — uses CSS `.view-bar.tb-hide + .setup-bar` adjacent sibling selector to adjust `top` when toolbar hides. Scoped under `body.setup-lock`, no `!important`.
2. **iPhone LANDSCAPE: setup-bar sticky below view-bar** — `top:calc(env(safe-area-inset-top) + 26px)` matches actual view-bar height (26px on iPhone).
3. **iPhone PORTRAIT: setup-bar wraps to two lines** — `flex-wrap:wrap` on `.setup-bar-inner` in portrait media query.

### Not yet implemented:
1. **iPhone PORTRAIT: SAVE/DELETE inline with color squares** — in edit/create forms, SAVE/DELETE should sit inline with the last color square row rather than wrapping to a separate line.

### Key technical context for setup-bar positioning:
- iPad media query: `@media (hover:none) and (pointer:coarse)` — view-bar is `position:fixed`
- iPhone media query: `@media (hover:none) and (pointer:coarse) and (max-width:430px), (max-height:430px)`
- CSS class `setup-lock` on body disables all UI except setup controls
- The view-bar and setup-bar use `position:sticky` on desktop
- iPad scroll-hide: toolbar+viewbar get `tb-hide` class via JS in view.ts; setup-bar follows via CSS `+` sibling selector
- View-bar height: 28px on iPad (13px font), 26px on iPhone (11px font)

## Versions

### v4.6.017 — 2026-06-19 (dev)
**Separator spacing + setup CANCEL button**

Changes from v4.6.015:
- `src/styles/globals.css` — `.vb-sep` margin 2px → 6px on each side
- `src/lib/setups.ts` — CANCEL button always shown in create form (was hidden when no setups exist); exits setup mode if no setups
- `src/store/state.ts` — APP_VERSION bumped to v4.6.017

### v4.6.016 — 2026-06-19 (dev)
**View bar separator spacing (not deployed)**

Changes from v4.6.015:
- `src/styles/globals.css` — `.vb-sep` margin 2px → 4px on each side
- `src/store/state.ts` — APP_VERSION bumped to v4.6.016

### v4.6.015 — 2026-06-19 (dev)
**iOS Save race fix + load guard + view bar reorganization**

Changes from v4.6.013:
- `src/lib/accountFlow.ts` — `saveNow()` waits for in-flight background sync before syncing (shows "WAIT…" / "SAVED."); blocks save entirely if project still loading ("Project still loading…")
- `src/lib/currentProject.ts` — `flushSyncNow()` now checks `_pullInFlight` and `_projectSwitchInFlight` (was missing); added `isLoadInFlight()` export
- `src/components/ViewBar.tsx` — 3×2VIEW moved from left group to middle group with `.vb-sep` vertical separator before MAIN
- `src/styles/globals.css` — added `.vb-sep` rule (1px wide, 16px tall, border-colored vertical line)
- `src/store/state.ts` — APP_VERSION bumped to v4.6.015

### v4.6.013 — 2026-06-19 (dev)
**Setup-bar positioning + touch targets**

Changes from v4.6.011:
- `src/styles/globals.css` — 3×2VIEW button gap removed; arrow+DONE invisible 10px touch zone (`::after` pseudo-element) on pointer:coarse; iPad `body.setup-lock .view-bar.tb-hide + .setup-bar{top:calc(safe+25px)}` so setup-bar follows view-bar on scroll; iPhone setup-bar top 28px→26px (matches actual view-bar height); iPhone portrait `.setup-bar-inner{flex-wrap:wrap}` so DONE stays visible
- `src/store/state.ts` — APP_VERSION bumped to v4.6.013
- `src/components/ViewBar.tsx` — 3×2 VIEW text: removed space between 3×2 and VIEW

### v4.6.011 — 2026-06-19 (dev)
**Frame card padding + setup-bar first positioning attempt**

Changes from v4.6.010:
- `src/styles/globals.css` — `.version-actions` padding: `3px 10px 10px` → `3px 10px` (equal top/bottom); iPad: `body.setup-lock .setup-bar{position:fixed;top:calc(80px+safe*0.5)}` inside touch query; iPhone: `body.setup-lock .setup-bar{position:sticky;top:calc(safe+28px)}` inside iPhone query
- `src/store/state.ts` — APP_VERSION bumped to v4.6.011

### v4.6.010 — 2026-06-19 (dev, committed but deploy had issues)
**Setup polish — re-applied all good changes from session**

Changes from v4.6.009:
- `src/store/state.ts` — APP_VERSION constant; color palette: #6→#E23A2F, #9→#1974D2, #10→#2E7D56, #11→#8B5E3C
- `src/styles/globals.css` — hover #b03b25→#b01f2a (3 spots); active pill box-shadow; DONE btn red fill; dropdown padding 8px/gap 10px; +NEW btn styling; +ADD text bigger/bolder; taken colors X marks (white + dark); active dropdown item box-shadow
- `src/lib/setups.ts` — arrow toggle ▶/▼; _closeDropdown() helper; click-outside-to-close; max 12 setups; +NEW no space; remove title tooltips; light class on taken colors
- `src/components/ViewBar.tsx` — 3×2 → 3×2 VIEW with hair space (U+200A)
- `src/components/Toolbar.tsx` — APP_VERSION label next to logo
- `landing.html` — hover #b03b25→#b01f2a (2 spots)

### v4.6.001 — 2026-06-16 (dev)
**3x2 grid view — text scroll fix, cross-compare arrows, iPhone landscape, equal spacing**

Changes from v4.6.000:
- `src/styles/globals.css` — Text block: overflow hidden by default, scroll only on focus; left+right arrows always visible & tappable in 3x2; 3x2 button visible on iPhone landscape (removed opacity:0.5 rule); narrower button padding for iPad fit
- `src/lib/overview.ts` — Text block click/blur handler (g3-text-active class toggle, scroll reset on blur); "HIDE" button text in 3x2; extracted `recalcGrid3x2Margins()` — all vertical gaps = 3vw
- `src/lib/init.ts` — Floor/Refs from 3x2 use renderAll(); 3x2 allowed on iPhone landscape (portrait shows toast); recalcGrid3x2Margins registered as window global
- `src/lib/view.ts` — Resize recalc wrapped in rAF; portrait rotation exits 3x2 and clears crossCompare
- `src/lib/actions.ts` — CAM photo in main strip single view: state-level crossCompare instead of per-strip

### v4.6.000 — 2026-06-12 (live on framehow.com/app)
**Menu responsiveness + iPhone 9:16 strip labels + tab windowing removal + default strip names**

Changes from v4.5.030:
- `src/lib/init.ts` — Menu responsiveness: `stopPropagation` on `#mainMenu` container to prevent iOS tap races; non-blocking save on New Project (fire-and-forget `flushSyncNow`)
- `src/styles/globals.css` — `touch-action:manipulation` on `.load-menu` and `.new-project-modal .np-btn`
- `src/lib/render.ts` — iPhone 9:16 strip labels: `_phonePortraitProject()` helper hides repeated main-frame name from strip cards (VERSN/FLOOR/REFS); `windowedTabIndices` simplified to always return all tabs (CSS overflow handles scrolling)
- `src/store/state.ts` — Default strip button labels: STRIP1→VERSN, STRIP2→FLOOR, STRIP3→REFS
- `CLAUDE.md` — Corrected git branch name (`v4.4`), added `--branch dev` to dev deploy command

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
