// DELETING A FRAME IS FINAL — DECIDED, NOT A FAULT (#378).
//
// The random day lost a sentence and was right to complain: on one device a
// frame was deleted while offline, and on the other somebody wrote on that same
// frame a moment later. The deletion won and the writing went with it.
//
// Everywhere else in the app the rule is "newer wins", so the first instinct was
// to make deleting obey it too. Two things argued against:
//
//   - the server does not hide a deleted frame, it destroys it — the row, its
//     versions, its drawings, its pictures. There is nothing to bring back
//     except what the other device happens to still hold.
//   - and this is one person's app. Deleting a frame is a deliberate act by the
//     same person who is writing on the other device. Roman: "someone deleting a
//     frame should be aware of doing it, so we could actually skip this problem."
//
// So: deleting a frame is final, whenever it happened. These two tests hold that
// rule in place, in both directions, so that it stays a decision rather than
// drifting into an accident.
//
//     npm run t -- -g "deleting"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test('writing on a frame after it was deleted elsewhere does not bring it back', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Delete or write', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // Something to recognise it by.
  await desktop.writeUnder(2, 'the third frame');
  await desktop.settle();
  await Device.waitUntilTheyAgree(desktop, tablet);
  await tablet.settle();

  say('desktop goes away and deletes the third frame');
  await desktop.offline(true);
  await desktop.page.waitForTimeout(4000);
  await desktop.deleteFrame(2);
  await desktop.settle();

  // LATER, and on the other device. This is the whole point: the writing comes
  // after the deletion, so the writing is what counts.
  await tablet.page.waitForTimeout(1500);
  say('tablet writes on that same frame, later');
  await tablet.writeUnder(2, 'STILL WANTED');
  await tablet.settle();

  const d = await desktop.mark();
  await desktop.offline(false);
  await desktop.waitForLogAfter(d, 'back online', 20_000);

  // Both settle, and the frame stays gone on both — the deletion is final, and
  // the writing made on it afterwards goes with it. Deliberately, not by
  // accident: see the note at the top.
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.page.waitForTimeout(3000);

  const dText = (await desktop.read()).frames.map((f) => f.text);
  const tText = (await tablet.read()).frames.map((f) => f.text);
  const shown = `\n  desktop: ${dText.map((t) => `"${t}"`).join(' | ')}`
    + `\n  tablet:  ${tText.map((t) => `"${t}"`).join(' | ')}`;

  expect(dText, 'THE DELETED FRAME CAME BACK on the desktop. Deleting is final, '
    + 'even when somebody wrote on it afterwards elsewhere.' + shown)
    .not.toContain('STILL WANTED');
  expect(tText, 'THE DELETED FRAME IS STILL ON THE TABLET. The deletion should '
    + 'have reached it and taken the frame with it.' + shown)
    .not.toContain('STILL WANTED');
  expect(dText, 'the two devices disagree about what is left' + shown).toEqual(tText);

  await desktop.close();
  await tablet.close();
});

test('deleting a frame after it was written on still deletes it', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Write then delete', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  say('tablet writes on the third frame');
  await tablet.writeUnder(2, 'DOOMED');
  await tablet.settle();
  await Device.waitUntilTheyAgree(desktop, tablet);

  say('and the desktop deletes it afterwards');
  await desktop.deleteFrame(2);
  await desktop.settle();

  const deadline = Date.now() + 60_000;
  for (;;) {
    await desktop.nudge(); await tablet.nudge();
    const d = (await desktop.read()).frames.map((f) => f.text);
    const t = (await tablet.read()).frames.map((f) => f.text);
    if (!d.includes('DOOMED') && !t.includes('DOOMED')) break;
    if (Date.now() > deadline) {
      throw new Error('THE FRAME CAME BACK. It was deleted after being written '
        + 'on, so the deletion is the later change and it should be gone.'
        + `\n  desktop: ${d.map((x) => `"${x}"`).join(' | ')}`
        + `\n  tablet:  ${t.map((x) => `"${x}"`).join(' | ')}`);
    }
    await desktop.page.waitForTimeout(1000);
  }

  await desktop.close();
  await tablet.close();
});
