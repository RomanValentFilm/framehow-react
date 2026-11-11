# Release notes since v5.0.109 (28 Oct) — for Roman's records
# Live is still v5.0.109. Everything below is on dev (v5.0.132 · #684 is the newest).

v5.0.110 · #662
- FH CAM is the default camera on every desktop project

v5.0.113 · #665 and v5.0.115 · #667
- Fitting export: 5 LOOKS PHOTOS comes first and is the default
- Fitting export: labels L3, stars 2 pt bigger
- Fitting export: the PDF is 16:9 like the PowerPoint, no Letter option
- PowerPoint pictures sit lower

v5.0.117 · #669
- Fitting export: stars in the PDF, the talent's name line, the talent's note in 5 LOOKS
- a rename on the main card survives a pull

v5.0.118 · #670
- Fitting export: the talent's note below the pictures, full width, both layouts

v5.0.119 · #671
- a rename is written to the device at once, so it survives a reload right after OK

v5.0.120 · #672, v5.0.121 · #673, v5.0.122 · #674
- Fitting export: talent name, header and notes moved by 1%

v5.0.123 · #675 to v5.0.127 · #679
- turning the device while shooting: the page ignores the turn until the camera closes
- the photo lands in the view where CAM was pressed, on the same card
- it never goes to 3x2 by itself

v5.0.128 · #680 to v5.0.130 · #682
- iPhone: library, then landscape: the view bar buttons (3x2, SETUPS, GROUP, SORT BY) work again
- the page behind the library is held still, so the first tap lands
- a tap is no longer taken for a swipe
- the log shows every view-bar and LIBRARY tap

v5.0.131 · #683
- Fitting export: a message when no photo meets the criteria (stars, unrated, hidden, strips), for 5 LOOKS PDF and Keynote and for the images ZIP

v5.0.132 · #684
- export (all projects except Fitting), PDF and Keynote: "Double Strip" is now "Main Frame + One Selected Strip Frame"
  - 1st Version Frame (v1), the default
  - last captured Version Frame
  - 1st starred
  - 1st tagged
- "Main Frame + Active Frame" is gone

v5.0.133 · #685


v5.0.133 · #685
- iPhone app shell: the text box's OK and CANCEL work on the first tap

v5.0.134 · #686
- iPhone app shell: the top row sits below the clock, grey strip behind the clock

v5.0.135 · #687
- iPhone app shell: the top row stays visible below the clock, same grey behind the clock

v5.0.136 · #688
- iPhone app shell: the top row keeps the real inset below the clock
- iPhone: a PDF loads nothing; note "PDF IMAGE EXTRACTION AND IMPORT is available only on a tablet or computer"
- note boxes: button "OK, got it."

v5.0.137 · #689
- iPhone: LOAD PDF shows the note before the file picker, centred

v5.0.138 · #690
- iPhone: LOAD PDF note then the NEW PROJECT menu; WRITE shows changed text at once; no keyboard suggestions/autocorrect anywhere

v5.0.139 · #691
- note headline breaks after EXTRACTION; OPEN PROJECT and other cards scroll in iPhone landscape; turning to portrait keeps a single strip

v5.0.140 · #692
- turning to portrait keeps a single strip; app shell: keyboard lies over the page, no glass bar above the keys

v5.0.141 · #693
- app shell: boxes sit above the keyboard (WRITE, rename, needs…); OPEN PROJECT box scrolls itself

v5.0.142 · #694
- Groups box: buttons wrap on iPhone portrait; the field you type into stays in view

v5.0.143 · #695
- Group box: buttons in two pairs; findings notes F1–F8

v5.0.144 · #696
- Group box: both button rows centred on phones; boxes taller than the free area scroll above the keyboard in portrait

v5.0.145 · #697
- WRITE: changing only the colour of the text is a change (the text colour is in the change fingerprint) — the colour no longer comes back

v5.0.146 · #698
- A field on the page hidden under the keyboard is scrolled into view (NEEDS items, notes, rename)

v5.0.147 · #699, v5.0.148 · #700
- NEEDS and NOTES alone in iPhone portrait are as tall as the main card (measured from the hidden main card)

v5.0.149 · #701, v5.0.150 · #702
- NEEDS / NOTES alone: its own button no longer empties the screen (every device, both orientations)

v5.0.151 · #703
- The measuring log lines taken out again

v5.0.152 · #704 — LIVE 6 Nov
- DRAW bar: one tool lit at a time (eraser on darkens colour and pen; off brings them back)

v5.0.153 · #705
- App shell: CAM opens the iPhone's native camera (FramehowCamera plugin — the 3 Nov test camera with Framehow's RATIO list); one 2400 px JPEG lands on the card at once. PWA unchanged.

v5.0.154–157 · #706–709
- Native camera in the iPhone app: RATIO list, pinch zoom with the lens following, tap focus (back to auto when the scene changes), EV, Cancel; Deep Fusion kept
- The two-step landing: the live frame lands on the card at the shutter, the real 2400 px photo (HDR layer in it) replaces it on the same version a second later; the live frame is never uploaded
- The iPhone app has one camera: no FH CAM / PHONE CAM switch there

v5.0.158–171 · #710–723 (6 Nov)
- The moment of taking a picture, agreed: black flash 90 ms, the camera screen frozen 300 ms (always the same), then the page copy moves from 95 % of the screen to its card in 0.5 s, fading from the middle; the real photo replaces it ~1.3 s later
- Real photo always uploaded (manual mark + retries); lone NEEDS/NOTES as tall as the main card; Cancel left of the shutter, no pill

v5.0.172 · #724 (9 Nov — the audit day begins)
- A picture whose upload fails (timeout, 5xx, dropped line) fails the save; it is filed as unsent and retried — no more silent loss
- Analytics page: a sign-in form and a cookie instead of the token in the address; the public beacon takes only clean short values; output escaped
- The pull after your own push no longer redraws every card (the rows are recognised as your own)

v5.0.173 · #725
- A picture added while a push is in the air goes up with the very next push (a push asked for during a push is asked again)

v5.0.174 · #726
- A deleted account is restored by signing in again within 7 days; the words say so (delete question, toast)

v5.0.175–176 · #727–728
- Library DELETE asks twice: what goes and what it frees, then the last check — No is red and preselected on both

v5.0.177 · #729
- A push may only name pictures in the account's own folder
- The admin "New password" button is gone — Forgot password is the one way

v5.0.178 · #730
- Every picture loaded from files (LOAD, folder, drag-drop) is shrunk to a long side of 2400 px at most, re-encoded (EXIF and GPS gone); PNG stays PNG; smaller pictures unchanged

v5.0.179 · #731
- Rate limits: sign-in 10 wrong per email per 15 min, sign-up 5 per address per hour, forgot mail 3 per email + 20 per address per hour, upload 60 per account per minute, beacon 600 per address per hour

v5.0.180–183 · #732–735
- Confirm your email: 150 MB of storage until the link in the welcome mail is opened, the full 500 MB after; the project list says so with "Resend mail"; the STORAGE FULL box points to the inbox; confirmed on one device, every device learns it from the heartbeat and held pushes go
- Sign-up tick box "Send me news and updates about Framehow." (optional, stored with the account)
- Welcome mail with Roman's words; toasts above the modals; "Resend mail" answers the click

v5.0.184 · #736
- LOAD on a shot takes several pictures: the first onto the shot, the rest become new shots after it (2#1, 2#2 … or the next numbers at the end)

v5.0.185 · #737
- Library preview waits for the real photo (not the live frame); server measures picture sizes itself; a restore on a project too large for a restore point is refused with a clear message

v5.0.186–187 · #738–739
- STORAGE FULL box in Roman's words; mails with a "Confirm email" / "Choose a new password" button; the confirmation link opens an EMAIL CONFIRMED box

v5.0.188 · #740
- Logout warns about unsent work and keeps only the unsent copies; project cache, previews and session cleared; account deletion wipes everything of it from the device

v5.0.189 · #741
- Project list: one row per project; unsent work on the device is a red note on the row ("opens with it"); copy rows only when the project is not in the cloud list

v5.0.190 · #742
- The typeface (DM Sans, DM Mono) comes with the app — no Google Fonts call, works offline
- Server today: migration 0032 (rate windows), 0033 (news consent), 0034 (accounts from before the confirmation rule count as confirmed); `npm run server` for worker deploys

v5.0.191 · #743 (9 Nov, evening)
- The "my own push coming back" shortcut is never used after a push where the server kept its own copy of anything; a setting counts as mine only with my change time
- A shot kept as "mine" through a fetch still drops versions deleted on the other device (an untag's copy stayed for ever)

v5.0.192 · #744 (10 Nov) — SAVE POINT before the 3-star rating for all projects
- STARS DECIDE THE GROUP, THE ARROWS THE ORDER INSIDE IT: ◀ ▶ move a version only past a neighbour with the same stars / hidden / tag state; otherwise the arrow is grey (strip, compare card, 3×2 and overview)
- The own-push shortcut only when the server holds exactly what was sent
- Tests: BIG DAY part 3 (refused move, order inside a group travels), star in 3x2

v5.0.193 · #745 (10 Nov)
- THREE STARS IN EVERY PROJECT: the rating fitting had. A row in horizontal projects (first star on the left), a column in portrait and fitting; bottom-left corner. Tap a level to set it, tap it again to clear; most stars first. An old single star counts as one. The MAX view takes the level pressed too.

v5.0.194 · #746 (10 Nov)
- The star row in horizontal projects is 10 % smaller, proportionally (cards and MAX view)

v5.0.195 · #747 (10 Nov)
- The setup button on a version reads "+NAME" (the setup's own name, the old grey look) instead of "TAG"; tagged it is the name filled in the setup's colour, as before; long names are cut with "…"

v5.0.196 · #748 (10 Nov)
- ACCOUNT CREATED box right after sign-up: a mail was sent to the address typed; the link unlocks 500 MB, 150 MB until then
- Server (runs 627–628): welcome mail says "on your iPhone, iPad or in a browser on your computer (www.framehow.com)"; mails use the reader's own colours (Gmail showed grey on white), an empty line only between paragraphs, links as blue underlined text, the confirm paragraph of the welcome mail in bold

v5.0.197 · #749 (10 Nov)
- Text in the notice boxes (one OK button, red headline) is centred
- Server (run 630): "Framehow" at the end of the mails in bold

v5.0.198 · #750 (10 Nov)
- THE NEWEST VERSION BY ITSELF: the first time each day the app comes to the front it asks whether a newer build is out and reloads at a quiet moment (no box open, nobody typing or drawing, camera off, nothing to send); nobody signs in again, the page returns to its shot. A debug device asks every time.
- THE SAVE REMINDER WAITS ITS TURN: not on top of a box, the keyboard, a drawing or the camera — it comes about 3 s after; showing, it steps aside for a box and comes back. Never counted as "Later".

v5.0.199 · #751 (10 Nov)
- The update asks only once the app is up with the project on screen; the new build is fetched WHOLE in the background first (a bad line changes nothing, tried again next time); then, at a quiet moment, the box "UPDATING FRAMEHOW — Loading the newest version — one moment." and the switch
- ONE LIST of what both the update and the save reminder wait for: drawing / DRAW mode / big view / scribble, typing, the camera, SETUPS open, a shooting order being edited, a shot or version being moved, any box, sheet, menu or overlay; the update also waits for nothing left to send. The log says why it waits.
- Tests 62 (save reminder waits its turn, never lost) and 63 (new version: no line, bad line, good line behind a WRITE box; still signed in, same project, same shot)

v5.0.200–201 · #752–753 (10 Nov)
- AFTER AN UPDATE THE PERSON FEELS NO DIFFERENCE: the same project, the page at its exact scroll position, the same view (3×2, overview, strips), every button lit as before (strips, NEEDS/NOTES, the group and its red name), the same version on every card
- The update sends unsent work first instead of only waiting for it
- Test 63 plays two updates (plain, and from a busy bar) and compares the bar, the versions on show and the scroll before and after

v5.0.202–203 · #754–755 (10 Nov)
- LIBRARY, nobody signed in: the button says "Sign in to see all your pictures in one place." with Sign in / Not now (it did nothing at all)
- The update also comes when nobody is signed in or the project was never saved (it waited for ever for work with nowhere to go — seen live in the simulator); the app saves to the device right before switching
- Test 63 has a third part: not signed in, unsaved project, update, the work is there afterwards

v5.0.204 · #756 (10 Nov)
- SEVERAL PICTURES INTO A VERSION STRIP land in the order chosen and none is left empty: all are read first, then placed (on the iPhone a later, quicker picture overtook the first, which then opened one more version — v1 empty, v2 v3 v4 filled). Test 60 now loads a big, slow first picture.
- LIBRARY notice reads "Sign in to see all your pictures."

v5.0.205 · #757 (10 Nov)
- Several pictures loaded onto a SHOT that already has a picture all become new shots after it; the shot is not touched (the first used to become a version of it). One picture alone still becomes a version. Test 59 has the case.

v5.0.206 · #758 (10 Nov)
- A new shot gets a name nobody has yet (after 2, with 2#1 and 2#2 there: 2#3); existing shots are never renamed, doubles made on purpose stay. NEW and loaded pictures alike. Bench + test 59.

v5.0.207 · #759 (10 Nov)
- THE UPDATE ASKS: after five minutes of use a small card "A new version of Framehow is available — update?" TOMORROW · NOW (centred). Nothing restarts by itself any more. TOMORROW: not asked again that day. NOW: saved, sent, UPDATING FRAMEHOW, back on the same screen. One question at a time: the save reminder first.

v5.0.208 · #760 (10 Nov) — THE UPDATE ONLY INFORMS (replaces 198–207's automatic switch and background download)
- Nothing at the start, nothing downloaded, nothing restarted by itself. After five minutes of use, once a day, one small question to the server.
- A newer version: a small card in the middle, at a quiet moment, never with the save reminder, only with a line: "A new version of Framehow is available. / Reload only if you are on a stable internet connection." NOT NOW · RELOAD — neither lit. At most twice per version, on two days; shown counts (the device put away: gone, once more on a later day).
- RELOAD: saved, the line checked (none: nothing restarts, a NO CONNECTION box, and that showing does not count), UPDATING FRAMEHOW, a normal start with its loading bar, back on the same shot / view / buttons / versions; "Framehow is updated." in the middle.
- The app knows afterwards whether it was updated. The start no longer reloads itself after a new offline copy.

v5.0.209–211 · #761–763 (10 Nov)
- NO CONNECTION box says only "Framehow was not reloaded." (Roman's words)
- The update card goes if the line drops while it is up (uncounted) and returns with the line; a device with the log on waits 30 s where others wait minutes
- After an update only "Framehow is updated." shows, not the "swipe over the image" hint on top of it

v5.0.212 · #764 (10 Nov)
- "Framehow is updated." centred; RULE: all new text and its buttons are centred, and every user-facing sentence is agreed with Roman before the deploy line (CLAUDE.md 11, 12)
- After an update a card returns to the VERSION it showed on a phone too: the version is written into both records the app keeps (the card's and the one the fetch after the start reads)
- The "swipe over the image" hint is gone (the arrows say it)

v5.0.213–215 · #765–767 (10 Nov, evening)
- The update card and the save reminder also wait while a photo taken is still arriving (the live frame on the card until the real photo lands)
- The update card has the same timing on every device — the test shortcuts for devices with the log on are gone
- Shell (not deployed, for build 2): the camera keeps clear of the Dynamic Island sideways

v5.0.216–224 · #768–776 (10 Nov, evening) — THE DYNAMIC ISLAND, iPhone sideways only
- The app keeps its full width and its own backgrounds; the three bars run edge to edge (they lie above the island). Only what would sit under the island starts beside it, on the island's side, with a 1 pt gap: the cards (3×2, strips, NEEDS/NOTES), the frame-set page of SHOOTING ORDER / STORY FLOW, LIBRARY (SELECT and DELETE too), GROUP, SETUPS, the Menu, the big DRAW view, MAX view. Turned the other way round, it follows. (A first design pushed the whole app in beside a stripe — dropped.)
- The app ends at the island's own edge, not the system's safe distance (10 pt further)
- More room at the ends of the bars sideways (top row 20, the others 12) for the round corners; MAX view keeps 16 pt on the side without the island
- NEW PROJECT box scrolls itself sideways; the page behind stays still
- SETUPS name field: no contact autofill over the keyboard. LIBRARY: DELETE the same distance from the right as SELECT
- Shell, for build 2 (unbuilt): the camera keeps clear of the island sideways

v5.0.225 · #777 (10 Nov, night)
- SORT BY menu opens in the middle on an iPhone held upright (it ran off the screen)
- MAX view sideways: the same room on both sides, the picture in the middle
- FULL RUN 665 on this version: 150 green, 1 red (a random day, seed 793634 — a sort-order decision left waiting). Not live.

## v5.0.226 · #778 (11 Nov, run 667)
- NOTES on the iPhone: a notes field taller than the free screen is moved by its typing line, not centred (G15). Notes field told off autofill like the setup label.
- 3x2 on the iPhone, upright projects: star column 15 % smaller, clear of the arrows (G16).

## v5.0.227 · #779 (11 Nov, run 668)
- NOTES on the iPhone: when the typing line is behind the keyboard it is brought to the middle of the free screen; a visible line is never moved (G15).

## v5.0.228 · #780 (11 Nov, run 669)
- NOTES on the iPhone: one move per typing place (the flicker of #779).

## v5.0.229 · #781 (11 Nov, run 670)
- iPhone sideways, upright projects: strip views give the picture the same height as 3x2 (half the screen); star column 15 % smaller in strips too (G16, done — Roman: happy with the card height).
- NOTES: the move waits until the screen has come to rest; log line "notes: typing line at …".

## v5.0.230 · #782 (11 Nov, run 671)
- NOTES: the screen itself is slid back over the typing line (window scroll), not the column.

## v5.0.231 · #783 (11 Nov, run 672)
- NOTES: typing line to 25 % from the top by sliding the screen — did not work on the phone (the slide was undone), replaced in the next build.

## v5.0.232 · #784 (11 Nov, run 673)
- NOTES: card moved up at the touch and field made short — the move at the touch worked; re-measuring the field while the keyboard was up made it go back and forth (fixed in the next build).

## v5.0.233 · #785 (11 Nov, run 674)
- NOTES on the iPhone (G15): at the tap the card goes to the first position under the bar and the field is given a fixed height once; the keyboard moves nothing (Roman: worked).

## v5.0.234 · #786 (11 Nov, run 675)
- NOTES: no grey under the short typing field — the card keeps the field look while typing (Roman: works now). G15 done; "AutoFill Contact" bar stays in Safari, to be checked in shell build 2.

## v5.0.235 · #787 (11 Nov, run 676)
- NEEDS: a card swiped sideways stays where it is when an item is ticked or the page is redrawn (Roman: works nicely).
- Phone checks from 9 Nov: 8 create-account box OK (Roman), 9 NEEDS last column = this fix. Still open: 13 "+ New Group" speed, 14 New Group sideways.

## v5.0.236 · #788 (11 Nov, run 676)
- FRAME-SET CARDS (G12, G13): the line under the picture is always the description (was: the WRITE text when there was one). The shot note on top across both columns, bold, all of it. Blocks in fixed places: left TALENTS over ART, right SHOOT over GEAR, each on a lighter shade (Roman: "I really love it").

## v5.0.237 · #789 (11 Nov, run 677)
- FRAME-SET CARDS: an empty block keeps its box (one line), the description is shown in full, the gaps between the boxes are even (6 px both ways).

## v5.0.238 · #790 (11 Nov, run 678)
- FRAME-SET CARDS: notes on the same shade as the blocks; description flows.

## v5.0.239 · #791 (11 Nov, run 679)
- FRAME-SET CARDS: only the breaks typed with Enter are kept (description and note); the notes box is always there, one line when empty.

## v5.0.240 · #792 (11 Nov, run 680)
- FRAME-SET CARDS: version and sketch pictures 20 % wide (was 17 %); the note without the word NOTES in front.

## v5.0.241 · #793 (11 Nov, run 682)
- FRAME-SET CARDS: the note box and the four needs boxes open the shot's NOTES / NEEDS box (NEEDS on that block's tab); a touch darker under the mouse; on closing a shooting order re-sorts at once (moved shots green) and the page shows the edited shot; STORY FLOW only redraws; a card in move mode opens nothing. New test e2e/64 (green in run 682; run 681 red was the test: thin space in "DAY 1").
