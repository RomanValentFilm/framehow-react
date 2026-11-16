// ONE FETCH, ONE REDRAW (16 Nov, Roman's iPad).
//
// 12:21:36–38, WF 7, 28 shots: one fetch from the server drew the whole project
// three times — 922 + 679 + 675 ms. For 2.3 seconds nothing answered. "The app
// is unresponsive" had a number at last: once inside the rebuild, once after
// it, once more after the view was put back.
//
// The tablet writes a sentence; the desktop fetches it. On the desktop the
// whole project may be drawn ONCE for that fetch — and the sentence is there.
//
//     npm run t -- -g "one fetch, one redraw"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

test('one fetch, one redraw: what another device wrote arrives with a single drawing of the project', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const projectId = await desktop.newProject('One redraw', 6);
  await tablet.openProject(projectId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  const redraws = () => desktop.page.evaluate(() => (window as never as { __fh_redraws?: number }).__fh_redraws ?? 0);

  for (const round of [1, 2]) {
    // (the desktop quiet first: nothing of its own may be drawing)
    await desktop.page.waitForTimeout(1500);
    const logBefore = await desktop.log();
    const before = await redraws();
    say(`round ${round}: the tablet writes under shot 3; the desktop has drawn the project ${before} time(s) so far`);
    await tablet.writeUnder(2, `written on the tablet, round ${round}`);
    await tablet.settle();
    for (let i = 0; i < 40; i++) {
      await desktop.nudge();
      if ((await desktop.log()).filter((l) => l.includes('pull: remote is newer')).length
        > logBefore.filter((l) => l.includes('pull: remote is newer')).length) break;
      await desktop.page.waitForTimeout(500);
    }
    await desktop.waitForLogAfter(logBefore, 'pull: remote is newer');
    await desktop.waitForLogAfter(logBefore, 'as matching the server');
    await desktop.page.waitForTimeout(1500);       // anything that would still draw has drawn
    const drawn = (await redraws()) - before;
    say(`   the desktop drew the whole project ${drawn} time(s) for that fetch`);
    expect(drawn, `ONE FETCH DREW THE PROJECT ${drawn} TIMES (Roman's iPad, 16 Nov: three times, 2.3 s of standstill)`).toBe(1);
    // …and what was written is on the desktop: both show the same project.
    await Device.waitUntilTheyAgree(desktop, tablet);
  }

  await desktop.close();
  await tablet.close();
});
