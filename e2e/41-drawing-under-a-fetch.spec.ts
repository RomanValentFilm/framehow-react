// THE BIG VIEW LEFT OPEN, A FETCH LANDS, THEN MORE STROKES (13 October, Roman).
//
// Roman drew on SKETCH in the big view, got distracted, drew some more, closed
// it — the drawing showed for a second and was gone, for good. His log had the
// line: "closing: … maps still the same: NO — replaced under us". While the
// view was open and his hand still for more than five seconds, a fetch from
// the server rebuilt the versions underneath; the canvas was still writing
// into the copy it took when it was wired, and those strokes never reached
// the project.
//
//     npm run t -- -g "under a fetch"
//
// About a minute and a half.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

test('drawing under a fetch: strokes drawn after a sync rebuilt the versions are kept', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const ipad = await Device.open(browser, 'ipad', token, true);

  const pid = await desktop.newProject('UNDER A FETCH', 2);
  await desktop.settle();
  await ipad.openProject(pid!);
  await ipad.settle();
  await desktop.showStrip('floor');

  say('desktop: one stroke on SKETCH version 1, sent; the iPad has it');
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

  say('desktop: opens the big view on it, draws a second stroke, and LEAVES IT OPEN');
  await desktop.openBigView(0, 'floor', 0);
  expect(await desktop.strokeInOpenBigView(0, 'floor', 0), 'two strokes in the project').toBe(2);

  say('the iPad changes shot 2 — the desktop, hand still, fetches while the view is open');
  const mark = await desktop.mark();
  await ipad.writeUnder(1, 'from the ipad while the desktop draws');
  await ipad.push();
  await ipad.settle();
  await desktop.page.waitForTimeout(6_000);              // the hand goes cold
  const until = Date.now() + 60_000;
  for (;;) {
    await desktop.nudge();                                // a mouse move, not a stroke
    await desktop.page.waitForTimeout(1000);
    if ((await desktop.read()).frames[1]?.text === 'from the ipad while the desktop draws') break;
    if (Date.now() > until) break;
  }
  expect((await desktop.read()).frames[1]?.text, 'the fetch landed while the view was open').toBe('from the ipad while the desktop draws');
  await desktop.waitForLogAfter(mark, 'arrangement arrived', 10_000);

  say('desktop: a THIRD stroke, after the fetch, then closes the view');
  expect(await desktop.strokeInOpenBigView(0, 'floor', 0),
    'THE STROKE WENT INTO A DETACHED COPY (Roman, 13 Oct) — the project does not have it').toBe(3);
  await desktop.closeBigView();
  await desktop.page.waitForTimeout(500);
  expect(await desktop.strokes(0, 'floor', 0), 'after closing, the project still holds all three').toBe(3);

  say('and the iPad receives all three');
  await desktop.push();
  await desktop.settle();
  const deadline = Date.now() + 60_000;
  while ((await ipad.strokes(0, 'floor', 0)) !== 3 && Date.now() < deadline) {
    await ipad.nudge();
    await ipad.page.waitForTimeout(1000);
  }
  expect(await ipad.strokes(0, 'floor', 0), 'three strokes on the iPad').toBe(3);

  await desktop.close();
  await ipad.close();
});
