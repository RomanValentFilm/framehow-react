// A FITTING KEEPS CAPITAL TAB LETTERS WHEN THE STRIP IS RENAMED ON THE CARD
// (23 October, Roman).
//
// In a fitting the version tabs read L1, L2 — capital, because "l1" reads as
// "11" (#505). Renaming the strip in Customise kept them capital; renaming it on
// top of a card made them small again.
//
//     npm run t -- -g "capital tab"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

test('fitting: renaming the LOOK strip on the card keeps the capital tab letter', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProjectOfKind('CAPITAL TABS', 'fitting', 2);
  await desktop.settle();
  const before = await desktop.versionLabels(0, 'ver');
  say(`   tabs before: ${before.join(' ')}`);
  expect(before[0], 'a fitting starts with capital tabs').toMatch(/^[A-Z]/);

  await desktop.renameStrip('ver', 'OUTFIT');
  await desktop.page.waitForTimeout(300);
  const after = await desktop.versionLabels(0, 'ver');
  say(`   tabs after renaming to OUTFIT: ${after.join(' ')}`);
  expect(after[0], 'the tab takes the new first letter, CAPITAL (Roman, 23 Oct)').toBe('O1');

  await desktop.close();
});
