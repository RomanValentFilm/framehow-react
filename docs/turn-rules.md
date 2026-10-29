# TURNING THE DEVICE WHILE SOMETHING IS OPEN — THE RULE (29 Oct 2026, Roman)

Made for the camera (v5.0.127 · #679, test 50). It is for the INTERACTION WITH
THE PICTURES / CANVASES only: DRAW, CAM, WRITE, MAX VIEW — those four.

## The rule

1. **From pressing the button until it is done/closed, the page in the background
   ignores every turn.** No view change, no strip change, no "3x2 needs landscape"
   message, no scrolling, no "which card is in the middle" update.
2. **Remember at the press:** the view, the shot (by its id — never by its number;
   shots added or deleted meanwhile must not matter), the card's top on the screen,
   and the screen's shape (portrait/landscape).
3. **When it is done, look only at how the device is held NOW:**
   - **Held as at the press** (also: turned and turned back, e.g.
     landscape → CAM → portrait → landscape → photo): the same view, the card put
     back at exactly the top it had at the press. Nothing else moves.
   - **Held the other way:** the ordinary turn rule runs ONCE now:
     - iPad 3x2 → portrait: MAIN + VERSIONS, on that shot.
     - iPhone portrait: MAIN.
     - Any view that also exists in the new orientation stays, and the card goes
       back to its top (if the card no longer fits there, it stops at the screen's
       bottom edge, still fully visible).
4. **After such a turn, 3x2 never comes back by itself.** Turning back later keeps
   the view; 3x2 only when the user presses 3x2. The "came from 3x2" note
   (`_returnTo3x2`) is cleared at the end, and ignored at the end even if an
   EARLIER ordinary turn left it (bug 29 Oct: portrait double view → CAM →
   landscape → landed in 3x2).
5. **The card shows what was just made** (the new version, the drawing), never
   jumps back to the main picture.
6. **No timers, no holds, no waiting.** The user may scroll at any moment; the
   first touch or scroll stops any putting-back at once.
7. **A normal turn (nothing open) is unchanged.**

## How it is built (camera — copy this for the others)

- `camera.ts`: `cameraSessionStart()` at the press (keeps the shape),
  `cameraSessionEnd()` at landing / close / cancel. The end puts back the
  shape of the press, compares with now, runs `handleOrientationFlip()` once if
  held the other way, clears `_returnTo3x2`, and returns whether the view changed.
- `view.ts handleOrientationFlip`: while `__fh_cameraBusy()` → does nothing and
  does NOT record the size (the turn stays owed until the end).
  `_camLandFid` = the shot to anchor on, forgotten at the first touch/wheel.
- `actions.ts applyCapturedImage`: card top at the press → `putBack()` after
  `showBarsNow()`, on the card that is visible; a ResizeObserver repeats it only
  while sizes really change, stops at the first touch/wheel.
- Better for the others: ONE shared "something is open over a card" session
  (start/end/busy) instead of a copy per button.

## Buttons to apply it to

| Button | Check |
|---|---|
| CAM (FH CAM, phone camera) | done, test 50 |
| DRAW | turn while drawing: strokes kept, same view, card in place |
| WRITE | turn while writing: text kept, same view, card in place |
| MAX view (fullscreen) | turn inside MAX: closing it lands in the starting view, on that shot |

Only these four — the interaction with the pictures/canvases (29 Oct, Roman).
Everything else is different or not concerned — do not extend the rule to it.

## Testing (lessons of 29 Oct)

- Measure the card's top AFTER the button is pressed — Playwright scrolls to
  reach a button at a card's foot (run 539/540: 102 px, the test was wrong, not the app).
- Each button: no turn · turn · turn and back · after an earlier 3x2 → portrait turn ·
  iPhone · fitting.
- The browser test cannot use FH CAM; Roman checks FH CAM and the native camera
  on the real iPhone/iPad.
