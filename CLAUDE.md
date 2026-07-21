# Framehow React — Project Notes

## Deployment

Git branch is `v4.4`. Cloudflare Pages production branch is `main`.

### 4 STEPS SAVE — when user says "4 steps save", ALWAYS do exactly this:

**Step 1.** Claude checks the CURRENT version in `src/store/state.ts` is the one being saved (NOT bumped yet). Claude tells the user the CURRENT VERSION number.

**Step 2.** Claude gives the user ONE terminal command that does all of this in order:
  - `git add -A && git commit -m "..." && git push` (pushes current version to GitHub)
  - `rsync -a --exclude=node_modules --exclude=dist --exclude=.git . ~/Desktop/Framehow\ Files/framehow-react-versions/v{CURRENT_VERSION}/` (copies source to versions folder, MUST be under 5MB — no node_modules, no dist, no .git)
  - `npm run build` (compiles TypeScript + bundles with Vite into dist/)
  - `npx wrangler pages deploy dist --project-name=framehow-react --branch=dev --commit-dirty=true` (deploys to dev)

**Step 3.** User pastes the terminal output. Claude confirms it worked.

**Step 4.** Claude bumps APP_VERSION in `src/store/state.ts` and `CLAUDE.md`. Claude shows the user the new version number.

CRITICAL: This procedure is ALWAYS exactly the same. Only the commit message and version number change.

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
- Current: `v4.9.020`
- Production: `v4.9.001`

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

## "4 STEPS SAVE" — triggered when user says "4 steps save", "save", "new version", or "save everywhere"
##
## CRITICAL: Follow this EXACT order. Do NOT bump the version until AFTER the
## user has run the terminal command and it succeeded.
##
## Step 1: Verify state.ts has the CURRENT version (NOT the next one)
## Step 2: Give user ONE terminal command that does steps A+B+C below
## Step 3: WAIT for user to paste the terminal output confirming success
## Step 4: ONLY THEN bump version in state.ts + CLAUDE.md
##
## The terminal command (steps A+B+C combined):
## A = git add + commit + push (saves current version to GitHub)
## B = cp backup to ~/Desktop/Framehow Files/framehow-react-versions/vCURRENT/ (< 5MB, no node_modules/dist/.git)
##     IMPORTANT: backup path is ~/Desktop/Framehow\ Files/framehow-react-versions/ (INSIDE "Framehow Files")
##     DO NOT use ~/Desktop/framehow-react-versions/ — that is WRONG
## C = npm run build + wrangler pages deploy --branch=dev (deploys current version)
##
## Template (replace vX.Y.ZZZ with current version, e.g. v4.7.011):
## ```
## cd ~/Desktop/Framehow\ Files/framehow-react && git add -A && git commit -m "vX.Y.ZZZ – DESCRIPTION" && git push origin v4.4 && cd ../framehow-react-versions && cp -R ../framehow-react vX.Y.ZZZ && rm -rf vX.Y.ZZZ/node_modules vX.Y.ZZZ/dist vX.Y.ZZZ/.git vX.Y.ZZZ/framehow-react-versions vX.Y.ZZZ/backend/node_modules vX.Y.ZZZ/backend/.wrangler && cd ../framehow-react && npm run build && npx wrangler pages deploy dist --project-name=framehow-react --branch=dev
## ```
##
## After success, Claude bumps state.ts to vX.Y.ZZZ+1 and adds a new
## "working copy" entry in CLAUDE.md Versions section.
## The backup must be < 5MB (currently ~2.3MB).
## Production deploy ONLY when user explicitly says so.
##
## REPORTING: After 4 steps save is complete, tell the user:
##   1. vX.Y.ZZZ saved to GitHub, desktop, and deployed to dev
##   2. vX.Y.ZZZ pushed to GitHub
##   3. vX.Y.ZZZ backed up to desktop › framehow-react-versions
##   4. New working version is vX.Y.ZZZ+1

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

### v4.8.001 — 2026-06-27 (dev — working copy)
Next version, continues from v4.7.017.

### v4.7.017 — 2026-06-27 (dev — deployed)
**Note sync fixes: remove keepAlive, flush on OK, markFrameDirty, 409 conflict pull+retry**

Changes:
- `src/lib/helpers.ts` — Removed keepAlive interval from note modal (typing naturally keeps heartbeat alive via capture-phase keydown listener). Added `flushSyncNow()` on OK for immediate push. Added `markFrameDirty()` to protect in-place note mutations during pull merges.
- `src/lib/currentProject.ts` — New `markFrameDirty(serverFrameId)` export for explicit dirty tracking of in-place mutations. `flushSyncNow()` now handles 409 conflicts: pulls to merge (with dirty frame protection), updates `lastKnownUpdatedAt`, schedules retry push.

### v4.7.012 — 2026-06-26 (dev — deployed)
Continues from v4.7.011.

### v4.7.016 — 2026-06-26 (dev — deployed)
**DRAW button opens fullscreen canvas everywhere, global color/thickness memory**

Changes:
- `src/lib/actions.ts` — DRAW button (`handleMainAction` + `handleAction`) now calls `openFullscreen()` instead of toggling inline draw mode. Covers all views: list, grid 3x2, groups, setups, main frames, version strips, cross-compare.
- `src/lib/fullscreen.ts` — Global `_lastColor` / `_lastWidth` track last used color+thickness across frames. Defaults: blue (#3080e0) + middle (12px). Eraser always off on open. Color and thickness stay highlighted together.

### v4.7.015 — 2026-06-26 (dev — deployed)
**CLAUDE.md 4-step save docs update — backup path fix, reporting format**

### v4.7.014 — 2026-06-26 (dev — deployed)
**R2 orphan cleanup, daily expired project purge, restore modal UI polish**

Changes:
- `backend/src/routes/cleanup.ts` — New admin endpoints: `POST /admin/cleanup/orphans` (batched R2 orphan scan+delete, 500 per call), `POST /admin/cleanup/expired-projects` (purge projects deleted >7 days), `GET /admin/cleanup/preview` (dry-run).
- `backend/src/index.ts` — Wired cleanup routes, added `scheduled` cron handler for daily purge at 3 AM UTC.
- `backend/wrangler.toml` — Added `[triggers] crons = ["0 3 * * *"]`.
- `src/lib/accountFlow.ts` — Restore modal: hide overlay before confirm dialog (z-index fix), simplified button labels to actual time + clock time (gray/white), improved `formatTimeAgo` wording.

### v4.7.013 — 2026-06-26 (dev — deployed)
**Restore Project feature — backend snapshots + frontend modal**

Changes:
- `backend/migrations/0010_project_snapshots.sql` — New `project_snapshots` table for storing project tree JSON at points in time.
- `backend/src/routes/projects.ts` — `maybeCreateSnapshot` (every 10 min during push), `forceCreateSnapshot`, `thinSnapshots` (retention policy), `GET /snapshots`, `POST /restore/:snapshotId`.
- `src/lib/accountFlow.ts` — `openRestoreModal` (fetches snapshots, groups into time buckets, dark modal UI), `performRestore` (progress bar, applies restored tree), `flowRestoreProject` entry point.
- `src/components/Toolbar.tsx` — Restore Project menu button with separator gaps.
- `src/lib/init.ts` — Click handler for Restore Project button.

### v4.7.012 — 2026-06-26 (dev — deployed)
**Incomplete load overlay — blocks interaction when images fail to download**

Changes:
- `src/lib/accountFlow.ts` — Added fullscreen overlay ("Couldn't load all content — check your connection") with Retry/Dismiss buttons when R2 image fetches fail; overlay shows after progress bar hides (no overlap); Retry triggers fresh pull; Dismiss lets user browse but _pullIncomplete stays true (no push/save of half-loaded state).

### v4.9.029 — 2026-07-20 (dev — deployed)
**Real image-count progress bar during project loading**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.029
- `src/lib/accountFlow.ts` — `applyCloudTreeToStore` now accepts optional `onImageProgress(loaded, total)` callback. Both main and version image fetch loops report progress (including on failure). Wired into openProject (50→85%), performRestore (60→95%), and sync pull callers. Label shows "Loading image N of M…" with proportional bar movement.

### v4.9.028 — 2026-07-20 (dev — deployed)
**3x2 iPhone short labels, NOTES has-content fix, strip toggle fixes, remove MAIN quick button**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.028
- `src/lib/overview.ts` — 3x2 quick buttons: short labels on iPhone (VRSN, SKTCH, NEED, NOTE), removed MAIN button, tighter CSS padding on iPhone landscape
- `src/lib/notes.ts` — `frameHasNoteContent()` now skips headers and first column (Table Settings structure) — only content cells (col 1+) and noteText count
- `src/lib/init.ts` — Desktop/iPad strip toggle counts NEEDS/NOTES in totalVisible; 3x2 save/restore includes notesStripVisible; 3x2 exit enforces iPhone landscape max-2; clears notesStripBtn on 3x2 entry
- `src/styles/globals.css` — iPhone landscape media query for tighter g3-quick-btn padding

### v4.9.027 — 2026-07-20 (dev — deployed)
**iPhone label truncation, remove NEEDS memo, strip toggle fixes, pill height match, notes default mode, 3x2 exit enforcement**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.027
- `src/lib/view.ts` — `_truncatePhoneLabels()`: on iPhone, truncates frame labels to first 3 chars of extra text (e.g. "1A OPTIONAL" → "1A OPT"). Handles combo labels (NEEDS/NOTES). Called from `syncCardHeights()` and after overview/grid renders. Restored pill height matching code in STEP 2b.
- `src/lib/needs.ts` — Removed memo textarea and event handler. Moved setup pill to `needs-bottom-left` for left alignment. Added `setup-pill` class to needs pill for size matching. Restored pill height re-application from stored data.
- `src/lib/notes.ts` — Table Settings no longer forces `mode: 'table'` on all cards; keeps existing mode.
- `src/lib/init.ts` — Desktop/iPad strip toggle-off now counts NEEDS/NOTES in totalVisible. 3x2 save/restore includes `notesStripVisible`. 3x2 exit enforces iPhone landscape max-2 strips. Clears notesStripBtn when entering 3x2.
- `src/styles/globals.css` — Removed `.needs-memo` CSS. `.needs-setup-pill` now inherits from `.setup-pill`.

### v4.9.026 — 2026-07-19 (dev — deployed)
**Detail bar visible on DETAIL press at any scroll position**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.026
- `src/lib/init.ts` — DETAIL toggle handler now forces all bars visible (removes `tb-hide`, resets scroll handler's `hidden` flag, sets `scrollHideGuard`) and dispatches resize event to trigger `syncDetailTopIPad()` recalculation. Applies to both iPad/desktop and phone 3x2 landscape paths.

### v4.9.025 — 2026-07-19 (dev — deployed)
**PDF re-adjust preserving work, orphaned frame handling**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.025, added `orphaned?: boolean` to Frame interface
- `src/lib/pdfAdjust.ts` — PDF re-adjust merge: center-crop 8×8 grayscale fingerprint matching preserves versions/strokes/needs/stars/tags/setups/notes for matched frames. Unmatched old frames kept near original position as orphaned.
- `src/lib/modals.ts` — `showOrphanChoice()` modal: KEEP/HIDE/DELETE options for orphaned frames.
- `src/lib/init.ts` — Capture-phase click interceptor for orphaned frames showing choice modal.
- `src/lib/render.ts` — Orphaned class toggling on frame cards.
- `src/lib/overview.ts` — Orphaned class toggling on 3x2 cards.
- `src/styles/globals.css` — Orphaned frame styling (dimmed canvas, red label).

### v4.9.024 — 2026-07-19 (dev — deployed)
**Camera fly-to animation, NEEDS modal zoom, 3x2 portrait rotation fixes**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.024
- `src/lib/overview.ts` — NEEDS modal (`_openNeedsModal`) now has zoom-from/zoom-to animation matching fullscreen (0.18s ease-out open, 0.18s ease-in close), animating from/to the source 3x2 card.
- `src/lib/fullscreen.ts` — `findSourceCard` uses `origin` + `stripScrollId` to locate correct strip canvas-wrap in multi-strip views.
- `src/lib/actions.ts` — Camera capture fly-to animation: captured image zooms out from full-screen to target frame card. Targets version strip card when visible, falls back to main card in single-strip/portrait mode. Skipped when fullscreen overlay is active.
- `src/lib/camera.ts` — `closeCamera` forces all bars visible instead of calling `resetToolbarState` (which would hide them when scrolled).
- `src/lib/view.ts` — iPad 3x2→portrait rotation: switches to MAIN+VERSN immediately, shows rotate overlay, activates detail bar + detail button + strip toggles. `_returnTo3x2` flag restores 3x2 when rotating back to landscape. `resetToolbarState` now respects `scrollHideGuard`. `_scrollHideReset(false)` + `scrollTo(0,0)` on rotation to prevent bar hiding. `g3RotateMsg` only auto-dismissed on landscape (not killed by portrait resize events).

### v4.9.023 — 2026-07-19 (dev — deployed)
**Two fullscreen modes: draw-only + full neutral**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.023
- `src/lib/fullscreen.ts` — Two fullscreen modes: draw-only (triggered by DRAW buttons, shows only toolbar) and full (triggered by VERSN buttons, starts neutral with no draw active). Added `drawOnly` flag based on `initialMode === 'draw'`. Added `fsMode: 'none'` for neutral state. Canvas gets `pointer-events:none` in neutral mode. DRAW button toggles on/off in full mode. After CAM/WRITE actions, returns to neutral in full mode. `initCanvas()` completely untouched.
- `src/lib/actions.ts` — Main DRAW and strip DRAW handlers now pass `'draw'` as `initialMode` to `openFullscreen()`.

### v4.9.020 — 2026-07-18 (dev — deployed)
**Detail bar: persistent on iPhone/iPad portrait, dynamic positioning, setup-lock blocks DETAIL**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.020
- `src/lib/init.ts` — DETAIL toggle: no-op on phone (CSS manages bar), blocked during setup mode. iPad portrait: detail bar stays open. 3×2VIEW in portrait keeps detail bar open. Strip-toggle buttons reflect active strips when opening detail bar (skip in 3×2).
- `src/lib/view.ts` — Rotation handler: iPad portrait keeps detail bar open. iPhone rotation keeps detail-open + DETAIL active. Dynamic detail bar positioning: JS measures view bar height via `offsetHeight` + computed `top`, positions detail bar below it on scroll/resize. Applied to both iPhone and iPad.
- `src/lib/render.ts` — `renderAll()` skips DETAIL button active state (managed by toggle, not view mode). Added `body.view-grid3x2` class toggle for CSS.
- `src/styles/globals.css` — iPhone: detail bar always visible (`display:flex!important`), hidden in 3×2 (`body.view-grid3x2`), shown when detail-open in 3×2. View bar visible in portrait (removed `display:none`). iPad: removed hardcoded detail bar `top` and `tb-hide` transforms (JS handles positioning). Removed DETAIL button exemption from setup-lock dimming.

### v4.9.019 — 2026-07-16 (dev — deployed)
**Fullscreen DRAW/CAM/WRITE buttons, version tabs, smart opening, has-content button styling**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.019
- `src/lib/fullscreen.ts` — Added DRAW/CAM/WRITE mode buttons below canvas in fullscreen overlay. DRAW shows color/thickness toolbar to its right. CAM triggers camera capture. WRITE opens text modal. Added version tabs (v1, v2, +) centered above canvas with frame label. Smart tab opening: remembers last active tab per strip. Camera auto-triggers for VERSN when strip has no content. Added `stripHasContent()` helper. Closing fullscreen resets `crossCompare` so 3x2 card shows main frame.
- `src/lib/overview.ts` — VERSN/SKETCH/REFS buttons use smart tab selection (last active tab if content exists). NEEDS button gets `has-content` class when frame has toggles/counters/memos set. Re-renders card on NEEDS modal close to update button state.
- `src/lib/actions.ts` — `applyCapturedImage` dispatches `fs-refresh` event when fullscreen overlay is active, so canvas refreshes after camera capture.
- `src/styles/globals.css` — `.fs-strip-tabs` centered with `justify-content:center`. `.vtab-add` red in fullscreen. New `.fs-bottom-bar`, `.fs-mode-btn` styles. `.g3-quick-btn.has-content` reversed colors (dark fill, bright text). Camera overlay z-index 500→10000, text modal z-index 300→10000 (above fullscreen overlay's 9999).

### v4.9.018 — 2026-07-16 (dev — deployed)
**Scribble sync fix, two-finger scroll in scribble mode**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.018
- `backend/src/routes/projects.ts` — Fixed scribble sync: `parseSyncPayload` was silently dropping the `scribbles` field from push payloads. Added `scribbles` to `SyncPayload` interface and parser. Added `scribbles` to `ProjectTree` interface.
- `src/lib/scribble.ts` — Fixed two-finger scroll in scribble mode when not zoomed: was calling `scrollEl.scrollBy()` on `overviewScroll` which has no overflow (not a scroll container). Changed to `window.scrollBy()`. Reduced scroll intent threshold from 12px to 6px. Removed scrolling during undecided phase to prevent jitter. Switched to `Math.round` for smoother sub-pixel handling.

### v4.9.017 — 2026-07-08 (dev — deployed)
**Drawings visible in SORT BY, new frames in all sort orders, strip restore from sort/3x2**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.017
- `src/lib/sortOrder.ts` — Sort cards now show stroke overlays (drawings) on MAIN, VERSN, and SKETCH via async rasterization. Added `fillRasterizedImages()` replacing `fillSketchImages()` — handles all three strip types including stroke-only versions (no bgImage). Imported `rasterizeMain`. Added `addFrameToSortOrders(frameId, afterFrameId)` — inserts new frames into all existing custom sort orders after the reference frame. Added `removeFrameFromSortOrders(frameId)` — removes deleted frames from all sort orders with break position adjustment.
- `src/lib/actions.ts` — Calls `addFrameToSortOrders` after every frame creation (new, portrait new, duplicate). Calls `removeFrameFromSortOrders` on permanent delete.
- `src/lib/init.ts` — Strip toggle from sort mode: detects `wasSort`, ensures pressed strip is activated without toggle-off. 3x2 entry saves pre-3x2 strip combination to `window.__pre3x2Strips`. Pressing MAIN from 3x2 restores previous strip combo (e.g. MAIN+REFS) instead of going to MAIN-only.

### v4.9.016 — 2026-07-07 (dev — deployed)
**Break text input: iOS scroll-to-input fix across all devices**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.016
- `src/lib/sortOrder.ts` — Break text input always rendered with `readonly` attribute. Device-specific focus handling: iPhone lets iOS handle naturally + scrolls break to 25% from top on blur; iPad uses `focus({ preventScroll: true })`, detects physical vs software keyboard after 500ms (visualViewport check), locks body with `position:fixed` for physical keyboard, `scrollIntoView` for software keyboard; Desktop removes readonly on mousedown for native cursor positioning. Break default text "BREAK NAME".
- `src/styles/globals.css` — Break text input width reduced to 60% (`flex:0 1 60%`). Active break text uses `box-shadow: inset 0 0 0 1px` instead of `border` to avoid layout shift triggering iOS scroll. `.sort-dragging` class prevents text selection during drag.

### v4.9.015 — 2026-07-02 (dev — deployed)
**Break cards, auto-deactivate, iPhone portrait layout, column/padding tweaks**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.015, added `storyFlowBreaks: SortBreak[]` field for story flow breaks
- `src/lib/sortOrder.ts` — Break cards redesigned: 50% grey (#808080) with white text, combined/active arrow pattern (matching frame cards), auto-activated on insert at middle of list. ADD BREAK button moved to header (right side of breadcrumb), works for both custom orders and story flow. Auto-deactivate on outside tap for both frame cards and break cards. Break rename/move/add all handle story flow via `storyFlowBreaks` state with `|| []` fallback for existing data.
- `src/styles/globals.css` — iPhone portrait: reduced 3-column sort card layout (38px|1fr|30px), hides VERSN/SKETCH/NEEDS/description. Card padding: 3px left, 9px right. Main frame image: 2px black outline, no border-radius. VERSN/SKETCH: no border-radius. Column 1 widened to 44px (38px iPhone). Break card: #808080 bg, white text, red outline when active. ADD BREAK header button styled.

### v4.9.014 — 2026-07-02 (dev — deployed)
**Drag-only on active card, auto-scroll edges, card shift animation**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.014
- `src/lib/sortOrder.ts` — Rewrote `setupDragAndDrop()`: drag restricted to active card only (non-active cards are inert, touch scrolling works normally). Added auto-scroll when finger is within 90px of top/bottom screen edge. Uses document-relative midpoints so drop calculation stays accurate during scroll. Other cards shift with smooth `translateY` animation to show drop position.
- `src/styles/globals.css` — `.sort-card`: removed `cursor:grab`, added `transition:transform .18s ease` for shift animation. `.sort-card-active`: added `touch-action:none` for iOS drag control. `.sort-card-dragging`: changed from opacity to `visibility:hidden` (original hides, clone is visible). `.sort-card-drag-clone`: added `visibility:visible` override so clone stays visible.

### v4.9.013 — 2026-07-01 (dev — deployed)
**Fix iPad sort-edit-view hidden under bars + dropdown not working when scrolled**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.013
- `src/styles/globals.css` — Fixed CSS cascade bug: iPad/iPhone `.sort-edit-view` overrides (padding-top) were at line 544 but base `padding:0` was at line 933, overriding them. Moved sort-edit-view device overrides AFTER the base sort CSS. Changed `.sort-dropdown` from `position:absolute` to `position:fixed` so viewport coords from getBoundingClientRect work correctly when page is scrolled (fixes dropdown not appearing when toolbar is hidden on iPad).

### v4.9.012 — 2026-06-30 (dev — deployed)
**Revert sync to v4.9.010 baseline + fix Write modal sync**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.012
- `src/lib/accountFlow.ts` — reverted to v4.9.010 sync logic (removed pullNeeded blocking, subscriber rewrite, renderTick tracking, post-pull setTimeout hack from v4.9.011/012 experiments)
- `src/lib/currentProject.ts` — reverted to v4.9.010 sync logic
- `src/lib/actions.ts` — added missing `bumpRenderTick()` after Write modal text save in both main-strip and version-strip (ver/floor/refs) paths; text changes now properly trigger Zustand subscriber → IDB save + dirty flag + cloud sync
- `src/lib/syncLog.ts` — temporary sync debug panel (added but unused — no imports)

### v4.9.011 — 2026-06-29 (dev — deployed)
**3x2VIEW default for landscape, broken img fix, syncing overlay on reload**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.012
- `src/lib/view.ts` — autoPhoneMainView() now defaults landscape projects to grid3x2 view; added guard to skip setViewMode when mode is already correct (prevents redundant renders)
- `src/lib/accountFlow.ts` — applyCloudTreeToStore sets currentViewMode to 'grid3x2' for landscape projects (was hardcoded 'both'); added autoPhoneMainView() after applyCloudTreeToStore and project restore; bootstrapAccountSystem shows "Syncing…" overlay during cloud pull on reload (blocks interaction until final state ready, removed 1.5s delay)
- `src/lib/overview.ts` — renderGrid3x2Card MAIN branch: show canvas instead of broken <img> when f.src is empty; all 3 overview render locations fixed
- `src/lib/render.ts` — Both main frame render locations: show canvas instead of broken <img> when f.src is empty
- `src/lib/pdfAdjust.ts` — Added autoPhoneMainView() call after PDF adjustment apply (switches to grid3x2 for landscape projects)

### v4.9.010 — 2026-06-29 (dev — deployed)
**SKETCH/NEEDS quick buttons in 3x2 view, floor prefix f→s, layout tightening**

Changes:
- `src/store/state.ts` — APP_VERSION v4.9.010; floor strip prefix changed from 'f' to 's' (s1, s2, etc.)
- `src/lib/overview.ts` — Added SKETCH/NEEDS quick-access buttons above each frame card in 3x2 view; SKETCH opens fullscreen draw on s1 of floor/sketch strip; NEEDS opens modal overlay at 75vh with needs card; vertical margins changed from 3vw to 2vw; imported openFullscreen, buildNeedsCard, ensureFrameNeeds, ensureStripVersions
- `src/styles/globals.css` — Added .g3-quick-btns/.g3-quick-btn styles (semitransparent, hover reveal on desktop, always visible on touch); added .g3-needs-overlay/.g3-needs-modal styles (bottom-sheet modal); text block reduced from 5 to 3 lines; grid container top padding 2vw

### v4.7.011 — 2026-06-26 (dev — deployed)
**Cross-device sync fixes (idle-wake, focus/blur ordering, delta push, frame guard)**

Changes:
- `src/lib/accountFlow.ts` — Idle-wake pull: detects 10+ seconds of inactivity then safePull on first user interaction (mousemove/touchstart/scroll/keydown/wheel); 5s cooldown prevents rapid-fire. Focus/blur ordering: safePull cancels pending pushes and blocks new ones during pull. versionTags now collected from ALL frames (not just dirty) in partial mode. Metadata-only changes (groups, setups) no longer skip push. Frame count guard prevents frame count decrease without matching tombstones. Setup origin markers cleared in clearCopyTaggedVersions.
- `src/lib/currentProject.ts` — Added cancelPendingPush() export; scheduleSyncPush() blocked during pulls; SYNC_MAX_INTERVAL_MS reduced to 5s for delta payloads.
- `src/lib/setups.ts` — clearCopyTaggedVersions also clears 'origin' markers when frame leaves setup.
- `src/store/state.ts` — APP_VERSION v4.7.011

### v4.6.028 — 2026-06-24 (dev)
**Prevent image loss during cross-device sync**

Changes from v4.6.027:
- `src/lib/accountFlow.ts` — Added `countCurrentImages()` helper counting all non-null images across frames and strip versions; `syncCurrentToServer()` refuses to push if `_pullIncomplete` is true or if image count dropped to 0 from >0; `_lastKnownImageCount` updated after successful push and pull; `applyCloudTreeToStore()` tracks expected vs fetched image count — if any R2 fetch fails, sets `_pullIncomplete=true` and schedules auto-retry in 5s; retry also wired for merge path in `tryPullFromCloud()`
- `src/lib/currentProject.ts` — Added `_pullIncomplete` flag with `setPullIncomplete()`/`isPullIncomplete()` exports; `runAutosave()` blocks IDB snapshot when `_pullIncomplete` is true; `isLoadInFlight()` includes `_pullIncomplete`
- `src/store/state.ts` — APP_VERSION bumped to v4.6.028

Three-layer safeguard:
1. `_pullInFlight` — blocks all saves/syncs during entire pull+image-load window
2. `_pullIncomplete` — blocks saves/syncs when R2 fetches partially fail, auto-retries
3. Image count guard — refuses push if all images vanished unexpectedly

### v4.6.027 — 2026-06-23 (dev)
**Fix iPhone view-bar disappearing on scroll**

Changes from v4.6.022:
- `src/styles/globals.css` — Removed `overflow-x:hidden` and `overflow-x:clip` from `body` (kept only on `html`) in touch device and iPhone media queries to prevent WebKit formatting context issues with `position:sticky`; added `-webkit-sticky` fallback and explicit `background:var(--surface)` to iPhone view-bar rule
- `src/lib/currentProject.ts` — `runAutosave()` blocks IDB snapshot while `_pullInFlight || _projectSwitchInFlight` is true (prevents saving imageless state during cloud pull)
- `src/store/state.ts` — APP_VERSION bumped to v4.6.027

### v4.6.022 — 2026-06-22 (dev + production)
**Loading bar during pull-on-focus sync**

Changes from v4.6.021:
- `src/lib/accountFlow.ts` — `tryPullFromCloud()` now shows progressOverlay ("Syncing…" → "Updating…" → done) during `applyCloudTreeToStore`, covering image download flicker; loading bar hidden during conflict dialog, re-shown for merge/cloud apply; catch block hides overlay on error
- `src/store/state.ts` — APP_VERSION bumped to v4.6.022

### v4.6.021 — 2026-06-22 (dev + production)
**Fix concurrent sync race in saveNow**

Changes from v4.6.020:
- `src/lib/accountFlow.ts` — `saveNow()` now wraps `syncCurrentToServer` with `setCloudSyncInFlight(true/false)` to prevent 5-second `runCloudSync` interval from firing a concurrent sync during image uploads (caused 409 conflict → "Something went wrong"); `startNewProject()` resets `lastKnownUpdatedAt = null` so new projects don't carry stale timestamps; removed duplicate zero-frame guard from accidental sed double-insert
- `src/lib/currentProject.ts` — Added `setCloudSyncInFlight()` export so `saveNow` can block background sync
- `src/store/state.ts` — APP_VERSION bumped to v4.6.021

### v4.6.020 — 2026-06-19 (dev)
**Strip tag polish — click fix, TAG text, overlay redesign**

Changes from v4.6.017:
- `src/lib/init.ts` — Added document-level delegated click handler for `[data-striptag-fid]` (fixes strip tag pill not triggering when canvas has image content); imported `handleStripTagClick` from setups
- `src/lib/setups.ts` — Exported `handleStripTagClick`; empty pill now shows "TAG" text
- `src/lib/render.ts` — Removed `wireStripTagClicks` import and call (delegation in init.ts handles it)
- `src/styles/globals.css` — `.strip-tag-empty` color changed from transparent to `#fff` (shows TAG text); `.strip-tag-overlay-box` background → transparent, border → none (matches rotate-screen style); `.strip-tag-overlay-desc` margin-top 0 → 16px (gap between sentences)
- `src/store/state.ts` — APP_VERSION bumped through v4.6.018→019→020

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

## COMPLETED: "Never Empty" Sync Architecture (done as of v4.7.011)

All items implemented and deployed:
- r2Key tracking on Frame + Version (diff-based pull skips unchanged images)
- Diff-and-patch pull (applyCloudTreeToStore compares r2Keys, never wipes images)
- Tombstones (deleted frames/versions tracked and synced, filtered on pull)
- Delta push (fingerprint-based, only changed frames sent)
- Safety guards kept as belt-and-suspenders: image count guard, frame count guard, _pullIncomplete flag

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
