// BOTH OFFLINE, BOTH WORKING, BOTH BACK (#309).
//
// The scenario Roman ran by hand a dozen times this week, now a script.
//
// The rules being checked are the ones he set:
//   - the later change to a frame wins, whichever device reconnects first
//   - the later arrangement wins whole, not merged into an order nobody made
//   - a renamed category travels
//   - and above all: the two devices end up showing THE SAME THING

import { test, expect } from '@playwright/test';
import { Device, freshAccount } from './harness';

test('the later change wins, whoever comes back first', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Offline test', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  // Let the app take its first look before anything is changed. Its stamping
  // happens on the local save, and the FIRST pass is deliberately read as "this
  // is how the project already was" (#289) — so a change made in the same
  // instant as the project is created carries no time, and "later wins" has
  // nothing to compare. A person is never that fast; a test is.
  await desktop.settle();
  await tablet.settle();

  // --- both go away --------------------------------------------------------
  await desktop.offline(true);
  await tablet.offline(true);

  // The tablet writes first, the desktop after it — so the desktop's is later.
  await tablet.writeUnder(1, 'written on the tablet');
  await tablet.page.waitForTimeout(1200);
  await desktop.writeUnder(1, 'written on the desktop');

  // --- the TABLET comes back first, the loser reconnecting first ------------
  await tablet.offline(false);
  await tablet.waitForLog('back online');
  await tablet.nudge();

  // --- then the desktop, whose change is the later one ----------------------
  await desktop.offline(false);
  await desktop.waitForLog('back online');

  const agreed = await Device.waitUntilTheyAgree(desktop, tablet);
  expect(agreed, 'the later writing must be the one both devices show')
    .toContain('written on the desktop');
  expect(agreed).not.toContain('written on the tablet');

  // Nobody was asked to choose (#303): the frame picker is gone.
  await desktop.expectNeverInLog('decision(s) waiting');
  await tablet.expectNeverInLog('decision(s) waiting');

  await desktop.close();
  await tablet.close();
});

test('the later arrangement wins whole, and a note survives it', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Arrangement test', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  // Let the app take its first look before anything is changed. Its stamping
  // happens on the local save, and the FIRST pass is deliberately read as "this
  // is how the project already was" (#289) — so a change made in the same
  // instant as the project is created carries no time, and "later wins" has
  // nothing to compare. A person is never that fast; a test is.
  await desktop.settle();
  await tablet.settle();
  const before = await desktop.read();
  const labels = before.frames.map((f) => f.label);

  await desktop.offline(true);
  await tablet.offline(true);

  // The desktop rearranges; the tablet writes on a frame, later.
  await desktop.moveFrame(3, 0);                 // last frame to the front
  await tablet.page.waitForTimeout(1200);
  await tablet.writeUnder(1, 'a note made while away');

  await desktop.offline(false);
  await desktop.waitForLog('back online');
  await tablet.offline(false);
  await tablet.waitForLog('back online');

  const agreed = await Device.waitUntilTheyAgree(desktop, tablet);

  // The arrangement the desktop made is the one in force...
  const order = (await desktop.read()).frames.map((f) => f.label);
  expect(order[0], 'the frame moved to the front should be at the front')
    .toBe(labels[labels.length - 1]);
  // ...and the note made on the other device is still there (#294).
  expect(agreed, 'a note must survive a re-order, even an older one')
    .toContain('a note made while away');

  await desktop.close();
  await tablet.close();
});

test('a renamed category reaches the other device', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Category test', 2);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  // Let the app take its first look before anything is changed. Its stamping
  // happens on the local save, and the FIRST pass is deliberately read as "this
  // is how the project already was" (#289) — so a change made in the same
  // instant as the project is created carries no time, and "later wins" has
  // nothing to compare. A person is never that fast; a test is.
  await desktop.settle();
  await tablet.settle();

  const start = await tablet.read();
  test.skip(start.categories.length === 0, 'this project template has no needs categories');

  await tablet.offline(true);
  await tablet.renameCategory(0, 'RENAMED WHILE AWAY');
  await tablet.offline(false);
  await tablet.waitForLog('back online');
  await tablet.push();

  // The desktop should end up with the new name.
  const deadline = Date.now() + 45_000;
  for (;;) {
    await desktop.nudge();
    const now = await desktop.read();
    if (now.categories[0] === 'RENAMED WHILE AWAY') break;
    if (Date.now() > deadline) {
      throw new Error(`the rename never arrived. Desktop has: ${now.categories.join(', ')}\n`
        + (await desktop.log()).slice(0, 20).map((l) => '  ' + l).join('\n'));
    }
    await desktop.page.waitForTimeout(500);
  }

  await desktop.close();
  await tablet.close();
});
