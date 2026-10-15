// SAVE ASKS FOR A NAME WHEN THE APP GAVE ONE (12 October, Roman).
//
// An unnamed project goes to the server by itself as "Untitled 12 Oct 16:05"
// once the save reminder has been waved away (#524), so nothing is lost. But
// that is the app's name, not the person's: Roman pressed SAVE on a brand-new
// project and was never asked what it is called. Now SAVE treats an app-given
// name as no name — the box opens, EMPTY, and the name typed there is what the
// server ends up with.
//
//     npm run t -- -g "asks a name"
//
// About a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

test('SAVE asks a name: an app-named "Untitled …" project opens an empty name box, and the typed name wins', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  // A fresh account opens on the "Open project" list; a person closes it
  // before working (run 365: it stayed open and swallowed the Continue press).
  if (await desktop.page.locator('#projectListModal').isVisible()) {
    await desktop.page.locator('#projectListClose').click();
    await desktop.page.waitForTimeout(300);
  }

  say('a project nobody named — "16×9 Start from Scratch" on the chooser, as a person does — with a line written in it');
  // The chooser is the app's own, opened at start for a fresh account (run 366:
  // the door built a project BEHIND it, and it then sat over the name box).
  await desktop.page.locator('.new-project-overlay [data-choice="scratch"]').click();
  await desktop.page.waitForTimeout(600);
  expect((await desktop.read()).frames.length, 'a new project with a first shot').toBeGreaterThan(0);
  expect((await desktop.read()).projectName, 'and no name').toBeFalsy();
  await desktop.writeUnder(0, 'written before any name');

  say('the save reminder is waved away — the project goes up by itself as "Untitled …"');
  await desktop.page.evaluate(() =>
    (window as never as { __fh_test: { waveSaveReminderAway(): void } }).__fh_test.waveSaveReminderAway());
  const deadline = Date.now() + 90_000;
  let got = await desktop.read();
  while (!got.projectId && Date.now() < deadline) {
    await desktop.nudge();
    await desktop.page.waitForTimeout(1000);
    got = await desktop.read();
  }
  expect(got.projectId, 'the unnamed project reached the server by itself').toBeTruthy();
  say(`   it went up as "${got.projectName}"`);
  expect(got.projectName, 'under the app\'s own provisional name').toMatch(/^Untitled \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/);
  await desktop.settle();
  // EVERYTHING ELSE ALREADY UP (Roman, 15 Oct): with nothing left to send, the
  // save after naming stopped at "nothing changed" and the server kept
  // "Untitled". So: push, settle, and only then SAVE.
  {
    const until = Date.now() + 60_000;
    while ((await desktop.read()).unsent.length > 0 && Date.now() < until) {
      await desktop.push();
      await desktop.settle();
    }
  }
  expect((await desktop.read()).unsent, 'nothing left to send before SAVE').toEqual([]);
  expect(await Device.projectNames(token), 'the server has the Untitled name').toEqual([got.projectName]);

  say('SAVE: the name box opens, and it is empty');
  // Not awaited — the save is now waiting on the box.
  const saving = desktop.saveThisProject();
  await expect(desktop.page.locator('#projectNameModal')).toBeVisible({ timeout: 10_000 });
  expect(await desktop.page.locator('#projectNameInput').inputValue(), 'the box is NOT prefilled (Roman)').toBe('');

  say('the person types THE REAL NAME and continues');
  await desktop.page.locator('#projectNameInput').fill('THE REAL NAME');
  await desktop.page.locator('#projectNameContinue').click();
  await expect(desktop.page.locator('#projectNameModal'), 'the name box closes on Continue').toBeHidden({ timeout: 10_000 });
  await saving;
  await desktop.settle();

  expect((await desktop.read()).projectName, 'the open project carries the typed name').toBe('THE REAL NAME');
  const onServer = await Device.projectNames(token);
  say(`   the server lists: ${onServer.join(' · ')}`);
  expect(onServer, 'and so does the server — the Untitled name is gone').toEqual(['THE REAL NAME']);

  say('SAVE again: a project the person named is not asked twice');
  await desktop.saveThisProject();
  await expect(desktop.page.locator('#projectNameModal')).toBeHidden();

  await desktop.close();
});
