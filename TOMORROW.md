# The list

Deployed: **v4.9.089 · #382**. Waiting to be saved: **#383**. Next number: **v4.9.090**.

## Next

1. A rename made before the thing has been sent gets put back by the next fetch.
   Roman: renamed a version, and a frame he had just created — the name showed
   for a second and reverted. Renaming again stuck. Likely `changeStamps.ts`:
   `if (!f.serverFrameId) return;` — nothing that has never been to the server
   gets a change time, so the rename has nothing to argue with. Test it first.
2. iPad view bar and setup bar hiding
3. Preview thumbnails in the sort view
4. Offline copies in the project list
5. A picker when a frame's needs change after sorting
6. Retire the frame picker — dead code
7. The ten-second lock
8. Retry backoff
9. Sweep the losing sides and tombstones
10. Take the sync log out — last
11. FITTING export modal

## Done, waiting to be saved (#383)

- The red group name now appears in the view bar. `enterGroup` changed the group
  and drew nothing; `bumpRenderTick()` only bumps a counter that nothing watches.
- The SORT BY menu is in two parts: the project's story flow and its own orders,
  a black separator, then every group with its own story flow and orders.
- A group's story flow can be chosen and takes you into that group. The top
  STORY FLOW is the project's and takes you back out to ALL.
- One + ADD ORDER under each block.
- The run script prints FH_RUN at the end and holds the Mac awake.

## Closed

- The scribble loss from #381 — kept on purpose.
- The random day failure — not ours.
- #366 touch-and-catch-up — dropped.
- Parked: frame numbering; the black canvas after deleting all versions.

Last run number: 60.
