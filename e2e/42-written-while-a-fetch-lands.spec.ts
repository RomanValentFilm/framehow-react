// A TEXT WRITTEN WHILE A FETCH LANDS (17 October, Roman, iPad).
//
// Roman pressed WRITE, deleted the text, OK — gone, sent. Opened WRITE again
// at once and typed a new text, OK — and it was not there. Between the two,
// his own change came back from the server and every card was rebuilt. The
// box still pointed at the old card; the new text was written onto that one,
// which was no longer the one on screen. The next push: "nothing changed".
//
// Here the second device changes the shot while the box is open, so the fetch
// certainly carries something for that card.
//
//     npm run t -- -g "while a fetch lands"
//
// About a minute each.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

for (const where of ['main', 'ver'] as const) {
  test(`text written on ${where === 'main' ? 'the card' : 'a VERSN version'} while a fetch lands inside the open box is on the card afterwards`, async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);

    const pid = await desktop.newProject('WRITTEN UNDER A FETCH', 2);
    await desktop.settle();
    await ipad.openProject(pid!);
    await ipad.settle();
    if (where !== 'main') await desktop.showStrip(where);

    say('desktop: a first text, sent; then deleted, sent');
    await desktop.writeOnCard(0, where, 0, 'FIRST');
    await desktop.push();
    await desktop.settle();
    await desktop.writeOnCard(0, where, 0, '');
    await desktop.push();
    await desktop.settle();
    expect(await desktop.textOnCard(0, where, 0), 'the text is deleted').toBe('');

    say('desktop: opens WRITE again at once and leaves the box open');
    await desktop.openWriteBox(0, where, 0);

    say('the iPad renames the shot; the desktop fetches while the box is open');
    const mark = await desktop.mark();
    await ipad.nudge();
    await ipad.renameFrame(0, 'renamed from the ipad');
    await ipad.push();
    await ipad.settle();
    {
      const until = Date.now() + 60_000;
      while ((await desktop.read()).frames[0]?.label !== 'renamed from the ipad' && Date.now() < until) {
        await desktop.nudge();
        await desktop.page.waitForTimeout(1000);
      }
    }
    expect((await desktop.read()).frames[0]?.label, 'the fetch landed while the box was open').toBe('renamed from the ipad');
    await desktop.waitForLogAfter(mark, 'arrangement arrived', 10_000);

    say('desktop: types SECOND into the open box, OK');
    await desktop.finishWriteBox('SECOND');
    expect(await desktop.textOnCard(0, where, 0),
      'THE TEXT WENT ONTO THE OLD CARD (Roman, 17 Oct) — written while the box was open across a fetch').toBe('SECOND');

    say('and it reaches the iPad');
    await desktop.push();
    await desktop.settle();
    {
      const until = Date.now() + 60_000;
      while ((await ipad.textOnCard(0, where, 0)) !== 'SECOND' && Date.now() < until) {
        await ipad.nudge();
        await ipad.page.waitForTimeout(1000);
      }
    }
    expect(await ipad.textOnCard(0, where, 0), 'the iPad has SECOND').toBe('SECOND');

    say('a reload on the desktop: still there');
    await desktop.reload();
    await desktop.settle();
    expect(await desktop.textOnCard(0, where, 0), 'after a reload').toBe('SECOND');

    await desktop.close();
    await ipad.close();
  });
}
