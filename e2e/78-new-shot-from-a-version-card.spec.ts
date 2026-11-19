// A NEW SHOT FROM A CARD THAT SHOWS A VERSION (19 November).
//
// Roman: "we do not have the NEW button in the version strips, only in MAIN
// SHOT … when you are in the ANGLE single view you are not able to do a new
// main shot." A card showing a version now carries +SH (in a fitting +TL),
// with a thin line after it; it does what New does on the main card — a new
// shot after this one. The main card keeps New.
//
//     npm run t -- -g "new shot from a version card"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 120_000 });

test('new shot from a version card: +SH in a storyboard, +TL in a fitting — a new shot after this one', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'tablet', token);

  await d.newProject('PLUS SH', 2);
  await d.settle();
  await d.setView('ver');
  // (the simulator's start leaves the Open project list standing over the page;
  // a person would have closed it)
  const close = d.page.locator('#projectListClose');
  if (await close.isVisible()) await close.click();
  const btn = d.page.locator('#versionsScroll .frame-card [data-newshot]:visible').first();
  await expect(btn, 'the version card has the button').toBeVisible({ timeout: 10_000 });
  await expect(btn).toHaveText('+SH');
  await expect(d.page.locator('#versionsScroll .frame-card .version-actions .act-sep:visible').first(), 'with the thin line after it').toBeVisible();

  say('tablet: +SH on shot 1\'s version card — a new shot between 1 and 2');
  const before = (await d.read()).frames.map((f) => f.id);
  await btn.click();
  // (looked at first: the outline lasts 1.4 s) The new shot's card in the strip has the red outline of a shot just made.
  await expect(d.page.locator('#versionsScroll .frame-card.frame-just-added:visible'), 'the new shot is outlined in the strip').toHaveCount(1, { timeout: 3_000 });
  await expect.poll(async () => (await d.read()).frames.length, { timeout: 10_000 }).toBe(3);
  const after = (await d.read()).frames.map((f) => f.id);
  expect(after[0], 'shot 1 stays first').toBe(before[0]);
  expect(after[2], 'the old shot 2 is now third').toBe(before[1]);

  say('tablet: the main card still says New, and has no +SH');
  await d.setView('main');
  await expect(d.page.locator('#mainScroll .frame-card [data-mact="new"]:visible').first()).toHaveText('New');

  say('tablet: a fitting says +TL');
  await d.newProjectOfKind('PLUS TL', 'fitting', 2);
  await d.settle();
  await d.setView('ver');
  await expect(d.page.locator('#versionsScroll .frame-card [data-newshot]:visible').first()).toHaveText('+TL', { timeout: 10_000 });

  await d.close();
});
