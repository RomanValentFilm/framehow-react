# Tomorrow — the new frame

Deployed: **v4.9.101 · #399**. Next number: **v4.9.102**. Last run: 91.

## One fault, three symptoms

For the second or two between pressing NEW and the server answering, the frame has
no server id. Everything in the sync is filed BY that id, so for those seconds the
frame is invisible to it:

- **its name** cannot be given a change time — times are filed under the server id
  — so the rename goes up as zero, the oldest time there is, and loses to the
  server's copy. The name comes back.
- **its place** cannot be put in the arrangement — that is a list of server ids —
  so the arrangement goes up one frame short (`story flow: 23 frames` with 24 on
  screen) and the other device has to guess. Middle at 21:20, end at 21:32.
- **the orders it belongs to** drop it, because they map their frames to server
  ids and filter out the ones with none.

Same hole, three symptoms. And the cure is the same shape each time: **the frame
carries its own facts** — its time, its place — instead of being pointed at from a
list keyed by an id it does not have yet.

NOT NEW. Compared against v4.9.087, ten versions back: `sort_order: i`, the
arrangement built only from frames with ids, and applyArrangement are all
unchanged. This has been there the whole time. What today's two bad builds did was
make it loud enough to find.

## The plan, in order

**1. Check the rename. Two minutes, before touching anything.**
Press NEW, rename, close. Two separate questions:
- does the name show at once? (fixed in #396 and proven — the rename used to be
  written onto a frame object the push had already replaced)
- is it still there a minute later? (the time-from-birth half is in, unconfirmed)

**2. Stop the jumping. Small, safe, no migration.**
Never APPLY an arrangement that is missing frames this device holds.
Never solve it by not SENDING ours — an item that stops appearing reads as
DELETED, which is exactly what #397 did to every frame.

**3. Write the tests before the fix.**
Every test was green today while frames jumped on screen, because they all asked
where things ENDED UP — and the order settles after a second, so that question can
never fail. Ask instead whether the position moved AT ALL:
- press NEW, watch the position for five seconds, it must never move
- two devices reordering while apart, each adding a frame
- a frame made offline, then reconnected

**4. The fix: a position on the frame.** (Roman's, and simpler than mine.)
Given when the frame is made, exactly as a break has one, travelling with the
frame like any other content. Then `frameOrder/main` retires and there is ONE
answer to "where".

Position and id cannot fight: the id says WHICH frame, the position says WHERE it
sits. What fights today is two things that both answer WHERE — `sort_order` and
the whole-list arrangement. The fix works by deleting one of them.

(My earlier idea was a key sitting BETWEEN the neighbours' keys, so two devices
inserting in the same place at the same instant cannot collide. That is all it
buys, and in a one-man app it is not worth the machinery. Plain position first.)

**5. The shooting orders — this is the one that loses work.**
You cannot make a frame inside an order, but the app adds every new frame to
existing orders by itself. At push time the order's frames are mapped to server
ids and filtered, so a frame without one is dropped. Then nothing repairs it: the
order's stored value holds LOCAL numbers, which did not change, so the app sees no
change and never re-sends it. The frame is missing from that order on the other
device for good.

Rule: when a frame gets its id, re-send the orders it belongs to.

Breaks need nothing — a break is a position in the agreed order, and step 4 is
what makes that order reliable.

## Offline

**The order is safe while you are away.** It is simply the order of the list on the
device, saved with the project. No ids involved, nothing expires — two hours or two
days makes no difference. The only risky moment is the reconnect.

**Story flow on reconnect — transient.** Everything goes up at once, but the
arrangement is built before the ids come back, so that first push is still one
frame short. Gone by the next push, and removed entirely by step 4.

**Shooting orders on reconnect — permanent and silent.** As in step 5. This is why
step 5 must not slip behind step 4.

## Do not repeat

- **#397** made the arrangement empty while a frame had no id. An empty list is not
  "say nothing" — a missing item reads as DELETED, so the device announced the
  whole arrangement was gone. Every new frame was misplaced within minutes.
- **#395's after-push comparison** marked any frame that no longer matched what was
  sent as unsent, and stamped it — which made it differ again, and push again. One
  frame went up three times in eleven seconds.
- Both went out on a green suite. Green means "nothing I can see objects", not
  "safe".

## Still open, from earlier

- Renaming a version: the sending side is fixed, the receiving side does not take a
  strip name that arrives. Test held back — it kills the local wrangler every run.
- FRAME → SHOT and HOW → ANGLE as default strip names. ANGLE starts with A, which
  changes the strip prefix and relabels every version — understand that first.
- The list: iPad bars hiding, thumbnails in the sort view, offline copies in the
  project list, needs-changed picker, retire the frame picker, the ten-second lock,
  retry backoff, sweep tombstones, take the sync log out, FITTING export.
