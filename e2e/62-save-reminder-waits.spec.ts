// THE SAVE REMINDER WAITS ITS TURN — AND ALWAYS COMES (Roman, 10 November).
//
// "To edit this project on your desktop, you'll need to save it first" is the
// one thing that leads a person who is not signed in to an account, so it must
// never be lost. It runs on a clock, and the clock once fired the moment WRITE
// was pressed: the reminder covered the write box and the write was lost (the
// simulator, 9 Nov). The rule now: while a box is open, or somebody is typing
// or drawing, it waits; when that is done it comes. If it is showing and a box
// opens, it steps aside and comes back. None of that is a "Later".
//
//     npm run t -- -g "save reminder"
//
// About a minute.

import { test, expect } from '@playwright/test';
import { Device, say } from './harness';

test.describe.configure({ timeout: 180_000 });

test('save reminder: it waits while the WRITE box or DRAW mode is open, comes when they are closed, and is never lost', async ({ browser }) => {
  // Nobody signed in: the project lives on this device only — whom the reminder is for.
  const desktop = await Device.open(browser, 'desktop', '');
  const hooks = <T>(fn: string, ...args: unknown[]) => desktop.page.evaluate(([f, a]) =>
    (window as never as { __fh_test: Record<string, (...x: unknown[]) => unknown> }).__fh_test[f as string](...(a as unknown[])), [fn, args]) as Promise<T>;
  await hooks('newUnsavedProject', 2);
  // On the bench the start's own boxes stay open (the tests press no buttons);
  // a person has closed them by now — and they would rightly hold everything back.
  for (const sel of ['#projectListClose', '#accountCancel']) {
    const b = desktop.page.locator(sel);
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  const reminder = desktop.page.locator('#saveToaster');
  const writeBox = desktop.page.locator('#textModalArea');

  say('WRITE is open — and the reminder\'s clock runs out');
  await desktop.openWriteBox(0, 'main', 0);
  await expect(writeBox).toBeVisible();
  await hooks('fireSaveReminder');
  await desktop.page.waitForTimeout(3000);
  await expect(reminder, 'NOTHING ON TOP OF THE WRITE BOX').toBeHidden();
  await expect(writeBox, 'the write box is still there').toBeVisible();

  say('the text is typed and saved — it is on the card');
  await desktop.finishWriteBox('HELLO');
  expect(await desktop.textOnCard(0, 'main', 0)).toContain('HELLO');

  say('...and NOW the reminder comes, a few seconds after the box closed');
  await expect(reminder, 'THE REMINDER NEVER CAME after the write box closed').toBeVisible({ timeout: 12_000 });
  await expect(desktop.page.locator('#saveToasterMsg')).toContainText('need to save it first');

  say('it is showing — WRITE is opened: it steps aside, and comes back when the box is closed');
  await desktop.openWriteBox(1, 'main', 0);
  await expect(reminder, 'the reminder stayed on top of a box that opened').toBeHidden({ timeout: 3_000 });
  await desktop.finishWriteBox('AGAIN');
  expect(await desktop.textOnCard(1, 'main', 0)).toContain('AGAIN');
  await expect(reminder, 'THE REMINDER DID NOT COME BACK').toBeVisible({ timeout: 12_000 });

  say('Later — it goes (the first of two). DRAW mode is opened, a stroke is drawn, and the clock runs out again');
  await desktop.page.locator('#saveToasterLater').click();
  await expect(reminder).toBeHidden();
  await desktop.openBigView(0, 'ver', 0);
  expect(await desktop.strokeInOpenBigView(0, 'ver', 0), 'a stroke was drawn').toBeGreaterThan(0);
  await hooks('fireSaveReminder');
  // Eight seconds: well past the last stroke. It is the DRAW mode being open
  // that holds it back, not the stroke (Roman, 10 Nov).
  await desktop.page.waitForTimeout(8000);
  await expect(reminder, 'NOT WHILE DRAW MODE IS OPEN — however long since the last stroke').toBeHidden();
  say('DRAW mode is closed — now it comes');
  await desktop.closeBigView();
  await expect(reminder, 'THE REMINDER NEVER CAME after DRAW mode was closed').toBeVisible({ timeout: 12_000 });

  say('and Save Now is there to press — the way to an account');
  await expect(desktop.page.locator('#saveToasterSave')).toBeVisible();
  await desktop.close();
});
