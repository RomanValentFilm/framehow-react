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

dev is **v4.9.215 · #518** (deployed 16 September 15:35, app only; commit 11764b5). Backend last deployed with 212. Next number: **v4.9.216 · #519**.

### 16 September, 15:35 — v4.9.215 · #518 (from Roman's log of the strip presses)
- frameFingerprint left the blank placeholder of a shown strip out (it counted; the push never sent it): every strip press pushed 41 shots undated → refused → forced fetch → full repaint. THE slow strip button.
- Versions the merge KEPT as mine are left out of the server-dated set after a pull (keptMineVersionIds) — an untag made the second before a pull was dated with the server's old time and lost (run 274).
- Tag/untag call stampChangedContent at once.
- applyCloudTreeToStore stamps under tree.project.id: opening another project left the content-stamp memory on the OLD project; the first stamp under the new id wiped it as a first look → the first edit after switching went up dated 0 and lost (run 277, intermittent — autosave vs edit order).
- Traces: deletions recorded / sent / arrived. Run 275 saw a copy stay on the iPad after an untag once (not reproduced in 276) — read these lines if it comes back.
- Redraw of 44 shots measures 100–140 ms on a strip press (Roman's log) — trim later.

### 16 September, 15:00 — v4.9.214 · #517
Shooting order: unchanged cards are REUSED (cloned, thumbnails included; `reuseUnchangedItems`), only the changed card is built; drawn thumbnails not re-rasterised (`data-rastered`); the page's scroll position is kept across a rebuild (the neighbour-anchor idea nudged the page by one card — gone); the active card/break is framed with a box-shadow, not a 3px border (it grew 4 px on activation and everything below jumped). Part 6 green (273). Full suite still due.

### 16 September afternoon — v4.9.213 · #516 (Roman's by-hand remarks on 212)
- Card follows the tagged photo (tag and untag) — the photo moves to the front, the card stayed on the old slot.
- Shooting order: the page stays put on arrows / add break / DONE (anchor on the first unmoved item); NOT redrawn when the rebuilt list is identical (flash on every sync gone); no redraw mid-drag; drag ghost's column fixed once at start.
- REAL SYNC FAULTS found by part 5 on the way: (1) the #514 projection rule swallowed a shot taken OUT of a group by hand — a projection only when the missing shots are not held here; (2) a change made while a pull was being applied (system-action window with awaits) was never marked — flushSyncNow now asks the settings memory by content when the flag is off. Frames changed in that window are NOT yet covered (LATER: make the system flag not swallow user changes).
- Redraw timing line: "redraw: N shots in M ms (who)" when > 100 ms — Roman: strips/NEEDS feel slower on 212; read his log next.
- OPEN: the repaint after a pull touches every card (the flash Roman sees with tags) — make it card-by-card. Full suite (267 partial: 4,5,6 green after fixes; 272: 1,2,3,8,9,10 green) — full run still due before the next deploy.

### DONE 14 September, late — v4.9.210 · #513 saved and deployed (app only)
It carried: BIG DAY parts 5, 6, 7 (all GREEN: runs 228, 230, 231),
`e2e/boxes.ts` (27's helpers shared), doors (groups, order delete, sort-view
drag, exports), lifts in groups.ts (saveGroupEdit/deleteGroup) and sortOrder.ts
(deleteSortOrder), and ONE APP FIX: after a restart the settings memory did not
know its project, so the first stamp threw it away and re-seeded everything as
"changed now" — a deleted group came back on both devices (run 227). Fixed:
importSettingStamps takes the project id.

### DONE 15 September morning — v4.9.211 · #514 saved and deployed (app AND backend)
- Pull: the shot's own record and each version judged separately, versions
  merged one by one by their own times in both branches (myWorkChangedAt gone).
- Server: the frame/version upsert refuses an older or undated copy at write
  time (two devices reconnecting in the same second raced read-then-write).
- Stamps: during a pull only what the server sent is server-dated; a local
  change made just before a failed pull is dated now.
- Orders and groups short of shots this device lacks are not a local change
  (the story-flow rule, generalised).
- A picture that cannot be read says so (toast + log line).
- BIG DAY part 8 green (run 244). SIMULATOR LIMIT: a file cannot be read while
  the simulated airplane mode is on (NotReadableError) — part 8 puts its
  offline picture on through the store door, reason written in the test.
- Random day: a change the other device had not received at departure counts
  as "apart" (run 245's real clash).
Full run 245: 60 green · 6 skipped · 3 red = LATER 3 (known) + 15 (idle-device
timing, seen in 224 too) + random day (now fixed, green in 246).

### 15 September — v4.9.212 · #515 saved 18:20, deployed 16 September (app AND backend)
BIG DAY IS COMPLETE: all ten parts exist and have been green (9: run 250;
4 with the setup-tag check: run 258; 10: run 264). Full run 265 pending.
App faults found and fixed today, all by the simulator:
- Delete during a push in flight: the tombstone was cleared by the push that
  did not carry it — kept now until a push actually carries it (part 9).
- Setup tagging, from Roman's by-hand notes: (1) a re-tag made fresh copies
  every time, so the old rows came back as v1+v2 of the same picture — copies
  are reused, linked to their origin (`copy:<origin id>` in the tag column);
  (2) untag removed copies only locally — now told to the server (tombstones);
  (3) new versions went up as time zero — named+dated the moment they are
  work (stampChangedContent; untouchedStrip moved to changeStamps.ts);
  (4) a tag arriving from the other device landed on version objects the
  pull threw away (settle() renumbers by copying) — the tag rides in the row
  now, both late tag loops and the versionTags list are gone; (5) a change
  made just as a pull arrives was scheduled to push and then the pull cleared
  the flag — marked after clearing now (accountFlow, kept-local branch).
  Also: leaving a setup REMOVES copies (was: emptied them, blank tabs stayed);
  untag re-sorts every frame in the setup so tabs renumber.
- Text typed under a shot was never sent on its own (mutated in place, nothing
  marked) — noteTextEdit marks the shot; tables the same.
- A 9:16 portrait project opened in whatever view the previous project left
  (after a fitting: LOOKS only, SHOT hidden) — opens with SHOT now.
Test/harness: leaveSetups door; tag door answers the untag dialog too; the
whole-agree wait dumps both logs + tag lines on failure; typeUnder retries
PIC/TXT and types into the VISIBLE box.
Rules confirmed with Roman: a shot's own versions are never touched by
tagging; on untag only the origin stays (as a plain version on its frame).

STILL OPEN from Roman's by-hand notes (15 Sept):
- An arrow pressed on a version in the strips scrolls that row to mid-screen
  — keep the scroll where it is (look for the centring on version change).
- The text box under a PORTRAIT shot on the iPad did not show in the simulator
  (run 260) — check by hand on the iPad; part 10 types on the desktop for B.
DONE 16 Sept: full run 266, deploy 212, release notes given.
Deploying a saved-but-bumped tree: `git stash -q` → build → deploy → `git stash pop -q`.
The version copy: remove backend/.wrangler and .wrangler-e2e from copies (36M of
throwaway test databases) — add them to the rsync excludes in the save command.

### THEN (was): part 8 … part 9 … the closing pass — all DONE, see above.

### DONE 14 September evening — v4.9.209 · #512 (app only), deployed
Group story flow in SORT BY: arrows and drag now write the group's own order
(they wrote ALL; the group's view lists by its own order, so the move snapped
back). Test in 28 presses the sort view's arrow. Roman found it by hand.
Next: BIG DAY part 5 (groups) — this is exactly the class it must catch.

### DONE 12–14 September (v4.9.207 · #510) — app AND backend
- Strip names travel by time (one item per strip), the blob's "sent" memory
  taken from what was sent, local settings stamped before arriving ones are
  judged.
- Customise: all SIX columns (SHOT / ANGLE / SKETCH / REFS / NEEDS / NOTES,
  button + card label), per project, remembered on the device and with the
  account (users.preferences, migration 0026) as the default for the next
  NEW project. 3x2 quick buttons and the export chooser read the names.
- Shot dating: a shot that arrives by pull is never dated "now".
- Untouched needs/note cards count as nothing in both fingerprints (#358's
  rule for columns); the cards draw the project's label.
- The server's order minus shots this device lacks is not a local change.
- An order's place in the list is not a change; settings values in one fixed
  spelling (both sides); an untouched copy is never a decision (server).
- Opening / restoring records what arrived as matching the server; refused
  shots the fetch has nothing newer for are recorded too (push loop, run 222).
- A partial push of only new shots is per-frame (no blanket 409, no 80 s wait).
- Tests: 18 one-at-a-time; part 2 pauses between NEWs; 13/09 aligned; watchdog
  on opening; whole-agree wait 90 s.
Full run 224: 64 green · 6 skipped · 3 red = LATER 3 (known) + 15 and part 3,
both "the idle device did not fetch within the window" (green in 204/212/216/222).

### NEXT: BIG DAY part 5 — groups; then shooting orders & boxes; exports;
offline day; RESTORE points + delete/recover; reload/switch; final comparison.

### BIG DAY — 11 September
`e2e/29-big-day.spec.ts`, run with `FH_RUN=<n> npm run t -- -g "big day"`.
Parts 1–7 GREEN (runs 204–231). Left: part 8 (offline day), part 9 (restore, delete/recover), reload/switch, final pass. 
RESTORE points + delete/recover; reload/switch; final flat comparison.
Doors added today press the app's own buttons and answer its own dialogs
(UPLOAD + file chooser, star, +, hide version, WRITE/TEXT box, PIC/TXT,
strip buttons, arrows+DONE, hide/un-hide shot). The whole suite (run 200 + 204):
everything green except LATER 3 (known).

### NOW
1. ~~The forced fetch after a stale push while a hand is drawing~~ — DONE #499:
   it waits for the hand; the main picture carries its change time so the
   server no longer calls it "older" by clock difference. Roman scribbled fast
   on #499: nothing lost.
2. ~~iPad view bar and setup bar hiding~~ — DONE by #481, Roman confirmed on the iPad 10 Sept.
3. ~~Preview thumbnails in the sort view~~ — already there (tap a small box on the iPad; hover on the desktop). Roman: done. Note: a shot with only a drawing and no picture shows no preview — a possible later improvement, not asked for.
4. **The ten-second lock** (waitForDeviceLock / heartbeat, accountFlow).
5. ~~FITTING export modal~~ — DONE #502–#507 to Roman's text: two layouts
   (TALENT + 4 LOOKS / 5 LOOKS), one row per page, LOOKS/REFS ticks, photos
   by stars (looks only; refs come whole), notes, A4/Letter; PDF, Keynote,
   images. Roman: "perfect".
6. ~~Two-finger pinch to zoom in the camera~~ — DONE #508, Roman: "love it".
7. **Take the sync log out** — last, Roman still reads it constantly.

### LATER
1. **Frame numbering 1, 2, 3, 4 — not 1, 1#1.** The X#1 form exists on purpose
   (a shot added after 3 is 3#1 so the script's numbers stay). Find every
   place that reads or writes it first: actions.ts 'new', pdf.ts, files.ts,
   exports, the sort cards. Decide with Roman what "after 3" is called.
2. ~~The whole-day test~~ — DONE 15 September: `e2e/29-big-day.spec.ts`, ten parts.
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

### TESTS TO WRITE

- NEW pressed while the previous NEW's push is still in the air (run 212,
  part 2: two NEWs within a millisecond; the reply's rebuild put 3#1 after 4).
  Same race as the move below. Part 2 now leaves 600 ms between the presses,
  as a person does; the race itself still needs its own test and a fix
  (the reply of push 1 rebuilding over work made after it began).
- A shot moved while the previous DONE is still in the air. Seen only in the
  simulator (run 195, four DONEs in 200 ms): each reply laid the older
  arrangement back over the newer move. Not yet seen by hand; test it alone.
- **Fast scribble across several cards** while pushes go out and the other
  device works; every stroke counted on both devices afterwards. Roman did it
  by hand on #499 — green; the simulator should hold it.
- **A shot ticked on the other device while this one has the order open** —
  green on next opening (Roman confirmed by hand).
- Both belong in the whole-day test (LATER 2).

### DONE 11 September
- #509 (v4.9.206): un-hide never pushed on its own, hide pushed only by luck —
  both push by right now · a settings change kept through a reconnect pull
  (a break added in the same breath as coming back) is pushed, not just
  marked · BIG DAY parts 1–3 · old tests 07/09/13 brought in line with the
  rules that came after them (pen-down holds the fetch; two devices changing
  the same shooting order apart is ASKED, Roman kept that rule) · door faults:
  project-making doors left the next-free number behind; four DONEs in
  200 ms are not what a person does.

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
