# LAUNCH — THE ONE LIST (9 Nov 2026). Nothing else counts; TOMORROW.md is history + notes.
TOMORROW (11 Nov): FULL RUN 665 (10 Nov night, v5.0.225 · #777) COUNTS AS GREEN — 150 green, the 1 red ("a random day", seed 793634) was the TEST's fault (a rightful sort-order decision inside the day; the per-step check had no allowance), fixed and replayed green in run 666. No app code changed since run 665. → C1 GO LIVE is Roman's call. Then: G12 + G13 (frame-set cards), the four phone checks, C2 build 2.
Cross out with [x] and the date. Blocks are groups; the RUNNING ORDER is:
1 done 9 Nov → 2 C1 live, C2, C2b →
3 A15, G1–G4, A2, A3, B3c, B3e-2 → 4 D1–D9 (Roman), C3 shell to live → 5 D11 SUBMIT → 6 A7 Fitting → 7 A8, A10, B3f, G-items.
ROMAN IN PARALLEL (no Claude needed): D3 D4 D5 (App Store Connect), D8 decision, A5 text,
D7 video + Fitting page text, F1 new token.

## THE GOAL, IN ROMAN'S WORDS (11 Nov, midnight) — IN THE APP STORE WITHIN ONE MONTH, 12 DECEMBER 2026 AT THE LATEST
"It has to be fast and it has to be safe to use. And it has to have the iPhone camera, which doesn't do bullshit, but saves photos quickly. And it has to be in the App Store. And it has to have the features which we decide, but most of them we did today. And it has to have the fixes that are necessary. And this has to happen within 1 month latest." — "With an app that is super solid: we fuck up once and no one gets back."
- THE LIST IS LOOKED AT AGAIN WITH A CLEAR HEAD, FIRST THING NEXT SESSION, against these five: fast · safe · the iPhone camera · the agreed features · the necessary fixes. What serves none of them waits until after the App Store.
- THE BAR FOR "SOLID" (Claude's proposal, Roman has not said yes yet): in the iPhone app and on the iPad — (1) a 300-photo project opens, shoots, saves, survives a turn and a restart, no COULD NOT SAVE, no page restart · (2) a fresh start with no connection opens the project with its pictures · (3) full run green · (4) Roman uses it one real working day and nothing breaks.
- TIME: about three working weeks of work to submission (aim: submitted by 3 December), the rest of the month is Apple's review — that part is not in our hands.

## THE PATH TO APPLE (Roman, 11 Nov late: "we need to be in the App Store" — nothing is announced before that; everything not on this path waits)
1. G21 step 0: the start-up loop in the iPhone app · 2. G21 step 1: FILL 25 in the app and the web app · 3. G21 steps 2–3 as far as the numbers demand
4. C2 build 2 on the iPhone, C2b on the iPad, C2c start with no connection · 5. C3 the app points at framehow.com/app · 6. D1/D10 Terms + Privacy, D3–D5 forms, D9 2FA · 7. D11 screenshots, texts, review account → SUBMIT
WAITS UNTIL AFTER SUBMISSION: G19 camera series, A7/D6 Fitting as its own app, G20 one storage limit, G8 Face ID, G11 guest link, D7 website extras, G4, G6, G7, A10, G2.

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
- [x] A14 (9 Nov, v5.0.190) Fonts bundled with the app — Google Fonts gone from the Privacy text; OCR CDN loads (PDF import) still to note in the Privacy text
- [x] A15 (9 Nov, v5.0.184, test 59) LOAD several pictures at once onto the SHOT strip: first on the shot, the rest new shots after it
- [ ] A10 "Tell phone users about the desktop" note (where/when)
- [x] A16 (10 Nov, v5.0.192) STARS DECIDE THE GROUP, THE ARROWS THE ORDER INSIDE IT: ◀ ▶ only past a neighbour with the same stars / hidden / tag state (found by run 617: two rules contradicted, devices disagreed)
- [x] A17 (10 Nov, v5.0.193–194) 3-star rating in every project: a row in horizontal projects (10 % smaller), a column in portrait and fitting
- [x] A18 (10 Nov, v5.0.195) The version's setup button reads "+NAME" (old grey look) instead of "TAG"; tagged = NAME filled, as before. Stars do NOT spread to the copies (agreed)

## G. Small bugs and comforts carried over from TOMORROW.md (one list, Roman 9 Nov)
- [x] G1 (9 Nov, test 60 green) Multi-load into an EMPTY version strip — already fine, guarded by test 60
- [ ] G2 Sign-in box: "keep me signed in" (sessions are 30 days sliding today — decide if needed at all)
- [x] G3 (10 Nov, v5.0.208, test 63) A NEW VERSION ONLY INFORMS (Roman: no automatic switch, no background download): after 5 min of use a card NOT NOW / RELOAD, twice per version at most; RELOAD checks the line; a fresh start loads the newest as always. PROVEN on Roman's iPhone 10 Nov 19:11 and 19:17 (home-screen app, airplane mode, fresh start: WF 7, 25 shots, all pictures there; back online it carried on by itself). STILL TO PROVE: the same inside the App Store shell (C2)
- [ ] G4 Slow project opens (Roman, 5 Nov): one timing line at open, then look
- [x] G12 (Roman, 10 Nov) FRAME-SET CARDS (SHOOTING ORDER and STORY FLOW): once a shot has text written with WRITE, the card shows THAT under the shot instead of the descriptive text — the description belongs there. FAULT. — DONE 11 Nov (v5.0.236–239: the description always, WRITE text never).
- [x] PHONE CHECKS of 9 Nov (Roman, 11 Nov): create-account box OK · NEEDS last column = swipe position kept (v5.0.235) · "+ New Group" under a second, fine · New Group sideways: the box lands on the exact right spot, DO NOT TOUCH; the keyboard covers the list while typing (unavoidable) — in build 2 (no AutoFill bar) just LOOK whether the box scrolls with the keyboard up.
- [x] G12 fixed 11 Nov in code (frame-set card line = the description, always) — goes out with the next deploy.
- [x] G13 (DONE 11 Nov, v5.0.236–241: note on top across both columns, bold, all of it, box always there; blocks fixed — left TALENTS over ART, right SHOOT over GEAR — on a lighter shade, empty ones stay; description in full, only Enter breaks kept; version+sketch column 20 %; boxes open NOTES / NEEDS and the order re-sorts on closing; test e2e/64) (Roman, 10 Nov) FRAME-SET CARDS: the shot's NOTES are missing on the right side (only NEEDS show). Put them in the second column under the last block (props / build), in another colour (red or blue) so they stand out. Look at the card's layout first, suggest placement + colour to Roman BEFORE building.
- [ ] G19 (Roman, 11 Nov) CAMERA SERIES — his idea, agreed in words, NOT built: the camera stays open; every shutter press flashes and puts the shot into a small window at the side (stack + count); nothing lands, saves or redraws while shooting; tapping the window (or DONE) closes the camera and the window travels to the frame card; the pictures are there as versions; ONE save. Open questions for him: versions of this shot (suggested) or new shots · always stay open, or only from the second press · Cancel throws the visit's shots away, asking first. Needs Xcode rounds.
- [ ] G20 (11 Nov, later clean-up, Roman not tonight) ONE STORAGE LIMIT: 500 MB for every account; the 150 MB-until-confirmed tier goes (two notices, resend line, test 58 mostly); the welcome mail still asks to confirm, nothing depends on it.
- [ ] G21 (11 Nov evening, from Roman's phone logs) THE PAGE RESTARTS ITSELF IN THE APP ON A HEAVY PROJECT: in WF 7 (26 shots, one with 36 versions) the page started anew when the phone was turned with the camera open, and again after deleting projects in the list — back in 3x2, list closed, typing cut off. Not our update code (no line), no reload in the shell: iOS throws the page out. Measured: 'save on this device took 1308 ms' for WF 7 — the whole project with every picture is one record, copied on each save. In a 5-shot project the camera was right (move 310 ms, no standstill, turn included). Job: pictures out of the project record and out of memory (kept apart, loaded when shown). Since v5.0.260 the log survives a restart (line 'THE PAGE STARTED ANEW HERE'). Camera Swift fix of 11 Nov (screen hidden at the shutter, taken down when the photo is done) is in Roman's Xcode build, works.
  - G21 PLAN, agreed with Roman 11 Nov evening — THREE STEPS, he decides after step 1 whether 2 and 3 come before the App Store: (1) MEASURE, FIRST THING NEXT SESSION (½ day): a hidden button FILL 25 in the log panel adds 25 camera-size pictures (2400 px, ~800 KB, made on the device) as versions to the open project; after each tap one log line: picture count, size of the device save, save ms, redraw ms. Roman does it SIGNED OUT in a new project (nothing uploads, his 500 MB untouched): tap, turn the phone, CAM, turn, Cancel, repeat until the page restarts or 300; once on iPhone, once on iPad; sends the log (it survives the restart). (2) pictures out of the device save record (1–1½ days). (3) only on-screen pictures in memory (2 days). Device keeps the ONE open project, as today; unsent photos stay until uploaded. STILL OPEN FROM 11 Nov: run 710 (save of the release notes, FH_NOTEST=1 npm run deploy -- 710 …) and Roman reading v5.0.262 on framehow.com/app.
  - G21, ADDED 11 Nov 23:00 from two logs of Roman's (log 1 = the iPhone app from Xcode, log 2 = the dev web app; told apart by 'PAGE STARTED ANEW' / native camera lines vs 'offline cache: on · dev address'): ALL THE CRASHING IS IN THE iPHONE APP ONLY — the same WF 7 loaded in the web app in 20 s without a crash. In the app: device save of WF 7 took 2833 ms (0.6 s in the afternoon), then SAVE ON THIS DEVICE FAILED 1-2-3 (IndexedDB server internal error) and the box; opening WF 7 crashed the page 8 s in, twice; each time the app came back on the last thing saved on the device (an unsaved new project), not on WF 7; the second time the page restarted 12 TIMES IN 9 SECONDS with only that 1-shot project open. ORDER FOR NEXT SESSION: (0) FIRST find the start-up loop: what the first second of a start reads from the device (the current-project record, the unsent/safety copies in the pending store — do they hold whole WF 7 copies?, previews) and why it falls over when the storage process has just died; a log line for each step of the start so the next loop names the step. (1) then FILL 25, and run it in BOTH the iPhone app and the web app, to get the two limits. Also seen: 16 redraws in 5 s while a project's pictures arrive (22:55:44–49) — one redraw per batch, worth merging.
  - G21 STEP 0 — FOUND AND BUILT 12 Nov (v5.0.264, run 712): Roman's phone at start: '9 whole-project copies kept on this device … device storage used: 656 MB' (2 safety copies of WF 7, 1 of EVENING, 1 + FIVE unsent 'local-17…' copies). listPending() read EVERY copy in full (getAll) — at each start three times, at each opening of the project list, in the LIBRARY, at logout, in the sweep. NOW: a list of a few words per copy lives with the copies (key __index, shaped like an empty deleted copy so an older page sweeps it harmlessly); listPending returns that list (PendingMeta: frames, stamped); a copy is read only when used, one at a time (getPending) — opening it from the list, uploading it, the LIBRARY's unsent pictures. The open project's id is kept beside the save (savedProjectId), so a start reads the open project once, not twice. Tests 39 and 61 check the list names exactly the copies. STILL TO LOOK AT: (a) why FIVE unsent 'local-…' copies of unnamed projects stay on the device after the project went up as Untitled; (b) 14–16 redraws while a project's pictures arrive (taps swallowed at start, Roman 12 Nov: 'cannot click while the storage message shows'; slow after LIBRARY delete) → one redraw per batch; (c) then FILL 25.
  - G21 STEP 2 — BUILT 12 Nov (v5.0.265, run 713), ahead of the FILL 25 measurement because Roman's log showed the trigger itself: WF 7 opened 11:05:13, saved to the device 11:05:15, page thrown out, back on the previous project; device storage 655 → 1941 MB in two minutes. PICTURES OUT OF THE DEVICE SAVE: src/lib/picStore.ts; saveSnapshot / loadSnapshot / savePending / getPending in persistence.ts; bench:save (35 checks) green here; e2e 67 new; NOT YET RUN on Roman's Mac or phone when this was written. STILL OPEN: step 3 (only on-screen pictures in memory) — decide after his phone shows what step 2 changed; the five leftover 'local-…' copies; the 14–17 redraws while pictures arrive; FILL 25. RUN 713 GREEN on Roman's Mac (bench:save + 28 browser tests, test 67 among them), on dev as v5.0.265.
  - G21 STEP 3 = **LAZY LOADING** (the name Roman chose, 12 Nov). NOT BUILT. Agreed in words: lazy applies to MEMORY and to the ORDER — what is on screen comes first and the person is in quickly; it does NOT mean 'only fetch what you look at': in the background the app keeps downloading until EVERY picture of the open project is on the device (Roman: 'someone in the office loads a big project and goes offline — he needs to be sure he has all 200 pictures with him'); and THE APP SAYS SO — while fetching something like '163 of 200 pictures on this device', and when it is complete. That line (wording, where it sits) and what the opening bar shows ('the first 30, then you are in, the rest follows') are to be AGREED WITH ROMAN BEFORE BUILDING. A new photo keeps the two-second save (Roman: fine as it is).
- [x] G17 (Roman, 11 Nov, DONE v5.0.244) SHOOTING ORDER: a shot whose needs changed is run through the rules A to Z — out of a real box into no box means it MOVES to the leftovers (green). New shot with no needs stays where made, red. Bench 6/6b/6c.
- [x] G18 (BUILT 11 Nov, v5.0.245: PDF + Keynote draw the note box, the four blocks in their fixed places on the lighter shade, empty ones kept, version/sketch 20 % — Roman to LOOK at one PDF and one Keynote) (found 11 Nov) THE SORT BY EXPORTS (PDF + Keynote) STILL DRAW THE OLD FRAME-SET CARD: no note box, blocks in the old places (first half of the tabs left, second half right), version/sketch 17 % wide, description as before. Bring them in line with the card on screen (G13) — ask Roman first.
- [x] G14 (BUILT 11 Nov, v5.0.245: eleven colours + grey, button left of the arrows when the break is edited, palette row inside the break, name white/dark by colour, syncs with the break, PDF + Keynote paint it; test e2e/65) (Roman, 10 Nov) COLOUR FOR BREAKS in both SORT BY views (SHOOTING ORDER and STORY FLOW): a break can be given a colour. Agree first: which colours, how it is chosen, and that the colour travels to the other device (G9 had "break colours synced" as a later idea — this brings it forward).
- [x] G15 (DONE 11 Nov, v5.0.234: at the tap the card goes under the bar, field short once, keyboard moves nothing; AutoFill bar stays in Safari → check in build 2) (Roman, 11 Nov) NOTES IN VERTICAL PROJECTS, iPHONE: while typing, the keyboard pushes the notes too far up — you cannot see where you type. Also the autofill bar shows above the keyboard: check whether iOS takes the field for a name field (same cure as the setup name fields: autocomplete off, neutral field name). Fix both together.
- [x] G16 (DONE 11 Nov, v5.0.229: iPhone sideways, strip picture height as 3x2, star column 15 % smaller) (Roman, 11 Nov) FITTING, iPHONE LANDSCAPE: the star rating overlaps the arrows. Ideas from Roman: stars a little smaller, or fewer buttons shown so the canvas is longer. Look first, suggest to Roman BEFORE building.
- [x] G5 NEEDS clickable on frame-set cards in STORY FLOWS / SHOOTING ORDERS (½ day) — DONE 11 Nov (v5.0.241: boxes open NOTES / NEEDS).
- [x] G6-F2 (10 Nov, v5.0.198–199, test 62) the save reminder waits while a box / DRAW / the camera / SETUPS / an order edit is open, comes ~3 s after, never lost
- [x] A19 (10 Nov, v5.0.196–197 + server 627–630) ACCOUNT CREATED box after sign-up; welcome mail: iPhone, iPad or a browser on your computer, reader's own colours, paragraphs, blue links, confirm paragraph and Framehow bold; notice boxes centred
- [x] G1b (10 Nov, v5.0.204, test 60 with a slow first picture) G1 WAS REAL on the phone: several pictures into a version strip left v1 empty (the readings finished out of order) → all read first, placed in the order chosen
- [x] A15b (10 Nov, v5.0.205, test 59) several pictures onto a SHOT that has one → all new shots, the shot untouched
- [x] G6-7 (10 Nov, v5.0.202–204) LIBRARY signed out says "Sign in to see all your pictures." with Sign in / Not now
- [ ] G6 Simulator findings: F1 UUID names from the Photos picker → number instead; F2 "save it first" notice repeats; F4 landscape-left Dynamic Island covers the page's left edge (no left safe-area)
- [ ] G7 Two timing reds from run 581: BIG DAY part 7 fitting PDF download; write-then-pull race (BIG DAY part 3, run 579)
- [ ] G8 Face ID / Touch ID sign-in in the iPhone app (after launch)
- [x] G10 (9 Nov, v5.0.189, test 61) Project list: one row per project; unsent work on the device is a note on the row, copy rows only when the project is not in the cloud list
- [ ] G9 Later ideas (not launch): professions in analytics · board merge/compare, PDF import adjust, copy frame data
- [ ] G11 AFTER LAUNCH (Roman, 9 Nov): GUEST LINK — a guest can VIEW and RATE a project, no editing. Needs: members/links table, routes that accept a guest for reading + rating, invite/revoke. A guest who EDITS is a later, bigger step (pictures into the owner's folder and quota, rights, names in the log).

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

## C. Go live, and Roman's own device check (TestFlight = Roman only, 9 Nov: testers get the App Store app)
- [x] C1 Full run → live with the 4 steps (push v4.4:main + direct wrangler upload) — DONE 11 Nov: full run 708 green (154), run 709 live v5.0.262 · #814. Roman to read the version on framehow.com/app.
- [ ] C2a IN BUILD 2 — REWRITTEN 11 Nov (Roman chose it after comparing three ways on the phone): THE PICTURE BEGINS WHERE THE ISLAND ENDS, the other side to the edge, same both ways round; the frame never reaches into the glass's round corners (16:9 / 1.85 untouched, 2:1 and 2.39 a few % narrower); RATIO / EV / 1x stay in their corners; shutter + Cancel on the right, on the picture, moved in beside the island when it is on that side. Switch `pictureEndsAtTheIsland` (false = full length under the island). STILL UNBUILT — first seen on the phone in the Xcode run. Old note (10 Nov, UNBUILT, untested): the camera keeps clear of the Dynamic Island sideways — picture, frame line, shutter, Cancel, RATIO, EV, 1x start where the island ends; follows the phone turned the other way (ios/App/App/FramehowCamera/CameraScreen.swift). Check on the iPhone both ways round, and upright unchanged.
- [ ] C2c IN THE SHELL: a fresh start with NO connection opens the project with its pictures (proven for the home-screen app, not yet for the shell)
- [x] A20 (10 Nov, v5.0.216–224, Roman on his iPhone: "feels like we are good now") DYNAMIC ISLAND IN THE APP — full width kept, only content and opened menus start beside the island. Original note: (Roman, 10 Nov, after first leaving it): on an iPhone sideways the app starts where the island ends, on the island's side only — bars, 3×2, GROUP, SETUPS, LIBRARY, boxes; switches sides with the phone; upright and iPad unchanged. One rule for the page, not panel by panel. 2–3 h + simulator + phone.
- [ ] C2 TestFlight build 2 with the camera on Roman's iPhone (CFBundleVersion 2, Archive → Distribute) — shell still on dev while we test
- [ ] C2b iPad: build 2 on Roman's iPad — rotation, layout, Pencil drawing, keyboard, camera (lenses differ); PDFs in the iPad simulator
- [ ] C3 BEFORE SUBMISSION: shell `server.url` dev → framehow.com/app, one more build — reviewers and store users must see live, never dev
- ~~C4 external testers~~ none: testers test the App Store app (and the browser version meanwhile)

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
- [ ] D11 SUBMIT FRAMEHOW TO APPLE (after C and D1–D9): store screenshots (iPhone + iPad), description, keywords, support URL framehow.com, App Privacy labels from the facts sheet, review notes with a test account → Submit for Review (1–3 days, expect one round of questions). Fitting (A7) submitted separately later.
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
