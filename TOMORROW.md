# Where things stand

dev and try427: **v4.9.159 · #462**, run 136 green, tested by hand on two shooting
orders in one project. Next number: **v4.9.160 · #463**.
A NEW NUMBER FOR EVERY DEPLOY — both parts, always.
Pins: `good-462`, `good-461`, `good-459`, `good-456`, `good-454`, `good-443`,
`good-440`, `good-437`. try411 sits on #426.

The shooting order is finished as far as the rules go.

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

## Still open

None of it urgent, none of it a ten-minute job.

1. iPad view bar and setup bar hiding — needs the iPad to judge
2. Preview thumbnails in the sort view
3. The ten-second lock
4. Retry backoff
5. Sweep tombstones
6. FITTING export modal
7. FRAME → SHOT, HOW → ANGLE as default strip names. ANGLE starts with A, which
   changes the strip prefix and relabels every version — understand that first.
8. **A forced fetch ignores the hand-busy guard**
   (`if (!force && handIsBusy())`, `accountFlow.ts`). Three forced fetches, not
   five — #410 retired the dead frame picker and took two with it. Two of the
   three cannot land while a hand is drawing: the sort-order picker (you are
   tapping a dialog) and closing a shooting order (#380, the catching-up). The
   third is the one that matters: **after a push the server refused as stale**
   (~line 2431, `if (staleCount > 0)`), which fires on its own from an autosave
   with nobody touching anything. That is the only path to change. Put it in a
   log before writing anything — the way #407 settled the strip names in one
   reading. **AGREED WITH ROMAN, KEEP EXACTLY THIS:**

   > So the fix is narrower than "forced fetches ignore the guard". It's one
   > path, and the honest question for it is: does it need to happen this
   > second, or can it wait the few seconds until the hand stops?
9. Take the sync log out — last, and Roman still reads it constantly.

## Parked, with a reason

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
