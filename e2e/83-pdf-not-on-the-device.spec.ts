// A PDF THAT IS NOT ON THE DEVICE (23 November, Roman).
//
// A PDF kept in iCloud and not yet downloaded still shows in the Files picker.
// With a weak line it arrives empty, or cannot be read at all. Until today
// Framehow emptied the project on the screen BEFORE it looked at the file, and
// then said only "Could not read this PDF." — in front of an empty project.
//
// Roman: "we need the user let him know that it is not our fault that his PDF
// is not on the device… He has to do something, not us." The words are his.
//   · the box says so, and what to do
//   · NOTHING on the screen changes: the open project keeps every shot
//   · and it still saves as ever
//
//     npm run t -- -g "pdf not on the device"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

test('pdf not on the device: the box says so, the open project keeps every shot and saves as ever', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProject('KEEP ME', 5);
  await d.settle();
  for (const sel of ['#projectListClose', '#accountCancel']) {
    const b = d.page.locator(sel);
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  const before = (await d.read()).frames.map((f: { id: unknown }) => f.id);
  expect(before.length).toBe(5);
  const note = d.page.locator('#importantNote');

  for (const how of ['empty', 'unreadable'] as const) {
    say(`a PDF is picked that arrives ${how}: the box, and nothing else`);
    await d.page.evaluate((h) => (window as never as { __fh_test: { pickPdfThatDidNotArrive(x: string): void } }).__fh_test.pickPdfThatDidNotArrive(h), how);
    await expect(note, 'THE BOX NEVER CAME').toBeVisible({ timeout: 10_000 });
    await expect(note).toContainText('THIS PDF DOES NOT SEEM TO BE ON YOUR DEVICE');
    await expect(note).toContainText('It may still be in iCloud. Download it in the Files app first, then load it into Framehow again.');
    await expect(d.page.locator('#progressOverlay'), 'no "Loading PDF…" over a file that is not there').toBeHidden();
    expect((await d.read()).frames.map((f: { id: unknown }) => f.id), 'THE OPEN PROJECT WAS TOUCHED').toEqual(before);
    await note.getByRole('button').click();
    await expect(note).toHaveCount(0);
  }

  say('the project is the same one, and saves as ever: a word under shot 1 reaches the server');
  const mark = await d.mark();
  await d.writeUnder(0, 'still here');
  await d.push();
  await d.waitForLogAfter(mark, 'push OK', 60_000);
  expect((await d.read()).frames.map((f: { id: unknown }) => f.id)).toEqual(before);
  await d.close();
});
