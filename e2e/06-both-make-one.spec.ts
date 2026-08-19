// TWO PEOPLE, EACH MAKING THEIR FIRST ONE (#322).
//
// Shooting orders, setups and groups used to be numbered per device, starting
// at 1. So the first shooting order made on the desk and the first one made on
// the iPad were both called `sort_1`.
//
// The server keeps one row per (project, kind, item_id). Two things with the
// same id are not two rows — they are one, and the later one wins. So two
// people each making their first shooting order while apart ended with one of
// them, and no sign that the other had ever existed.
//
// This is not an unusual thing to do. It is the FIRST thing two people do.

import { test, expect } from '@playwright/test';
import { Device, freshAccount } from './harness';

test('two devices each make their first shooting order, and both survive', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Both make one', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // Both go away. Neither can see what the other is doing — which is the whole
  // point: two devices that cannot talk cannot agree a number between them.
  await desktop.offline(true);
  await tablet.offline(true);
  await desktop.page.waitForTimeout(4000);

  const deskId = await desktop.newSortOrder('DESK ORDER');
  const padId = await tablet.newSortOrder('PAD ORDER');

  expect(deskId, 'two devices must not invent the same id').not.toBe(padId);

  await desktop.moveInOrder(0, 3, 0);
  await tablet.moveInOrder(0, 1, 0);
  await desktop.settle();
  await tablet.settle();

  // Both come back.
  const d = await desktop.mark();
  await desktop.offline(false);
  await desktop.waitForLogAfter(d, 'back online');

  const t = await tablet.mark();
  await tablet.offline(false);
  await tablet.waitForLogAfter(t, 'back online');

  // Both orders must exist, on both devices, with both names.
  const deadline = Date.now() + 60_000;
  for (;;) {
    await desktop.nudge(); await tablet.nudge();
    const dNames = (await desktop.read()).orders.map((o) => o.name).sort();
    const tNames = (await tablet.read()).orders.map((o) => o.name).sort();
    const bothHaveBoth =
      dNames.includes('DESK ORDER') && dNames.includes('PAD ORDER')
      && tNames.includes('DESK ORDER') && tNames.includes('PAD ORDER');
    if (bothHaveBoth) break;
    if (Date.now() > deadline) {
      throw new Error(`one of the two shooting orders was lost.\n`
        + `  desktop has: ${dNames.join(', ') || '(none)'}\n`
        + `  tablet has:  ${tNames.join(', ') || '(none)'}`);
    }
    await desktop.page.waitForTimeout(500);
  }

  // And nobody was asked to choose between them: they are not two versions of
  // one order, they are two orders.
  await desktop.expectNeverInLog('decision(s) waiting');
  await tablet.expectNeverInLog('decision(s) waiting');

  await desktop.close();
  await tablet.close();
});
