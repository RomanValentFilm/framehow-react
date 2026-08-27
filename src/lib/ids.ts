// IDS TWO DEVICES CANNOT BOTH INVENT (#322).
//
// Shooting orders, setups and groups were numbered per DEVICE, starting at 1.
// So the first shooting order made on the desk and the first one made on the
// iPad were both `sort_1` — two different things wearing the same name.
//
// The server keeps settings one row per (project, kind, item_id). Two items with
// the same item_id are not two rows. They are one, and the later one wins. So:
//
//   - two people each make their first shooting order while apart, and one of
//     them disappears entirely — its arrangement, its breaks, all of it. The
//     list is still called SHOOTING ORDER 1, so nothing looks wrong.
//   - two people each make their first setup, and it is worse than loss: the
//     frames still carry `setup_1`, so half the storyboard ends up labelled and
//     coloured with a setup nobody ever applied to it. Wrong shooting data on
//     screen, not a missing list.
//
// Frames, versions and needs items never had this — they use real unique ids.
// These three were the last counters left.
//
// The fix is not a cleverer counter. Any counter shared between devices that
// cannot talk to each other has this fault. The id simply has to be one no
// other device would produce.
//
// Old ids keep working untouched: nothing renames anything that already exists,
// and the two forms sit side by side happily. Only new ones are made this way.

/** A new id for a thing the user just made, unique across devices. */
export function uniqueId(prefix: string): string {
  // Time first so ids sort roughly in the order they were made, which makes a
  // log readable; randomness after, which is what actually makes them unique.
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * The same, for the one place that has to stay a number.
 *
 * Groups are identified by a plain number throughout the app, and turning that
 * into text touches a great deal for no gain. A random number in this range
 * collides about as often as two randomly chosen people sharing a birthday
 * *second* — and unlike a counter, two devices making their first group no
 * longer collide every single time, which is what was actually happening.
 */
export function uniqueNumericId(): number {
  return Math.floor(Math.random() * 2_000_000_000) + 1;
}

/**
 * A FRAME'S IDENTITY, MADE WHEN THE FRAME IS MADE (#405).
 *
 * The server never handed these out — the app has always invented them, in the
 * push: `const frameId = f.serverFrameId || uuid()`. It simply did it two
 * seconds too late and did not write it onto the frame until the answer came
 * back. Everything filed by that id therefore had a hole in it for those two
 * seconds, and every symptom of this week lived in the hole:
 *
 *   - the whole-project arrangement is a list of ids, so a frame without one
 *     could not be in it and its place had to be guessed
 *   - change times are filed by id, so a rename went up as zero and lost
 *   - and a rename could land on a different frame entirely, because the local
 *     numbers are handed out afresh on every pull
 *
 * Roman: "we could give him a temporary ID, that will be reassigned once the
 * server gives him the real one." Nothing needs reassigning — it is the real one
 * from the start.
 */
export function newFrameId(): string {
  return crypto.randomUUID();
}
