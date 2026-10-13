// A DRAWING MADE RIGHT AFTER A DELETE (13 October, Roman).
//
// Roman drew on SKETCH, deleted that version, drew a new one at once, closed
// the big view — the drawing showed for a second and was gone, for good.
// Deleting the only version puts a blank in its place; the new strokes go
// onto that blank; the next sync from the server decides what stays.
//
// This plays it with the second device alive, so the syncs land exactly as
// they do in life, and then asks both devices and the server for the strokes.
//
//     npm run t -- -g "after a delete"
//
// About a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

test('drawn after a delete: the new drawing survives the sync, on both devices', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const ipad = await Device.open(browser, 'ipad', token, true);

  const pid = await desktop.newProject('AFTER A DELETE', 2);
  await desktop.settle();
  await ipad.openProject(pid!);
  await ipad.settle();
  await desktop.showStrip('floor');

  say('desktop: a drawing on SKETCH version 1, and the iPad sees it');
  expect(await desktop.draw(0, 'floor', 0)).toBe(1);
  await desktop.push();
  await desktop.settle();
  {
    const until = Date.now() + 60_000;
    while ((await ipad.strokes(0, 'floor', 0)) !== 1 && Date.now() < until) {
      await ipad.nudge();
      await ipad.page.waitForTimeout(1000);
    }
  }
  expect(await ipad.strokes(0, 'floor', 0), 'the iPad has the first drawing').toBe(1);

  say('desktop: DELETE that version, then draw again AT ONCE and close the big view');
  await desktop.deleteVersion(0, 'floor', 0);
  expect(await desktop.versionLabels(0, 'floor'), 'a blank version stands in its place').toHaveLength(1);
  expect(await desktop.strokes(0, 'floor', 0), 'and it is blank').toBe(0);
  expect(await desktop.draw(0, 'floor', 0), 'the new drawing has its stroke').toBe(1);

  say('the syncs land: the desktop sends, the iPad answers, the desktop fetches');
  await desktop.push();
  await desktop.settle();
  await ipad.nudge();
  await ipad.push();
  await ipad.settle();
  await Device.nudgeOneAtATime(desktop, ipad);
  await desktop.settle();

  expect(await desktop.strokes(0, 'floor', 0),
    'THE NEW DRAWING IS GONE ON THE DESKTOP (Roman, 13 Oct) — the sync threw away the version drawn after the delete').toBe(1);
  expect(await ipad.strokes(0, 'floor', 0), 'and the iPad has the new drawing').toBe(1);
  expect(await desktop.versionLabels(0, 'floor'), 'one SKETCH version, not two').toHaveLength(1);

  say('a reload on the desktop: still there');
  await desktop.reload();
  await desktop.settle();
  expect(await desktop.strokes(0, 'floor', 0), 'after a reload the drawing is still there').toBe(1);

  await desktop.close();
  await ipad.close();
});

// ROMAN'S LOG, 13 OCT 16:43 — the same, but the big view stays OPEN and a
// fetch lands inside it: delete, draw at once, hand still, the fetch brings the
// deletion back and rebuilds the shot's versions, draw more, close. The push
// on closing then said "nothing changed — not sending": the strokes were gone.
test('drawn after a delete, view left open: a fetch lands inside the view and the strokes survive it', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const ipad = await Device.open(browser, 'ipad', token, true);

  const pid = await desktop.newProject('AFTER A DELETE, OPEN', 2);
  await desktop.settle();
  await ipad.openProject(pid!);
  await ipad.settle();
  await desktop.showStrip('floor');

  say('desktop: a drawing on SKETCH, sent; the iPad has it');
  expect(await desktop.draw(0, 'floor', 0)).toBe(1);
  await desktop.push();
  await desktop.settle();
  // The iPad asks the server only when touched (#366): nudge it until the
  // stroke is there (run 371: the untouched iPad had not asked yet).
  {
    const until = Date.now() + 60_000;
    while ((await ipad.strokes(0, 'floor', 0)) !== 1 && Date.now() < until) {
      await ipad.nudge();
      await ipad.page.waitForTimeout(1000);
    }
  }
  expect(await ipad.strokes(0, 'floor', 0), 'the iPad has the first drawing').toBe(1);

  say('desktop: DELETE it, open the big view on the blank that replaced it, draw — and leave the view open');
  await desktop.deleteVersion(0, 'floor', 0);
  await desktop.openBigView(0, 'floor', 0);
  expect(await desktop.strokeInOpenBigView(0, 'floor', 0), 'one stroke on the new version').toBe(1);

  say('the delete goes up; the iPad changes a shot; the desktop, hand still, fetches inside the open view');
  const mark = await desktop.mark();
  await desktop.push();
  await ipad.writeUnder(1, 'from the ipad, inside the open view');
  await ipad.push();
  await ipad.settle();
  await desktop.page.waitForTimeout(6_000);
  const until = Date.now() + 60_000;
  for (;;) {
    await desktop.nudge();
    await desktop.page.waitForTimeout(1000);
    if ((await desktop.read()).frames[1]?.text === 'from the ipad, inside the open view') break;
    if (Date.now() > until) break;
  }
  expect((await desktop.read()).frames[1]?.text, 'the fetch landed while the view was open').toBe('from the ipad, inside the open view');
  await desktop.waitForLogAfter(mark, 'arrangement arrived', 10_000);
  expect(await desktop.strokes(0, 'floor', 0),
    'THE FETCH THREW AWAY THE NEW VERSION — a version this device made, with a stroke on it, that the server did not know yet').toBe(1);

  say('desktop: one more stroke after the fetch, then closes the view');
  expect(await desktop.strokeInOpenBigView(0, 'floor', 0), 'two strokes').toBe(2);
  await desktop.closeBigView();
  await desktop.page.waitForTimeout(500);
  expect(await desktop.strokes(0, 'floor', 0), 'after closing, both strokes are in the project (Roman, 13 Oct 16:43)').toBe(2);
  expect(await desktop.versionLabels(0, 'floor'), 'one SKETCH version').toHaveLength(1);

  say('and the iPad receives the new drawing');
  await desktop.push();
  await desktop.settle();
  const deadline = Date.now() + 60_000;
  while ((await ipad.strokes(0, 'floor', 0)) !== 2 && Date.now() < deadline) {
    await ipad.nudge();
    await ipad.page.waitForTimeout(1000);
  }
  expect(await ipad.strokes(0, 'floor', 0), 'two strokes on the iPad').toBe(2);
  expect(await ipad.versionLabels(0, 'floor'), 'one SKETCH version on the iPad too').toHaveLength(1);

  await desktop.close();
  await ipad.close();
});

// ONE DEVICE, FETCHING ITS OWN DELETE BACK (Roman's log, 16:43, read again).
// "pull: remote is newer (Tablet)" — the Tablet is Roman himself. The fetch
// that landed inside his open view was his own delete coming back, and the
// server's answer for that shot had no SKETCH version at all: the blank he was
// drawing on was replaced by a fresh blank. No second device needed.
test('drawn after a delete, one device: the fetch of its own delete must not replace the version being drawn on', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('OWN DELETE BACK', 2);
  await desktop.settle();
  await desktop.showStrip('floor');

  say('a drawing on SKETCH, sent');
  expect(await desktop.draw(0, 'floor', 0)).toBe(1);
  await desktop.push();
  await desktop.settle();

  say('DELETE it, open the big view on the blank, one stroke; the delete goes up while the view is open');
  await desktop.deleteVersion(0, 'floor', 0);
  await desktop.openBigView(0, 'floor', 0);
  expect(await desktop.strokeInOpenBigView(0, 'floor', 0), 'one stroke on the new version').toBe(1);
  const mark = await desktop.mark();
  await desktop.push();
  await desktop.waitForLogAfter(mark, 'push OK', 20_000);

  say('hand still; a fetch lands inside the open view');
  await desktop.page.waitForTimeout(6_000);
  const mark2 = await desktop.mark();
  await desktop.startPullWithoutWaiting();
  await desktop.page.waitForTimeout(3_000);
  say('   log since the push:\n' + (await desktop.log()).slice(0, (await desktop.log()).length - mark2.length).map((l) => '      ' + l).join('\n'));
  expect(await desktop.strokes(0, 'floor', 0),
    'THE FETCH OF ITS OWN DELETE REPLACED THE VERSION BEING DRAWN ON (Roman, 13 Oct 16:43)').toBe(1);

  say('one more stroke, close the view');
  expect(await desktop.strokeInOpenBigView(0, 'floor', 0), 'two strokes').toBe(2);
  await desktop.closeBigView();
  await desktop.page.waitForTimeout(500);
  expect(await desktop.strokes(0, 'floor', 0), 'both strokes in the project after closing').toBe(2);
  await desktop.push();
  await desktop.settle();

  say('a reload: still there');
  await desktop.reload();
  await desktop.settle();
  expect(await desktop.strokes(0, 'floor', 0), 'after a reload, both strokes').toBe(2);
  expect(await desktop.versionLabels(0, 'floor'), 'one SKETCH version').toHaveLength(1);

  await desktop.close();
});
