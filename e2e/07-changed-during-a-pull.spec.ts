// A CHANGE MADE WHILE THE PULL IS IN THE AIR (#323).
//
// The first run of the shooting-order test added a break in the same instant the
// desktop reconnected, and the break vanished — from the device that MADE it.
// Both devices then agreed, quietly, on an order with no break in it.
//
// The cause: on a pull the store is rebuilt from the project's metadata blob
// first, and only then are the per-item settings merged on top. By then the
// merge is looking at the server's copy, so its protection — "an item I changed
// later and have not sent is left alone" — can decline to overwrite, but can
// never put anything back.
//
// It is a narrow window. It is also exactly when people act: the iPad comes back
// to life and they immediately do the thing they had been waiting to do.

import { test, expect } from '@playwright/test';
import { Device, freshAccount } from './harness';

test('a break added in the same moment as reconnecting is not painted over', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('During a pull', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // An order both devices know about.
  await desktop.newSortOrder('SHOOTING ORDER 1');
  await desktop.push();
  await Device.waitUntilOrdersAgree(desktop, tablet);
  await desktop.settle();

  // The desktop goes away, and the tablet changes something so there is a real
  // answer waiting when it comes back.
  await desktop.offline(true);
  await desktop.page.waitForTimeout(4000);
  await tablet.writeUnder(1, 'the pad kept working');
  await tablet.push();
  await tablet.waitForLog('push OK');

  // ...and the break is added in the SAME BREATH as reconnecting — no waiting
  // for the pull to land, which is the whole point.
  await desktop.offline(false);
  await desktop.addBreak(0, 2, 'LUNCH BREAK — 60 min');

  // Both must end up with the break AND with the tablet's writing. Neither
  // piece of work may be spent to buy the other.
  const agreed = await Device.waitUntilOrdersAgree(desktop, tablet);
  expect(agreed, 'a break made while the pull was in the air must survive')
    .toContain('LUNCH BREAK');

  const both = await Device.waitUntilTheyAgree(desktop, tablet);
  expect(both, "and the other device's work must survive too")
    .toContain('the pad kept working');

  await desktop.close();
  await tablet.close();
});
