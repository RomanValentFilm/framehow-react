# 29 — THE WHOLE DAY (outline, 10 September)

Roman: "a basic heavy duty test that runs all functions of the app, back and
forth… so every time we do some change, we immediately know if we broke
anything else elsewhere."

One script, one sitting, three devices (Desktop, iPad, iPhone), run after every
change. Every check is `expect.soft`, so ONE run reports EVERY broken rule
(the 27-the-whole-loop way). Target: about 8 minutes. Grows as the app grows;
the numbered parts below are the order of the day.

    FH_RUN=<n> npm run t -- e2e/29-the-whole-day.spec.ts

Every step is done through the app's OWN path (a button, or a door that calls
the same function the button calls — never a copy). Where a door is missing it
is listed under "doors to add".

## The day

### 1. Starting projects — every way in
- Desktop: new project from a PDF (the fixture PDF, 8 pages) → 8 shots.
- Desktop: new project from a folder of images (fixture: 5 pictures).
- Desktop: new project from scratch (landscape), then portrait, then FITTING.
- iPad: opens each from the project list; iPhone opens the landscape one.
- Check: same shots, same names, same pictures on all three. Numbers may differ.
- Check: the project list on each device shows all of them, alphabetical.

### 2. Shots — make, name, move, hide, delete
- Desktop: new shot after #3 (label 4? — see FIX 05: expect 1, 2, 3, 4 style),
  duplicate #2, rename #5, hide #6, delete #7 for good.
- iPad meanwhile: new shot at the end, rename it while the desktop's push is
  in the air (#496).
- Check on all three: order of shots, names, hidden one hidden, deleted one
  gone and staying gone after reload.

### 3. Pictures, drawings, versions
- iPad: photograph on #1 main (camera door), photograph into a version on #2.
- Desktop: draw on #3 main, draw on a SKETCH version of #3, text on #4.
- iPhone: scribble on #1 in 3x2, quickly, then rub it out (#475/#476).
- Desktop: rename versions (v1 → "WIDE"), star one, hide one, delete one.
- Check on all three: picture counts, stroke counts, version labels, stars,
  the hidden and deleted versions; nothing bred (#358).

### 4. Strips and names
- Desktop: rename strips (HOW → ANGLE, prefix change) and a frame's own strip
  label. Check names everywhere, including the 3x2 buttons (older item 11).

### 5. Needs, notes, setups
- Desktop: rename a needs column and an item; add DAY 4; tick DAY 1–3 on six
  shots; counters; location; copy/paste settings between shots; notes on 3.
- iPad: tick a needs item on a shot while the Desktop has the order open (see
  7 — the green mark rule).
- Desktop: create 3 setups, put shots in them, tag a version; rename and
  recolour a setup; delete one.
- Check on all three: every rename, every tick, every setup, every tag.

### 6. Groups
- Desktop: BARN (shots 2,4,6,8), YARD (1,3,5). New shot INSIDE the barn (hidden
  in ALL). Reorder inside the barn. Hide a shot in the yard only.
- iPad: makes a third group at the same time.
- Check: all three groups on all three devices; the group's own order; the
  hidden-in-group shot shown in ALL.

### 7. Shooting orders and the boxes — round and round
- Desktop: order for ALL, order in BARN, order in YARD. EDIT ORDER → boxes:
  DAY 1, DAY 2 (DAY 3 not tappable until a shot has it), SORT NOW. Move a shot
  by arrows, another by drag (desktop drag — item 1). Breaks in every flow,
  named, moved (see 28 "breaks belong").
- Go round FOUR times: change a need on the iPad → open the order on the
  Desktop → exactly one green → DONE → nothing → EDIT ORDER offers the new day.
- SORT BY switches order / story flow inside a group and stays in the group.
- Check: the order the same on all three (by names), one push per leaving,
  no red on a fresh sort, breaks only in their own flow.

### 8. Exports
- Desktop: PDF export (each layout), PPTX, images; portrait export; FITTING
  export (item 10). Check: a file of the right size and page count arrives.
  (Playwright download event; open the PDF with pdf-parse and count pages.)

### 9. Offline — the real day
- iPad offline: works on shots, needs, a break, a new shooting order, a NEW
  project made offline; back online: everything arrives, under its own name,
  nothing leaks between projects (28's two unproven tests live here).
- Desktop offline at the same time, both edit the same shot: the later edit
  wins, the other side's version survives as its own (#307/#310).
- iPhone: airplane on, reload, airplane off — the offline cache serves it.

### 10. Restore, delete, recover
- Desktop: restore point list; restore to an earlier point; "you are here";
  restore back. Delete a project; the open project asks; SAVE AS NEW; recover
  the deleted one from the list. Offline copies: shown, opened, deleted,
  recovered within the 24 h.

### 11. Reload and switch
- Every device reloads once mid-day and once at the end. Switch projects while
  a pull is in flight (#425). Start a new project with unsent work (#423).
- Final check on all three: the whole project written out flat (shots, names,
  pictures, versions, needs, setups, groups, orders, breaks) IDENTICAL.

## Rules the day holds to (each an `expect.soft`, each with its number)
- no PULL FAILED, no FULL REPLACE, no decision(s) waiting, no "kept a frame the
  server has not seen" for ever (rules.ts `mustNotHaveSaid`)
- the 3x2-on-open rule untouched; a sync never changes the view (#342/#347)
- a sync never closes an order, a setup bar, a pen (#352–#357)
- the private number never leaves the device (#489)

## Doors to add (each calls the app's own function)
- import a PDF / a folder from a fixture (handlePDF / handleFolderImages)
- photograph (camera capture → applyCapturedImage) with a fixture picture
- rename / star / hide / delete a version by index
- rename a strip
- export and hand back the file
- restore to a point; delete / recover a project; SAVE AS NEW
- airplane mode for the iPhone device (exists for desktop/tablet)

## Fixtures
- e2e/fixtures/eight-pages.pdf, e2e/fixtures/pictures/*.jpg (5, small)
