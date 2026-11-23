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

## v5.0.277 · #829 (13 Nov 17:35, on dev by run 738)
- Start of WF 7 on the iPad still drew all shots four times after the fetch (v5.0.276 log, 17:24). The redraw after the pictures only happens when a picture really came; the redraws name who asked for them in the log ('pictures: all in', 'fetch: the view put back') so the rest can be found. KNOWN: every start fetches the whole project again (the mark of what was last taken is not kept across a restart) — that is the real cost, not looked into today.
- The name reminder came the moment a new project was created (Roman, 17:26): the project went up as "Untitled" within a second and the question with it. It is asked a minute after the reminder first met the project.

## v5.0.278 · #830 (13 Nov 19:14, on dev by run 741 — wide run 739: 44 of 45 green, the 45th the new test itself, fixed twice)
- CAMERA, RATIO ON THE iPAD — FOUND (Roman, 17:45: "I pressed RATIO, nothing; I turned the device and the menu opened by itself"). The tap was taken; the screen did not redraw until the turn forced it. The camera screen stops redrawing when IT hides the clock and battery (both ways tried today — "AttributeGraph: cycle detected"). Now the app's own screen hides them before the camera is put up and shows them again when it goes; the camera screen is the stock one again.
- CAMERA: RATIO and Cancel confirmed working on the iPad by Roman (17:50). The RATIO / EV row is back in the corner (the 56 pt on the iPad was a wrong guess).
- (13 Nov evening: a display-only half cure for the standstill at the start — 'a fetch that brings nothing new leaves the screen alone' — was built and TAKEN OUT AGAIN the same hour, on Roman's word: no half cure we are not sure of; find the real problem. The attempt is kept outside the project.)
- THE START KNOWS WHAT IT HOLDS (13 Nov evening — the real cause of the two seconds without an answer at the start of WF 7 on the iPad). After a restart the app had forgotten how far it had taken the server's state (takenFromServerAt was not kept), counted itself as having taken nothing, and fetched and rebuilt the whole project — "pull: remote is newer (Tablet)", the Tablet being itself. The mark now rides in the device's save, in the same record as the shots' server times (one save = one project + its mark, so they cannot disagree); it is put back at the start and with every copy put in place; the save is written again when the mark moves without the screen changing (the device's own save coming back as "nothing new"). The mark still only moves by TAKING (#299). Missing or older than the server = as before: the project is fetched. Log at the start: "holds everything the server had up to HH:MM:SS". Test 72 (start with nothing new: not fetched again; the other device changed something: fetched and on the screen).
- A STAR IS ON ITS CARD AT ONCE (Roman, iPad, 18:18): a tap on a star drew every shot of the project again (880 ms for WF 7) before the star showed. Only the shot's own cards are drawn now; the list views as before.
- LIBRARY, DELETE: the chosen pictures leave the library the moment the last question is answered (they stood there for two to three seconds — a redraw of the project and the server's answer — and could still be tapped). The cards, this device and the server follow.
- KNOWN (seen in run 740's network record): after a fetch that rebuilds the project the device sends one more save that changes nothing ('a shot changed while a sync was being applied') — harmless churn, on the list.

## v5.0.279 · #831 (dev, run 744, 16 Nov)
- A star set while only its card is drawn is written to the device too: the whole-page redraw used to be what told the store that something moved; drawing one card said nothing, so with no connection the star would have stayed in memory only. Found reading the log of 19:47, not by a fault seen.
- CONFIRMED BY ROMAN'S LOG 13 Nov 19:46: three starts in a row say "holds everything the server had up to 18:41:17", then "heartbeat: nothing new" — no fetch, no rebuild, one redraw of 400 ms instead of four.
- OPEN from the same log: deleting in the library still stalls the scrolling for half a second each time (the project behind is drawn again, 870 ms — draw only the cards that lost a picture, or wait until the library closes); one black tile in the library after a delete (screenshot 19:49 — a picture without a preview? to look at); a run of saves of the same shot after star taps ("a shot changed while a sync was being applied") — each star is its own save, fine, but the wording misleads.
- FULL RUN 742 (13 Nov 19:55–21:11, on the files of v5.0.279): 169 passed, 2 red, 6 parked. Red 1 = test 01 (two devices reload): it waited for the fetch at the start that no longer happens — the test now takes 'restored … known to be on the server' as the same knowledge. Red 2 = test 44 (fitting, version arrows): the card was measured in the instant a fetch redrew the page (boundingBox null) — looks like timing, to be run alone.
- Run 743: test 44 red again. Cause read from the trace and the log: five seconds after its first saves a device fetched ITS OWN work back ('pull: remote is newer (Desktop)') and redrew the page; the test asked for the card in that instant. The test asks again now (run 744 green, the card stays at 250 px over five taps). The needless redraw itself is on the list (LAUNCH.md, FOUND 16 Nov).

## v5.0.280 · #832 (dev, run 745, 16 Nov)
- LIBRARY, DELETE: only the shots that lost a picture are drawn again — not the whole project behind the library (iPad, WF 7: 870 ms of standstill at every delete). A view where the shot has no card of its own draws everything, as before. Test 48 (DELETE) checks the log line.
- LIBRARY, A TILE THAT SHOWS NOTHING: every tile is looked at once; a preview on this device that cannot be drawn or is black from corner to corner is replaced by the server's (or made again from the full picture), and the log says which picture, how big, kept since when, and what came instead — the cause of a preview going bad on the iPad is NOT known yet; this line is there to find it. A picture that really is black is left alone.

## v5.0.281 · #833 (dev, run 746, 16 Nov — 11 green, 1 parked)
- The library says what its looking costs: 'PICTS: looked at N tile(s) in X ms altogether'. The deploy writes its last line into e2e-log/deploys.log, so 'Dev is up' can be read.
- ONE FETCH, ONE REDRAW (16 Nov, Roman's iPad 12:21:36–38: one fetch drew all 28 shots of WF 7 three times — 922 + 679 + 675 ms, 2.3 s of standstill; the same three at every start that fetched). The rebuild no longer draws when the fetch has no picture to wait for, the redraw after it is gone, and the view is put back BEFORE the one drawing that remains (inside the system action). With pictures to wait for: once so the shots stand, once when all are in. Test 73.

## v5.0.282 · #834 (dev, run 748, 16 Nov — run 747 red: the new test looked before the fetch)
- CONFIRMED on Roman's iPad 12:37:36: the fetch after a library delete draws once (951 ms) where it drew three times (2.3 s). The looking at tiles costs under 1 ms a tile ('looked at 59 tile(s) in 42 ms').
- 'pictures: all in' draws the project only when a picture really landed — not when every asked picture was answered 'deleted in the library' (iPad 12:36:49, 849 ms for nothing).
- OPEN (same log): at a start that finds real news the project is still drawn several times (start 411 + rebuild 683 + view put back 674); and a device fetches its own library delete back and draws for it (951 ms) although its cards already say so.
- THE BAR: ONE DESIGN, TWO PLACES (Roman, 16 Nov: 'middle means wait, bottom means carry on'). Thin red line, small white words. IN THE MIDDLE on a black screen when one must wait — a project arriving, restoring, a PDF, loading files; words unchanged. AT THE BOTTOM when one can carry on — the app starting (striped moving line, 'Opening app…'; the line along the top is gone) and pictures arriving ('Loading pictures N / M'). The same on the Mac, the iPad and the iPhone.
- AN OPEN PROJECT WAITS FOR NOTHING — ALSO DURING A FETCH: a fetch that brought pictures put the black curtain over the work ("Loading image 3 of 5…") until the last one was in. It now does what an opening does: the shots at once, the pictures in the background, the thin bar counting "Loading pictures 3 / 5". (The wait sat inside the system action; nothing waits there any more.) Test 73, second test.

## v5.0.283 · #835 (dev, run 749, 16 Nov)
- THE BAR, after Roman's first look (16 Nov): the stripes at the start are wide (a red piece and a gap = a fifth of the screen; the narrow ones were "too busy"); ONE BAR AT A TIME — while the middle one is up the bottom one is not shown; the storage notice ("Storage 92 % full …") is said when the project is in, not over the black screen in the second of the wait (nothing waited for it, it only looked so).

## v5.0.284 · #836 (dev, run 750, 16 Nov)
- A BOX ON TOP: THE BOX MOVES, NEVER THE PAGE BEHIND (Roman, iPad, 16 Nov: moving the project list moved the page behind it). The iPad keeps a scroll inside a box only if the box can scroll that way; a short list, or one at its end, handed the finger to the page. One guard for every account box (project list, name box, sign-in): finger or wheel moves what can move inside, otherwise nothing. Why it showed today is not known — nothing of today's work touches it.

## v5.0.285 · #837 (dev, run 751, 16 Nov)
- NO WHITE PILL OVER A BOX (Roman, 16 Nov, screenshot 13:49: '"…" deleted. Storage 463 of 500 MB · 93 %' across the rows of the project list). After Delete now nothing is said on top of the list — the row is gone and the list's own storage line has the figure. The storage step notice ('Storage 95 % full …') waits while any box is open (project list, a notice, a project arriving) and comes when it is closed.
- THE PROJECT LIST STAYS while a question is asked about one of its rows (Delete, Delete now, Recover): the question comes on top; the list is no longer taken away and brought back around it.
- SEEN, NOT YET LOOKED AT: two storage figures two seconds apart (13:48:30 '93 % — 466 MB', 13:48:32 '95 % — 475 MB'; the pill said 463, the list's line 472) — two answers of the server that do not count the same things.

## v5.0.286 · #838 (dev, run 752, 16 Nov)
- THE LIST IS SEEN BEHIND THE QUESTION (Roman tested again: "it's the same, the list goes away"). Two reasons: his iPad was still running the build before (the log shows the same file name as the start before the deploy), and — the real one — the question's own ground is 85 % black, so a list left in place was hidden all the same. Over the project list a question's ground is 50 % now; rename keeps the list too.
- THE MENU SAYS WHAT HAPPENED TO A TAP: 'menu: finger on the button' / 'tap taken (N ms after) — opened | closed | locked' / 'closed by a tap elsewhere'. Roman had to tap three times at about 13:57; the log had nothing about it.
- FOUND IN THE SAME LOG, TO LOOK AT NEXT: every time WF 7 is opened the device sends the same five shots again ('5 shot(s) hold a version the server has not got — still to send': fd75af, e5d976, 719253, dc194e, 28ef7b — also at 13:39 and 12:21), fetches 361 rows back as 'remote is newer (Tablet)' and draws the whole project twice (912 + 902 ms, 13:56:18–24) — and a fetch replaced the version under an open WRITE box ('written to the live one').

## v5.0.287 · #839 (dev, run 753, 16 Nov)
- THE PAGE BEHIND A BOX IS HELD (Roman on v5.0.286: the page still moved behind the project list). The touch guard of v5.0.284 was not enough on his iPad — which way the swipe got past it is NOT known. Now the page is pinned while any account box is open, the way it is behind the export boxes (lockPageScroll), and let go at the same place when the last box closes; the log says 'box open: the page behind is held at N px' / 'box closed: the page is let go'.

## v5.0.288 · #840 (dev, run 755, 16 Nov — run 754 red, see below)
- THE STORAGE NOTICE CAME EVERY TEN SECONDS (Roman's log 14:14–14:15: 'Storage 80 % full — 401 of 500 MB' six times in a minute). Cause: two figures from the server — the project list, a save and Delete now count the pictures (392 MB, 78 %); the heartbeat reads the running total (401 MB, 80 %), 9 MB higher. 78 → 80 → 78 → 80: the line at 80 % was crossed again each time. The heartbeat's figure no longer changes the figure on the screen and never raises a notice; it still wakes held saves (room again, email confirmed). The notice now comes: with the first figure after a start if 80 % or more; when a save takes it over 90, then 95; again only after it fell under 80 and climbed back. SERVER, TO DO: the running total (storage_totals, userBytes) stands 9 MB above the counted sum for Roman's account — find what it does not subtract.
- THE MENU OPENS WHEN THE FINGER LIFTS: at 14:14:00 a finger on Menu had no tap after it, in the second the storage notice appeared — the iPad drops its made-up click when something new comes on the screen. The button takes the finger-up itself now.
- THE STORAGE NOTICE NEVER COSTS A TAP — THIS NOTICE ONLY (Roman: "only the storage pill, not any other pills. Big warning"). It does not appear while a finger is on the screen nor in the half second after it lifted, and while it shows a tap goes through it. Every other white notice (SAVED., WAIT…, errors) is exactly as it was: at once, and a tap on it closes it.
- Run 754 red (test 31): with the heartbeat's figure set aside, a device no longer heard 'over 80 %' after its previews had gone up — no save followed to carry the count. What the two figures are, read in the server: the heartbeat's is the account's running total (every file in the store); the list / a save / Delete now COUNT the pictures on the cards of live projects plus previews — the figure the limit is held against. So the total stays a hint: when it moves, the app asks GET /user/storage once and notes the count. Not a server fault after all — two different sums; the 9 MB between them on Roman's account are files no card names (to look at with the dead-picture count).

## v5.0.289 · #841 (dev, run 759, 16 Nov)
- SERVER (not deployed yet — tests first): ONE STORAGE FIGURE = what the account has on the server (userBytes), in the list, a save's answer, Delete now's answer, the heartbeat and at the upload door alike. The count that left out recoverable projects and unnamed files is no longer shown (Roman: "the server has to show what is on server, period"). Run 756 green on it (9 tests).
- SERVER: DELETE NOW TAKES ALL OF THE PROJECT AT ONCE — also the pictures taken off a card earlier that only its restore points still held (read out of the restore points before they go), and the library's previews of its pictures (Delete now was built before the previews existed and never learned to take them; the library's own DELETE did). The protection is unchanged and a little wider: a file any other project's card or restore point names is kept. The figure comes down by what really left the store. Test 33, second test: after Delete now the account's folder holds only the other project's picture and preview, and the figure equals the folder to the byte.
- CORRECTED 16 Nov: I told Roman twice that pictures taken off a card are never deleted. Wrong — the nightly job has deleted them since 22 Sept (24 h old, named by no project and no restore point). The heading of cleaner.ts still said "counting mode, nothing here deletes"; it says what the file does now.
- Run 757 green (5 tests; the new one: before Delete now 4 pictures / 63710 bytes in the folder, after 1 / 15948 — 'the folder really holds 15948'). SERVER DEPLOYED by Roman as run 758 (16 Nov ~15:15; his word — the server script did not write its result down until now, it does from the next one).
- (reporter only, no change of behaviour) A shot the fetch keeps as "holding a version the server has not got" says which version and why: '… keeps as its own: 3f9a1c "v2" NOT IN THE ANSWER · upload · picture …' or '… MINE IS LATER · mine@… theirs@none'. For the five shots of WF 7 that are sent again after every opening.
- FOUND READING (16 Nov 15:25), to fix with the above once the log has spoken: OPENING A PROJECT IS NOT COUNTED AS HAVING HEARD THE SERVER — loadCloudProject never calls holdTree(…, true). So after every opening the first fetch (5 s after the first save) asks for the WHOLE project, cannot be recognised as "my own save coming back", and draws everything (865–912 ms on the iPad, every time: 12:21, 13:56, 14:05).

## v5.0.290 · #842 (dev, run 761, 16 Nov — run 760 red: the new test stopped waiting after 28 s, the news came after 24–30)
- The bar at the start of the app is a plain red line that fills from the left, like the pictures' (Roman, 16 Nov) — no stripes. Text unchanged: 'Opening app…'.
- OPENING A PROJECT IS HAVING HEARD THE SERVER: the opening now stands on the project it took (holdTree, heard), as a fetch does. Until now the first fetch after the first save asked for the whole project again, took the device's own save for news, rebuilt and drew everything (0.9 s on the iPad after every opening) and set the pictures coming a second time. Test 73, third test: after an opening, one's own first save coming back raises no 'pull: remote is newer' and draws nothing.
- Roman's log 15:28 with the reporter: the 'N shot(s) hold a version the server has not got' line did NOT come this time (it went 6 → 5 → 2 → 0 over the day as those shots were sent). The reporter stays in; the cause is not known.
- STILL OPEN, seen in the same log (15:18:10, 15:27:58, 15:28:04): at a START the device fetches the whole project and draws it (614–919 ms) whenever its own last save was not followed by a fetch before the app was closed — the mark 'holds everything up to …' only moves on a fetch, never on a save. Real cure to look at with a bench: a save's answer that differs from what was last heard only in the rows just sent IS having heard.
- LAZY LOADING 2, STEP A: the pictures of the project that is left are let go from memory when another project comes (the session's picture cache was never emptied — every project opened stayed in memory until a restart). Log: 'N picture(s) of the project before are let go from memory'.
- LAZY LOADING 2, AS DECIDED WITH ROMAN 16 Nov 16:05: (1) the OPEN project is whole on the device's storage, always — offline you reach its start, its end, every version. (2) The device does NOT keep the pictures of projects that are not open (no step B): two heavy projects kept would take the room the open one needs for new photos offline. (3) Step C, later, with the iPad measurement: of the open project only the pictures near the screen are held sharp in MEMORY; the rest are read from the device's storage when one gets near — never from the server, so offline is untouched.

## v5.0.291 · #843 (dev, run 763, 16 Nov — run 762 stopped at the device-save bench: syncTrace.ts named fill25.ts and so pulled the whole app into the bench; the button goes through window.__fh_fill25 now)
- CONFIRMED on Roman's iPad 16:28–16:30 (v5.0.290, Fitting 01 opened, three photos): every own save came back as 'N row(s), all of them what this device already holds (its own push) — leaving the screen alone' — no 'pull: remote is newer', no drawing of the project after an opening. The start at 16:27 drew once (410 ms) and fetched nothing. SEEN IN THE SAME LOG, to look at: 'scroll: centre on 9' written fifteen times in four seconds around the camera (16:29:29–33); each photo is still three saves of the same shot.
- FILL 25 (agreed 11 Nov, built 16 Nov): a button in the log panel. One tap adds 25 pictures of camera size (2400 px, about 800 KB, made on the device — a sky, a ground, a sun, a figure and the picture's number written large, so they are seen to be real) as versions to the shots of the open project, saves into LOCAL APP STORAGE and writes one line: pictures in the project, MB in APP MEMORY, KB each, the drawing of the project in ms, the save in ms, LOCAL APP STORAGE used. Signed in it says so in the log (the pictures would go to the SERVER) — the measurement is done signed out, in a new project.
- APP MEMORY, SAID: 'APP MEMORY <when>: the open project holds N picture(s), X MB · beside it: N fetched picture(s) no card shows, Y MB · N preview(s) standing in' — six seconds after a start, right after an opening, and with every picture in. The line of step A now reads '… let go from APP MEMORY (the side copy of what was fetched)'.
- CAMERA, asked and settled 16 Nov: the photo follows how the device is held (sideways in a vertical project = a wide picture, the person standing) — Roman: 'all is good', nothing to change.

## v5.0.292 · #844 (dev, run 764, 16 Nov)
- FILL 25 ON ROMAN'S iPAD, 16 Nov 17:16–17:18 (signed out, a new project of 8 shots, 12 taps): 108 pictures 90 MB in APP MEMORY · 208 → 168 MB · 308 → 247 MB — THE PAGE NEVER STARTED ANEW. One drawing of the project 103–108 ms at every size (drawing does not depend on the number of pictures; WF 7's 400–900 ms come from its 28 shots). A batch of 25 saved into LOCAL APP STORAGE in 1.3–1.9 s + 0.2 s, the same at 300 as at 100. LOCAL APP STORAGE 756 MB used at the end. So: step C is not urgent for the iPad; the iPhone (where the crashing was, 11 Nov) is still to be measured.
- DROP TEST: a button in the log panel, only on a device where FILL 25 was pressed, only signed out, two taps: empties the app's LOCAL APP STORAGE on this device and starts the app anew. (Signed out there is no other way to be rid of a test project — the project list asks for a sign-in, and signing in would send the 308 test pictures, 190 MB, to the account.)

## v5.0.293 · #845 (dev, run 765, 16 Nov)
- DROP TEST appears after ANY tap on FILL 25 — also one that answers 'NO PROJECT' — and at once, without closing the log (Roman, 17:27: FILL said NO PROJECT, so the flag was never set and there was no way out).
- Roman's iPad 17:27–17:33: the first DROP TEST (17:27:56) was undone three seconds later by a save already on its way ('25 picture(s) put on this device') — the app started anew with the test project; the second (17:31:04) held: 'start: 0 whole-project copies … nothing saved', 'APP MEMORY … 0 picture(s)'. He signed in; storage stayed at 406 MB — nothing of the test reached the SERVER. STEP A SEEN WORKING: '124 picture(s) of the project before are let go from APP MEMORY'. APP MEMORY per project: Workflow 02 = 111 pictures, 121.8 MB; the next = 22 pictures, 8.4 MB.

## v5.0.294 · #846 (dev, run 766, 16 Nov)
- DROP TEST holds the device's saves and waits 3.5 s before it empties the device, so a save in the air cannot write the test back.

## v5.0.295 · #847 (dev, run 767, 16 Nov)
- FILL 25 fills the MAIN shots first (every shot without a main picture gets one), then versions as before; the log line says how many main shots hold a picture. For the test Roman asked for: how 30 full main photos behave at a redraw, without the camera's HDR layer in the question.
- READ IN THE SWIFT (CameraModel.croppedAndResized): the camera's JPEG is written in Display P3 at quality 0.92 WITH Apple's HDR gain map inside when the photo has one (iOS 18+) — on purpose, proven 3 Nov. So 'HDR layer in the file' on the iPhone is what the file really carries; whether it is why the phone unpacks slowly (750 ms) is NOT known.

## v5.0.296 · #848 (dev, run 768, 16 Nov)
- FILL 25 really fills every empty main shot (v5.0.295 filled one: shots made with New are in drawing mode, and it had skipped those).

## v5.0.297 · #849 (dev, run 769, 16 Nov)
- FILL 25 WITH MAIN SHOTS, Roman's iPhone 19:06 (35 shots, every main shot a full 2400 px test picture, 600 KB, plain JPEG): a whole redraw 194–617 ms. The same phone at 17:52 with 33 shots holding CAMERA photos: 8790 ms. In the same 19:06 log three camera photos: 'real photo unpacked in 711 / 740 / 755 ms'. So it is not the 2400 pixels; it is something about the camera's photo. WHAT, is not known — hence:
- PHOTO TEST: a button in the log panel. For the newest pictures of the open project (up to four) it says what is IN the file (how many pictures it holds, whether a gain map is named, which colour profile), what it costs to unpack and paint AS IT IS, and what a PLAIN copy costs at full size, at 1280 and at 960, with each one's weight. Changes nothing, saves nothing.
- THE CAMERA'S RECIPE, AS DECIDED 3 Nov (TOMORROW.md) and as the Swift does it — re-read 16 Nov after I had spoken about HDR from memory: the shutter gives Apple's finished picture; Framehow crops to the frame, shrinks to 2400, saves a JPEG (Display P3, 0.92) — nothing is pressed into the picture ('keep the HDR off', 16:45); Apple's gain map is carried along inside the same file untouched (decision 17:10, 'HDR kept — works' 17:30). NOT KNOWN: whether it is in today's files, what it costs to unpack, whether Framehow shows the boost anywhere (the note says newer Safari does for an <img>; 'check the views' was never done).

## v5.0.298 · #850 (dev, run 770, 16 Nov)
- PHOTO TEST, Roman's iPhone 19:27, one fresh camera photo (2400×1349, 807 KB): IN THE FILE: 2 pictures, listed (MPF) — the gain map is there. AS IT IS: unpacked in 594 ms. A PLAIN COPY of the same 2400×1349 (727 KB): 15 ms. At 1280 (211 KB): 4 ms. At 960 (131 KB): 3 ms. So the 0.6–0.75 s per camera photo on the phone is the second picture in the file, not the pixels: a plain photo of FULL size unpacks forty times faster. A smaller twin is not needed for speed.
- PHOTO TEST ends by showing the newest picture twice, side by side — AS SHOT and PLAIN COPY — so the eye can say whether Framehow shows any difference at all.

## v5.0.299 · #851 (dev, run 771, 16 Nov 20:30 — 4 passed)
- THE BRIGHTNESS LAYER GOES (Roman, 16 Nov 19:50, after the side-by-side inside Framehow on his iPhone: left AS SHOT, right PLAIN COPY — "left is brighter … too bright. It is wrong … the highlights are totally over. The right one is the correct one, close to what the iPhone does"). The 3 Nov decision (keep it) was made on the Photos app; the check inside Framehow was never done until today. CameraModel.swift: keepBrightnessLayer = false — the gain map is not read and not written; the photo is Apple's finished picture, cropped, 2400 px, JPEG. NEEDS A BUILD FROM XCODE onto the devices (and a new TestFlight build before Apple). The log will say 'HDR layer not in the file', and PHOTO TEST should then say '1 picture(s)' and unpack in ~15 ms. NOT TOUCHED: the photos already shot with the layer — they stay slow on the phone and too bright where shown as a real picture (main shots, MAX view) until they are saved again plain; to decide.
- A PROJECT WITH UNSENT WORK IS NOT DELETED BLIND (Roman, 16 Nov 20:10: "i deleted a project that was saved and renamed, but in the open project modal still named with the old name! that's losing work"). Cause, read in the code: a save refused for STORAGE FULL stops whole, the new name with it — the list showed the server's old name. Now (1) the list row carries the name THIS device has while its save is waiting; (2) Delete and Delete now first ask, default No: "This project has work on this device that is not saved to the server yet. Delete anyway?" — No = nothing happens, the list stays, the save keeps trying. Test 31 extended.
- DELETE ACCOUNT ASKS TWICE (Roman, 16 Nov, text agreed): after the first Yes, default No: "Are you sure you want to delete your account with all its content? If you do, your account and all its content will be deleted. You can recover it for 7 days by signing in with your email and password. After that it is deleted for good." First account question: Cancel red, Yes plain. Second: no red button, both plain (Roman: "Both are gray. That is what we want."). Test 34 extended.
- OPEN (found 16 Nov, not built): pictures uploaded for a project whose save was then refused belong to no project on the server — Delete now cannot take them; they sit in the LIBRARY, count in the storage, and go with the nightly sweep after 24 h. Cure idea: the upload says which project it is for. To agree with Roman.

## v5.0.300 · #852 (dev, run 776, 17 Nov 11:47; full run 775 green on these files)
- A PICTURE DELETED ELSEWHERE IS ALWAYS NEWS (full run 772 red, runs 773 red / 774 green, 16 Nov 22:05). A device that was offline while another deleted a picture in the library came back, sent its shot WITH the picture; the server kept it deleted and answered with the row marked deleted; the app took the fetch after it for "my own push coming back" (A1, 9 Nov) and the card showed a dead picture for good. The hole is from 9 Nov; "opening counts as heard" (run 760) made it reachable right after an opening. Cure: deltaAlreadyHeld says news for any picture row marked deleted; a push whose picture the server holds deleted counts as refused → "the next fetch is applied in full". Bench check added (184 of 184). Test 48 prints the returning device's lines; proof in run 774: "picture of 915e3c (deleted elsewhere) — the next fetch is applied in full" → "pictures deleted in the library: 1 card(s) say so".
- Test 14 ("a photo in 3x2 does not move the page") closes the Open-project box first: the page behind an open box is held on purpose since 16 Nov. Big day part 4 red in run 772 was green alone in run 773 — watch it in the next full run.
- FULL RUN 775 (16 Nov 22:09–23:30): GREEN — 175 passed, 6 skipped, 0 failed, on these files (v5.0.300 · #852). Big day part 4 green in it.

## v5.0.301 · #853 — LIVE and dev (run 777, 17 Nov 11:52, "Dev AND LIVE are up"; same code as full run 775 green; live before: v5.0.270 · #822)

## v5.0.302 · #854 (dev, run 779, 17 Nov 12:24 — test 74 four plays green; the other upload tests green in run 778)
- JOB 1 — PICTURES THAT GO UP BELONG SOMEWHERE (17 Nov; Roman's phone 16 Nov: FILL 25 ×4 signed in → "picture upload failed (429)", 516 of 500 MB, 125 pictures in the library owned by no project). ONE CAUSE, read in the code (accountFlow.ts, the save's picture step): every picture of a save went up AT THE SAME MOMENT (Promise.all); when one failed the save failed and the retry sent ALL of them again — the copies that had arrived stayed on the server, on no card. Cures: (1) APP: four at a time; each picture that arrives is noted on the device under its content name (the sent-ahead note of 13 Nov, until now only for a project standing in; a note now carries its project and is good only for it), so the retry takes the server's file and sends only what is missing — log "N picture(s) were on the server already from an earlier try". (2) APP: a 429 is waited out (15 s, up to 6 times, all uploads wait together), the save does not fail — log "the server takes no more pictures this minute (429)". (3) SERVER: the room for a file is TAKEN in one statement before it is stored (totals.ts reserveBytes) — pictures arriving together can no longer all pass the wall; given back if storing fails. (4) SERVER: POST /upload?project=<id> writes the project onto the file (R2 customMetadata.project_id); deleteProjectForGood reads it in its one folder listing and takes the files sent for the project that never got onto a card (kept if another project's card or restore point names them). Order-safe: the old server ignores ?project=. Test 74 (four plays); tests 54 and 61 catch /upload with its new ?project=.
- PHOTO TEST measures THE GLOW (test tool only): a picture that still carries the brightness layer is shown small for a moment with dynamic-range-limit standard / constrained / no-limit — unpack ms, on-screen ms — and the time to switch a shown picture from plain to full glow; says whether the screen understands the setting. For item 25 (after Apple).
- Run 778 (17 Nov 12:15): 10 of 12 green — the wall play and the Delete-now play of test 74 green, all older upload tests green. The two red plays were the TEST's timing: the app pushes the moment the pictures land, so the mark must be taken before them. The app's own log in that run shows the cure working: 'push FAILED status=503 … the pictures that did arrive are remembered' → two seconds later 'push start … 4 picture(s) were on the server already from an earlier try — taken from there, not sent again … push OK'. Nothing deployed by 778.

## v5.0.303 · #855 (dev, run 781, 17 Nov 13:21 — no tests: test tool + Swift files only)
- SERVER run 780 (17 Nov, 'Server is up', version 4da3cf52): job 1 server side — reserveBytes at the upload door, customMetadata.project_id on uploads, deleteProjectForGood takes the files sent for the project that never got onto a card. No migration. Not yet in the app that is LIVE: four-at-a-time, the remembered uploads and the 429 wait (dev v5.0.302) — they go live with the next live deploy.
- CAMERA, Xcode round 1 of the series (Swift, CameraScreen.swift; goes to the phone only by an Xcode build): 1:1 fills its frame lines — the chip's picture was always sized by the frame's WIDTH, right for every frame wider than 4:3, wrong for 1:1 (black bars inside the lines); now sized to cover the frame on both sides. RATIO top left, the lens button top right where EV was, both in the corners of the SCREEN whatever the ratio; the EV button is gone (sliding up/down stays). Bottom left kept free for the series' picture box.
- PHOTO TEST looks through EVERY picture of the open project for ones that still carry the brightness layer (cheap look: "MPF" in the first 90 KB) and measures up to two of them for the glow, wherever they are; says how many it found. (Run on v5.0.302 it took the 4 newest of WF 7 — boards, PNG — and found nothing to measure.)
- TO CLEAR UP WITH ROMAN (17 Nov 13:15, his phone log, WF 7 = cloud id 90497508, a REAL project): "pictures deleted in the library: 69 card(s) say so" (WORKFLOW 05: 21) and 13 pictures named on cards whose FILE the server does not have ("picture deleted in the library (server has no file)": ver v1–v6 on some shots, floor v2, refs v1; "previews: 13 without one"). The 69/21 carry the server's deleted mark (library DELETE — on 16 Nov Claude told him "SELECT the day → DELETE" for the test pictures, which takes every picture of that day). The 13 have NO mark and NO file: cause unknown — asked him whether anything he wanted is missing; told him not to open WF 7 on the iPad until known. Also 13:11: the page started anew in WF 7 after ~100 s away ("redraw 97792 ms", "save took 98343 ms" = time spent suspended), back whole in 2 s.

## v5.0.304 · #856 (dev, run 782, 17 Nov — camera tests green; the series needs the Xcode build of round 2)
- CAMERA SERIES, round 2 (17 Nov; job 2 of the list; words agreed with Roman 13 and 17 Nov — see LAUNCH.md). App: camera.ts asks the native camera for a series of 4 with the names the shots will land on (seriesNamesFor: 'M' for an empty main card, the empty version on screen, then the strip counts on); collects each shot's live frame and real photo; at the end of the visit lands them all — landSeriesShotQuietly (actions.ts) for all but the last, applyCapturedImage for the last (the one move into the card), real photos that are still on their way take their live frame's place as before (applyFinalPhoto). A tap on the picture box = the same + the MAX view on the last shot. Swift: CameraModel counts the shots, freezes the screen only on the shot that closes the camera, makes the small pictures for the box, and cuts frames NARROWER than 4:3 too (1:1 photos were the whole 4:3 picture; now square); CameraScreen draws the picture box bottom left (square, newest shot fitted, names above it in one grey shape), DONE in place of Cancel once there is a shot, upright to the RIGHT of the shutter, shutter pale while a photo is being made; the plugin sends 'preview' with index/last, 'seriesPhoto', 'seriesDone', and answers `take` with { series, count, reason } when every photo is out and the web app has the screen. Old shell + new app, and new shell + old app, both behave as before.

## v5.0.305 · #857 (dev, run 783, 17 Nov 13:55; Xcode round 3 built by Roman ~13:57)
- CAMERA SERIES, round 3 (17 Nov, after Roman's first series on the phone — "works"; log 13:45: 4 on M v1 v2 v3, 1 on v4, 3 on v5 v6 v7, one push each): SHOT AFTER SHOT WITHOUT WAITING — the shutter no longer waits for the photo before (CameraModel keeps each capture's frame, size, moment and index under AVCapturePhotoSettings.uniqueID; onPhoto carries the index; the plugin sends it), "processing…" removed, the shutter never pale. A TAP ON THE PICTURE BOX GOES STRAIGHT TO THE MAX VIEW: no move into the card (target.noMove in applyCapturedImage), the MAX view is opened behind the camera and only then does the camera's screen go.
- CAMERA SERIES ON THE PHONE, round 3 (Roman's log 13:57–13:59): four shots inside one second ("series of 4 landed … 4 real photo(s) still on their way", each real photo in its place 0.4–2.4 s later, "the page never stood still"); box tapped → "the camera's screen goes 4 ms / 28 ms after the landing — the MAX view is under it", "max screen: shot 3, 26 picture(s), opens on v25". Roman: "I think it works nicely."

## v5.0.306 · #858 (dev, run 784, 18 Nov 13:46 — 13 camera tests green)
- Camera, Xcode round 4 (Swift only): the picture box has the PHOTO's own shape, no black bars (long side 88 pt): a lying or square photo has the names above it, left to right; a standing photo has them at its right side, from the bottom upwards. The photo fills the grey shape edge to edge; the box sits 14 pt from the glass (the buttons 22).
- Camera, Xcode round 5 (Swift only; Roman: "the box is now just right"): the photo in the box keeps square corners — only the grey with the names is round (UnevenRoundedRectangle), the bottom is straight; beside a standing photo the four names have four places spread evenly over its height, filled from the bottom.
- Camera, Xcode round 6 (Swift only): above a lying photo the names also have four places, one per quarter of the width, filled from the left — the empty places say a fourth shot is expected. Roman's log 14:22–14:23 (fitting): CAM on the empty talent card → 'M L16 L17 L18'; CAM in the looks view → 'L1 L2 L3 L4'. The rule is unchanged: where CAM is pressed decides.
- Camera box: the name of a shot that lands on the main card is SH (the shot) and in a fitting TL (the talent), in capitals — it was M (Roman, 18 Nov: "no one knows what it is"). Roman built Xcode rounds 5–6 on 18 Nov: "that is correct" (square photo corners, four places for the names in both layouts).
- CLAUDE'S SLIP, 18 Nov 13:46: the tab change below was SAVED WHILE RUN 784 WAS GOING (the rule: no saving during a run — the run's header was not checked first). Its 13 tests had passed and the commit (13:46:20) does not contain it, but the file changed at 13:46:33, in the middle of the build (done 13:46:47): whether dev v5.0.306 carries the tab change cannot be said. Cure: v5.0.307 with the change and its test, run 785.

## v5.0.307 · #859 (dev, run 785, 18 Nov — test 75 green)
- THE TAB OF THE VERSION ON SHOW IS IN SIGHT (Roman, 18 Nov: "you land on version 7 and the tabs above the card are on v1"). revealActiveVersionTab was called while the card was not on the page yet (a whole-page redraw draws a card, then places it): no width, nothing measured, the row stayed at its beginning. Now a row without width is looked at again at the next frame and after 0.3 s. Test 75.

## v5.0.308 · #860 (dev, run 789, 18 Nov 14:07 — no tests in the deploy: the nine turn tests were green on these app files in run 787; the cross-swipe line is for Roman's phone to confirm)
- The MAIN card showing a version scrolls its tabs too (Roman, 18 Nov, after v5.0.307: single and double strip views fine; "the only thing where it doesn't work is … a single strip view of shot or of talent"). renderMainFrame's compare branch returned before the reveal step at the end of the function; the step is now called on that way out as well. Test 75 extended with the main card.
- Run 786 (18 Nov 13:56): RED, nothing deployed — the TEST's fault: its cross-swipe is a touch ("Illegal constructor": the simulated device had no touch). The first two checks of the test were green in that run. The test now opens a touch device.
- THE VERSIONS OPEN IN 3x2 SURVIVE A TURN ON THE iPAD (Roman, 18 Nov: "when you are in 3x2 view and you have some versions open and you change the device orientation, then it's also no reset"). Read in view.ts (handleOrientationFlip): turning upright from 3x2 cleared the cross pointers, and turning back cleared them again — every card returned on its main picture. Now the cards that showed a version are noted, the upright view's version strip is put on that version, and the way back to 3x2 puts the pointers up again on the version the strip is on by then. Unchanged, as read: a turn never touches the version a version card shows; on the iPhone a turn to upright keeps the cross-swipe.
- Runs 786–788 RED, nothing deployed — three times the TEST (75, its new cross-swipe part), never the app: made-up touches are refused by the test browser (the older swipe test is parked for the same reason — should have been looked at first); then the tablet's 'main' view has two strips, where the main card never shows a version. The test now plays it on an upright phone, pressing the card's own › arrow. STILL TO PROVE with a tests-only run.

## v5.0.309 · #861 (dev, run 790, 18 Nov 14:24 — 13 camera and turn tests green)
- CAM ON A MAIN CARD THAT SHOWS A VERSION: THE CARD GOES TO THE NEW PHOTO (Roman's iPhone, 18 Nov 14:15, WF 7: "it stays on the last shot version instead of showing the new"; his log: "series of 1 landed (DONE) on v37" … "landed on the card (shot 8, ver 36)"). applyCapturedImage's fromCompare branch moved only the strip's own pointer (stripCrossCompare); the main card reads crossCompare, which stayed on the version shown before. Both move now. The landing line also says what the main card shows, where CAM was pressed and in which view; a view change that sends main cards back to their own picture is said in the log.
- NOT YET EXPLAINED (same log, 14:15:54): after a photo on shot 10 the card "jumped back to main". At that second the phone took its own work back as news ("pull: remote is newer (Phone)", 99 rows — list item 10) and redrew; that card's pointer was already -1 ("noted -1, on screen -1"). What dropped it is not in the log; the new lines above are there to catch it next time.

- Roman, iPhone, v5.0.309, 18 Nov 14:30: "works" (3x2 → upright → CAM on the card showing a version: the card goes to the new photo). The jump back to main was not reported again; the new log lines stay in to catch it if it returns.

- Test 75: run 791 (tests only) red once more on the cross-swipe part — on the simulated upright phone the test's steps did not reach the version view. The part is taken OUT of the test: it is back to exactly what was green in run 785 (the tab row after a whole-page redraw). The cross-swipe case stands on Roman's iPhone and its log line, and is OWED an automated play (to do with the simulator passes, list A8).

## v5.0.310 · #862 (dev, run 792, 18 Nov 14:39 — test 76 and the camera and turn tests green)
- CAMERA SERIES — CRASH SAFETY (18 Nov; the last piece of job 2; Roman agreed 17 Nov: "yes I think so"). Each real photo of an open series is filed on the device the moment the camera hands it over (picStore.keepSeriesShot: the picture under its content name, and a small note in localStorage — project, shot, strip, the names in order). The clean-up of unnamed pictures never takes one a note names. The landing marks the note landed and clears it half a minute later; a start that finds a note (accountFlow → actions.recoverCameraSeries) puts the shots on their card as the landing would have, skips any picture the card already has, then saves and sends. A series noted for another project waits until that project is opened. Log: "series photo N is on this device (… ms) — safe if the app is closed now" / "N shot(s) of a series that never landed are put on shot X now". Test 76 (through the same function the camera path calls; the native camera itself cannot be played). NOT covered: the second between the shutter and the real photo (about 1.2 s — the photo is not made yet); and in a very fast series, real photos that arrive after the landing.

## v5.0.311 · #863 (dev, run 794, 18 Nov — MAX view, camera, picture-during-fetch and storage tests green)
- NOT BUILT, ON ROMAN'S WORD (18 Nov 14:50): filing each shot's live frame at the shutter so that even the last shot before a crash comes back. His phone test (three fast shots, app closed at once → two back; two shots → one back) showed the last shot missing — its real photo takes 1.2–2 s to be made and was not there yet. Claude built the live-frame cure; Roman: "That complicates things again. We have to save some small picture. This is bullshit. … when the app dies in the middle of 4 shots taken, then what is saved is saved … that's fair enough, because the user knows." TAKEN OUT AGAIN before any deploy (the three files put back to v5.0.310). THE RULE: what the camera has finished and handed over is safe; a shot still being made when the app dies is lost, and that is accepted.
- THE MAX VIEW, job 3 of the list (18 Nov; words agreed 13/14 Nov and today — "agree to all points"): (7) THREE STARS, bottom left as on the cards (a row in wide projects, a column in upright ones and fittings), on versions only; a tap rates the picture one is looking at, a tap on its own level takes the stars away; nothing moves while one looks — the versions go into star order when the shot is LEFT (viewer closed, or up/down), and the cards keep showing the same pictures (maxView.settleStars). (8) Coming back to a shot in the same viewing lands on the version it was left on; a shot not yet visited opens on the shot itself, as before. (8b) The name stands TOP LEFT, 32 px high like the icons at the top right, letters 20 px (Roman: "now it looks a little smaller"). Test 46 (up and down) extended.
- MAX VIEW, two more from Roman before the deploy (18 Nov): (a) A PLAIN PHOTO FILLS THE SCREEN IN ITS OWN SHAPE — "the 4:3 and 1:1 aspect ratio don't fill the screen. They are kind of small": the viewer's surface was the CARD's shape with the picture fitted inside (a 4:3 photo on a 16:9 card = a 16:9 box with black beside the photo, fitted to the screen). A picture with nothing drawn on it now takes its own shape; one with a drawing keeps the card's surface, because the strokes are measured on the card. (b) NO CLOCK AND BATTERY OVER THE MAX VIEW OPENED FROM THE CAMERA'S PICTURE BOX (his iPad): the viewer hid them when it opened behind the camera, and the camera put them back on leaving; the app now takes them away again when the camera has gone (maxViewKeepsTheClockAway). App side only — if a flash of the bar is still seen, the camera's own leaving (Swift, dismissScreen) is the place.
- RUN 793 RED — AND IT WAS THE APP: A PHOTO LOST TO A FETCH (18 Nov 15:24, test 45 "phone cam, frameline later ON (not a fitting)"; green in runs 790 and 792 — a race, there before today). The device's log in the test: "camera: photo saved 2400×1349" · "camera: landed on the card (shot 1, ver 1)" · "pull: remote is newer (Desktop)" [its own first save coming back] · "local frames not yet on the server: 1" · "1 frame(s) changed later elsewhere — taking theirs" — and the card was empty. Cause, read in the code: a change gets its time when the next SAVE looks at the project (stampChangedContent); a fetch applied before that look judged the shot "changed, age unknown", and whoseFrameWins gives a shot of unknown age to the server's copy. Cure: the fetch takes that look itself before it judges (accountFlow, before keepMine/takeTheirs) — work done a moment ago has a time: now. Nothing else in the rule changes (age unknown from an old save still loses to a known time). NEEDS THE FULL RUN before live, like every change to the sync.

## v5.0.312 · #864 (dev, run 795, 18 Nov 16:45 — look only, no tests in the deploy)
- Roman on v5.0.311 (18 Nov): MAX view — "all other things checked and all is good". Two small ones, agreed: the card's MAX button (the two arrows) is fully shown — black 45 % behind a white icon, like the side arrows on the same card (it was the whole button at 55 %); in the camera, Cancel / DONE stand in the same grey pill as RATIO, same small letters, not bigger (Swift — needs an Xcode build).
- ONE LOOK FOR EVERY ICON ON A PICTURE (Roman, 18 Nov, after the tables of what each icon had): "make it everywhere the same, like the empty setup pill, but no outline on the icons except the setup pill": black 60 % behind, white icon or letters, the whole button shown at 60 %, fully shown on hover (a mouse's hover only — after a finger's tap nothing stays bright). On the cards: MAX button, side arrows, stars, empty setup pill; in the MAX view: close, share, arrows, stars; in the DRAW view: close, arrows, stars, setup pill. One block at the end of globals.css. This REPLACES the "MAX button fully shown" of an hour earlier (never deployed). The setup pill with a setup keeps its colour; the camera's pills are black 45 % with full white letters (Swift) — to decide whether they join.

## v5.0.313 · #865 (dev, run 796, 18 Nov — look only)
- The icons on a picture are shown at 70 %, not 60 % (Roman, 18 Nov, after seeing v5.0.312): black 60 % behind, white, the whole button at 70 %, fully shown on hover. One number, in the block at the end of globals.css.

## v5.0.314 · #866 (dev, run 797, 18 Nov 17:12 — look only: the card's side arrows smaller)
- The side arrows on a card are a little smaller: the grey box 26 × 40 instead of 28 × 48 (as wide as the MAX button), the arrow itself unchanged, the touch area as before. Cards only — 3×2, DRAW and the MAX view keep their sizes.

## v5.0.315 · #867 (dev, run 798, 18 Nov 17:13 — look only: the MAX view arrows smaller)
- …and the arrows of the MAX view the same way: 36 × 54 instead of 44 × 64, arrow unchanged, touch area as before (up/down follow).

## v5.0.316 · #868 (dev, run 800, 18 Nov 17:38 — app side; server side live since run 801, migration 0035 done)
- A project deleted for good (Delete now, or the nightly sweep) leaves every screen: the server keeps a small note of it (migration 0035, `projects_gone`) and answers 410 "deleted_for_good"; a device that has it open closes it at its next word with the server, drops its own copy (a reload does not bring it back) and shows the Open project list. Nothing is asked; unsent work on that device goes with it (Roman, 18 Nov: his WF 7 lived on in a browser). A project still in the recover list keeps its question (SAVE AS NEW / DELETE). Test 77. NEEDS THE SERVER DEPLOY with the migration.

## v5.0.317 · #869 (dev, run 803, 18 Nov 17:52 — app side; the heartbeat part waits for its server deploy)
- Deleted for good while the question "IT SEEMS YOU DELETED THIS PROJECT ALREADY" stands on another device (Roman's phone, 17:42: plain Delete, then Delete now — the phone went on asking): the question goes off the screen with the project. A SAVE AS NEW being named at that moment saves nothing. Test 77, second play.
- The heartbeat says "deleted" too (run 802 red showed it: a device that only looks at a project sends nothing but heartbeats, and those answered a plain 404 — it learned nothing until its next fetch). Server: the heartbeat route answers like the sync routes (410 deleted / deleted_for_good). App: that answer on a heartbeat closes the project (for good) or asks (recover list). NEEDS A SERVER DEPLOY.

## v5.0.318 · #870 (dev, run 806, 18 Nov 18:19 — the test and the heartbeat part; the SAVE AS NEW cure is SERVER, live since run 807)
- SERVER: SAVE AS NEW on a deleted project sends every shot (Roman's "QQQQQ TEST 2", 18 Nov 18:03 — 3 shots sent, 2 taken; shot 1, changed last on the other device, was judged against the row still under the DELETED project, called stale and left there; the device believed all was sent). The stale test now reads this project's own rows only (frames and versions). Test 77, third play. NEEDS A SERVER DEPLOY.
  (run 805 red: the decision alone was not enough — the upsert carries the same date guard at the moment of writing, #514, and held the shot back silently. Rows carried in from a deleted project are now marked (`payload.carried`) and written as sent.)

## v5.0.319 · #871 (dev, run 808, 18 Nov 18:46 — test only on the app side; the cure is SERVER, live since run 809)
- SERVER: SAVE AS NEW also keeps a shot the other device had DELETED but this screen still shows (Roman: "should be saved because it was showing on this device"). The deletion record was looked up by the shot's name alone at the moment of writing; it now belongs to its own project. Test 77, third play (4 shots: one changed last elsewhere, one deleted elsewhere). NEEDS A SERVER DEPLOY.

## v5.0.320 · #872 (dev, run 811, 18 Nov 20:44 — FULL RUN 812 green on this code: 184 passed)
- FULL RUN 810 (18 Nov, 183 green, 1 red): test 39 "the dead copy at start" — a regression of today's "deleted for good closes the project": an unsent copy of a project deleted for good, put in place at start to be sent, was taken for the open project and closed — which emptied the device's save of the project really open (the start ended empty). Never live. Cure: nothing is closed while a copy stands in; the copy is parked by the upload, as before.

## v5.0.321 · #873 (DEV AND LIVE, run 813, 19 Nov — everything since v5.0.301 is live; full run 812 green on this code)

## v5.0.322 · #874 (dev, run 815, 19 Nov 11:58 — test 78 green; to be seen by Roman)
- +SH / +TL: a card that shows a VERSION (in a strip view, or the main card cross-swiped to one) has a button for a new shot, first in its row, with a thin line after it (Roman, 19 Nov; words agreed: +SH in a storyboard, +TL in a fitting — the names from the camera box). It does what New does on the main card: a new shot after this one. The main card keeps New. NOT in the 3x2 and overview cards (their own rows, untouched). After a cross-swipe the new shot shows its main card (no pointer is made up for it). Test 78. TO BE SEEN BY ROMAN (does WRITE stay in the first row on the iPhone).
  …and the new shot is slid to and outlined in red in a strip view too, as in the SHOT view (Roman, 19 Nov): the slide picked the main card, which a strip view does not show; the strip's card had no outline class.

## v5.0.323 · #875 (dev, run 816, 19 Nov 12:13 — tests 75 and 78 green; Roman: "love it, works")
- +SH / +TL also on a 3x2 card cross-swiped to a version (Roman, 19 Nov: "only in 3x2 cross swipe the button is still missing") — not on the phone, where the 3x2 row has no New either.
- On the last version tab the "+" comes into sight too (Roman, 19 Nov): the row slides on so that the + shows — only when the active tab is the last one and tab and + both fit; otherwise the tab wins.

## v5.0.324 · #876 (dev, run 817, 19 Nov 12:37 — tests 73 and 79 green; a sync change: full run before live)
- JOB 4 ITEM 10 — OWN WORK COMES BACK AND REDRAWS: THE CAUSE, FROM ROMAN'S iPAD LOG (19 Nov 11:21:44–48, v5.0.321). After a camera series two pushes follow each other within a second (push 1: shots e2a5d6 + 561404; push 2: 561404 again, its real photo). The app remembered only what the LAST push sent, so the fetch that brought back both called e2a5d6 news: "pull: remote is newer (Tablet)" on the tablet itself, the storyboard rebuilt, "the card was redrawn meanwhile". Cure (deltaMerge.carrySent): what earlier pushes sent stays "mine" from push to push — only where the new reply holds the row exactly as the reply before did; a row another device wrote in between is dropped from the memory and applied the ordinary way. Bench 1c (9 checks, 193 of 193). Test 79. A SYNC CHANGE: full run before live.

## v5.0.325 · #877 (dev, run 818, 19 Nov 13:37 — tests 45, 76, 78 green; to be seen by Roman on the phone)
- CAM ON AN EMPTY MAIN / TALENT CARD — DECIDED AND BUILT (Roman, 19 Nov, in his words): "when shooting photos in versions, they land in versions (as we have) · when 1 photo in MAIN CARD it lands in main card · when more than 1 photo in MAIN CARD they land in v1, v2… and the v1's photo is copied into MAIN CARD as well". Also with versions already there (v1–v3 → the series is v4, v5…, the main card gets a copy of v4). A main card that has a picture is left alone, as before. A plain copy, not a link (drawing on one leaves the other). The same picture on two cards goes up ONCE (one file; the second upload waits for the first). The camera box says SH v2 v3 v4 (TL in a fitting): the first is on the main card AND takes the first version's place. The start that recovers a series follows the same rule. Test 76, second play. App only, no Xcode build.
- THE PROMPT ON AN EMPTY MAIN CARD (words agreed 19 Nov): "add a / PICTURE / by choosing an action below" — new for storyboards (their empty main card said nothing); a fitting keeps TALENT PROFILE PICTURE. When the shot's other strips hold something, three more lines after an empty one: "or see your other / CONTENT / by pressing buttons above". No strip names in it.

## v5.0.326 · #878 (dev, run 819, 19 Nov — look only)
- The prompt on an empty main card: smaller (10 px), lines closer (1.3), PICTURE / TALENT PROFILE PICTURE and CONTENT white (Roman, 19 Nov, after seeing v5.0.325: "too big, the spaces between the lines on iphone are huge … you forgot to make white"). Look only.

## v5.0.327 · #879 (dev, run 820, 19 Nov 13:50 — look only; Roman: "works")
- The prompt on an empty main card, second look (Roman, 19 Nov): lines a little further apart (1.5, was 1.3); PICTURE and CONTENT grey like the rest in a storyboard — white only in a fitting ("we keep that white in FITTINGS").

## v5.0.328 · #880 (dev, run 821, 19 Nov 13:59 — look only)
- The prompt's key words in a storyboard are not bold any more (Roman's iPhone screenshot, 13:53: PICTURE looked white — the colour was the same grey, the bold strokes read brighter). A fitting keeps bold and white.

## v5.0.329 · #881 (dev, run 822, 19 Nov 14:15 — look only)
- The prompt in 3x2 on the phone: much smaller (6.5 px), each line on one line (Roman's iPhone screenshot, 14:13: at 10 px "by choosing an action below" broke in two and the longer text ran out of the card, under its edge).

## v5.0.330 · #882 (dev, run 823, 19 Nov — look only; Roman: "perfect!")
- IN THE APP, AN UPRIGHT CARD FITS THE iPHONE'S SCREEN (Roman, 19 Nov 14:23, a fitting in LOOKS: the second row of buttons was half out of sight since the app draws under the clock). The picture's height was a hand-tuned sum made for Safari; in the app it is now measured — screen height, less where the first card starts, less what the card needs around the picture, less a little room above the home bar — and only ever made smaller. The app only, upright projects (fittings and 9:16 storyboards): the iPhone held upright, and the iPad either way (Roman: "same for ipad"). Safari and the phone held sideways are untouched. A log line says the numbers once. The shutter sound stays (Roman: "let's keep the sound").

## v5.0.331 · #883 (dev, run 824, 19 Nov 15:31 — tests 73, 79, 80 green; a save-path change: full run before live)
- JOB 4 ITEM 9 — THE START FETCHES THE SAME NEWS AGAIN: MEASURED (Roman's iPhone, 19 Nov 15:21–15:22, fitting FFFFFFFG MONDAY). Three starts in a row: "holds everything the server had up to 15:03:30" → 49 rows → "pull: remote is newer" → the storyboard rebuilt, each time. The mark of what was taken rode in the ordinary device save: two seconds with no change at all, restarted by every touch — the one start that was left alone got it written ("saving: 18 frame(s)" at 15:22:05), the two that were touched or closed within seconds did not. Cure: the mark has its own wait that nothing restarts — the save is written 0.8 s after a fetch (looking again every 0.5 s while a fetch or a stand-in is busy, 15 s at most), and says so in the log. Test 80. (A start of the landscape project MADILLO WIDE in the same log fetched nothing: fine.) NOT the cause I had read in the code beforehand (own push never heard before closing) — that case stays possible, not seen.
- …AND THE SECOND LOG, WITH A PHOTO (Roman's iPhone, 15:24–15:25, MADILLO WIDE): photo on shot 2, push OK at 15:25:02, app closed some seconds later (the phone was turned, a fetch was running), start at 15:25:12: "local frames not yet on the server: 1" → "pull: remote is newer (Phone)" (its own name) → the shot pushed again and ITS PICTURE UPLOADED A SECOND TIME (previews e5d992da then 630b931e — the first file is left on no card until the nightly cleaner). The device's save held the photo but not the word that it was sent: that word waits for the same quiet two seconds. Cure: the same short wait after every push OK (what the server has is written to the device 0.8 s later). Test 80, second play. My first reading of the code (own push not heard before closing) is confirmed by this log; the rebuild at such a start (138 ms here) stays — the memory of what was sent is not kept across a restart; not built.

## v5.0.332 · #884 (dev, run 825, 19 Nov 17:29 — tests 58 and 63 (3 plays) green; server side done: runs 826 and 827, migrations 0036 and 0037)
- "scroll: centre on N" is said once per turn, not seven times (list item 11; the seven centrings in 1.2 s after a turn are on purpose and stay).
- ITEM 9 SEEN ON ROMAN'S iPHONE (v5.0.331, 15:41–15:42): photo, push OK, "what the server has is written to the device now"; the start 18 s later restores "up to 15:41:50", no news, no push. Second round: the app closed while the push was still in the air — the start sends that one shot again (nothing can note an answer that never came); no second upload of the picture.
- THE PLAN LINE (list item 12; words agreed with Roman 19 Nov): "PLAN: Free during launch." / "Framehow is currently free to use. Pricing may be introduced later." — in Create account, just above the buttons, and in Account settings; not on Log in. Server: `users.plan`, default 'free_launch' (migration 0036) — a field only, no billing code.
- UPDATE BY A DATE, AND — SEPARATELY — THE SWITCH (list item 16b; every word agreed with Roman 19 Nov). TIMELINE, 14 days at most: day 0 the card as it was (NOT NOW · RELOAD) · day 2 "Update by <date>" (bold) / "This version will stop being supported after that date." (NOT NOW · UPDATE NOW) · day 14 "This version is no longer supported. Please update Framehow to continue." (UPDATE NOW only, the app behind covered). Each card once; all three only in the quiet moment the first card always waited for; the last also waits while a fetch is applied. The first two keep the five minutes of use; the last card and the switch do not. Never offline. PER ACCOUNT: the count starts with the first card on any device and is kept on the server (users.update_clock_at / _version, migration 0037; GET/POST/DELETE /user/update-clock; earliest wins; a count older than 21 days, or started by an older version than the device runs, does not apply) — on the device when nobody is signed in. A RELOAD that could not go (no line) does not count. THE SWITCH IS A SEPARATE PIECE OF SAFETY CODE — src/lib/safetySwitch.ts (Roman: "the switch should just never be mistaken with the 3rd card"): its own question to the server, memory, box (#safetySwitchOverlay) and restart; the update cards know nothing of it. public/update-rules.json, "stop_and_update_below": a version, normally null; read once a day (first time in front with a line; and at a new day). An app older than it — and only when a newer build really is out — SENDS NOTHING MORE (push, retry, unsent copies; the update's own "send first" too) and shows its box at the first safe moment (the quiet moment, and no fetch being applied): the same two agreed sentences, UPDATE NOW only; the project is saved on the device, the line is checked, then the restart. To use: change the one line, deploy. Test 63 (timeline in play 1; new play 3 for the switch). NEEDS: dev deploy + server deploy with migration 0037.

## v5.0.333 · #885 (dev, run 828, 19 Nov 17:40 — the switch's play green)
- The switch's box can carry OUR OWN WORDS on the day it is used (Roman: "could we eventually change that text … when using the switch?"): an optional "message" in update-rules.json replaces the two agreed sentences — shown as plain text, 300 letters at most. Test 63, play 3.

## v5.0.334 · #886 (dev, run 829, 19 Nov 17:54 — test 81 and big day parts 1, 1b, 10 green)
- A PROJECT FROM PICTURES: A FILE NAMED BY A CODE IS NUMBERED (list item 13; simulator find of 5 Nov). Pictures from the Photos picker arrive as "9406091e-2a71-…"; the shots were labelled "9406091e 2a7" in any order. Now numbered in the order picked (1, 2, 3 — or on after the highest number the named files bring); files with real names keep them exactly as before, and a coded file no longer stops the shared word being dropped from the others (scene_03 → 03). frameLabel.ts (pure; bench 9 checks), files.ts. Test 81 (Roman: also the properly named folder and the storyboard PDFs, "to be sure that we don't break anything else"): named, shuffled, worded, coded, mixed; the three fixture PDFs import, none named by a code — their names go into the log to be pinned.

## v5.0.335 · #887 (dev, run 830, 19 Nov 18:09 — test 81 green incl. the question and the pinned PDF names)
- "Load Images from Folder" writes the file names into the log exactly as the device hands them over (the first eight) — to MEASURE what Roman's iPhone and iPad really give for pictures from Photos (a code, IMG_4021, or 'image' for all?) before anything more is built on a guess.
- Test 81 pins the names of the three storyboard PDFs as run 829 read them (18 shots "1. 2. 3. 4. 5A. 5B. …", 23 shots "FRAME 01 … FRAME 06A FRAME 06B …", 12 shots "#1 … #12"): a later change to PDF naming shows red.
- MEASURED (Roman's iPhone, 17:57, v5.0.334): pictures from Photos arrive as "IMG_8813.jpeg" etc. — the shots are 8813, 8814, 8817, 8819, 8820. Real names; nothing more to build for item 13.
- PICTURES WITH A CAMERA'S OWN NAMES: THE PERSON IS ASKED (Roman, 19 Nov, after his phone made shots called 8813, 8814 …: "that's weird"; the box and its words are his). When every picked picture is named by a camera (IMG_, DSC_, PXL_, GOPR … — or only by a code), before the project is made: "PLEASE CHECK THE IMPORTED SHOT NAMES:" / "These pictures carry names (IMG_8813 … IMG_8820)." / ○ CHANGE NUMBERS TO — Start numbering at: [01] / ○ KEEP ORIGINAL NUMBERS / OK. One of the two is always ticked (CHANGE to begin with). CHANGE numbers them from the start typed, in the form typed (01 → 01 02 03; 5 → 5 6 7), in the order the photos were taken. KEEP is as before. A folder somebody named is not asked about. frameLabel.ts (cameraNumberOf, numberedFrom; bench +12), modals.ts (askImportedShotNames), files.ts. Test 81.

## v5.0.336 · #888 (dev, run 831, 19 Nov — look only)
- The question about camera names: "CHANGE NUMBERS TO:" with the colon (Roman, after seeing it).

## v5.0.337 · #889 (dev, run 833, 20 Nov 13:16 — tests 59, 60, 74, 76 green)
- FULL RUN 832 (19 Nov 19:09–20:34): 190 green, 1 red — test 60 "three pictures loaded at once fill v1, v2, v3 … on both devices": the iPad had v1● v2● v3○. A fault of THE SAME DAY's work, never live: since "the same picture goes up once" two versions can name one file; on the receiving device both arrivals of that file looked for "the version with this name" and both took the first — the other stayed empty. Cure (accountFlow, the background picture arrivals — both the arriving and the 'picture gone' path): the version the arrival was meant for, if it still carries the name; else one with the name and no picture yet; else the first.

## v5.0.338 · #890 (dev, run 834, 20 Nov 13:42 — test 70 (4 plays) and big day part 7 green)
- NO EXPORT WHILE THE PROJECT'S PICTURES ARE STILL ARRIVING (list item 28, moved up by Roman 20 Nov). A project opens at once, ALL its pictures follow in the background (the bar at the bottom counts); the previews on the cards are never exported — an export pressed in that window made a document with empty cards and said nothing. Now every export (PDF, PowerPoint, images; 9:16; fitting) stops there with a note — his words: "PICTURES ARE LOADING" / "See the progress in the bar at the bottom of the screen." / OK — and makes nothing; the export box stays as it was. No second bar, no waiting code. Test 70, third play.

## v5.0.339 · #891 (next)
- LIMITS (list item 15; numbers and words agreed with Roman 23 Nov): 50 projects per account (live ones), 300 shots per project; versions are not counted. A limit only stops MAKING SOMETHING NEW, at the tap that would go over — it never refuses a save. App (limits.ts): New project (menu, project list, start chooser) asks the server for the count first, two seconds at most; no line / nobody signed in = not known = not stopped. New, duplicate, several pictures becoming new shots, and a folder of more than 300 pictures: nothing is made. Boxes, his words: "PROJECT LIMIT REACHED" / "An account can hold 50 projects. Delete the old projects you no longer need to make a new one." — "SHOT LIMIT REACHED" / "A project can hold 300 shots. Create a new project for more." NOT counted on the way in: a storyboard PDF (its shots are known only after it is read) — it comes in whole and no shot can be added after. SERVER: its own ceiling of 100 projects (403 project_limit), against abuse only — a project made offline must never be left stuck on a device. Test 82.
- THE ANALYTICS SIGN-IN LOCKS (Roman, 23 Nov): 5 wrong passwords from one internet address, then five minutes shut ("Too many wrong tries. Wait five minutes."); the right password clears the count. Server only.
- THE GITHUB TOKEN (list item 16, 23 Nov, done by Roman): new fine-grained token for this one repository, the old ones deleted, the address in the project carries no token any more, the Mac's keychain keeps it.
