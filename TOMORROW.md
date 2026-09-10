# Where things stand

dev: **v4.9.173 · #476**, app AND backend. Next number: **v4.9.174 · #477**.
A NEW NUMBER FOR EVERY DEPLOY — both parts, always.
WE WORK ON DEV. try427 and try411 are old addresses; ignore them unless Roman
says otherwise.
Pins: `good-476`, `good-463`, `good-462`, `good-461`, `good-459`, `good-456`,
`good-454`, `good-443`, `good-440`, `good-437`.

The shooting order is finished as far as the rules go (#462, run 136 green,
tested by hand on two shooting orders in one project).

Since then, 7 September: #463 the retry backoff · #465-#474 a deleted project is
not an outage, and the line about it can only ever be true · #476 rubbed-out
strokes stay rubbed out.

## Where the rules live

**THE RULES LIVE AT THE TOP OF `test/resort-bench.ts`**, in Roman's words, each
with the section number that proves it. 25 sections, one second to run
(`npm run bench:resort`). Nothing lives only in a conversation. If a rule is not
in that list, it is not a rule.

**ROMAN'S OWN TEST IS `e2e/27-the-whole-loop.spec.ts`** — his script, his order,
end to end, about three minutes:

    FH_RUN=<n> npm run t -- e2e/27-the-whole-loop.spec.ts

It writes `e2e-log/last-run.log`, which Claude reads directly. Roman says "zzz".
Every check is `expect.soft`, so ONE run reports EVERY broken rule.

## How we work — from Roman

- **NEVER FIX ONE OF TWO. GREP FIRST.** Before saying a fix is done, search for
  every other place that does the same thing and read every hit. This one fault
  — one job, two copies, only one mended — has cost more days than anything
  else here. The long version, with the list of times it has happened, is at the
  top of CLAUDE.md.
- **NEVER SAY A FAULT EXISTS WITHOUT TRACING THE PATH TO IT.** Reading one
  function and reasoning forward is not evidence. If the path from a button to
  the code has not been walked, say "not traced" — do not state it as fact.
- **Roman's check, and he should use it freely: "did you trace it, or are you
  reasoning?"** An honest answer is "reasoning" more often than it should be.
- Read the code and the tests and decide. Do not answer from a screenshot when
  the code can be read.
- CLAUDE CANNOT RUN THE E2E OR THE BUILD. Tried and confirmed: playwright is in
  the sandbox but downloading a browser fails, and `npm run build` cannot run
  there. The bench is Claude's, the e2e is Roman's.
- The bench covers `bracket.ts`, the DECISION. It covers NOTHING in
  `sortOrder.ts`, the SCREEN. Never report "benches green" after changing the
  screen half — that is what broke green icons for a day. If a rule is worth
  having, make it a plain function in `bracket.ts` and bench it.
- Do not ask him to pin, save or park something instead of fixing it.
- Always say how long a test run will take. Figures are in CLAUDE.md.

## THE BARS IN PORTRAIT — ROMAN'S RULE, 9 SEPTEMBER

> "this change considers the portrait mode only... on IPAD and IPHONE... show
> all the top view bars all the time: Tool Bar, View Mode bar, Detail Bar. (the
> set up bar only when set up was activated, which is possible on iphone to
> activate only in horizontal view) <<< this means the top view bar does not
> move with scrolling anymore"

and then, a minute later:

> "these bars can be visible all the time also in horizontal mode on iPAD ONLY
> (let the iphone in horizontal mode as is)"

So the rule as built (#481):
- **iPad, both ways up** — toolbar, view bar and detail bar all shown, all the
  time. Nothing hides them on scrolling. `tb-hide` is now added NOWHERE.
- **iPhone portrait** — the same three, all shown, stacked and still. The view
  bar used to be hidden here entirely.
- **iPhone landscape** — UNCHANGED. Left exactly as it was, on purpose.
- The setup bar appears only when SETUPS is on, as before.

Why it came up: on the iPhone in portrait the whole view bar was hidden, and
SORT BY lives in it — so inside a shooting order there was no way to switch
orders or get out.

## THE LIST — 10 September, evening (Roman's order)

dev is **v4.9.195 · #498**. Next number: **v4.9.196 · #499**.

### NOW
1. **The forced fetch after a stale push while a hand is drawing** — agreed
   first step: put it in the log before writing anything (accountFlow,
   `if (staleCount > 0)` after a push).
2. **iPad view bar and setup bar hiding** — needs the iPad to judge.
3. **Preview thumbnails in the sort view.**
4. **The ten-second lock** (waitForDeviceLock / heartbeat, accountFlow).
5. **FITTING export modal.**
6. **Take the sync log out** — last, Roman still reads it constantly.

### LATER
1. **Frame numbering 1, 2, 3, 4 — not 1, 1#1.** The X#1 form exists on purpose
   (a shot added after 3 is 3#1 so the script's numbers stay). Find every
   place that reads or writes it first: actions.ts 'new', pdf.ts, files.ts,
   exports, the sort cards. Decide with Roman what "after 3" is called.
2. **The whole-day test** — outline in `e2e/29-THE-WHOLE-DAY.outline.md`;
   build in parts, each green before the next.
3. **Unsent work of OTHER projects uploads by itself when the user uses the
   app** — today only the open project is retried (`retryPendingSyncs`); a
   project worked on offline and then left sits in the list as "on this device
   — not uploaded yet" until its copy is opened. The 28 test "offline with a
   project open, then a new project made offline too" proves it — fails on
   exactly this, everything before is green (run 179).
4. **Dead pictures on the server** — the cleaner needs an age guard (about 7
   days) before it goes on the schedule; and a purged project's deletion notes
   outlive it (one line in the purge, not a migration). Details in the older
   notes below.

### DONE 9–10 September (for the record)
- #489 orders/groups travel by name · #490 setups in the boxes, bars in SETUPS
  · #491 +/- gone, needs items listed · #492 isStoryFlow crash · #493 group
  stays on SORT BY, per-flow breaks · #494 each story flow owns its breaks
  · #495 boxes push once · #496 iPad break rename, work changed during a push
  is sent, the fetch's own push, the lock in the log, wrangler 4.130
  · #497 one main picture, iPhone version hidden · #498 desktop drag.
- Confirmed by Roman on devices: all of the above, plus the other-device
  green mark. Agreed: a REMAINING shot that gets a new item with no box is not
  green — nothing moved.
- ANGLE is the default strip name (older item 11).
- `settle()` in the simulator means "saved and quiet"; waits touch one device
  at a time (the lock needs ten quiet seconds).

## Parked, with a reason

- **`26-needs` "going round the loop many times settles, and never invents
  work" fails: ONE CHANGE SHOULD MARK ONE SHOT — it marked 0.** Single device,
  no sync between two of them. Opens and closes a shooting order four times,
  changing a shot's day each round, and expects exactly one shot to come up
  green as moved by the re-sort.

  NOT from #489, and proved rather than argued: RUN 148 ran the same test
  against `3e5eae9`, this morning's code before any of today's work, and it
  failed identically — same message, 14.2s against 14.3s. The other two tests in
  that file pass on both.

  One suspicion already ruled out with a bench, not an opinion: `decideResort`
  (bracket.ts:894) gives up with "no sorting sheet yet — nothing to follow" if
  the order has lost either its `bracketTree` or its `sortedSnapshot`, and #489
  now translates both. The bench holds a real order shape through the round trip
  and both survive, in the right numbers — see "the sorting sheet survives the
  journey out" in delta-bench.


- **A REARRANGED STORY FLOW DOES NOT REACH A DEVICE THAT CAME FROM ANOTHER
  PROJECT.** Found by the simulator on 9 September, in
  `28-numbering-across-projects` — marked `test.fixme` there so a run stays
  honest. NOT from today's work: it fails the same way on RUN 137, before any
  of it.

  What happens: two devices open the same project, each having had a different
  project open before. One rearranges the story flow and adds breaks. **The
  breaks arrive; the order does not.** The device's own log says it:

      arrangement NOT taken: changed_at=1788959633351 (mine is newer and unsent)

  and beside it, three different projects' arrangements all reporting
  `server has 1788959633351` — one remembered time, shared across projects.

  `08-story-flow` passes, because there both devices hold the one project all
  along. That is why this went unseen.

  THREE ATTEMPTS, 9 September, ALL REVERTED — read this before a fourth:

  1. Empty the settings memory for the new project BEFORE the arriving items are
     judged, instead of after. True of the code, cured nothing.
  2. A device must not REFUSE an arrangement when all it did was fill in shots
     the list never named. It fired correctly — the log says "mine was only a
     fill-in" — but both devices still ended on their own list, because the one
     that corrected later overwrote the real rearrangement ON THE SERVER.
  3. So also: do not STAMP a fill-in as a change. That stopped the correction
     winning — and stopped the completed list ever reaching the server at all.
     The log then reads "8 frames · already up there" while the server still
     holds the one-shot list. Worse than the fault.

  WHAT 2 AND 3 TOGETHER SHOW, and where a fourth attempt should start: the
  server keeps ONE arrangement per project, and time is the only thing deciding
  who wins. A correction that must reach the server but must never beat a hand
  move cannot be expressed with a single timestamp. Either the correction and
  the rearrangement stop sharing one item, or the arrangement stops being able
  to be short in the first place — that is, the list written when a project is
  born names every shot it has, not the one shot `startFromScratch` makes.
  The second is much the smaller change and is where to look first.

  The first guess was that the settings memory is judged before it is emptied
  for the new project — `applySettingsToStore` weighs what arrives, and the
  memory is only emptied afterwards by `adoptSettingsFromServer`, and
  `frameOrder/main` is the same name in every project. That IS true of the code.
  But moving the emptying earlier did not cure this, and `26-needs` "going round
  the loop many times" failed in the same run, so it was taken straight back
  out. Both halves need understanding before it goes back in.


- **The random day** — fails on settings (setups, an unanswered sort-order
  decision). Proved NOT ours: the same seed fails identically with #406 stashed.
  Also not repeatable — same seed, different failure each time.
- **`13-scribble` "scribbling fast"** — fails on its own guard, because #381
  means fewer rebuilds. Not a lost stroke. The test needs rewriting for the
  behaviour Roman chose to keep.
- **Groups and shooting orders store frames by local NUMBER** and translate to
  ids on the way out. Since #405 that translation cannot fail, but storing ids
  directly is the cleaner end state. Using ids in the buttons too would retire
  the private numbering altogether — a proper piece of work, not a patch.
- **From the #417 audit, still worth doing:** `loadCloudProject` never calls
  `resetProjectSyncGuards()` or `forgetHeldTree()`, so `_pendingTombstones`,
  `_lastKnownFrameCount` and the held delta tree cross the project boundary; a
  pull in flight is never cancelled by a project switch (it captures `cp` once
  and uses it after the await, ending in `markSaved(cp.projectId)`); and
  `applyArrangement` does not de-dup, so one repeated id becomes permanent and
  travels.
- **The test doors are not the app.** `testHooks.newProject` calls
  `startFromScratch()`, which does not clear the current project id — so
  `saveNow()` pushes the "new" project into the previously open one. Any test
  that makes two projects in one session is really working on one. Fix that
  before trusting a project-switch test.

## Decided — do not reopen without reading this

- **An automatically re-sorted arrangement is not data, it is a RESULT.** Never
  fight over a result — recompute it. The only thing in an order that is truly
  data is the hand rearranging, because nothing else can recreate it. So an
  automatic re-sort never contests: against a hand-made arrangement it loses
  without asking, and two devices that both re-sorted offline are BOTH wrong —
  the next open re-sorts from the settled needs and they agree.
- **UNDO was designed and then cut, on purpose.** It dragged in three things:
  keeping the previous arrangement, a fingerprint of the needs the user had
  refused, and that fingerprint having to travel — otherwise the other device
  re-sorts straight back and overrules the undo. And it solved a problem the
  manual-move replay already solves. Do not reintroduce it without that.
- **Each device works the re-sort out for itself** — today's needs against the
  order's `sortedSnapshot`. Nothing new travels.
- **The rule that chooses 3x2 when a project OPENS is pristine.** Do not change
  it.

## Do not repeat

- **#397** made the arrangement empty while a frame had no id. A missing item
  reads as DELETED, so the device announced the whole arrangement was gone.
- **#395's after-push comparison** stamped what it marked, which made it differ
  again, which pushed again. One frame went up three times in eleven seconds.
- **#403** gave every frame its own fractional number and retired the
  arrangement. It undid rearranging and collided with #294 — one arrangement,
  later wins whole. Roman chose #294. Tests kept in `23-position.spec.ts`,
  parked.
- All three went out, or nearly went out, on a green suite. Green means "nothing
  I can see objects", not "safe".
- **The week's one fault, for the shape of it:** a frame had no identity for the
  first two seconds of its life, and every symptom lived in that hole — a rename
  lost, a place guessed, a shot dropped from an order at push time. **#405** gave
  the frame its id when it is made; **#406** let it keep the local number it
  already has.
- **#417:** one project's frames were adopted by another because
  `clearPushedFingerprints()` emptied the "was this ever pushed?" guard three
  hundred lines earlier in the same function, so everything was kept and the next
  push re-parented it. Two copies of one job, and only one had the rules — that
  is the fault that keeps coming back.

## Tooling

- `wrangler dev` crashes at random and takes the rest of the run with it. If a
  run says `ECONNREFUSED 127.0.0.1:8787`, it is void — repeat it.
- The run script holds the Mac awake (`caffeinate -dims`) and prints FH_RUN at
  the end.
