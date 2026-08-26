// A RENAME HAS TO LEAVE THE DEVICE ON ITS OWN (#388).
//
// Roman: "the tags sync and travel, but the renamed categories do not." And
// before that, on a version and on a frame he had just made: the new name showed
// for a second and then came back to the old one.
//
// One cause. Every rename in NEEDS reached into the store and wrote over the
// name that was already there, then asked for a sync — but a push starts
// `if (!_dirty) return;`, and writing over something in place never sets that.
// So nothing was sent. The name then travelled LATE, whenever some other change
// happened to cause a push, and if a fetch arrived before that, the old name
// came back instead. Which is exactly why it looked random.
//
// THE OLD TEST COULD NEVER HAVE CAUGHT IT. Its door built new objects, put them
// in the store and stamped them — a copy of what a rename ought to do, and none
// of the code a rename actually ran.
//
// So the rule here: rename, and then TOUCH NOTHING. No writing, no moving, no
// second change to trigger a push by accident.
//
//     npm run t -- -g "rename"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test('a renamed column travels with nothing else touched', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Renames', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // CAREFUL: SHOOT DAY is spelled with a six-per-em space (U+2006), not an
  // ordinary one, so the two words sit closer together. The line below holds
  // that character. The first run of this test failed with "SHOOT DAY" not
  // matching "SHOOT DAY" — identical on screen, different underneath. If this
  // ever fails that way again, check the space before anything else.
  expect(await desktop.needTables(0), 'the SHOOT category should start with its '
    + 'six columns, DIRECTION among them (#386)')
    .toEqual(['SHOOT DAY', 'UNIT', 'LOCATION', 'DIRECTION', 'INT/EXT', 'DAYTIME']);

  say('desktop: renaming DIRECTION, and doing nothing else at all');
  await desktop.renameNeedTable('tbl_direction', 'CAMERA SIDE');

  say('tablet: waiting for it to arrive');
  const deadline = Date.now() + 60_000;
  for (;;) {
    await tablet.nudge();
    const names = await tablet.needTables(0);
    if (names.includes('CAMERA SIDE')) break;
    if (Date.now() > deadline) {
      throw new Error('THE RENAME NEVER LEFT THE DEVICE. The tablet still has '
        + `${JSON.stringify(names)}. Nothing was touched after the rename, `
        + 'which is the whole point: a rename has to be worth a push by itself.');
    }
    await tablet.page.waitForTimeout(1000);
  }

  // AND IT MUST NOT COME BACK. The other half of what Roman saw: the name
  // showed and then reverted, because a fetch arrived carrying the old one.
  for (let i = 0; i < 10; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(500); }
  expect((await desktop.needTables(0))[3], 'THE OLD NAME CAME BACK. A fetch '
    + 'landed on top of a rename that had never been sent.').toBe('CAMERA SIDE');

  await desktop.close();
  await tablet.close();
});

test('a renamed item inside a column travels too', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Renamed items', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  say('desktop: renaming DIRECTION A, and nothing else');
  await desktop.renameNeedItem('tbl_direction', 'ti_dir_a', 'A SIDE');

  const deadline = Date.now() + 60_000;
  for (;;) {
    await tablet.nudge();
    const items = await tablet.needItems('tbl_direction');
    if (items.includes('A SIDE')) break;
    if (Date.now() > deadline) {
      throw new Error('THE RENAMED ITEM NEVER LEFT THE DEVICE. The tablet has '
        + `${JSON.stringify(items)}.`);
    }
    await tablet.page.waitForTimeout(1000);
  }

  await desktop.close();
  await tablet.close();
});
