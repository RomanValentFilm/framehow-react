// WORK MADE WHILE AWAY, ARRIVING LATE (#316).
//
// The two tables #313 did not reach: settings and deletions. Both carried the
// DEVICE's time of the change, and both were filtered against a SERVER time on
// the way out — so anything made while a device was away, and pushed after the
// other device had already caught up, fell beneath the question and was never
// handed over. Not late. Invisible, and for good, because that watermark only
// climbs.
//
// The shape both tests need, and the reason it is not the same as 02:
//
//   1. the tablet goes away and does something              (stamped THEN)
//   2. the DESKTOP carries on working and pulls              (its mark moves PAST that)
//   3. the tablet comes back and pushes
//   4. the desktop must still be told
//
// Step 2 is the whole test. In 02 the tablet's work always arrived before the
// desktop had moved on, so the fault could not show. Here the desktop moves on
// first, which is what actually happens on a shoot: one person keeps working
// while the other is in a basement with no signal.

import { test, expect } from '@playwright/test';
import { Device, freshAccount } from './harness';

/** Make the desktop do a round trip, so its "I have heard everything up to
 *  here" mark moves past whatever the tablet did while it was away. */
async function desktopMovesOn(desktop: Device, text: string): Promise<void> {
  const mark = await desktop.mark();
  await desktop.writeUnder(0, text);
  await desktop.push();
  await desktop.waitForLogAfter(mark, 'push OK');
  // ...and a pull, which is what actually advances the mark (#299: pushing
  // never counts). Nudging is how the heartbeat gets a chance to run.
  for (let i = 0; i < 12; i++) await desktop.nudge();
  await desktop.settle();
}

test('a category renamed while away still arrives', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Away test', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  const start = await tablet.read();
  test.skip(start.categories.length === 0, 'this project template has no needs categories');

  // 1. the tablet goes away and renames a category
  await tablet.offline(true);
  await tablet.page.waitForTimeout(4000);      // long enough to be noticed (#298)
  await tablet.renameCategory(0, 'RENAMED WHILE AWAY');
  await tablet.settle();

  // 2. the desktop keeps working, and catches up past that moment
  await desktopMovesOn(desktop, 'the desk carried on');

  // 3. the tablet comes back
  const back = await tablet.mark();
  await tablet.offline(false);
  await tablet.waitForLogAfter(back, 'back online');
  await tablet.push();

  // 4. the desktop must be told
  const deadline = Date.now() + 45_000;
  for (;;) {
    await desktop.nudge();
    const now = await desktop.read();
    if (now.categories[0] === 'RENAMED WHILE AWAY') break;
    if (Date.now() > deadline) {
      throw new Error(`the rename made while away never arrived.\n`
        + `  desktop has: ${now.categories.join(', ')}\n\n`
        + (await desktop.log()).slice(0, 25).map((l) => '  ' + l).join('\n'));
    }
    await desktop.page.waitForTimeout(500);
  }

  await desktop.close();
  await tablet.close();
});

test('a frame deleted while away stays deleted, on both', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Deleted while away', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // The frame that is going to be deleted — named, so its ghost is recognisable.
  await tablet.writeUnder(3, 'this frame is going to be deleted');
  await tablet.push();
  await Device.waitUntilTheyAgree(desktop, tablet);
  await tablet.settle();
  await desktop.settle();

  // 1. the tablet goes away and deletes it
  await tablet.offline(true);
  await tablet.page.waitForTimeout(4000);
  await tablet.deleteFrame(3);
  await tablet.settle();
  expect((await tablet.read()).frames, 'the tablet should be down to three')
    .toHaveLength(3);

  // 2. the desktop keeps working, and catches up past the deletion
  await desktopMovesOn(desktop, 'the desk carried on');

  // 3. the tablet comes back
  const back = await tablet.mark();
  await tablet.offline(false);
  await tablet.waitForLogAfter(back, 'back online');
  await tablet.push();

  // 4. both must end up with three frames, and the dead one must not be on
  //    either of them. Deleting is final.
  const agreed = await Device.waitUntilTheyAgree(desktop, tablet);
  expect(agreed, 'the deleted frame must not come back')
    .not.toContain('this frame is going to be deleted');
  expect((await desktop.read()).frames, 'the desktop should be down to three too')
    .toHaveLength(3);
  expect((await tablet.read()).frames).toHaveLength(3);

  await desktop.close();
  await tablet.close();
});
