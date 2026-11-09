# LAUNCH — THE ONE LIST (9 Nov 2026). Nothing else counts; TOMORROW.md is history + notes.
Cross out with [x] and the date. Blocks are groups; the RUNNING ORDER is:
1 done today (A1 A4 A9 A11 A12 A13a B3a–e1 B3d) → A6a A6b (deploy 596) → 2 full run, C1 live, C2, C2b, C3, C4 →
3 A15, G1–G4, A2, A3, B3c, B3e-2 → 4 A7 → 5 D1 → 6 A8, A10, A13b, A14, B3f, D7, submission.
ROMAN IN PARALLEL (no Claude needed): D3 D4 D5 (App Store Connect), D8 decision, A5 text,
D7 video + Fitting page text, F1 new token.

## A. Code — the app itself
- [x] A1 (9 Nov, v5.0.172) Busy page after the shutter: own push comes back as "remote is newer" and redraws all cards → recognise own push, skip redraw (bench test first)
- [x] A2 (9 Nov, v5.0.185) Library preview is made from the live frame → remake from the real photo when it lands
- [x] A3 (9 Nov, Roman on the PWA) Version strip's own card in landscape after a shot — fine
- [x] A4 (9 Nov, v5.0.176) Library permanent delete: second confirmation, text says "cannot be undone, frees X MB"
- [x] A5 (9 Nov) Welcome mail: confirmation link + 150/500 MB lines + "kept on your device when offline…" (Roman's wording)
- [x] A6a (9 Nov, v5.0.181, test 58) Email confirmation: 150 MB until the welcome-mail link is opened, full allowance after; Resend; all devices (9 Nov, in test 58)
- [x] A6b (9 Nov, v5.0.181) Sign-up tick box "Send me news and updates about Framehow." → users.newsletter_consent_at
- [ ] A6 "Free during launch — paid plans later" line in the account box; `plan` field on the account (free), no billing code
- [ ] A7 Fitting as its own app: build flag, second bundle id (com.framehow.fitting), Fitting build hides the rest
- [ ] A8 Long simulator test on the iPhone simulator (plan: TOMORROW.md 5 Nov section) + the faults it finds
- [x] A9 (9 Nov, v5.0.173, test 55) HIGH: a picture added while a push is in flight can be lost (test 33 red in runs 581/582: 3 uploads in 0.1 s, server keeps 2) — upload queue; also write-then-pull race (BIG DAY part 3), BIG DAY 7 timing red
- [x] A11 (9 Nov, v5.0.174) Account deletion: sign in again within 7 days = restored; app text says 7 days (today admin-only, text says cannot be undone)
- [x] A12 (9 Nov, v5.0.178, test 56) HIGH (privacy): pictures from LOAD / folder / drag-drop are stored as the original file, EXIF+GPS included → resize to 2400 and re-encode (strips EXIF) like the camera paths
- [x] A13a (9 Nov, v5.0.177) Remove the admin Set-password button
- [x] A13b (9 Nov, v5.0.188, tests 34+61) Logout warns about unsent work and keeps unsent copies but clears project cache + previews; account deletion wipes everything local
- [ ] A14 Self-host the Google Fonts (one subprocessor less); note OCR CDN loads in the Privacy text
- [x] A15 (9 Nov, v5.0.184, test 59) LOAD several pictures at once onto the SHOT strip: first on the shot, the rest new shots after it
- [ ] A10 "Tell phone users about the desktop" note (where/when)

## G. Small bugs and comforts carried over from TOMORROW.md (one list, Roman 9 Nov)
- [x] G1 (9 Nov, test 60 green) Multi-load into an EMPTY version strip — already fine, guarded by test 60
- [ ] G2 Sign-in box: "keep me signed in" (sessions are 30 days sliding today — decide if needed at all)
- [ ] G3 Reload-on-new-version: check the behaviour, decide the rule
- [ ] G4 Slow project opens (Roman, 5 Nov): one timing line at open, then look
- [ ] G5 NEEDS clickable on frame-set cards in STORY FLOWS / SHOOTING ORDERS (½ day)
- [ ] G6 Simulator findings: F1 UUID names from the Photos picker → number instead; F2 "save it first" notice repeats; F4 landscape-left Dynamic Island covers the page's left edge (no left safe-area)
- [ ] G7 Two timing reds from run 581: BIG DAY part 7 fitting PDF download; write-then-pull race (BIG DAY part 3, run 579)
- [ ] G8 Face ID / Touch ID sign-in in the iPhone app (after launch)
- [x] G10 (9 Nov, v5.0.189, test 61) Project list: one row per project; unsent work on the device is a note on the row, copy rows only when the project is not in the cloud list
- [ ] G9 Later ideas (not launch): professions in analytics · break colours synced · guest link (view + rate) · board merge/compare, PDF import adjust, copy frame data

## B. Audit (report first, no code) — running in the background from 9 Nov
- [x] B1 (report 9 Nov: docs/audit-launch-2026-11-09.md) Security & storage audit (Roman's prompt): offline photos, quota, access control, abuse, recovery/GDPR — graded report in docs/
- [x] B2 (in the report, §5 table) Deletion inventory: which deletes are soft (7 days) / hard, when R2 objects really go, backups/versions, account deletion — facts for the Terms
- [x] B3a CRITICAL: a failed picture upload fails the save and is retried (9 Nov, test 54) 
- [x] B3b HIGH: analytics page — sign-in form + cookie, token out of the URL, /track whitelist, output escaped (9 Nov) 
- [x] B3c (9 Nov, server) HIGH: restore on projects > 900 KB is refused with a clear message instead of wiping without a way back — wipes without a pre-restore point → make the point (or refuse the restore)
- [x] B3d (9 Nov, v5.0.179, test 57) rate limits: sign-in 10/email/15 min, sign-up 5/IP/h, forgot mail 3/email/h + 20/IP/h, upload 60/account/min (burst), beacon 600/IP/h
- [x] B3e-1 (9 Nov, v5.0.177) r2_key ownership checked on sync
- [x] B3e-2 (9 Nov, server) MEDIUM: server measures the upload size itself (client-sent size_bytes not trusted)
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
