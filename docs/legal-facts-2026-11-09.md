# Framehow — Legal / privacy facts sheet, 9 November 2026

For: Roman Valent, Tinge Films s.r.o., Prague — Terms of Service, Privacy Policy, GDPR documentation.
Method: every statement below was verified in the code and configuration as it stands on 9 Nov 2026 (after the fixes that landed today: failed upload fails the save; analytics sign-in cookie; `/track` whitelist; account restore by signing in; library delete asks twice). `docs/audit-launch-2026-11-09.md` was used as the starting point and re-checked. Where a fact is not in the repository it is marked **UNKNOWN** — look in the Cloudflare dashboard or ask the provider. Environment variables are named, never their values.

Paths are relative to the project root. `backend/` = the Cloudflare Worker `framehow-api`; `src/` = the web app; `ios/` = the Capacitor shell; `site/` = the website.

---

## 1. HOSTING / CLOUDFLARE SERVICES

Three deployables, all on Cloudflare:

| Deployable | Cloudflare product | Config | What it does |
|---|---|---|---|
| `framehow-api` | **Workers** (Paid plan, per `backend/src/lib/email.ts` comment) | `backend/wrangler.toml` | The whole backend: auth, projects, sync, upload, image serving, analytics, admin pages, nightly cron |
| App at `framehow.com/app` | **Pages** (project `framehow-react`, also `dev.framehow-react.pages.dev`) | `vite.config.ts`, `public/_headers`, `scripts/postbuild.mjs` (`_redirects`) | Static files of the web app only; no server code |
| Website `framehow.com/`, `/terms`, `/privacy`, `/imprint`, `/img/*` | **Workers with static assets** (`framehow-site`, "a Worker made of files and nothing else: no code, no bindings") | `site/wrangler.toml` | Static HTML/images only |

Bindings of `framehow-api` (`backend/wrangler.toml`):
- **D1** — binding `DB`, database `framehow-db`: all structured user data (section 2).
- **R2** — binding `IMAGES_BUCKET`, bucket `framehow-storage`: pictures and previews (section 3).
- **Email Sending** (`[[send_email]] name = "EMAIL"`): outgoing transactional mail (section 8).
- **Cron trigger** `0 3 * * *` (03:00 UTC daily): purge of expired projects and accounts, dead-file cleaner, storage recount, admin mail (`backend/src/index.ts`).
- **Vars** (non-secret): `APP_NAME`, `APP_URL`, `APP_URLS`, `GLOBAL_STORAGE_LIMIT_GB`, `STORAGE_LIMIT_MB`, `SESSION_TTL_DAYS`, `PASSWORD_RESET_TTL_HOURS`, `EMAIL_VERIFY_TTL_HOURS`, `ADMIN_EMAIL`.
- **Secrets**: `ADMIN_API_TOKEN` (admin pages). `EMAIL_API_KEY`, `EMAIL_FROM` are declared in `types.ts` as obsolete.

NOT used (verified: no binding in either wrangler.toml, no code): KV, Durable Objects, Cloudflare Images, Queues, Turnstile, Cloudflare Access, Workers Analytics Engine, Logpush (config is dashboard-side → UNKNOWN whether enabled). Cloudflare's own request analytics/WAF/rate limiting are dashboard features → UNKNOWN.

The API is reached by the app at `https://framehow-api.roman-cbd.workers.dev` (`src/lib/api.ts`, overridable with `VITE_API_BASE_URL`). The iOS shell loads the web app from `https://dev.framehow-react.pages.dev/app/` today (`capacitor.config.ts`; LAUNCH C1 switches it to `framehow.com/app`).

## 2. DATABASE (D1)

- Binding `DB`, name `framehow-db`, migrations in `backend/migrations/` (`backend/wrangler.toml`).
- Location / jurisdiction / read replication: **UNKNOWN** — no `location_hint`, jurisdiction or replication setting in any config file; D1 placement is chosen at creation in the dashboard.
- Categories of personal/user data stored (from the migrations 0001–0031 and the routes that fill them):

| Table | Contents |
|---|---|
| `users` | id, **name, e-mail, profession (optional)**, password hash (PBKDF2), email_verified flag, e-mail-verification token hash + expiry, `terms_agreed_at`, `preferences` (JSON of the user's default names, ≤ 8 KB), created/updated/deleted timestamps |
| `sessions` | session id, user id, **token hash only**, `device_info` = **full User-Agent string** of the signing-in browser (`routes/auth.ts`), expiry |
| `password_resets` | token hash, expiry, used_at (rows are never swept except on admin set-password) |
| `projects` | **project name**, timestamps, soft-delete `deleted_at`, `metadata` (JSON: export header fields, camera aspect etc.), `last_device_id`/`last_device_name` and `heartbeat_*` (device id = random UUID from `localStorage fh_device_id`; device name = "Phone"/"Tablet"/"Desktop" derived from the User-Agent, `src/lib/accountFlow.ts`), `restored_snapshot_id` |
| `strips`, `frames`, `versions` | the storyboard structure: **shot labels, free text (`text_content`), tables (`table_data`), notes, scribbles (JSON strokes), needs/notes state, setup ids, tags**, hidden/starred flags, timestamps, `changed_offline` |
| `images` | version → **R2 key**, width, height, size, content type, `deleted_at` (library delete) |
| `drawings` | **drawing strokes as JSON** (≤ 1 MB each) per version |
| `project_settings` | per-item project settings (strip names, needs definitions, sort orders, groups, setups…) as JSON |
| `project_snapshots` | **whole project tree as JSON** (restore points, section 15) incl. all text/drawings and R2 key references |
| `project_deletions` | tombstones (deleted frame/version ids, device id, time) — **never swept** while the project lives (comment says 30 days; no sweep exists) |
| `frame_conflicts`, `setting_conflicts` | losing side of a two-device conflict as JSON, device names |
| `analytics_events`, `analytics_sessions` | section 11 — event name, session id, device class, browser family, PWA flag, **country (from `cf-ipcountry`)**, user id, small JSON meta (can include **project names**) |
| `storage_totals` | running byte totals per account/scope |
| `deleted_pictures` | R2 keys deleted in the library, per user, so they cannot be re-attached |
| `project_members` | exists in the schema, **unused** (collaboration not implemented) |

Not stored: raw IP addresses (no `CF-Connecting-IP`/`X-Forwarded-For` read anywhere in `backend/src`), plaintext passwords, plaintext session/reset/verification tokens, payment data, location data.

## 3. IMAGE / FILE STORAGE (R2)

- Binding `IMAGES_BUCKET`, bucket `framehow-storage` (`backend/wrangler.toml`). Jurisdiction: **UNKNOWN** — not in config; check the bucket's settings in the dashboard (R2 jurisdiction is fixed at bucket creation).
- Object key layout: `users/<userId>/<uuid>.<ext>` for pictures; `users/<userId>/thumbs/<file>.jpg` for library previews (`backend/src/routes/upload.ts`, `lib/cleaner.ts`). Each object carries `customMetadata.user_id` and the HTTP content type.
- Accepted picture types at `POST /upload`: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/heic`, `image/heif`; ≤ 10 MB; type is taken from the `Content-Type` header, not sniffed. Previews at `PUT /thumbs/*`: `image/jpeg` only, ≤ 200 KB.
- Nothing else is stored in R2: no PDFs, no exports, no drawings (drawings are JSON in D1), no backups.
- **PDFs are never uploaded.** PDF import runs entirely in the browser (`pdfjs-dist`, `src/lib/pdf.ts`); only the extracted page images (PNG data URLs rendered from canvas) end up as pictures on cards and are then uploaded like any picture. The server has no PDF route and `application/pdf` is not an accepted upload type.
- Bucket is private: no public bucket URL, no signed URLs; objects are served only through the authenticated `GET /images/*` (ownership checked against an image row of the caller's live project) and `GET /thumbs/*` (key must start with `users/<me>/`), with `Cache-Control: private`.

## 4. LOCAL DEVICE STORAGE

**IndexedDB** (origin-scoped: `framehow.com` / `dev.framehow-react.pages.dev`; the iOS shell is the same web origin):
- DB `framehow`, store `state`, key `currentProject`: the whole open project (frames, versions, **pictures as base64 data URLs**, drawings, notes, dirty-frame ids, pushed fingerprints, pending tombstones) — autosaved 2 s after every change (`src/lib/persistence.ts`, `currentProject.ts`).
- DB `framehow`, store `pending`: one record per project with unsent work (full copy incl. pictures); after a successful upload the record is archived (`archive:<key>:<time>`, max 3 per project) and swept after 24 h (older copies) / 72 h (newest copy); user-deleted device copies are swept 24 h after `deletedAt` (`persistence.ts`).
- DB `framehow-picts`, store `previews`: library previews (512 px JPEG bytes, fingerprint, R2 key, label "project – shot – version") (`src/lib/pictsStore.ts`).
- `navigator.storage.persist()` is requested at boot.

**localStorage keys** (`src/lib/*`):
- `fh_session_token` — **the Bearer session token in plaintext**; `fh_session_user` — JSON of id, name, e-mail, profession, preferences (`session.ts`).
- `fh_device_id` — random UUID identifying this browser to the sync (`accountFlow.ts`).
- `fh_default_names` — user's default strip/column names (`userDefaults.ts`); `fh_camFramelineLater` (`camMode.ts`); `fh_resort_note_off` and per-shooting-order mark lists (`sortOrder.ts`); `pdfAdjustRects_<projectId>_<file>` / `pdfAdjustLastFile_<projectId>` — PDF adjust rectangles and the last imported PDF **file name** (`pdfAdjust.ts`); `fh_sync_log`, `fh_debug` (debug switches, `syncTrace.ts`); `fh_test` (test hook).
- **sessionStorage** `fh_sid` — analytics session id (random, per tab session) (`tracking.ts`).

**Cache Storage / service worker** (`public/sw.js`, filled by `scripts/postbuild.mjs`): pre-caches the app shell, icons, manifest, all hashed JS/CSS bundles and the pdf.js worker; runtime-caches same-origin GET responses (network-first). The API lives on a different origin, so **no API answers or pictures are cached by the service worker**. `sw.js` itself is served `no-store` (`public/_headers`).

**File System APIs**: none. Files enter only via `<input type="file">` (single pictures, folder import via `webkitdirectory`-style multi-select) and drag-and-drop; the app never writes to the device file system except through downloads / the share sheet (section 18).

**Capacitor shell**: no native storage plugin; all data lives in the WKWebView's web storage for the loaded origin. Native camera plugin hands the JPEG to JS; nothing is written to Photos unless the user shares to it (Info.plist declares camera and photo-library usage strings).

**On logout** (`accountFlow.ts` logoutBtn → `session.logout`, `clearCurrentProject`): server session row deleted; `fh_session_token` and `fh_session_user` removed; in-memory store reset; the `currentProject` IDB record deleted. **Kept on the device**: `pending`/archive copies of unsent or recently sent projects (with pictures), `framehow-picts` previews, `fh_device_id`, all other localStorage keys, the service-worker cache. (Audit 3.9 — still true.)

**On account deletion in the app** (`deleteBtn` → `DELETE /user/me`): same local clearing as logout; the same local remnants stay. Nothing on the server deletes anything on devices.

## 5. ENCRYPTION / TRANSPORT

Three distinct things:

1. **In transit (TLS/HTTPS)** — yes, everywhere in production. All production URLs are `https://` (`APP_URL`, `APP_URLS` first entry, `API_BASE_URL`, `server.url` with `cleartext: false`, Google Fonts, jsDelivr). CORS refuses non-HTTPS origins except `localhost`/`127.0.0.1` (`backend/src/cors.ts`); `http://127.0.0.1:5173/app` in `APP_URLS` is the local dev/test address only. No unencrypted transmission of user data exists in production code. Analytics beacons (`sendBeacon`) also go to the HTTPS API.
2. **At rest on Cloudflare** — Cloudflare documents D1 and R2 as encrypted at rest by default (provider statement). **UNKNOWN from the repository**; nothing in the code configures or verifies it. Cite as Cloudflare's documented default.
3. **Application-level / end-to-end encryption** — **none**. Pictures, text, drawings and names are stored as the server receives them; the server (and therefore an administrator, section 6) can read them. Only passwords and tokens are hashed (section 7). No client-side encryption, no customer-managed keys.

## 6. ADMINISTRATOR ACCESS

Anyone with the Cloudflare account (dashboard, API token, or `wrangler` with the account's credentials) can read and change everything:
- **D1 rows**: names, e-mails, professions, password hashes, session token hashes with User-Agents, project names, every shot label/text/table/note/scribble, drawings (JSON), restore points (complete project trees), conflict copies, analytics events with country and project names, device ids/names.
- **R2 objects**: every photograph and preview of every user, by key.
- Worker logs (section 17), secrets (`ADMIN_API_TOKEN`), vars, cron runs, deploy history.

In-app admin pages (`backend/src/routes/analytics.ts`, behind the `fh_admin` cookie or `Authorization: Bearer <ADMIN_API_TOKEN>`):
- `/analytics` dashboard: totals, recent sessions (user name/e-mail, device, browser, country), top events, recent events with meta, top users.
- `/analytics/users-list`, `/device-users`, `/browser-mobile`: **all users with name, e-mail, profession, created date, sessions, devices/browsers**.
- `/analytics/user/:uid`: one user's sessions and events; `/analytics/session/:sid`: one session's timeline (event + meta).
- `/analytics/projects`: **all project names** with orientation and owner name/e-mail.
- `/analytics/storage`: per-account storage used/limit, totals, "Recount now"; `/analytics/dead-pictures` + delete button.
- `/analytics/deleted-users` + **`POST /analytics/restore-account`** (undo an account deletion within 7 days).
- **`POST /analytics/set-password`**: generates a new password for any account, shows it once in the browser, deletes all that user's sessions and reset links. This is a full account-takeover capability by design (support path).
- `/admin/cleanup/expired-projects` (run the purge), `/admin/cleanup/preview`.
- Admin mails to `ADMIN_EMAIL` carry total storage and the first 8 characters of the five largest account ids (`lib/totals.ts`).
- No audit trail beyond `console.log` lines (e.g. "new password set by hand for <id>", "account <id> brought back").

## 7. AUTHENTICATION

- **E-mail + password** only. Name required, profession optional, `terms_agreed_at` recorded at sign-up (`backend/src/routes/auth.ts`). No OAuth/Apple/Google sign-in, no 2FA.
- Password rules: 8–200 characters, no other policy.
- **Hashing**: own implementation on Web Crypto — **PBKDF2-SHA256, 100 000 iterations, 16-byte random salt, 32-byte key**, stored as `pbkdf2$<iter>$<salt>$<hash>` in `users.password_hash`; constant-time compare (`backend/src/lib/crypto.ts`). Login runs the hash even for unknown e-mails (anti-enumeration timing).
- **Sessions**: opaque 32-byte random token; D1 stores **only its SHA-256 hash** plus `device_info` = User-Agent. TTL `SESSION_TTL_DAYS` = 30 days, **sliding** — renewed for another 30 days on any request past the halfway mark (`lib/auth.ts`). Expired rows are not swept (comment: "cheap to leave"). Logout deletes the row; password change deletes other sessions; reset/admin set-password deletes all.
- **Transport of the token**: `Authorization: Bearer` header; stored client-side in `localStorage.fh_session_token`. **No authentication cookies** for users.
- **E-mail verification**: a token hash + expiry (`EMAIL_VERIFY_TTL_HOURS` = 48) is written at sign-up and `GET /auth/verify-email` exists, but **no verification mail is ever sent** and nothing requires `email_verified` — the account is fully usable at once (`lib/email.ts` footer comment, Roman's decision 22 Sept). The verification token is echoed in the sign-up response as `dev_token` whenever `EMAIL_API_KEY` is unset (audit 3.5 — unchanged).
- **Password reset**: `POST /auth/forgot-password` always answers OK; token hashed, single-use, TTL `PASSWORD_RESET_TTL_HOURS` = 1 h; link `${APP}/?reset=<token>` built only from addresses in `APP_URLS`. Reset signs the resetting device in and signs all others out.
- **Deleted account + sign-in**: within 7 days of `deleted_at`, a correct password restores the account and the projects deleted with it (`restored: true`); after 7 days the login is refused as invalid credentials even if the row still exists until the 03:00 sweep (`routes/auth.ts`, new 9 Nov).
- Rate limiting: **none in code** (section 19).

## 8. EMAIL

- Provider: **Cloudflare Email Sending** via the Worker binding `EMAIL` (`[[send_email]]` in `backend/wrangler.toml`; `env.EMAIL.send(...)` in `backend/src/lib/email.ts`). No API key, no Resend/Mailgun/MailChannels/SendGrid code anywhere (the `EMAIL_API_KEY` secret is a leftover, documented as obsolete in `types.ts`).
- From: `Framehow <info@framehow.com>`; plain text only; signed "Framehow".
- Mails that exist: **Welcome** (at sign-up, awaited inline), **Your Framehow password** (reset link, 1 h), **admin storage mails** to `ADMIN_EMAIL` (nightly report; step alerts at 8 GB, 9 GB, then every 250 MB). No verification mail, no deletion confirmation, no notifications.
- Failure handling: every send error is logged and swallowed; the user action succeeds regardless.
- **Newsletter / marketing / consent code: none** (no match for newsletter, marketing or consent in `src/`, `backend/src/`, `site/public/`). The only consent captured is the Terms tick box at sign-up (`terms_agreed_at`).
- Logging: `[email] sent to=<address> subject=...` and failures with the address are written to the Worker log on every send (section 17).

## 9. THIRD-PARTY SERVICES / SUBPROCESSORS

Hosts that user data or identifiers reach at runtime (verified by grepping every `http(s)://` in `src/`, `backend/src/`, `site/public/`, `index.html`):

| Recipient | What reaches it | Where |
|---|---|---|
| **Cloudflare** (Workers, Pages, D1, R2, Email Sending, DNS/TLS) | Everything: all requests with IP/headers, all stored data, outgoing mail content and recipient addresses | whole stack |
| **Google Fonts** (`fonts.googleapis.com` → `fonts.gstatic.com`) | Client IP, User-Agent, Referer of every app load (CSS `@import` of DM Sans / DM Mono) | `src/styles/globals.css:1`, `globals_v3.4.css:1` |
| **jsDelivr CDN** (`cdn.jsdelivr.net`) | Client IP/UA when a PDF import runs OCR: tesseract.js worker and WASM core are loaded from the CDN at runtime | `src/lib/pdf.ts`, `src/lib/pdfAdjust.ts` (`workerPath`, `corePath`) |
| tesseract.js language data host | `langPath` is not set, so tesseract.js v5 fetches `eng.traineddata` from its library default remote host (projectnaptha tessdata CDN) — client IP only; **confirm the default for the installed version** | same |
| **Apple** | Distribution of the iOS shell via App Store / TestFlight; Apple's own crash/usage data per the user's iOS settings; the shell itself sends nothing to Apple from Framehow code | `ios/`, `capacitor.config.ts` |

What is **not** transmitted to any third party: pictures, text, drawings, names, e-mails — OCR and PDF rendering run locally (WASM in the browser); only the library code is fetched from the CDN.

Verified absent: Stripe, Sentry, PostHog, Google Analytics/gtag, Meta pixel, Hotjar, OpenAI, Anthropic, any AI API, any CDN `<script>` tag in `index.html` or `site/public/*.html`. Analytics is the app's own `/track` only (section 11). Payments: none (LAUNCH E: "Stripe on the web" is a future plan).

## 10. AI / OCR / FRAME EXTRACTION

- **PDF import** (`src/lib/pdf.ts`, `pdfAdjust.ts`): `pdfjs-dist` renders each page to a canvas in the browser; image regions, text areas and label numbers are found by **pixel heuristics on the canvas** (`getImageData`, edge/contrast scans, grid detection, fingerprinting with an 8×8 grayscale hash) — rule-based code, no model, no server. The user can adjust rectangles in the Adjust tool; rectangles are kept in localStorage.
- **OCR: yes — tesseract.js** (`createWorker('eng', ...)`) is used to read shot text/labels from detected text regions when the PDF has no text layer. It runs **in the browser as WebAssembly**; the image crops never leave the device. The worker/core scripts come from jsDelivr and language data from tesseract.js's default host (section 9), so offline OCR is not available and those hosts see the client's IP.
- **External AI / generative AI: none.** No LLM, vision or image-generation API, no server-side processing of pictures (the Worker only stores and serves bytes).
- Previews (library thumbnails, 512 px) and 2400 px shrinking are canvas operations in the browser.

## 11. COOKIES / TRACKING / ANALYTICS

**Cookies**
- For users: **none**. The app uses Bearer tokens in localStorage; the Pages site and the website set no cookies in code.
- Admin only: `fh_admin` — set by `POST /analytics/login` after the admin password is typed; value = SHA-256 of a salted `ADMIN_API_TOKEN` (never the token); **`HttpOnly; Secure; SameSite=Strict; Path=/analytics; Max-Age=2592000` (30 days)**; cleared by `/analytics/logout` (`backend/src/routes/analytics.ts`). Strictly necessary for the admin function; never set on a user's browser.

**Strictly necessary storage** (no consent question under ePrivacy): session token and user record, device id, IndexedDB project data, service-worker cache, preferences, PDF-adjust rectangles (section 4).

**First-party analytics** (`src/lib/tracking.ts` → `POST /track`, `backend/src/routes/analytics.ts`), no consent banner today:
- Fields: `event` (whitelisted names such as `app_opened`, `heartbeat` every 2 min while visible, `signup` with `profession`, `login`, `project_opened`/`project_created` **with the project name in `meta`**, `project_saved`, `photo_taken`, `camera_opened`, `pdf_loaded`, `draw_used`/`write_used` with strip, `images_loaded`, `start_*`, `view_*`, `export_*`, `signpost_choice`), `sid` (random id in sessionStorage, per tab session), `device` (phone/tablet/desktop from screen size and touch), `browser` (family from UA), `pwa` flag, `uid` (user id when signed in), `meta` (≤ 600 bytes).
- Server adds `country` from the `cf-ipcountry` header. **No IP address, no full User-Agent** is stored here. Input is validated with regexes and length caps (9 Nov).
- Stored in `analytics_events` and `analytics_sessions` for ever; rows with the user's `uid` are deleted when the account is erased after 7 days; **anonymous pre-login rows (by `sid` only) are kept**.
- Purpose/use: the admin dashboard (section 6). No third-party analytics.
- **Fingerprinting**: none. `sid` is random per tab session; `fh_device_id` is a random UUID (not derived from hardware); the "fingerprints" in the sync code are content hashes of frames/pictures for change detection, not device fingerprints.
- **Crash / error monitoring**: none (only `console.*` and the on-device sync trace, section 17).
- **Third-party scripts**: none; third-party *resources*: Google Fonts CSS/fonts, jsDelivr tesseract files (section 9).

## 12. STORAGE LIMIT

Verified against `backend/wrangler.toml`, `backend/src/routes/upload.ts`, `routes/projects.ts`, `lib/storage.ts`, `lib/totals.ts`, `src/lib/storageMeter.ts`:
- **Per account: 500 MB** (`STORAGE_LIMIT_MB = "500"`; code default 350 if unset). Counted at the upload door from the running total of **every object under `users/<id>/`** (pictures of live and recently deleted projects, dead files until the cleaner removes them, previews). The figure the app shows (`storageFigure`) sums image rows of **live projects** + previews — it can be lower than what the door counts (audit 2.3, unchanged).
- **Per picture: 10 MB** (`MAX_IMAGE_BYTES`), checked on `Content-Length` and on the buffered body → `413 image_too_large`. Previews ≤ 200 KB.
- **Global ceiling: 50 GB** (`GLOBAL_STORAGE_LIMIT_GB = "50"`) → `413 storage_full` "Framehow's storage is full for the moment".
- **Notices at 80 / 90 / 95 %**: once per step, re-armed only after usage falls below 80 % (`storageMeter.ts`). The OPEN modal shows "Storage X of Y MB · N %" (red from 80 %).
- **At 100 %**: `POST /upload` refuses with `413 storage_full` (also `PUT /thumbs` and the sync `POST /projects/:id/sync` when incoming + other projects' bytes exceed the limit). The app stops pushing (`storageFullFromServer`), the work stays on the device as a pending copy and is pushed when space is freed (`onStorageFreed`, retry machinery).
- **Quota release**: the running totals (`storage_totals`) are decremented **immediately** by Delete now (`deleteProjectForGood → addBytes(-bytes)`), library delete (`deletePictures`, sized by `bucket.head`) and the nightly dead-file cleaner. The ordinary project Delete (7-day window) frees quota only when the cron purges the project (day 7–8) — until then the files still count at the upload door, although the app's displayed figure already excludes them. Every night at 03:00 UTC `recalibrate` lists the bucket and overwrites all totals with the exact figures.
- Differences from the intended wording: project size on delete is taken from client-supplied `size_bytes` rows (audit 2.1 — unchanged); parallel uploads can overshoot the wall by up to N × 10 MB until the recount (audit 1.6 — unchanged).

## 13. IMAGE RESIZING, ORIGINALS, EXIF/GPS

- **Camera paths** (web FH CAM / PHONE CAM and native): long side **2400 px**, aspect preserved, JPEG. Web: `shrinkForSaving` draws to a canvas and `toDataURL('image/jpeg', 0.9)` (`src/lib/camMode.ts`); phone photos are decoded with `createImageBitmap(..., imageOrientation: 'from-image')`. Native iOS: `CameraModel.maxSide = 2400`, CoreImage crop/resize, `CIContext.jpegRepresentation` quality 0.92, Display P3, HDR gain map attached on iOS 18+ (`ios/App/App/FramehowCamera/CameraModel.swift`).
- **File import paths (LOAD picture, folder import, drag-and-drop)**: **NOT resized.** `FileReader.readAsDataURL` stores the file bytes unchanged as the card's picture (`src/lib/loadPictures.ts`, `src/lib/files.ts`), and that data URL is what `uploadImageToR2` sends (`accountFlow.ts`). So for imported files **the original full-resolution file, including its EXIF/GPS metadata, is uploaded and stored** (subject to the 10 MB cap and the accepted content types). PDF-extracted pictures are canvas PNGs (no EXIF).
- **EXIF on the web camera path**: canvas re-encoding produces a new JPEG without the source's EXIF — **GPS and camera metadata are stripped**. (The browser's `getUserMedia` frames carry no EXIF anyway.)
- **EXIF on the native path**: the JPEG is produced by `CIContext.jpegRepresentation(of:colorSpace:options:)` from a `CIImage` created from the `AVCapturePhoto` file data; no `kCGImagePropertyGPSDictionary` or other metadata dictionary is passed and no location is requested (Info.plist has camera and photo-library strings only, **no location usage string**, no CoreLocation code) — so **no GPS can be present**. Whether CoreImage carries the capture's own EXIF (make/model/exposure) through the crop/resize into the output file is **UNKNOWN** from the code (CoreImage may propagate `CIImage.properties`); if it matters, verify a sample JPEG or clear `properties` explicitly.
- Library previews: 512 px JPEG made on the device; `/thumbs` on the server.

## 14. DELETION — real behaviour

Verified in `backend/src/routes/projects.ts`, `user.ts`, `cleanup.ts`, `auth.ts`, `lib/storage.ts`, `lib/cleaner.ts`, `src/lib/picts.ts`, `src/lib/accountFlow.ts`. The cron runs once a day at **03:00 UTC**; "7 days" therefore means "the first 03:00 UTC run more than 7 × 24 h after the deletion" → between 7 and 8 days.

| | What | Server rows | Files in R2 | Recovery |
|---|---|---|---|---|
| **A. Project — Delete** | `DELETE /projects/:id` sets `deleted_at` (soft) | Purged by cron on day 7–8 (`purgeExpiredProjects → deleteProjectForGood`, cascade to strips/frames/versions/images/drawings/snapshots/settings/conflicts; tombstones deleted explicitly) | Deleted at the same moment, unless another project or a live project's restore point of the same user names the key (then kept) | User: "Recover" in the project list within the window (`POST /projects/:id/recover`) |
| **B. Project — Delete now** | `DELETE /projects/:id/now` | Immediately | Immediately (same "named elsewhere" exception) | None |
| **C. Shot / version deleted; picture replaced on a card** | Tombstone in the sync payload → `DELETE FROM frames/versions/images/drawings` at once; replaced picture = row updated to the new key | Hard, immediately; tombstone row kept (never swept while the project exists) | File stays only while a restore point names it: automatic points are thinned and **all non-saved points are deleted after 48 h**; projects whose tree exceeds 900 KB get **no automatic points at all**; the nightly cleaner deletes any file no row and no restore point names once it is ≥ 24 h old → typically gone 2–3 days after the deletion (or the next night for large projects) | Whole-project restore to a point (section 15) within that window; device archive copy 24–72 h |
| **D. Picture — library Delete** | `POST /user/pictures/delete` (app asks **twice**, both default No, states MB freed — `src/lib/picts.ts`) | `images.deleted_at` set, `size_bytes = 0`; `deleted_pictures` row kept **for ever** (until account erase) so no offline device can re-attach it | **File and preview deleted immediately**; totals decremented | None; cards keep text/drawings and say "You deleted this picture"; a restore point naming the key yields a card whose picture 404s |
| **E. Account** | `DELETE /user/me`: `users.deleted_at` set, all live projects soft-deleted with the same timestamp, **all sessions deleted at once** | Cron on day 7–8 (`purgeDeletedAccounts`): every project for good, then **every object under `users/<id>/`**, `analytics_events`/`analytics_sessions` with that `uid`, `storage_totals`, `deleted_pictures`, then the `users` row (cascade: sessions, password_resets, project_members) | With the account, day 7–8 | **Signing in with the correct password within 7 days restores account + the projects deleted with it** (new 9 Nov); admin "restore account" page likewise. E-mail stays reserved meanwhile (sign-up refused with "deleted recently") |

Quota: B and D free the running total immediately; A and E free it at the purge; the dead-file cleaner frees it nightly.

Technical exceptions / what remains:
- Tombstone rows (`project_deletions`) for deleted shots/versions stay as long as the project exists.
- `deleted_pictures` keys stay until the account is erased.
- Anonymous analytics rows (no `uid`) are never deleted; analytics rows of a live user are kept indefinitely.
- Restore points marked `saved` are kept until the user deletes them (or the project goes); they contain the whole project text and reference picture keys and keep those files alive.
- Conflict copies (`frame_conflicts`, `setting_conflicts`) hold the losing side's content until the project is purged.
- Worker logs mention e-mail addresses, user ids, project ids/names (section 17) for Cloudflare's retention period (UNKNOWN).
- Device copies: `currentProject` is overwritten/cleared when another project opens or on logout; pending/archive copies are swept 24–72 h after upload; previews in `framehow-picts` are not cleared on logout/deletion.
- D1 Time Travel (section 16) may retain deleted rows platform-side for up to 30 days.
- Not implemented: "inactive accounts are deleted" (no such code), any deletion of a user's sessions on inactivity (expired rows stay).

## 15. RESTORE POINTS

- Table `project_snapshots` (`backend/migrations/0010`, `0014`, `0016`, `0027`): `tree_json` = the entire project tree (strips, frames, versions, image rows with **R2 keys**, drawings, settings, metadata) as a D1 TEXT value, `created_at`, `reason` (`auto` | `pre_restore` | `offline` | `saved`), `label`, `continued_at`.
- References, not copies: pictures are referenced by key; no bytes are duplicated in R2.
- Creation: `auto` before a sync push if the last point is ≥ 10 min old (`maybeCreateSnapshot`); `pre_restore` before every restore and on request; `offline` ("where you left off") and `saved` (user-named) via `POST /projects/:id/snapshots`. Empty projects and trees > **900 000 bytes** get no point (`MAX_SNAPSHOT_BYTES`; the restore still proceeds without the pre-restore point — audit 1.2, unchanged).
- Thinning (`thinSnapshots`, run after each auto point and after a restore): keep all ≤ 1 h; one per hour for 1–4 h; one for 4–12 h; one for 12–24 h; one "yesterday" > 24 h; **everything not `saved` and older than 48 h is deleted**. `saved` points are kept until the user deletes them (`DELETE /projects/:id/snapshots/:sid`, `reason = 'saved'` only).
- Restore (`POST /projects/:id/restore/:sid`): replaces the current project content with the point (strips cascade-deleted and re-inserted), removes the matching tombstones.
- Interaction with deletion: the nightly cleaner (`lib/cleaner.ts`) treats any key found in any `tree_json` as **in use**; `keysNamedElsewhere` also keeps a file that a live project's restore point of the same user names when another project is purged. A library delete (section 14 D) removes the file regardless of restore points.

## 16. BACKUPS

- **Framehow operates no backups**: no export cron, no `wrangler d1 export`, no copy of R2 objects, no second bucket, no snapshot of D1 anywhere in `backend/` or `scripts/`. R2 has no object versioning in the repo (and R2 does not offer bucket versioning). Deleted data is not backed up by the application.
- **Redundancy ≠ backup**: Cloudflare replicates D1 and R2 internally for durability (provider feature, protects against hardware loss, not against deletion). 
- **D1 Time Travel**: Cloudflare's point-in-time restore of a D1 database (documented 30 days on the paid plan) is an infrastructure feature usable only by the account holder via `wrangler`/dashboard; it is **not user-restorable** and cannot bring back R2 objects the cleaner deleted. **UNKNOWN** whether it is enabled/used; nothing in the repo references it. If stated at all, state it as a platform feature, not a Framehow backup.
- Restore points (section 15) and device copies (section 4) are the only recovery mechanisms, and both are short-lived unless the user saves a point.
- The current `site/public/privacy.html` line about "temporary backup copies ... normal backup cycle" describes something that does not exist.

## 17. LOGS

- **Worker `console.*` lines** (33 in `backend/src`): e-mail sends and failures **with the recipient address** (`lib/email.ts`), upload refusals with user id and byte counts, storage deletes with **project name and id**, cleaner lines with every deleted key (which contains the user id), account restore/erase with user id, admin set-password with user id, unhandled errors with stack. No request bodies, no passwords, no tokens, no IPs are logged by the code.
- **Retention of Workers logs**: **UNKNOWN** — depends on the plan and whether Workers Logs / Logpush / a tail is configured in the dashboard; nothing in the repo configures it. Cloudflare's own edge request logs (with IPs) are also outside the repo.
- **Analytics tables** in D1: section 11 (country, device class, browser family, user id, project names — no IP, no UA).
- **Sessions table**: full User-Agent per sign-in (section 7).
- **In-app sync trace** (`src/lib/syncTrace.ts`): kept **only in memory on the device** (last 300 lines), shown on screen on dev/local addresses or with `?fhsync=1`; the only outbound path is the user copying it to the clipboard. It is **never sent to the server**.
- **IP addresses**: the Worker stores only `cf-ipcountry` (country code) in analytics; no raw IP anywhere in D1 or R2. Cloudflare sees IPs at the edge (provider processing).

## 18. SHARING / EXPORTS

- Exports are generated **in the browser** (`src/lib/exports.ts`): **PDF** (jsPDF), **PPTX** (pptxgenjs — PowerPoint, not Keynote), **images ZIP** (JSZip); each in landscape, portrait and fitting variants. Delivered as a download (`<a download>`) on desktop or via `navigator.share({files})` (iOS share sheet) on iOS. Nothing is uploaded or generated server-side; the server never sends files other than the user's own pictures to the user's own session.
- Library (PICTS) and MAX view: SHARE via `navigator.share` on touch devices, otherwise DOWNLOAD (`src/lib/picts.ts`, `maxView.ts`) — again device-local.
- **No public share links, no guest links, no collaboration**: no route serves content without a Bearer session; `project_members` is unused; "guest link (view + rate)" is listed as LATER in `TOMORROW.md`.
- Mail from Framehow never carries user content (section 8).

## 19. SECURITY — implemented measures

- Authentication middleware `requireUser` on every user route; Bearer token looked up by hash; expired sessions refused (`backend/src/lib/auth.ts`).
- Per-user ownership on every project route (`loadOwnedProject`, `WHERE user_id = ?`), on `/images/*` (image row of an own live project), on `/thumbs/*` and library delete (key prefix `users/<me>/`), on snapshots/conflicts (`project_id` of an owned project). Not checked: that an `r2_key` in a sync payload starts with `users/<me>/` (audit 3.3, unchanged).
- R2 private; served only through the Worker with `Cache-Control: private`; no public or signed URLs.
- Passwords PBKDF2-SHA256 100 k iterations, random salt, constant-time compare; session/reset/verification tokens stored as SHA-256 hashes; sessions 30 days sliding; reset links 1 h single-use; all sessions dropped on reset/admin set-password.
- HTTPS only in production; CORS allow-list of own hosts (`framehow.com`, `framehow.app`, `*.framehow-react.pages.dev`, `localhost`) with credentials (`backend/src/cors.ts`); mail links only to addresses in `APP_URLS`.
- Admin pages: password sign-in form → `fh_admin` HttpOnly/Secure/SameSite=Strict cookie scoped to `/analytics`, or `Authorization: Bearer`; nothing read from the query string any more; all dynamic output HTML-escaped (`esc()`); `/track` input whitelisted and size-capped. No `Content-Security-Policy` header on `/analytics*` or on the app (`public/_headers` sets only `Cache-Control`).
- CSRF: user API uses Bearer headers, no cookies → not exploitable cross-site; admin POST forms are protected by `SameSite=Strict`.
- XSS: user content in the app is rendered into the user's own DOM; some `innerHTML` with `escapeHtml` in places, some without (self-XSS only — a user sees only their own data). Admin pages escape everything.
- Input limits: name/profession ≤ 120, password 8–200, preferences ≤ 8 KB, drawing ≤ 1 MB, picture ≤ 10 MB, preview ≤ 200 KB, library delete ≤ 500 keys, `/track` meta ≤ 600 bytes.
- Data-loss protections: client refuses to push a project that "looks empty" (`accountFlow.ts`), delta-merge "last line of defence" refuses any merge that would drop a frame without a tombstone (`src/lib/deltaMerge.ts`), pre-restore points, 24 h grace in the cleaner, "named elsewhere" check before deleting files, library delete double confirmation, failed uploads fail the save and are retried (9 Nov).
- **Rate limiting: NONE** in code (sign-up, sign-in, forgot-password mail, `/track`, `/upload`); no captcha/Turnstile. Dashboard WAF rules: UNKNOWN.
- **Audit logging: none** beyond `console.log` lines; no admin action log table.
- Secrets: in Worker secrets, not in the repo; the GitHub PAT in `.git/config` (audit 3.2) is a housekeeping item (LAUNCH F1).

## 20. LEGAL/PRIVACY FACTS THAT CANNOT BE DETERMINED FROM THE CODE

1. **R2 jurisdiction** of bucket `framehow-storage` (default / EU / FedRAMP) — set at creation; check the bucket settings.
2. **D1 location** of `framehow-db` (location hint, where the primary lives) and whether **read replication** is on.
3. **Encryption at rest** — Cloudflare's documented default for D1/R2; not verifiable from the repo.
4. **Workers log retention** and whether Workers Logs, Logpush or any log sink is enabled (logs contain e-mail addresses and ids).
5. **Cloudflare DPA / SCCs** — whether the self-serve DPA is accepted for the account; Cloudflare's sub-processor list applies.
6. **Cloudflare Email Sending** terms (sub-processor status, where mail is relayed from, retention of message metadata); DKIM/SPF status of framehow.com (LAUNCH F2).
7. **Apple** as distributor/processor for the iOS shell (App Store / TestFlight terms, Apple's analytics and crash reporting per device settings) and the account data Apple holds.
8. **Google Fonts** — transfer of client IPs to Google on every app load; consider self-hosting (DM Sans base64 already exists for PDFs in `src/assets/fonts/`).
9. **jsDelivr** and the tesseract.js language-data host — CDN providers seeing client IPs during OCR; confirm the default `langPath` for the installed tesseract.js version; consider bundling.
10. **D1 Time Travel** — whether enabled/used, and the retention on the current plan.
11. **Data residency of Pages** (static assets served from Cloudflare's global edge; no user data) and of Workers execution (runs at the edge nearest the user; D1/R2 location governs storage).
12. **Cloudflare WAF / rate-limiting / Bot Fight Mode / billing alerts** — all dashboard-side.
13. **Edge request logs** held by Cloudflare (IPs, URLs) and their retention — outside the repo.
14. **Workers plan** and any contractual limits (CPU time, request volume) relevant to availability statements.
15. Whether the native camera JPEG carries capture EXIF (make/model/exposure) — verify a sample file (GPS is excluded by the absence of location permission).
16. **Dev environment**: `dev.framehow-react.pages.dev` serves the same backend and the same production database — if testers use it, the Privacy Policy covers it; the admin pages do not distinguish dev from live users.
