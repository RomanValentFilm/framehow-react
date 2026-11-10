# Simulator session — 9 Nov 2026, evening (iPhone 17 simulator, iOS 27.2, dev v5.0.190 · #742, not signed in)

## Faults
1. The simulator's home-screen app was still on v5.0.144 (5 days old) and only updated after a full device restart — resuming the app does not pick up a new version. (G3 reload-on-new-version: real users with the PWA will sit on old versions the same way.)
2. On opening (old version) the red "Offline — changes saved on this device only" banner and the F2 box "To edit this project on your desktop, you'll need to save it first" (Later / Save Now) came up together — F2 still there.
3. LANDSCAPE: the top bar is cut by the rounded screen corners on BOTH sides — "GROUP" shows as "ROUP" (left, F4) and "LIBRARY" as "LIBRA" (right). The second bar (SHOT … M+3) also runs to the edges. Needs left AND right safe-area padding.
4. The F2 "save it first" box popped up AGAIN the moment WRITE was pressed (landscape) — it covered the WRITE box and the write was lost (keyboard closed, nothing to type into). Second WRITE worked. So F2 is not just annoying: it interrupts work.
5. G1 IS REAL ON THE PHONE: shot 02, ANGLE strip, untouched (one empty v1), Load → Photo Library → 2 pictures → THREE versions v1 v2 v3; v1 stays EMPTY, the pictures are on v2 and v3. Test 60 (desktop, VERSN strip, load sheet) is green — the phone path (picker straight from Load, touch device) or the ANGLE strip behaves differently. Log line seen: "picture loaded: IMG_1.png 1774×887 → 1774×887 PNG (metadata removed)".
6. Minor, dev only: in landscape DRAW the colour/pen/eraser bar sits under the developer log strip (users don't have the log).
7. LIBRARY when not signed in: the button does nothing visible. Log says "PICTS: not signed in" — the person gets no word. Should say "Sign in to see your pictures" (or show the device's own pictures).
8. Account box on the iPhone: "New here? Create an account" needed three taps — the keyboard popped up and moved the box under the finger (focus went into EMAIL/PASSWORD instead). After Cancel the page underneath had jumped to another shot (was on 02, came back on 01_4).
9. Minor: in iPhone portrait the NEEDS table's last column (DIRECTION) runs off the card's right edge.
10. 3×2 in portrait says "Please rotate the screen, the 3×2 view is available only in landscape view" — but rotating does NOT open 3×2: landscape shows the single NEEDS card (shot 01, TALENTS tab). 3×2 had to be pressed again in landscape.
11. LANDSCAPE 3×2: the header line is clipped instead of the bar — "FRAMEHOW" shows as "AMEHOW" (left corner), the red Menu button is cut at the right.
12. GROUPS panel (landscape-left): the Dynamic Island covers the panel's left edge — the hint text under "+ New Group" and the new group's name are half hidden (F4).
13. "+ New Group" opens its box only several seconds after the tap (looks dead; three taps before it showed). Save on the new group also took several seconds; the log shows two full redraws for it ("redraw: 13 shots in 369 ms", then 456 ms). The group itself was made correctly (13 shots).
14. The New Group box in landscape: the keyboard covers the shot list — only the first shot is visible; Select All works but you can't see what you selected.

## Not tested (no account in the simulator, or camera)
Project list with the one-row/unsent note, storage line + "Confirm your email … · Resend mail", LIBRARY delete's two questions, logout warning — all need a signed-in account; these are covered by tests 58, 61, 48 on the bench. Camera: none in the simulator.

## Worked
- LOAD on a shot's main card with 4 pictures from the Photos picker (multi-select offered): first onto 01#1, new shots 01#2, 01#3, 01#4 right after it, then the existing 01_4 — correct order and numbering (A15). Log: previews made per picture.
- WRITE in landscape (second try): box fully above the keyboard, OK reachable, "Test" on the card at once; kept after rotating to portrait.
- Rename a shot: box above the keyboard ("You are changing the frame number.").
- 3×2 view in landscape (after the second press): shots and their strips show.
- NEEDS: column opens on every shot, DAY 1 ticks red.
- Create-account box: both tick boxes, "Send me news and updates about Framehow." exactly, buttons visible.
- DRAW: big view, a stroke lands and is kept on the card after closing and rotating.

## Replay with Roman, 10 Nov (v5.0.201 in the simulator) — his verdicts
- 1 old version → FAULT, fixed: daily update check, fetched whole, switched at a quiet moment, same screen after (v5.0.198–201, test 63)
- 2 "save it first" on opening → NOT a fault: it is the save reminder (1 min, then 15 min, twice) and leads to an account; kept
- 4 reminder on top of WRITE → FAULT, fixed: it waits while a box / DRAW / camera / SETUPS is open and comes ~3 s after (test 62)
- 3 + 11 landscape corners (logo "F", Menu corner) → NOT a fault: fine on Roman's real iPhone and iPad (simulator corner mask). GROUP / LIBRARY not cut today.
- 10 turning to landscape does not open 3×2 by itself → NOT a fault: pressing 3×2 is right
- 12 Dynamic Island over the outer 3×2 card in landscape → LEFT AS IT IS (Roman: side room would make the app narrower; the user scrolls). Known fix if Apple objects: room on the island's side only.
- 7 LIBRARY silent when signed out → FAULT, fixed (v5.0.202): a notice with Sign in / Not now. The other buttons stay as they are when signed out (Roman).
- NEW, found in the replay: the update never came on a device with nobody signed in (waited for "settings still to send") → fixed v5.0.203, test 63 part 3.
- 5 several pictures into an empty strip (G1) → FAULT on the real iPhone, fixed v5.0.204 (read all first, place in order); Roman confirmed.
- Update on Roman's real phone (10 Nov, 18:58, v5.0.212 → 213): card, RELOAD, "UPDATED", back on shot 2 view main, and the fetch after the start notes the versions on show ("noted 15, on screen 15", "noted 3, on screen 3") — the card stays on its version. Confirmed "perfect".
- STILL TO CHECK on the phone: 8 create-account box + keyboard · 9 NEEDS last column upright · 13 "+ New Group" slow · 14 New Group sideways, keyboard over the shot list. And: a fresh start with NO connection (project + pictures from the device).
