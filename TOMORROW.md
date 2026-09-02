# Where things stand

Deployed to dev: **v4.9.108 · #410**.
On try411 only: **v4.9.120 · #422** (the re-sort, working).
Next number: **v4.9.121 · #423**. Last run: 108. A NEW NUMBER FOR EVERY DEPLOY — both parts, always.

## The week's fault, and it was one fault

A frame had no identity for the first two seconds of its life. Everything in the
sync is filed by that identity, so for those seconds the frame was invisible to
it — and every symptom lived in that hole:

- its name could not be stamped, so a rename went up as zero and lost
- it could not be in the arrangement, so its place was guessed
- it was dropped from shooting orders at push time, silently and permanently
- and the local numbering was dealt out afresh on every sync, so a rename could
  land on a different frame than the one you tapped

**#405** — the frame gets its id when it is made. The app always invented these
itself (`f.serverFrameId || uuid()`); it simply did it at push time. Nothing
about the server changed.

**#406** — a frame keeps the local number it already has. Only frames this device
has never seen get new ones.

Confirmed by hand: names hold, positions hold, both renames of the same card show
the same id.

## #417 — ONE PROJECT'S FRAMES WERE BEING ADOPTED BY ANOTHER

The afternoon's chaos, and it was not the re-sort. Roman watched one project go
9 → 21 → 29 → 33 frames. Orders full of shots that were not in the project,
`showing 20 of 13`, cards drawn twice.

`applyCloudTreeToStore` keeps every frame in the store the answer did not
mention, on the grounds that it must be unsent work (#405). The guard that told
unsent work from somebody else's frames — "was this ever pushed?" — is emptied
by `clearPushedFingerprints()` THREE HUNDRED LINES EARLIER IN THE SAME
FUNCTION. So the answer was always "never pushed" and everything was kept. The
next push then re-parented those frames onto the open project on the server
(`ON CONFLICT(id) DO UPDATE SET strip_id = excluded.strip_id`), which is why it
survived a reload.

Fixed two ways: read the record before it is thrown away, and never rescue when
the tree being applied is not the project the app is standing in (opening a
project applies its tree BEFORE setCurrentProject, so a mismatch means those
frames belong to something else).

**Still worth doing, from the audit:** `loadCloudProject` never calls
`resetProjectSyncGuards()` or `forgetHeldTree()`, so `_pendingTombstones`,
`_lastKnownFrameCount` and the held delta tree cross the project boundary; a
pull in flight is never cancelled by a project switch (it captures `cp` once and
uses it after the await, ending in `markSaved(cp.projectId)`); and
`applyArrangement` does not de-dup, so one repeated id becomes permanent and
travels. Full audit findings are in the transcript.

**And the test doors are not the app.** `testHooks.newProject` calls
`startFromScratch()`, which does not clear the current project id — so
`saveNow()` pushes the "new" project into the previously open one. Any test that
makes two projects in one session is really working on one. Worth fixing before
trusting a project-switch test.

## Still open

- **The random day** — fails on settings (setups, an unanswered sort-order
  decision). Proved NOT ours: the same seed fails identically with #406 stashed.
  Also not repeatable — same seed, different failure each time.
- **13-scribble "scribbling fast"** — fails on its own guard, because #381 means
  fewer rebuilds. Not a lost stroke. The test needs rewriting for the behaviour
  Roman chose to keep.
- **A forced fetch ignores the hand-busy guard** (`if (!force && handIsBusy())`,
  accountFlow.ts). The real hole under the vanishing strokes. **AGREED WITH
  ROMAN, KEEP EXACTLY THIS:**

  > So the fix is narrower than "forced fetches ignore the guard". It's one
  > path, and the honest question for it is: does it need to happen this
  > second, or can it wait the few seconds until the hand stops?

  THREE forced fetches now, not five — #410 retired the dead frame picker and
  took two with it. Two of the three cannot land while a hand is drawing: the
  sort-order picker (you are tapping a dialog) and closing a shooting order
  (#380, the catching-up). The third is the one that matters: **after a push the server refused as stale** (~line 2431,
  `if (staleCount > 0)`), which fires on its own from an autosave with nobody
  touching anything. That is the only path to change. Put it in a log before
  writing anything — the way #407 settled the strip names in one reading.
- Groups and shooting orders store frames by local NUMBER and translate to ids on
  the way out. Since #405 that translation cannot fail, but storing ids directly
  is the cleaner end state.
- Using ids in the buttons instead of local numbers — would retire the private
  numbering altogether. A proper piece of work, not a patch.

## The list

1. iPad view bar and setup bar hiding
2. Preview thumbnails in the sort view
3. **The order follows the needs** — BUILT (#411–#417), on try411 only, not yet
   on dev. Twelve cases in `test/resort-bench.ts` (`npm run bench:resort`, one
   second). The rules as agreed:
   - Only when a shooting order is OPENED. Never in the background, never while
     somebody is inside one.
   - Catch up FIRST. If a pull is in flight, or the device knows the project
     changed elsewhere, wait — never re-sort from needs about to be replaced.
     Fetching is already held while an order is open (#380), so this belongs at
     the door.
   - Needs changed while you are INSIDE an order: nothing moves. A quiet line
     says "NEEDS were changed on another device — this order will update when
     you leave." Closing catches up; the next open re-sorts.
   - It re-sorts by itself and says so, at the top of the order view, above the
     editing window, visible without opening EDIT:
     "Shooting order was automatically modified to match new criteria in NEEDS."
     No button. NO UNDO — see below.
   - Re-sort first, then replay the manual moves on top: each moved frame
     anchored behind the frame it currently follows, as an arrangement is
     re-applied after a sync.
   - Applied to the same order. Never a second order — that splits the truth.
   - Each device works it out for itself: today's needs against the order's
     `sortedSnapshot`. Nothing new travels.
   - An automatic re-sort NEVER contests. Against a hand-made arrangement it
     loses without asking. Two devices that both re-sorted offline are BOTH
     wrong — the merged needs are a mixture neither had; the next open re-sorts
     from the settled needs and they agree.
   - The picker stays as it is, for hand-made arrangements only.

   **The principle, if it is ever reopened:** an automatically re-sorted
   arrangement is not data, it is a RESULT. Never fight over a result —
   recompute it. The only thing in an order that is truly data is the hand
   rearranging, because nothing else can recreate it.

   **UNDO was designed and then cut, on purpose.** It dragged in three things:
   keeping the previous arrangement, a fingerprint of the needs the user had
   refused, and that fingerprint having to travel — otherwise the other device
   re-sorts straight back and overrules the undo. And it solved a problem the
   manual-move replay already solves. Do not reintroduce it without that.

   **As it ended up (#411–#422), confirmed working by Roman:**
   - Green means "its needs changed" — the shot's BOX changed. Not "it moved".
   - A changed shot goes to the END OF ITS BOX as that box sits in the list in
     front of you — the whole chain, so DAY 1 > LOCATION 1 is a different place
     from DAY 1 > LOCATION 2. Anchoring to "the nearest shot not moving" only
     worked while the list was already in box order, and put 8B behind DAY 3.
   - Nowhere to put it — its box has no other shots yet — it stays where it is
     and goes green for you to place. The app moves what it is sure of.
   - A shot you placed by hand goes green when the shot above it leaves (#420).
   - Green is a running list of "not looked at yet". A second change ADDS to it.
     DONE clears one, is remembered on the device, and survives a reload.
   - The log names the shots (#421) and DONE writes a line (#422). Both exist
     because "4 frame(s) changed box" could not be argued with.

   **Roman, at the end of the day: "it works... I'm just thinking if we should
   not simplify."** The rule grew three clauses in one evening, each for a real
   reason. Worth re-reading whole, with fresh eyes, before it goes to dev.

   **The work:** the saved `bracketTree` stores each node's `matchedIds` frozen
   from when it was built. The re-sort needs a walk that recomputes them from
   today's needs (each node has `categoryId`/`itemId`, so it can be done) and
   then flattens. That walk is the main piece; the rest is the line, the replay,
   and the ordering rule.
4. The ten-second lock
5. Retry backoff
6. Sweep tombstones
7. FITTING export modal
8. FRAME → SHOT, HOW → ANGLE as default strip names. ANGLE starts with A, which
   changes the strip prefix and relabels every version — understand that first.
9. Take the sync log out — last

## Do not repeat

- **#397** made the arrangement empty while a frame had no id. A missing item
  reads as DELETED, so the device announced the whole arrangement was gone.
- **#395's after-push comparison** stamped what it marked, which made it differ
  again, which pushed again. One frame went up three times in eleven seconds.
- **#403** gave every frame its own fractional number and retired the
  arrangement. It undid rearranging and collided with #294 — one arrangement,
  later wins whole. Roman chose #294. Tests kept in 23-position.spec.ts, parked.
- All three went out, or nearly went out, on a green suite. Green means "nothing
  I can see objects", not "safe".

## Tooling

- `wrangler dev` crashes at random and takes the rest of the run with it. If a
  run says `ECONNREFUSED 127.0.0.1:8787`, it is void — repeat it.
- The run script holds the Mac awake (`caffeinate -dims`) and prints FH_RUN at
  the end.
- ALWAYS tell Roman how long a run will take. Figures are in CLAUDE.md.
