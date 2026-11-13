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

## v5.0.242 · #794 (11 Nov, run 683)
- FRAME-SET CARDS: the NEEDS / NOTES box grows out of the box that was pressed (was: from the top left corner).

## v5.0.243 · #795 (11 Nov, run 684)
- FRAME-SET CARDS: after NEEDS from a card — the order changed: page to the top (icon overview shows the green shot); nothing moved: same place; NOTES: always the same place. The order is counted BEFORE the box closes, under the project-loading bar with "Re-sorting…" (a quarter second at least). Test e2e/64 extended (three landing cases).

## v5.0.244 · #796 (11 Nov, run 685)
- SHOOTING ORDER RULE CHANGED (Roman): a shot that was in a real box and fits no box any more MOVES to the leftovers — at its number among them — and is green. A new shot with no needs still stays where it was made (red); a leftover that stays a leftover is not marked. bracket.ts decideResort + placeInLeftovers; bench sections 6 (rewritten), 6b, 6c. Order tests 26, 27, 64 green in run 685.

## v5.0.245 · #797 (11 Nov, run 687)
- BREAK COLOURS (G14): eleven colours + the grey (last, the start colour); round button left of the arrows while the break is edited, palette row inside the break; name white on dark / dark on light; `color` on the break, travels with it (shooting order, story flow, groups); PDF + Keynote paint it. Test e2e/65 (run 686 red was the test: a space in the compared text).
- SORT BY EXPORTS (G18): PDF + Keynote card as on screen — note box, four blocks in fixed places on the lighter shade, version/sketch 20 %.
- Log line "by hand: dragged …" names the shot that was in the hand.

## v5.0.246 · #798 (11 Nov, run 688)
- BREAK COLOURS: the palette opens and the colour is painted on the break card in place — no redraw of the whole order (it took about a second per tap on the iPad for 26 shots).

## v5.0.247 · #799 (11 Nov, run 689)
- SORT BY REDRAW: the pictures are no longer written into the order HTML (a short name per picture; the picture is handed to new cards after the comparison) — a redraw cost about a second on an iPad. Log: "order redrawn: N kept · X ms".
- A tap on a needs / notes box while a break or another card is being edited only ends that editing.

## v5.0.248 · #800 (11 Nov, run 690)
- EXPORTS: a group exported with STORY FLOW takes the group's own breaks (it was given the project's).
- SORT BY: a sync does not redraw the order while a break or a card is being edited (Roman's rule); iPad redraw measured at ~330 ms after #799 (was ~1000).

## v5.0.249 · #801 (11 Nov, run 691)
- SORT BY REDRAW: a card that did not change stays the very same node (not cloned), marked wired; wireEditViewEvents passes over it. The card or break being edited is still made anew (drag set-up). Reuse only within the same order.
- Break colour button: a rectangle saying COLOR (was a round dot).

## v5.0.250 · #802 (11 Nov, run 692)
- DONE on a break acts at the touch (pointerdown) and keeps the typed name — it needed two taps when the name field had the cursor. renameBreak says nothing when the name is the same.
- EXPORT: the shooting-order list shows only the orders of the chosen group (ALL: the project's); it follows the group picker.
- iPad redraw of a 26-shot order: ~180 ms (1000 this morning). Camera screen (island + round corners) committed, still unbuilt.

## v5.0.251 · #803 (11 Nov, run 693)
- CAMERA LANDING: the copy that shrinks into the card starts on the rectangle where the frame stood on the camera screen (was 95 % of the screen — a jump since the picture begins beside the island).
- CAMERA SCREEN (Swift, Xcode run, not TestFlight yet): picture begins where the island ends, sideways and upright; frame out of the glass corners; RATIO / EV / 1x one look, 12 pt from their two edges of the visible picture; RATIO list fits under its button.

## v5.0.252 · #804 (11 Nov, run 694)
- COPY LOG in the app shell goes through the share sheet (whole log); a hidden-field copy as the fallback. Works on the phone (Roman pasted a full log).

## v5.0.253 · #805 (11 Nov, run 695)
- CAMERA LANDING: the travelling copy keeps the picture's own shape (was the card's shape, stretched); move 0.3 s.

## v5.0.254 · #806 (11 Nov, run 696)
- CAMERA, OPTION A (Roman): no freeze — the screen goes right after the flash (100 ms, was 390) and the picture travels from where it stood; from the shutter on only the photo on black (no dim surround, buttons, frame line); in the app a black backdrop fades over the whole move, the picture from halfway. Saves and fetches are held for 0.8 s while a photo lands (holdSyncFor) — the move stood still for a second before. Swift part needs the Xcode run.

## v5.0.255 · #807 (11 Nov, run 700; 697–699 red: the hold on a merely open list, then a stale build, then the mail text on an account it could not help)
- STORAGE FULL: new texts, the number said, buttons OPEN LIBRARY / OPEN PROJECTS (opens in Edit Projects) / Not now; unconfirmed email: Resend mail — only when confirming really gives more room.
- QUIET WHILE PROJECTS ARE EDITED in the list: nothing sent, fetched or redrawn from Edit Projects until Done / close; then one catch-up.
- CAMERA: nothing saved or fetched from the shutter until the picture has landed (0.6 s); while the camera is merely open the app works on.
- LATER (Roman, tired of it tonight): one storage limit, 500 MB for all — drop the 150 MB tier. CAMERA SERIES (his idea): camera stays open, shots collect in a small window, tap it → they land as versions, one save.

## v5.0.256 · #808 (11 Nov, run 702; 701 red: the test marked too late)
- STORAGE notices: every button pressed by a test; button named OPEN PROJECTS' LIST; the mail is mentioned only where confirming gives more room (one rule). A previous photo waits while the next one lands.

## v5.0.257 · #809 (11 Nov, run 703)
- CAMERA: the real photo is unpacked before it replaces the live frame, so the swap does not hold the page.

## v5.0.258 · #810 (11 Nov, run 704)
- SAVES AGAIN AFTER iOS CLOSES THE DEVICE STORAGE: the app held on to a closed database for good ("The database connection is closing", then COULD NOT SAVE ON THIS DEVICE). A closed one is forgotten and opened anew; one more try. Test 66 closes it on purpose.
- A new camera ratio is written down after the landing, not in it.

## v5.0.259 · #811 (11 Nov, run 705)
- Preview work (LIBRARY) waits two seconds after a photo's live frame. The log says where the page stood still during a landing; every line within 4 s of a landing carries its ms.

## v5.0.260 · #812 (11 Nov, run 706)
- THE LOG SURVIVES A RESTART OF THE PAGE (app shell only): the line "THE PAGE STARTED ANEW HERE", the lines from before below it.
- CAMERA (Swift, Xcode build): at the shutter the camera screen only becomes invisible; it is taken down when the photo is done. Before, the page stood still ~1.2 s after every shot and the first shot after a turn showed no move. Roman's log in a 5-shot project: move 310–330 ms, no standstill, turn included.

## v5.0.261 · #813 (11 Nov, run 707)
- COULD NOT SAVE ON THIS DEVICE only after three failed saves in a row (two failed 3 s apart while iOS restarted its storage; the third worked).

## v5.0.262 · #814 (11 Nov) — LIVE on framehow.com/app
- FULL RUN 708: 154 passed, 0 failed, 6 parked (fixme), 1.1 h. Run 709: FH_LIVE push e28bdc6 → 8211dd2. Live before: v5.0.152 · #704 (6 Nov).
- WHAT WENT LIVE SINCE 6 NOV, for the user:
  - 9 Nov: confirm your email (150 MB until then, 500 MB after), mails with a button, rate limits, library delete asks twice, one row per project in the list, pictures loaded during a save go up at once.
  - 10 Nov: the update card only informs (NOT NOW / RELOAD), after an update back in the same place; new shots get a name nobody has; several pictures into a strip land in the chosen order; iPhone sideways beside the Dynamic Island; MAX view to the edge.
  - 11 Nov: NOTES on the iPhone stay put when the keyboard comes; frame-set cards in SORT BY redesigned (note box, NEEDS blocks in fixed places, whole description; a tap opens NOTES / NEEDS; Re-sorting bar); a shot that fits no box any more goes to the leftovers; BREAK COLOURS (11 + grey), synced, in PDF and Keynote; group exports with their own breaks and orders; SORT BY redraw about five times faster on the iPad; STORAGE FULL notice with OPEN LIBRARY / OPEN PROJECTS' LIST; nothing synced while projects are edited in the list.
  - Also live, missed in the first writing of this note (checked against all 111 commits since e28bdc6): 3-star rating in every project (10 Nov); LOAD on a shot takes several pictures — the first on it, the rest new shots after it (9 Nov); every loaded picture 2400 px at most, re-encoded, metadata gone (9 Nov); logout warns about unsent work and keeps only the unsent copies, account deletion wipes the device, a deleted account comes back when signed in within 7 days (9 Nov); the typeface comes with the app, no Google Fonts call (9 Nov); the version's setup button reads +NAME (10 Nov); LIBRARY says why when nobody is signed in (10 Nov).
  - Native camera (app shell only, loads dev): island and round corners respected, RATIO / EV / 1x one look, no freeze, picture travels from its frame into the card in 0.3 s.
- OPEN: G21 — a very heavy project (WF 7: 26 shots, hundreds of pictures) makes iOS stop the page / its storage process (Xcode console: WebContent "Crash" on opening it, Network Process crash during the device save). Fix agreed in words with Roman: pictures apart from the project record, in memory only what is on screen, the device keeps the one open project (as today), unsent photos stay until uploaded. Not built.

## v5.0.263 · #815 (12 Nov, run 711)
- START-UP SAYS WHAT THE DEVICE HOLDS: "start: N whole-project copies kept on this device … device storage used: X MB", and names each step; written to the device at once so a start that falls over names the step.

## v5.0.264 · #816 (12 Nov, run 712)
- THE LIST OF DEVICE COPIES IS READ, NOT EVERY WHOLE COPY. Roman's phone held 9 copies (2 of WF 7), 656 MB; a start read all of them in full three times, the project list again at every opening. A list of a few words per copy now lives with the copies (key __index); a copy is opened only when used, one at a time. The open project is read once at start (savedProjectId), not twice.

## v5.0.265 · #817 (12 Nov, run 713)
- EVERY PICTURE IS ON THE DEVICE ONCE, BY ITSELF — THE SAVE NAMES IT (src/lib/picStore.ts, its own database framehow-pics). Roman's log 11:05: WF 7 finished opening, two seconds later it was saved to the device and the page was thrown out; device storage 655 → 1941 MB in two minutes. A save is now the small rest; a picture is written once, about a megabyte at a time; the save is written only after every picture it names is there. Copies of unsent work and their safety copies name their pictures the same way and share them.
- A picture nothing names is removed only at the second look, a minute apart, and only when the save and the list of copies could both be read for certain. Logout keeps the unsent copies' pictures and removes the rest; deleting the account removes all.
- Saves and copies from before this change (pictures inside) read as before and become light the next time they are written.
- NEW: `npm run bench:save` (35 checks against a stand-in database: nothing lost, nothing written twice, old saves, a missing picture, removal only at the second look). Test 67 (the save holds no picture, reads back whole, to the byte count; after a reload; after iOS closed the databases). In the simulator the line for "a picture" is 64 bytes, so every test with a picture goes this way.
- NO WAY BACK BELOW THIS VERSION ON A DEVICE THAT RAN IT: an older page reads the names (fhpic:…) as if they were pictures. Dev only until a full run has passed.

## v5.0.266 · #818 (12 Nov, run 714)
- WF 7 (251 pictures) in the iPhone app after v5.0.265: opened, switched away and back, camera with a turn, three photos, writing — no restart, no COULD NOT SAVE; filing 251 pictures 1.5 s once, later saves 0.2 s; device storage 655 MB (was 1941).
- ONE REDRAW A SECOND WHILE A PROJECT'S PICTURES ARRIVE (was one per picture: 13–46 redraws of all cards in a row; taps swallowed at start, slow after deleting in the LIBRARY). The first one after 150 ms, so a single picture is on its card at once; one more at the end.
- PICTURES ARE FETCHED EIGHT AT A TIME (was all at once: 251 in one burst).
- A save that had to be written whole (pictures could not be filed by themselves) is done again the light way after 10, 30 and 90 s.

## v5.0.267 · #819 (12 Nov, run 715)
- TWO PROJECTS MIXED — FOUND AND CLOSED. Roman's phone 12:10:45: photos in "9x16 proj", then WF 7 opened from the list; a tap while it loaded set off the heartbeat, which fetched for the project the app still called open (9x16) and laid the answer over WF 7's shots already on the screen: "KEEPING 26 frame(s) the answer left out", 30 shots, WF 7 upright; opening WF 7 again then sent that arrangement to WF 7 and kept 9x16's four shots in it. Cause: loadCloudProject applies the new project and loads all its pictures BEFORE setCurrentProject — for a big project twenty seconds in which "the open project" is the old one. The guard "answer was for another project" compares against that same old id and let it through. OLD FAULT, not from today's work (live v5.0.262 has it): it needs something to fetch in the old project (photos just taken) and an opening longer than the heartbeat's five seconds.
- NOW: no fetch and no heartbeat while a project is being opened (isProjectSwitchInFlight), also not a forced one; an answer that comes back after an opening began (projectSwitchCount) is dropped. Test 68 opens a project with slow pictures, changes the old one on another device and asks for a fetch in the middle.
- Roman restored WF 7 from MENU › RESTORE PROJECT. Restore points are on the server and were never touched by the device-copy work.

## v5.0.268 · #820 (12 Nov, run 716)
- THE SECOND WAY TWO PROJECTS MIXED (Roman's phone 16:45, still on v5.0.266): an unnamed project with two photos was going up as "Untitled 12 Nov 16:44" (saveNow: create, then send — 47 s) when WF 7 was opened over it. loadCloudProject's flushSyncNow returned at once ("a push is already running"); WF 7 was applied; then the old save finished and markSaved() made ITS project the open one again, WF 7's shots on the screen. The heartbeat fetched for it: "KEEPING 26 frame(s)", pushes to the Untitled project, the cards lost their versions, and at the second look "256 picture(s) nothing names any more removed" — blank and black. The server refuses shots of another project (#49), so WF 7 itself was not written to this time.
- NOW: (1) opening a project waits up to 20 s for a save that is still going up ("opening waits: …"); (2) saveNow notes which project it is for (local identity + projectSwitchCount) and after each wait for the server stops, marking nothing, if another project has become the open one. Test 68, second test: an unsaved project with a slow upload, BIG opened over it — BIG is and stays the open project.
- EVERY LONG JOB KNOWS WHICH PROJECT IT IS FOR (Roman, 12 Nov: "the user should be allowed to do anything he wants … keep track of these commands that are still somewhere"). currentProject.ts: openProjectToken() / isAnotherProjectNow(token) / AnotherProjectNow. syncCurrentToServer takes the token and asks after the pictures went up and when the server answered — before it reads the settings or writes ids into shots — and stops (it was sending the NEW project's settings under the OLD project's id). flushSyncNow, the retry's push and saveNow ask too and mark nothing on a project that is not theirs.
- TWENTY SECONDS IS POLITENESS, NOT SAFETY: if the save of the project being left is still going after the wait, the project is filed on the device first, whole (fileOpenProjectAsUnsent), and goes up from that copy later. A project created on the server whose work could not follow: its filed copy learns the id (givePendingItsProject) and goes up into it — not created twice. Test 68, third test: a 35 s upload, BIG opened over it; BIG stays BIG, the left work arrives in its own project.
- THE UPDATE CARD AND THE SAVE REMINDER do not come while a project is being opened, while a save is going up, or in the ten seconds after a project came on the screen (quietMoment.busyToShow); a card that is up steps aside when a project is opened.
- THE QUESTION "You have unsaved work that will be discarded. Continue loading this project?" IS GONE (Roman: "a wrong model … shall we kill that one"): nothing is discarded; a project left with unconfirmed work is sent or filed on the device and stays in the list. Test 68, fourth test: the app closed while a project is loading comes back in the old, never-saved project, whole.
- AN UNSAVED PROJECT THAT IS LEFT BECOMES A FULL PROJECT, "Untitled" AND ITS DATE (Roman: "should not become the short one … the short ones are only copies of projects that have not been uploaded"). Before, that only happened after a minute of work; left sooner it stayed a short row "on this device — not uploaded yet" for good. Now: leaving (Open project, New project) files the project with its memory; uploadUnsentCopies gives a copy that has no project on the server its project (its own name, or Untitled + the time of its last change) and sends it; the look happens 2.5 s after another project is opened or begun, and at every start. Not the unsaved project that is open (savedProjectLocalKey / localProjectId). In the list it is then a full row; until its work is up it carries the red note "unsent work on this device — opens with it". Test 68, fifth and sixth test (two unsaved projects and the app closed).
- RUN 716 RED (34 of 35): the new test "an unsaved project that is left becomes a full Untitled project" — and it found an OLD LOSS: opening a cloud project did not give the app a new device-only name, so (a) the left project could not be told from the open one, and (b) the first save in the opened project called markPendingUploaded(_localId) on the LEFT project's copy — an unsaved project that had never been to the server was marked "already uploaded", turned into a grey safety copy and swept after three days. loadCloudProject now takes a new identity at the switch (and gives the old one back if the opening fails before anything new is on the screen). Run 717.
- A PICTURE THAT ARRIVES LATE GOES ONLY INTO THE PROJECT IT WAS FETCHED FOR: pictures are put on shots by the shot's device number, and another project's shots have the same numbers; applyCloudTreeToStore takes the token and drops a picture that arrives after another project came on the screen.
- AN UNTITLED PROJECT WENT UP FIFTEEN SECONDS LATE EVERY TIME: saveNow waited "for the other save" — which was the retry that had called it (retryIsCreating).
- STILL OPEN: "the project list did not load" once at 16:44 — not looked at yet.

## v5.0.269 · #821 (12 Nov, run 719)
- Roman's phone on v5.0.268, 19:21: new unsaved project (portrait, photos, drawing, text) left for WF 7; apps switched in the middle of the loading. GOOD: no mix, the left project went up as "Untitled 12 Nov 19:20" with its two shots. BAD: a SECOND "Untitled 12 Nov 19:21" was made, holding WF 7's 26 shots — while WF 7 was being opened, the unsaved project's ordinary "file my work on the device" (noticeUnsent, from emit) ran with WF 7's shots on the screen, and the new rule gave that copy a project. The server refused the shots (#49: "26 shot(s) belong to ANOTHER project"); WF 7's settings went into that project. NOW: nothing is filed on the device while a project is being opened. Test 68 (fifth test) counts exactly one Untitled project.
- NOT YET DONE, Roman's two other points from that test: (a) the black full-screen "Uploading unsent work: …" notice — he wants it in the background, unseen; it covers the screen because the open project is taken off the screen while the copy goes up (holdOpenProject / putOpenProjectBack); doing it unseen means sending a copy without putting it on the screen — a job of its own. (b) photos into WF 7 right after: the first was taken upright (1206×2400, "ratio canvas") and sat as a cut-out in the landscape card; later ones (2400×1004) looked cropped too until a fetch redrew the cards at 19:21:57 — cause not found yet (the camera's frame follows how the phone is held; the card's crop after a project was put back on the screen?).
- THE OLD PROJECT LEAVES THE SCREEN THE MOMENT THE NEW ONE IS CHOSEN (Roman: "There can't be two projects on the screen at the same time"). loadCloudProject: the project being left is sent or filed, held whole (holdOpenProject), then the storyboard is emptied and NO project is open (resetStoryboardState + clearCurrentProject, the device's save kept) until the new one has arrived; if the opening fails the left project is put back (putOpenProjectBack). This closes the window the three faults of the day came through, and with it the old project's choices no longer stay in force for the new one — camAspectRatio, groups, orders, setups, the format (Roman: "the format of a project is individual for a project open, no spill from old one"). Test 68, seventh test.

## v5.0.270 · #822 (12 Nov, 21:43) — LIVE on framehow.com/app
- Full run 720: 161 passed, 1 red (test 31 — the harness counted log lines in a log that kept 300; now 6000 in the simulator), 6 parked. Run 721: that test green, FH_LIVE push 8211dd2 → d26b7e4. Live before: v5.0.262 · #814 (11 Nov).
- The device-save bench runs in front of every deploy (scripts/deploy.sh).
- WHAT WENT LIVE SINCE v5.0.262, for the user:
  - THE PROJECT ON THE DEVICE: every picture is stored once, by itself; a save writes only what changed (a 251-picture project: saves 0.2 s, was up to 2.8 s; the iPhone app no longer restarts on it). The app saves again after iOS closes its storage; "could not save" only after three failures in a row.
  - OPENING A PROJECT IS SAFE: the old project leaves the screen the moment another is chosen and comes back if the opening fails; nothing of one project can land in another (a fetch during loading, a save finishing late, pictures arriving late — three ways two projects were mixed, one of them losing an unsaved project after three days, all closed). Closing the app while a project loads comes back in the project that was open.
  - AN UNSAVED PROJECT YOU LEAVE becomes a full project, "Untitled" with date and time, by itself. The question "unsaved work will be discarded" is gone — nothing is discarded.
  - SMOOTHER: cards are redrawn once a second while a project's pictures arrive (was once per picture; taps were swallowed), pictures are fetched eight at a time. The update card and the save reminder wait for a calm moment (not while a project opens or a save goes up). An untitled project no longer waits 15 s before going up.
  - Native camera (iPhone app, Xcode build): the camera screen is taken down when the photo is done — no 1.2 s standstill, the first shot after a turn moves like the others.
- KNOWN, NOT IN IT: G22 the black "Uploading unsent work" curtain (now seen more often, because left projects go up by themselves); lazy loading (G21 step 3); STORY GRID (G23).

## v5.0.272 · #824 (13 Nov, run 723)
- UNSENT WORK OF ANOTHER PROJECT GOES UP UNSEEN (G22). The black full-screen "Uploading unsent work: …" is gone from the app in use. Agreed with Roman 13 Nov: (1) THE PICTURES FIRST, in the background, one by one, whenever there is a line — nothing held, nothing shown (sendCopyPicturesAhead; what the server answered is noted per picture in the device's picture store, key __sentAhead). (2) THE REST in one short step at a QUIET MOMENT — nothing open, no camera, no typing or drawing, no project loading, no save going up, the app in front, the screen not touched for four seconds — with the copy standing in behind a screen that is HELD AS IT IS (render.ts: renderAll does nothing while __fh_screenHeld; currentProject: listeners held). THREE SECONDS at most. (3) A TOUCH STOPS IT AND IS NOT LOST: at the first instant of a touch the open project is put back (a few ms) and the touch goes through — nothing on the screen has moved. Tried again at the next quiet moment. What was left in the air finishes by itself and touches nothing (the project token).
- A picture sent ahead is good for 20 hours (the server removes files no project names after 24); after that it is sent again. The phone keeps every picture until the project is confirmed, and after that with the grey safety copy for its one to three days.
- The push takes a picture from its note only while a copy is standing in (not for the open project's own pushes).
- AT START nothing changed: unsent copies still go up before anything is on the screen, under the startup line.
- Test 69: pictures ahead + the short step, a watcher proves the black notice is never on the screen; a slow server → "three seconds are up", the open project back; a click in the middle → back at once, the next change is the open project's and travels; the left work still arrives.
- KNOWN EDGE, not closed: a picture sent ahead and deleted in the LIBRARY before its project went up would leave a note pointing at a file that is gone (for up to 20 h).
- STORY GRID, STEP 1 — MAX VIEW GOES UP AND DOWN (Roman, 12 Nov). Arrow down / the arrow at the bottom / a swipe with the finger moving UP (as a page scrolls) = the next shot; up = the one before. The order is the order the cards stand on the screen (inside a group: that group's shots; hidden shots and shots with nothing to show are passed over). Coming from another shot the viewer opens on the shot's MAIN picture ("Not any version, next shot"); in a version column on the version the column shows. Left and right as before. The card of the shot being left follows as if the viewer had been closed on it; closing puts the page on the shot it was left on. Two new arrows, middle of the top and bottom edge, shown only where there is a shot to go to. Test 46, third test.
- AFTER RUNS 724–726 (still v5.0.272, deployed to dev by run 726): a look for unsent work that came within three seconds of the last one was DROPPED, and with it the only timer that would look again — unsent work then waited for the next save (run 723 hid it by timing). It is put off now, never dropped; the same while one copy is still going up. A picture the server REFUSES no longer holds its whole project on the device (the project goes up without waiting for it; the save says PICTURE NOT ACCEPTED as before). A change made in the open project right after a touch stopped the step goes up when the step has ended. The log says why unsent work waits (once per 30 s). Tests: the simulator slows uploads inside the app (a proxy in front of WebKit loses the picture — every "slow upload" test had been uploading empty bodies); the project list is closed when a test builds a project behind it.

## v5.0.273 · #825 (13 Nov, on dev by run 730)
- LAZY LOADING, HALF 1 (G21 step 3; agreed with Roman 13 Nov). OPENING A PROJECT RETURNS WHEN ITS SHOTS ARE ON THE SCREEN — the person is in and can work. The pictures follow in the background: small previews stand on the cards first (512 px, from this device's preview store, else the server's /thumbs, six at a time), the sharp pictures replace them in the order of the shots, eight at a time as before. src/lib/lazyPictures.ts (previews shown only — never saved, sent or exported; the count; the bar), accountFlow.ts bringThePictures (taken out of applyCloudTreeToStore; `background` only for loadCloudProject — a fetch of the open project works as before).
- THE BAR along the bottom edge (28 px, the app is that much shorter, red fill, text centred): "Loading pictures 126 / 251"; with no connection "Offline — 126 of 251 pictures on this device"; gone when every picture is on the device. In the background NO PICTURE IS GIVEN UP: no connection → it waits for the line and goes on; only another project on the screen ends it.
- A picture arriving late is put on its card as the app's doing (the project is not marked as changed), and only if the card still wants THAT picture — a photo taken on the card meanwhile is not covered; versions are found by the picture's name, not by their place.
- THE APP CLOSED WHILE PICTURES COME: it starts in that project (the device save has its shots); pictures the project names but does not hold are fetched in the background three seconds after the start, and when the line comes back (bringMissingPictures).
- A picture being fetched is fetched once, whoever asks meanwhile. Unsent work of another project does not take its short step while pictures of the open project are still arriving.
- THE UNSEEN STEP IS STOPPED, NOT LEFT IN THE AIR (Roman, 13 Nov: "at that very same moment the background upload is interrupted … the open project never waits"): its requests carry a signal (api.ts requestsBelongToAStep); a touch or the three seconds aborts them on the spot, so the open project's own save never waits behind them.
- Test 70 (three tests): in at once (< 3.5 s with 4 s pictures), the bar counts, previews stand in, a rename and a new photo made meanwhile are kept and the photo is not covered, all pictures arrive, the other device agrees; offline in the middle → the bar says so, back online it finishes; closed in the middle → starts in that project and fetches the rest. Test 68: "slow opening" is now a slow project fetch, not slow pictures. The old test door openProject still waits for the pictures; openProjectAndBeIn does not.
- NOT IN IT (half 2): sharp pictures far from the screen leaving memory. KNOWN: an export or PDF started while the bar is still counting takes the cards as they are (pictures not yet arrived are missing from it) — to decide with Roman.
- MAX VIEW IN 3×2 (Roman's iPad, v5.0.272): no up and down there, and after closing, the card was drawn again inside itself (two, three rows of buttons). The viewer took the frame INSIDE the 3×2 card for the card. Fixed; test 46 has a 3×2 test now.
- CAMERA (iPhone/iPad app, needs an Xcode build): the clock and battery are hidden while the camera is open — on the iPad RATIO and EV stood behind them.
- Lazy loading: the preview of a picture that was replaced while loading is dropped too (run 727, the one red).
- LEAVING A PROJECT THAT HAS NO NAME: ASKED ONCE (Roman, 13 Nov). The name box SAVE uses, with its own words — "Name this project" · NOT NOW · SAVE (the same title when SAVE is pressed; its buttons stay Cancel · Continue) — when another project is picked from the list or a new one is begun (after the kind is chosen), only for a project with work in it and no name of its own (none, or the app's "Untitled …"). NOT NOW: it is or becomes "Untitled …", nothing lost. A named project is never asked. The old "Save your current work before starting a new project?" (two questions) is gone. accountFlow.ts nameItBeforeLeaving; test 71.

- THE SAVE REMINDER ALSO FOR SIGNED-IN PEOPLE (Roman, 13 Nov): a project that went up by itself as "Untitled …" gets the reminder after its minute of work too — "This project has no name yet. Name it now?" · Later · Save Now (Save Now opens the name box) — once, not again after fifteen minutes. For someone not signed in nothing changed (after a minute; Later → once more after 15 minutes; then quiet for the session).
- (run 730) A project already up as "Untitled …" and named when leaving is RENAMED before it leaves the screen — one project, no second one (test 71). KNOWN EDGE: named when leaving with no connection — the name is on the filed copy; whether it reaches the server from there is not tested.

## v5.0.274 · #826 (13 Nov — tests green in run 731, but the upload FAILED: Cloudflare 503 three times; its content went out as v5.0.275)
- (13 Nov 16:40, from Roman's iPad on v5.0.273) "I opened WF 7 and then nothing worked": (1) previews were fetched even when every sharp picture was already in hand — 268 of them AFTER the pictures, a redraw of all cards for each (650 ms on the iPad), 15 seconds of a standing page; previews now only for pictures really still on their way, and stopped when the pictures are in. (2) IN THE BACKGROUND ONLY THE CARD THAT GOT A PICTURE IS DRAWN AGAIN (25 ms instead of 650) — the list views every four seconds and at the end. (3) A picture the library deleted, told to its card after the project was noted as matching the server, made five shots of WF 7 go up at every opening and the whole project come back as "changed elsewhere"; a shot that matched before the card was told still matches. THE BAR is thin now: 16 px of black, a 3 px red line along its lower edge, small white text. MAX VIEW: the up and down arrows sit on the edge of the screen. A stopped step is not taken for a lost connection. CAMERA (Xcode build): no "starting…"; a device with one back camera shows 1x and stays 1x (no "Back Camera", no 0.5x). OPEN: RATIO does not open its list on the iPad — cause not found.
- CAMERA (Xcode build), "starting…" that stayed with a dead RATIO on the iPad: cause not proven. Hardened where it most likely comes from — CAM pressed again while the screen of the shot before was still up unseen (waiting for its photo): the old screen is taken down first, and a finished photo only takes down ITS OWN screen and camera. "starting…" is no longer shown at the start; it appears only if the camera has not started after three seconds (then something is wrong).
- iPad: the bar with SHOT · ANGLE · SKETCH · REFS · NEEDS · NOTES slid up under the 3×2VIEW row, a black band where it belonged (Roman, 13 Nov, after the page restarted under the camera). It was placed once from where the view bar stood; the view bar moves when the clock-and-battery strip changes height, with no resize or scroll. It is checked every half second now and placed again when the view bar has moved. (Third sighting of "the iPad detail bar is gone".)

## v5.0.275 · #827 (13 Nov 17:06, on dev by run 735 — everything listed under 274 and here)
- MAX VIEW in the iPhone / iPad app: no clock and battery over the picture (the shell hides them while the viewer is open — a new door in the camera plugin, `statusBar`; needs an Xcode build).
- CAMERA (Xcode build): RATIO and Cancel did not answer on the iPad after the clock-and-battery change of this afternoon. Most likely cause: `.statusBarHidden` on the SwiftUI screen ("AttributeGraph: cycle detected" at every opening). The bar is hidden by the screen's own controller now (CameraHost). NOT PROVEN until Roman has tried it.
- "A little bar that shows 8 of 13 loading, and it comes always" (Roman, 13 Nov): the thirteen pictures of WF 7 that the library deleted were asked for again at every start. A picture found gone is remembered on the device (localStorage fh_gone_pictures); after that its card is told at once — no asking, no bar, no log line.
- CAMERA: the three Swift files are BACK AS THEY WERE ON 11 NOV (commit 523c758), to find out whether RATIO and Cancel not answering on the iPad is from today or was always there. Today's camera changes (no "starting", 1x only, one screen at a time, no clock/battery, statusBar door for the MAX view) are kept aside in the session folder camera-today/ and go back in one at a time.
- CAMERA, OPEN: on the iPad RATIO answers late or at the second tap and Cancel does nothing — also with the 11 Nov camera code, so not from today. Tap reporters are in the Swift files (lines 'FH CAM:' in the Xcode console); waiting for Roman's console.

## v5.0.276 · #828 (13 Nov 17:23, on dev by run 737)
- "The app was not responsive for a while" at the start (Roman, iPad, 17:09): the fetch at the start drew all 26 shots again four times in three seconds (650 ms each). The card-by-card drawing of the opening is used for every fetch of pictures now.
- CAMERA, MEASURED ON THE iPAD (reporters in the Xcode console, 13 Nov 17:10): three taps on "Cancel" landed on the picture, 5–10 pt under the word — the button was only the word itself, 16 pt high (the padding round it was never part of it). It is a clear field of 96 × 48 now, a plain word as before. RATIO worked all along; it sat under the clock-and-battery strip, where iOS takes the taps — hiding the strip in the camera is the fix. The "AttributeGraph: cycle detected" line comes with hiding the strip and is harmless; it caused neither. Today's camera changes are back in (CameraHost hides the strip, no "starting" unless 3 s pass, 1x only on a one-lens device, one camera screen at a time, statusBar door for the MAX view). The reporters are out.
- The bar in the middle that flashed at every start ("Loading image 13 of 13"): pictures known to be gone are not counted as loading any more.
- CAMERA on the iPad: the RATIO / EV row begins at least 56 pt below the top edge (it stood 12 pt from the top-left corner, where the system takes the touches — easy to press the moment a 1:1 frame moved it down). iPhone unchanged. Cancel confirmed working by Roman (17:18).

## v5.0.277 · #829 (next)
- Start of WF 7 on the iPad still drew all shots four times after the fetch (v5.0.276 log, 17:24). The redraw after the pictures only happens when a picture really came; the redraws name who asked for them in the log ('pictures: all in', 'fetch: the view put back') so the rest can be found. KNOWN: every start fetches the whole project again (the mark of what was last taken is not kept across a restart) — that is the real cost, not looked into today.
- The name reminder came the moment a new project was created (Roman, 17:26): the project went up as "Untitled" within a second and the question with it. It is asked a minute after the reminder first met the project.
