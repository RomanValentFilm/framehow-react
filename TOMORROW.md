# Where things stand

Deployed: **v4.9.107 · #409**. Next number: **v4.9.108**. Last run: 102.

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

  There are five forced fetches and only five. Four cannot land while a hand is
  drawing — three are the keep-both/keep-mine picker (you are tapping a dialog)
  and one is closing a shooting order (#380, the catching-up). The fifth is the
  one that matters: **after a push the server refused as stale** (~line 2431,
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
3. **The order follows the needs** — agreed in full with Roman, build to this:
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

   **The work:** the saved `bracketTree` stores each node's `matchedIds` frozen
   from when it was built. The re-sort needs a walk that recomputes them from
   today's needs (each node has `categoryId`/`itemId`, so it can be done) and
   then flattens. That walk is the main piece; the rest is the line, the replay,
   and the ordering rule.
4. Retire the frame picker — dead code
5. The ten-second lock
6. Retry backoff
7. Sweep tombstones
8. FITTING export modal
9. FRAME → SHOT, HOW → ANGLE as default strip names. ANGLE starts with A, which
   changes the strip prefix and relabels every version — understand that first.
10. Take the sync log out — last

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
