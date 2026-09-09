# FRAMEHOW — WHAT IT IS, HOW IT IS TESTED, WHAT IS BROKEN

Written 9 September 2026, end of day, for whoever picks this up next.
Roman Valent is the author of the app and the only person who deploys it.

Everything below is read out of the code as it stands at **v4.9.189 · #492**,
branch `v4.4`, deployed to `dev.framehow-react.pages.dev`. Where something is a
belief rather than something traced, it says so.

---

## 1. WHAT THE APP DOES

Framehow is a storyboarding tool for film. A **project** is a storyboard. A
storyboard holds **shots** (called frames in the code). Each shot has pictures,
drawings, notes, needs, and belongs to an arrangement. It runs in a browser, on
a Mac, an iPad and an iPhone, and the same account sees the same projects on all
three. It works with no signal and catches up later.

### The shot, and what hangs off it

- **Strips** — a shot has four columns of pictures: MAIN, plus three named
  strips (ANGLE, SKETCH, REFS by default; the user renames them). Each column
  holds **versions** — v1, v2, v3 — with one showing.
- **Drawing** — you draw on a version with a pen; strokes are stored per version.
- **Scribble** — a quick pencil over the card itself, separate from drawing.
- **Camera** — take a photo straight into a version.
- **Text and tables** — each shot carries text, and a small table.
- **Notes** — a longer note per shot, in its own column.
- **Needs** — tick-lists per shot, grouped into tabs (SHOOT, TALENTS, GEAR, ART)
  and tables inside them (SHOOT DAY, UNIT, LOCATION, DIRECTION, INT/EXT,
  DAYTIME, …). Some are toggles, some are counters.
- **Setups** — a camera setup, made by the user in SETUPS with a name and a
  colour, then tapped onto shots. One setup covers many shots.

### The views

- **MAIN** — one column of cards.
- **3×2** — a grid, six cards a page.
- **Strip views** — MAIN plus up to three columns side by side (two on a phone,
  three on an iPad in portrait, four in landscape).
- **LOOKS / fitting** — a separate project type for costume fittings.
- **Fullscreen** — one version, full screen, with drawing.
- **Overview / cast board** — a board of all the shots.

### Arranging shots

- **STORY FLOW** — the order of the storyboard itself. Drag a card, it moves.
  Can hold **breaks** (LUNCH, COMPANY MOVE) sitting between shots.
- **GROUPS** — a named subset of shots (THE BARN). A group has its own order and
  can hide shots. Entering a group filters every view.
- **SHOOTING ORDERS** — a separate running order for a shooting day. Any number
  of them, each with its own sequence and its own breaks. An order can belong to
  the whole project or be made inside a group.
- **THE SORTING SHEET (EDIT ORDER)** — the bracket. You pick criteria — a needs
  item, or a setup — and it pulls the matching shots into boxes, in the order
  you picked them. Pressing SORT NOW applies it.
- **The re-sort** — when the needs change, opening the order re-runs the sheet
  and marks the shots whose box changed, so you can see what moved.

### Getting things out

- **PDF export** — storyboard, shooting order, needs, several layouts.
- **PowerPoint export**.
- **PDF import**, with a page-adjust screen for cropping.
- **Folder import** of images.

### Accounts and projects

Sign up, log in, reset password, verify email. Projects are listed, opened,
renamed, deleted. A deleted project is recoverable for a period. Snapshots can
be taken and restored.

---

## 2. THE FILES, BY WHAT THEY DO

About 38,000 lines in `src/`, 4,000 in `backend/src/`.

| file | what lives there | lines |
|---|---|---|
| `accountFlow.ts` | **the sync**: pushing, pulling, merging, project open/close, account screens | 5,884 |
| `sortOrder.ts` | shooting orders, the sorting sheet, breaks, the re-sort | 3,150 |
| `exports.ts` | PDF and PowerPoint | 3,016 |
| `pdfAdjust.ts` | the PDF import adjust screen | 2,317 |
| `overview.ts` | the cast board | 2,111 |
| `pdf.ts` | PDF import | 1,857 |
| `view.ts` | which view is showing, the bars, orientation | 1,429 |
| `init.ts` | startup, wiring every button | 1,355 |
| `render.ts` | drawing the cards | 1,179 |
| `testHooks.ts` | the doors the simulator drives (`__fh_test`) | 1,150 |
| `bracket.ts` | the sorting sheet's logic — matching, re-sorting, what moved | 1,056 |
| `currentProject.ts` | which project is open, saving | 1,026 |
| `modals.ts` | every dialog | 1,024 |
| `setups.ts` | setups: making, colouring, putting on shots | 1,002 |
| `scribble.ts` | the pencil | 930 |
| `helpers.ts` | odds and ends | 927 |
| `fullscreen.ts` | the fullscreen version view | 888 |
| `projectSettings.ts` | **settings sync**: one item per group/order/category, times, merging | 791 |
| `actions.ts` | adding, deleting, moving shots | 782 |
| `state.ts` | the whole store, and the default needs | 764 |
| `needs.ts` | the needs cards | 668 |
| `camera.ts` | taking a photo | 637 |
| `notes.ts` | notes | 558 |
| `persistence.ts` | the device's own offline copy | 548 |
| `groups.ts` | groups | 513 |
| `drawing.ts` | the pen | 482 |
| `orderIds.ts` | **#489** — orders and groups travel by permanent name | 258 |
| `changeStamps.ts` | when each shot and version was last changed | 252 |
| `files.ts` | new project, portrait, fitting, folder import | 242 |
| `deltaMerge.ts` | folding a partial answer into what the device holds | 196 |
| `fitting.ts` | the LOOKS project type | 192 |
| `sessionRules.ts` | who wins when two devices disagree | 183 |
| `syncTrace.ts` | the on-screen sync log | 164 |
| `projectGone.ts` | telling "deleted" from "offline" | 134 |
| `retryWait.ts` | the backoff after a failed save | 104 |
| `arrangements.ts` | hand-move versus fill-in (built today, **not wired in**) | 74 |

---

## 3. WHAT THE SERVER DOES

Cloudflare Worker, D1 database, R2 for pictures. 30 migrations, the newest
`0025_images_r2key_index`. **A migration is never edited after it has run.**

### Endpoints

**Projects** — `GET /` list · `POST /` create · `GET /:id` · `PUT /:id` rename ·
`DELETE /:id` · `GET /:id/status` · `GET /:id/sync` (fetch, whole or changes
only) · `POST /:id/sync` (send) · `POST /:id/heartbeat` (has anything changed) ·
`POST /:id/recover` · snapshots: `GET|POST /:id/snapshots`,
`POST /:id/restore/:snapshotId` · conflicts: `GET /:id/conflicts`,
`POST /:id/conflicts/:conflictId`, and the same pair for setting-conflicts.

**Account** — signup, login, logout, forgot-password, reset-password,
verify-email, `GET|PUT /me`, `PUT /password`, `DELETE /me`.

**Pictures** — `POST /upload`, `GET /images/*`.

**Admin** — cleanup preview, expired projects, orphans. Analytics.

### The logic that is genuinely on the server, not in the app

- **Newer wins, per row.** A shot or version is taken only if what arrives is
  newer than what is held (`syncDecide.ts`). Anything refused comes back in the
  reply so the device knows.
- **The settings merge.** Each group, shooting order and needs category is a row
  of its own with its own time. The server keeps the newer one and returns the
  merged set.
- **Conflicts.** When two devices changed the same thing and neither is clearly
  newer, the server keeps both and hands the question back to be answered by
  whichever device asks — so any device can answer, not only the one that made
  it.
- **The arrangement.** Shots carry a position; the server hands them back in it.
- **Deletion.** A deleted project answers 410 with the code `deleted` — both,
  never one — so the app can tell it apart from being offline.
- **Recovery window.** A deleted project stays recoverable for a period.
- **Cleanup.** Expired projects and orphaned pictures.
- **has_drawing** on a version, so a device that does not hold the drawing does
  not tell the server there isn't one.

### What the server does NOT do

It knows nothing about views, groups' meaning, the sorting sheet, the re-sort,
or the green marks. Those are worked out on each device, by decision.

---

## 3b. THINGS YOU WILL NEED AND WILL NOT GUESS

### Where everything is

- The repo is at `~/Desktop/Framehow Files/framehow-react`, branch **`v4.4`**.
  Cloudflare Pages calls its production branch `main`; **we work on `dev`**.
- `CLAUDE.md` at the repo root holds the working rules, the deploy lines, and
  the admin token and database ids. Read it first, every session.
- `TOMORROW.md` holds the open list, the decisions not to reopen, and a "do not
  repeat" section of faults that came back. It is the memory between days.
- `~/Desktop/framehow-react-versions/` holds a copy of the source at each saved
  version — that is what "4 steps save" fills. Each under 5MB.
- `CHANGELOG.md` is stale (stops at v4.7.011). Do not trust it; use `git log`.

### The numbering

Two numbers, bumped together on every deploy:

- **`APP_VERSION`** in `src/store/state.ts` — `v4.9.191`.
- **`SYNC_BUILD_TAG`** in `src/lib/syncTrace.ts` — `#494`.

The `#NNN` is the change number. It is the thread through everything: commit
messages, the comments in the code, `TOMORROW.md`. **When you want to know why
something is the way it is, the reason is in a comment next to it with its
number, or in `git log --oneline --grep="#406"`.** This codebase explains itself
in prose; read the comment before changing the line. Several of today's mistakes
were made by changing code whose comment said exactly why it was like that.

### How Roman gives you evidence

The app has an on-screen **sync log**. He turns it on by tapping the version
number in the toolbar three times, or with `?fhsync=1` in the address. It has a
COPY LOG button. When he pastes a wall of timestamped lines, that is it — read
it as the app's own account of what it did, and trust it over your reading of
the code.

The log is also written by the simulator into the page, and the test can attach
both devices' logs to a failure. **If a test fails and you cannot see why, make
the failure print the logs before running it again.** Three runs were wasted
today for want of that.

### You can open the app yourself

The deployed app at `dev.framehow-react.pages.dev` can be opened in a browser
and driven directly — resize to an iPad's size, build a local project through
the test door (`window.__fh_test`), and measure what is actually on screen.
That is how the bar fault was found in one attempt after an hour of reading CSS.
Use it for anything visual. It is not a substitute for the simulator on sync.

### The devices in play

A Mac desktop, an **iPad Air 5th gen** (not a Pro — the strip limits differ),
and an iPhone. The app decides it is a tablet from the touch points and from the
smaller side of the screen being 830px or less.

### Known flaky, not faults

- `wrangler` in the simulator falls over at random. `ECONNREFUSED
  127.0.0.1:8787` means the run is void — repeat it, and split long runs.
- `09-random-day` fails on settings and is not repeatable — parked, in
  TOMORROW.md.
- `13-scribble` "scribbling fast" fails on its own guard since #381, not on a
  lost stroke. The test needs rewriting for the behaviour Roman chose.

---

## 4. THE BENCH TESTS — CLAUDE CAN RUN THESE, IN SECONDS

`npm run bench` in the app, `npm run bench` in `backend/`.

A bench tests **one decision, alone**. No browser, no server, no screen. It is
instant, and it can only ever ask the questions the author thought of.

| bench | what it holds to account | checks |
|---|---|---|
| `test/delta-bench.ts` | folding a partial answer in; the retry backoff; deleted-versus-offline; **orders and groups travelling by name**; breaks moving when a shot is dropped; the whole-day simulation of devices opening projects | 172 |
| `test/needs-bench.ts` | the needs, and settings stamping | 58 |
| `test/resort-bench.ts` | the sorting sheet: matching, re-sorting, what moved | all good |
| `backend/test/sync-bench.ts` | the win/lose rules | 17 |
| `backend/test/server-bench.ts` | the real routes against a stand-in database | 68 |
| `backend/test/session-bench.ts` | sessions and accounts | 42 |

`test/settings-probe.ts` is not a bench — it is a one-second reproduction of the
settings machinery, run by hand when something needs watching closely.

---

## 5. THE SIMULATOR — ROMAN RUNS THIS, CLAUDE READS THE LOG

`npm run t` — or `npm run t -- -g "some words"` for one scenario.

Two real browsers (one is WebKit, the engine the iPad runs), a real Cloudflare
worker with a real local database, real timers. Nothing it does can reach the
real server. It writes the whole run to `e2e-log/last-run.log`, which Claude
reads directly.

**This is the only thing that can say the app works.** A bench says a rule is
right. Today three hours went into a fault that did not exist in the app at all —
it was in the simulator's own door, which made shots without names. The door is
not the app; when it drifts it invents faults.

28 files, 68 scenarios:

reload · both offline · one device alone · **shooting order across going offline
and back** · away and late · both make one · changed during a pull · **story
flow** · a random day · drawing · what you have open · no flash · scribble ·
stay put · both rearrange · setups · setup tags · delete versus write · **group
orders** · renames · new frame renamed · new frame in the lists · position · two
projects · switch mid-pull · **needs and the order** · the whole loop ·
**numbering across projects** (8 scenarios, written today).

Known about the simulator: `wrangler` falls over at random and takes the rest of
the run with it. If a run says `ECONNREFUSED 127.0.0.1:8787`, it is void —
repeat it. Split long runs so one crash cannot take everything.

---

## 6. THE RULES WE AGREED

These are not preferences. They were each written after something went wrong.

### How to answer Roman

- **Words only.** No log excerpts, no code, no file paths, no line numbers in
  the chat. He does not read them and they bury the answer.
- **The only thing that ever goes in a code block is a command he must paste.**
  He has mistaken output for a command and run it.
- **Every command is labelled above the box** with what it is, the run number
  and how long it takes — `SIMULATOR TEST — RUN 152 — about 90 seconds`, or
  `DEPLOY — v4.9.188 · #491`.
- **Three sentences maximum** unless he asks for more.
- **No jargon.** Say "box", not node. Say "the app", not the client. The device
  asks, the server answers; the device sends. Never "pull" or "push" as nouns.
- **"The boxes"** = the screen behind EDIT ORDER inside a shooting order (the
  grey REMAINING boxes where DAY 1, DAY 2… are picked, then SORT NOW). Never
  "the sheet", "the bracket" or "the tree" — Roman asked for "boxes" (#495).
  An item nobody has ticked yet is listed grey and NOT tappable in the boxes;
  it becomes tappable once at least one shot has it, on the next EDIT ORDER.
- Findings belong in the code and in `TOMORROW.md`, not in the chat.

### The words Roman uses, and what they mean

| he says | it means |
|---|---|
| **zzz** | the test run has finished. Read `e2e-log/last-run.log` yourself and tell me what it says. Do not ask him to paste anything. |
| **4 steps save** | the save ritual below. All four steps, in order. |
| **go** | build it. Stop asking. |
| **fix it** / **fix** | the thing just discussed, now, without a plan first. |
| **show me the list** | the open items from TOMORROW.md, short, in points. |
| **did you trace it, or are you reasoning?** | you have stated something as fact without following the code. Answer honestly; "not traced" is an acceptable answer, a guess dressed as a finding is not. |
| **works.** / **works** | confirmed on his device. It can come off the list. |
| **it's a mix up** | you have handed over something wrong and he has run it. Stop, work out the actual state before touching anything else. |
| **wait** | stop what you are doing and answer him first. |
| **repair it now** | something is in a bad state on his machine or on dev; fixing it comes before anything else. |
| **what is this?** | he does not recognise a word you used. Say it again without the word. |

He writes fast, in lower case, often from a phone, and often mid-thought while
something else is running. Typos are normal. If a message looks like it
contradicts an earlier one, he has usually learnt something in between — ask
which he means rather than picking one.

### Handing over a command — the exact shape

Roman pastes what he is given, without reading it. So:

**Every command is labelled on the line above the box.** Two kinds, and only
two. The label is bold, the version or run number is in it, and the time it
takes is in it.

> **SIMULATOR TEST — RUN 152 — about 90 seconds**
>
> ```
> cd ~/Desktop/Framehow\ Files/framehow-react && FH_RUN=152 npm run t -- -g "some words"
> ```

> **DEPLOY — v4.9.191 · #494**
>
> ```
> cd ~/Desktop/Framehow\ Files/framehow-react && V="…" && … ; echo "DEPLOYED: $V"
> ```

Rules that go with it:

- **One command per box.** Never two boxes in one message unless he asked for
  both, and then each gets its own label.
- **Nothing else is ever in a box.** Not log output, not a snippet being
  discussed, not a file path. He has run output as a command before.
- **Never a placeholder.** No `MESSAGE`, no `vX.Y.ZZZ`. A template was pasted
  once and produced a commit called "MESSAGE".
- **Check `git status` and `git log` before handing over anything with git in
  it.**
- **A deploy always carries a NEW number**, in both `APP_VERSION` and
  `SYNC_BUILD_TAG`, and the command ends by printing what it deployed, read out
  of the source files. He checks that number on screen against what you said.
- After a test run he says **zzz**. That means: the run finished, read
  `e2e-log/last-run.log` yourself and tell me what it says.

### "4 STEPS SAVE" — when he says those words, do exactly this

1. **Say the CURRENT version** in `state.ts` — not bumped, not the next one.
2. **One command**, labelled, that does all three things: commit, push, and copy
   the whole folder into `~/Desktop/framehow-react-versions/<version>` —
   excluding `node_modules`, `dist`, `.git`, and the test output folders. It
   must come out under 5MB. End it by printing what was saved.
3. **He pastes the output back.**
4. **Then bump** `APP_VERSION` and `SYNC_BUILD_TAG`.

Not four messages — step 2 is one line he can paste once. Do not skip step 1;
he uses it to check you are saving what he thinks you are saving.

### How to work

- **NEVER FIX ONE OF TWO. GREP FIRST.** Before saying a fix is done, search for
  every other place the same thing happens. Today thirteen places asked the same
  question and only some knew both answers.
- **NEVER SAY A FAULT EXISTS WITHOUT TRACING THE PATH TO IT.** Say "not traced"
  instead. Roman's check, and he should use it freely: *"did you trace it, or
  are you reasoning?"*
- **Do only what was asked.** Not the neighbouring thing. An iPad change is not
  an iPhone change.
- **A change that deletes anything gets its danger traced before the deploy
  command is handed over.**
- **Never hand over a command with a placeholder in it.** A template with
  `MESSAGE` in it was pasted and produced a commit called "MESSAGE".
- **Check the state before handing over any git command** — `git log`,
  `git status`.
- **Never search-and-replace across a file that contains the new helper.** Today
  a blanket replace rewrote a helper's own body into a call to itself; every
  shooting order crashed and it went out in a deploy.
- **Never report "benches green" after changing the screen half.** CSS has no
  bench.
- **Always state how long a test run takes.**
- **Do not ask Roman to pin, save or park something instead of fixing it.**
- **Claude does not delete Roman's data.** Give him the command instead.
- Claude cannot run the simulator or `npm run build`; the bench is Claude's, the
  simulator is Roman's.

### Deploying

- **Roman controls all deployments. Never deploy. Never propose production.**
- **We work on DEV.** `dev.framehow-react.pages.dev`. `try427` and `try411` are
  old addresses.
- **A new number for every deploy** — both `APP_VERSION` in `state.ts` and
  `SYNC_BUILD_TAG` in `syncTrace.ts`.
- The deploy command copies `dist` outside the git repo first, uses
  `(git commit … || true)` and a `;` before the build, and **ends by printing
  the version and build number read out of the source files** — not typed by
  hand, which is how a log once said 404 for a 410.
- **"4 STEPS SAVE"**: (1) report the current version, not bumped; (2) one
  command that commits, pushes and copies the folder into
  `framehow-react-versions` — under 5MB, no `node_modules`, no `dist`, no
  `.git`; (3) Roman pastes the output; (4) bump both numbers.

### Decisions about the app that must not be quietly reopened

- **The private shot number never leaves the device.** Numbers are local
  handles, allowed to differ between devices for ever. Only permanent names
  travel. (#489)
- **A shot gets its permanent name where it is made**, not when the server
  answers. (#405, finished in #489 — nine places.)
- **An automatically re-sorted arrangement is not data, it is a RESULT.** Never
  fight over a result — recompute it. The only thing in an order that is truly
  data is the hand rearranging, because nothing else can recreate it.
- **Each device works the re-sort out for itself.** Nothing new travels.
- **A shot that did not change box is not marked.** Otherwise a needs change
  paints a wall of green on shots nobody touched. (#432)
- **Breaks stay beside the list, not inside it.** #337 put them inside and the
  app decided its settings had changed on every pass — push, pull, push, pull.
  #343 put it back.
- **A shooting order is one item and does not merge.** The later edit wins
  whole. (#312)
- **UNDO was designed and then cut, on purpose.** Do not reintroduce it without
  reading why.
- **The rule that chooses 3×2 when a project opens is pristine.** Do not change
  it.
- **Fitting stays untouched.**
- **"Gone" requires 410 AND the code `deleted`** — both, never either.
- **A new shot appears in the story flow immediately, like every other view —
  but never enters a shooting order while EDIT ORDER is open.** The bracket is
  counting a fixed set of shots. It lands next time the order is opened.
- **Migrations are never edited after being run.**

---

## 7. WHAT IS STILL BROKEN

### Certain

1. **The green marks.** In a shooting order, when the needs move a shot, that
   shot should be marked so you can see what moved. A test that changes one
   shot's day and expects one mark gets none. **Older than today** — proved by
   running it against this morning's code. The app says *"the boxes match the
   needs — nothing to do"*, and the current reading is that the test asks for a
   box the sheet never had; that reading has been wrong once already. Not fixed.

2. **Dragging in the shooting order on the Desktop.** The card being dragged
   appears on the left of the screen instead of under the pointer. Drawing only.
   Not started.

3. **Ten pushes while you work the sorting sheet.** Every box you pick sends the
   half-finished order to the other devices. The rule Roman remembers holds the
   *fetching* and is commented out; nothing holds the *sending*. Agreed fix: send
   once, when you leave the sheet. Not started.

### Reported today, cause not confirmed

4. **Breaks appearing in both the story flow and a shooting order.** They are
   separate in the store and separate on screen in every reproduction attempted
   here. A real fault was found and fixed nearby — a group's story flow was not
   recognised as a story flow in thirteen places — which may or may not be the
   cause. Roman to re-check on #492.

### On the older list, untouched

- iPad view bar and setup bar hiding — needs the iPad to judge.
- Preview thumbnails in the sort view.
- The ten-second lock.
- Dead data on the server: orphaned pictures (needs an age guard first); notes
  outliving a purged project; **do not** sweep live-project notes.
- The FITTING export modal.
- The forced fetch that can land while a hand is drawing.
- Take the sync log out — last, and Roman still reads it constantly.

---

## 8. WHAT TODAY WAS FOR, AND HOW IT WENT

The day's goal was one thing: **shooting orders were not syncing**. Roman:
*"this is the most crutial part of the app, if this does not work, we failed!"*

**Fixed and proved on the simulator:**

- Shooting orders and groups now travel by the shots' permanent names, never by
  a device's private numbers. This was the whole fault: the same fourteen shots
  were numbered 17–30 on the Desktop and 1–14 on the iPad, so an order made on
  one showed nothing on the other. Proved across a whole working day with three
  devices, offline on both sides, and a project made entirely with no signal.
- A shot gets its permanent name wherever it is made — six of the nine places
  had been missed.
- The bars in SETUPS were being painted near-black with their dividing lines
  removed, which read as a gap and as a missing detail bar.
- Every setup is offered in the sorting sheet, not only those already on a card.
- Every needs item is selectable in every box, so a day added today can be used
  at once.
- A group's story flow is treated as a story flow in all thirteen places.
- `+/-` removed from DIRECTION in new projects.

**Went wrong, and is worth knowing:**

- Three attempts were made at a story-flow fault that **did not exist in the
  app**. It was the simulator's own door creating shots without names. Roman
  ended it with one sentence — *"it can never be shorter"* — after three hours.
- A blanket search-and-replace rewrote a new helper into a call to itself. Every
  shooting order crashed, and it was deployed before anyone noticed.
- Nine screen changes made earlier in the day were deployed together in one go,
  none of them ever seen on a device in between. That is why the evening felt
  like everything breaking at once.

**The lesson, in one line:** the simulator answers "does it work"; the bench
only answers "is my idea of the rule self-consistent". Today they were used in
the wrong order.
