// THE STORY FLOW IS ONE THING (#337).
//
// Roman's rule, in his words: "newer wins in all of the arrangement, frame
// order, positions of breaks... all the stuff", and "the break stays where the
// user puts it. Period. Not behind some frame rule."
//
// It used to be two things. The frame order was one item and each break was
// another, merged separately — so the other device rearranged, the frames moved
// and the breaks did not, and LUNCH ended up two frames from where anybody had
// put it. Now they travel together and the later one wins whole, exactly as a
// shooting order already does.

import { test, expect } from '@playwright/test';
import { Device, freshAccount } from './harness';

test('the story flow and its breaks arrive as one thing', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Story flow test', 5);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // A break both devices know about, put where the user wants it.
  await desktop.addStoryBreak(2, 'LUNCH BREAK');
  await desktop.push();
  await desktop.waitForLog('push OK');

  const deadline = Date.now() + 45_000;
  for (;;) {
    await tablet.nudge();
    if ((await tablet.read()).storyBreaks.some((b) => b.text === 'LUNCH BREAK')) break;
    if (Date.now() > deadline) throw new Error('the break never reached the tablet');
    await tablet.page.waitForTimeout(500);
  }
  await tablet.settle();

  // Now the tablet rearranges, offline, and comes back last — so the tablet's
  // whole arrangement wins, breaks and all.
  await tablet.offline(true);
  await tablet.page.waitForTimeout(4000);
  await tablet.moveFrame(4, 0);                 // last frame to the front
  await tablet.settle();

  const t = await tablet.mark();
  await tablet.offline(false);
  await tablet.waitForLogAfter(t, 'back online');

  // Both devices must show the same story flow — frames AND break together.
  const deadline2 = Date.now() + 60_000;
  for (;;) {
    await desktop.nudge(); await tablet.nudge();
    const d = await desktop.storyFlowAsText();
    const p = await tablet.storyFlowAsText();
    if (d === p && d.includes('LUNCH BREAK')) {
      // Both devices show the same thing, break included. Where the break sits
      // is by POSITION and stays where the user put it (#343) — the frames may
      // move underneath it, which is the agreed rule.
      break;
    }
    if (Date.now() > deadline2) {
      throw new Error(`the two devices never agreed on the story flow:\n`
        + `  desktop: ${d}\n  tablet:  ${p}`);
    }
    await desktop.page.waitForTimeout(500);
  }

  await desktop.close();
  await tablet.close();
});
