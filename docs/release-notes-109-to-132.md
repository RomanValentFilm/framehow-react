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
