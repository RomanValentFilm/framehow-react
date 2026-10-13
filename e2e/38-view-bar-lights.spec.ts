// WHICH BUTTON IS LIT IN THE VIEW BAR (12 October, Roman).
//
// Roman changed some NEEDS, went into a GROUP and opened one of its SHOOTING
// ORDERS. The order was fine — but the view bar still showed SHOT and NEEDS as
// lit, not SORT BY. The lit button must say where the person IS.
//
// Nothing in the code read as the cause, so this is the trace: Roman's steps
// with REAL clicks on the real buttons, and at each step the bar is read and
// printed. Then a sync arrives from a second device while the order is open,
// and the bar is read again.
//
//     npm run t -- -g "view bar lights"
//
// About two minutes.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

/** The buttons lit in the view bar, by what they say. */
async function lit(d: Device): Promise<string[]> {
  return d.page.evaluate(() =>
    Array.from(document.querySelectorAll('.view-bar .active, .view-bar .group-active, .detail-bar .active'))
      .map((b) => ((b as HTMLElement).dataset.view || (b as HTMLElement).dataset.strip || b.id || '?') + ':' + (b.textContent || '').trim().replace(/\s+/g, ' ')));
}

test('view bar lights: in a group\'s shooting order only SORT BY is lit — after real clicks, and after a sync', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const ipad = await Device.open(browser, 'ipad', token);

  await desktop.newProject('THE LIGHTS', 6);
  await desktop.settle();
  const kitchen = await desktop.makeGroup('KITCHEN', [0, 1, 2]);
  await desktop.enterGroup(kitchen);
  await desktop.newSortOrder('KITCHEN DAY 1');
  await desktop.closeOrder();
  await desktop.enterGroup(null);
  await desktop.settle();
  await ipad.openProject((await desktop.read()).projectId!);
  await ipad.settle();

  // The project list panel is left showing after a project is made (test 19).
  await desktop.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));

  say('step 1 — NEEDS, with the real button');
  // NEEDS lives in the DETAIL bar, not the view bar (runs 364/365 looked for
  // it in the wrong bar for five minutes each). By its id, on the page.
  await desktop.page.locator('#needsStripBtn').click();
  await desktop.page.waitForTimeout(400);
  say(`   lit: ${(await lit(desktop)).join(' · ')}`);

  say('step 2 — into the group, through the GROUP button and the sidebar');
  await desktop.page.click('.view-bar .view-btn[data-view="group"]');
  await desktop.page.waitForSelector('.group-item[data-gid]');
  await desktop.page.click(`.group-item[data-gid="${kitchen}"]`);
  await desktop.page.waitForTimeout(500);
  say(`   lit: ${(await lit(desktop)).join(' · ')}`);
  expect(await desktop.whichGroup(), 'in the group').toBe(kitchen);

  say('step 3 — SORT BY, and the group\'s order from the menu');
  await desktop.page.click('#sortByBtn');
  await desktop.page.waitForSelector('#sortDropdown .sort-dd-item[data-sort-id]');
  await desktop.page.click('#sortDropdown .sort-dd-item:has-text("KITCHEN DAY 1")');
  await desktop.page.waitForTimeout(600);
  let now = await lit(desktop);
  say(`   lit: ${now.join(' · ')}`);
  expect(await desktop.orderBeingEdited(), 'the order is open').toBeTruthy();
  const notSortBy = now.filter((b) => !b.startsWith('sortby:') && !b.startsWith('group:'));
  expect(notSortBy, 'IN A SHOOTING ORDER ONLY SORT BY (and the group name) MAY BE LIT — Roman, 12 Oct').toEqual([]);
  expect(now.some((b) => b.startsWith('sortby:')), 'and SORT BY is lit').toBe(true);

  say('step 4 — the iPad writes on a shot; the desktop takes the sync with the order still open');
  await ipad.writeUnder(4, 'from the ipad, mid-order');
  await ipad.push();
  const until = Date.now() + 60_000;
  for (;;) {
    await desktop.nudge();
    await desktop.page.waitForTimeout(1000);
    const seen = (await desktop.read()).frames[4]?.text === 'from the ipad, mid-order';
    if (seen || Date.now() > until) break;
  }
  expect((await desktop.read()).frames[4]?.text, 'the sync arrived').toBe('from the ipad, mid-order');
  await desktop.page.waitForTimeout(800);
  now = await lit(desktop);
  say(`   lit after the sync: ${now.join(' · ')}`);
  expect(await desktop.orderBeingEdited(), 'the order is still open after the sync').toBeTruthy();
  expect(now.filter((b) => !b.startsWith('sortby:') && !b.startsWith('group:')),
    'THE SYNC RE-LIT SHOT/NEEDS while the order was open').toEqual([]);
  expect(now.some((b) => b.startsWith('sortby:')), 'SORT BY still lit').toBe(true);

  await desktop.close();
  await ipad.close();
});
