# LAUNCH — the one list (9 Nov 2026)
Cross out with ~~strike~~ and the date. Blocks are groups; the RUNNING ORDER is:
1 B3a B3b (done) → A1 → A9 → A11 → A4 → 2 C1, C2, C2b, C3, C4 → 3 B3e (r2_key), A13, A12, B3d, A14, B3c, B3f, A2, A3 →
4 A7 → 5 D1, D2 → 6 A8–A10, D7, submission.
ROMAN IN PARALLEL (no Claude needed): D3 D4 D5 (App Store Connect), D8 decision, A5 text,
D7 video + Fitting page text, F1 new token.

## A. Code — the app itself
- [x] A1 (9 Nov, v5.0.172) Busy page after the shutter: own push comes back as "remote is newer" and redraws all cards → recognise own push, skip redraw (bench test first)
- [ ] A2 Library preview is made from the live frame → remake from the real photo when it lands
- [ ] A3 Version strip's own card in landscape after a shot — check
- [x] A4 (9 Nov, v5.0.176) Library permanent delete: second confirmation, text says "cannot be undone, frees X MB"
- [ ] A5 Welcome mail text reviewed (today: 4 plain lines) — Roman's wording
- [ ] A6 "Free during launch — paid plans later" line in the account box; `plan` field on the account (free), no billing code
- [ ] A7 Fitting as its own app: build flag, second bundle id (com.framehow.fitting), Fitting build hides the rest
- [ ] A8 Long simulator test (plan in TOMORROW.md) + the faults it finds
- [x] A9 (9 Nov, v5.0.173, test 55) HIGH: a picture added while a push is in flight can be lost (test 33 red in runs 581/582: 3 uploads in 0.1 s, server keeps 2) — upload queue; also write-then-pull race (BIG DAY part 3), BIG DAY 7 timing red
- [x] A11 (9 Nov, v5.0.174) Account deletion: sign in again within 7 days = restored; app text says 7 days (today admin-only, text says cannot be undone)
- [x] A12 (9 Nov, v5.0.178, test 56) HIGH (privacy): pictures from LOAD / folder / drag-drop are stored as the original file, EXIF+GPS included → resize to 2400 and re-encode (strips EXIF) like the camera paths
- [x] A13a (9 Nov, v5.0.177) Remove the admin Set-password button
- [ ] A13b Logout keeps unsent copies but clears project cache + previews; account deletion wipes everything local
- [ ] A14 Self-host the Google Fonts (one subprocessor less); note OCR CDN loads in the Privacy text
- [ ] A10 F4 island overlap · reload-on-new-version rule · "tell phone users about the desktop"

## B. Audit (report first, no code) — running in the background from 9 Nov
- [x] B1 (report 9 Nov: docs/audit-launch-2026-11-09.md) Security & storage audit (Roman's prompt): offline photos, quota, access control, abuse, recovery/GDPR — graded report in docs/
- [x] B2 (in the report, §5 table) Deletion inventory: which deletes are soft (7 days) / hard, when R2 objects really go, backups/versions, account deletion — facts for the Terms
- [x] B3a CRITICAL: a failed picture upload fails the save and is retried (9 Nov, test 54) 
- [x] B3b HIGH: analytics page — sign-in form + cookie, token out of the URL, /track whitelist, output escaped (9 Nov) 
- [ ] B3c HIGH: restore on projects > 900 KB wipes without a pre-restore point → make the point (or refuse the restore)
- [ ] B3d MEDIUM: rate limits on sign-up, sign-in, reset mail, /track, upload (per IP/email)
- [x] B3e-1 (9 Nov, v5.0.177) r2_key ownership checked on sync
- [ ] B3e-2 MEDIUM: server measures the upload size itself (client-sent size_bytes not trusted)
- [ ] B3f MEDIUM: caps on object/project/frame/snapshot counts per account
- [ ] B3g LOW: User-Agent and country kept in sessions/analytics — decide what to keep (Privacy text)

## C. TestFlight — before real testers
- [ ] C1 Shell `server.url` dev → framehow.com/app; camera build live (4 steps)
- [ ] C2 TestFlight build 2 with the camera (CFBundleVersion 2, Archive → Distribute)
- [ ] C2b iPad: build 2 on Roman's iPad — rotation, layout, Pencil drawing, keyboard, camera (lenses differ); PDFs in the iPad simulator
- [ ] C3 Beta description + feedback email in TestFlight
- [ ] C4 Invite the first tester

## D. Before the first App Store submission (not needed for TestFlight)
- [ ] D1 Terms + Privacy rewritten — they still say "Beta"; must describe real deletion/recovery behaviour (from B2); agreement 3.3.3 C
- ~~D2 counsel~~ skipped for now (Roman, 9 Nov) — Roman writes the Terms himself from the facts in B2
- [ ] D3 EU trader status in App Store Connect
- [ ] D4 Untick Mac + Apple Vision availability in App Store Connect
- [ ] D5 Age-rating questions
- [ ] D6 Fitting split done (A7) — submit Framehow first, Fitting second
- [ ] D7 Website: the video, a Fitting page, "browser or App Store" two doors, pricing page (Roman's "Free during launch" text)
- [ ] D8 Decide: noindex on the site until launch (Roman)
- [ ] D9 Roman: 2FA on the Cloudflare account; confirm nobody else has a login; one line in the Privacy page about restricted admin access
- [ ] D10 docs/legal-facts-2026-11-09.md = the facts sheet for Terms/Privacy (9 Nov); fix the privacy page's "backup cycle" sentence

## E. Pricing — decided so far
- Launch free, all features and exports, no end date announced. Six months = internal review target.
- Later: subscriptions switch on server-side (the shell loads the web, so old installs see it on reload); Apple IAP build only when pricing starts; card via Stripe on the web.
- Model leaning: 1 project free (not a time limit) — decide with usage data.
- Announce 30–60 days before, existing work stays accessible and exportable.

## F. Housekeeping
- [ ] F0 Analytics: the admin password is the old token; set a memorable one with `wrangler secret put ADMIN_API_TOKEN` if wanted
- [ ] F1 Regenerate the GitHub token (sits in the git remote URL)
- [ ] F2 DKIM for framehow.com in Google Admin (optional)
- [ ] F3 Welcome / reset mails: reply-to that is read

## Done
- ~~Native camera in the iPhone app, the agreed moment (6 Nov)~~
- ~~Apple team, App Store Connect record, TestFlight build 1 (6 Nov)~~
- ~~Terms/Privacy pages live with Roman's wording, tick box on sign-up (9 Oct)~~
- ~~Welcome mail and password-reset mail exist (Oct)~~
