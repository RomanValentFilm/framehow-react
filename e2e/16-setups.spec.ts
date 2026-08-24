// A SETUP MADE WHILE THE OTHER DEVICE IS AWAY (#365).
//
// The random day, watched step by step with a fair window, gets all the way to
// the end — the frames converge every time — and then fails on the setups: one
// device has two of the three that were made, the other has one.
//
// The missing one is the FIRST, made by the tablet while both devices were
// online and nobody was in contention. The desktop was away from the step after,
// holding a palette that had never heard of it, and pushed that palette when it
// came back.
//
// This is the shape, written small: one device makes a setup while the other is
// away; the one that was away comes back and makes its own.
//
//     npm run t -- -g "setup made while"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

// NOT RUNNING, AND THE REASON MATTERS.
//
// Nothing is lost here: the device that was away simply stops asking. The app
// listens only while its window is in front and it has been touched recently,
// which is deliberate — but it means a desktop behind another window can sit an
// hour out of date, and to the person that looks exactly like a setup vanishing.
//
// #366 fixes it in one line and makes this pass in twenty-two seconds. #366 is
// held back because with it on, another test fails every time: two devices, one
// in a shooting order, and the desktop never takes the tablet's writing.
//
// So this stays here, skipped, as the thing #366 is for.
test.fixme('a setup made while the other device is away is not lost', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Setups', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  say('desktop goes away');
  await desktop.offline(true);
  await desktop.page.waitForTimeout(4000);

  // Made on the tablet, ONLINE, with nobody to argue with. It reaches the
  // server; the desktop simply has not heard about it.
  say('tablet: makes DAY while the desktop is away');
  await tablet.newSetup('DAY');
  await tablet.settle();
  for (let i = 0; i < 6; i++) { await tablet.nudge(); await tablet.page.waitForTimeout(500); }

  // And the one that was away makes its own, then comes back.
  say('desktop: makes NIGHT while still away, then comes back');
  await desktop.newSetup('NIGHT');
  await desktop.settle();
  const d = await desktop.mark();
  await desktop.offline(false);
  await desktop.waitForLogAfter(d, 'back online', 20_000);

  const deadline = Date.now() + 60_000;
  let dS: string[] = [], tS: string[] = [];
  for (;;) {
    await desktop.nudge(); await tablet.nudge();
    dS = (await desktop.read()).setups.slice().sort();
    tS = (await tablet.read()).setups.slice().sort();
    if (dS.includes('DAY') && dS.includes('NIGHT')
      && tS.includes('DAY') && tS.includes('NIGHT')) break;
    if (Date.now() > deadline) {
      throw new Error('A SETUP WAS LOST. Both were made, neither was deleted, '
        + 'and they were never in competition with each other.'
        + `\n  desktop has: ${dS.join(', ') || '(none)'}`
        + `\n  tablet has:  ${tS.join(', ') || '(none)'}`
        + `\n\n  desktop log:\n${(await desktop.log()).slice(0, 22).map((l) => '    ' + l).join('\n')}`
        + `\n\n  tablet log:\n${(await tablet.log()).slice(0, 22).map((l) => '    ' + l).join('\n')}`);
    }
    await desktop.page.waitForTimeout(1000);
  }

  expect(dS, 'the two devices ended with different palettes').toEqual(tS);
  await desktop.close();
  await tablet.close();
});
