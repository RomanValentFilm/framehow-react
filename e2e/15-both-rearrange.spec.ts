// BOTH DEVICES REARRANGE WHILE APART (#364).
//
// The random day has now failed on three different seeds — 985927, 511151,
// 831232 — always the same shape: after one device has been away while the other
// worked, the two end up showing the frames in DIFFERENT orders. Not one losing
// to the other, which is the agreed rule and would be fine. Different.
//
// The suite already proves that one device rearranging wins whole. This is the
// case underneath the random day's failure, written down small and on purpose so
// it can be read and replayed without twenty-four random steps in the way.
//
// The rule, in Roman's words: the later arrangement wins whole. Which of the two
// wins is not what this test cares about — only that both devices end up
// believing the same thing.
//
//     npm run t -- -g "rearrange"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test('two devices rearranging while apart end up agreeing', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Both rearrange', 6);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // Something to tell the frames apart by, so a disagreement is readable.
  for (let i = 0; i < 6; i++) await desktop.writeUnder(i, `frame ${i + 1}`);
  await desktop.settle();
  await Device.waitUntilTheyAgree(desktop, tablet);
  await tablet.settle();

  say('both devices go away');
  await desktop.offline(true);
  await tablet.offline(true);
  await desktop.page.waitForTimeout(4000);

  // Each rearranges, differently. This is two people on a shoot reordering the
  // board at the same time, which happens.
  say('desktop: moves the last frame to the front');
  await desktop.moveFrame(5, 0);
  await desktop.settle();

  say('tablet: moves the second frame to the end');
  await tablet.moveFrame(1, 5);
  await tablet.settle();

  // Back, one after the other.
  const d = await desktop.mark();
  await desktop.offline(false);
  await desktop.waitForLogAfter(d, 'back online', 20_000);
  await desktop.page.waitForTimeout(1500);

  const t = await tablet.mark();
  await tablet.offline(false);
  await tablet.waitForLogAfter(t, 'back online', 20_000);

  // Whichever arrangement wins, BOTH must end up with it.
  const deadline = Date.now() + 60_000;
  let lastSeen = '';
  for (;;) {
    await desktop.nudge(); await tablet.nudge();
    const dS = (await desktop.read()).frames.map((f) => f.text).join(' | ');
    const tS = (await tablet.read()).frames.map((f) => f.text).join(' | ');
    lastSeen = `\n  desktop: ${dS}\n  tablet:  ${tS}`;
    if (dS === tS) break;
    if (Date.now() > deadline) {
      throw new Error('THE TWO DEVICES KEPT DIFFERENT ARRANGEMENTS. One of the '
        + 'two orders should have won whole, and both should be showing it.'
        + lastSeen);
    }
    await desktop.page.waitForTimeout(1000);
  }
  say(`they agree: ${lastSeen}`);

  await desktop.close();
  await tablet.close();
});

// THE SMALLEST VERSION OF THE RANDOM DAY'S FAILURE (#364).
//
// Watching the day step by step, the two devices stop agreeing at STEP THREE —
// long before anybody goes offline or rearranges anything. Steps one and two are
// the desktop writing on two frames; step three is the tablet writing on a
// third. All three online, seconds apart. The tablet's writing never reaches the
// desktop.
//
// Three people writing on a board at once is not an edge case. It is Tuesday.
test('two devices writing seconds apart, both online, both arrive', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Writing at once', 6);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  say('desktop writes on two frames, then the tablet writes on a third');
  await desktop.writeUnder(5, 'desktop first');
  await desktop.settle();
  await desktop.writeUnder(0, 'desktop second');
  await desktop.settle();
  await tablet.writeUnder(2, 'tablet third');
  await tablet.settle();

  const deadline = Date.now() + 60_000;
  let lastSeen = '';
  for (;;) {
    await desktop.nudge(); await tablet.nudge();
    const d = (await desktop.read()).frames.map((f) => f.text).join(' | ');
    const t = (await tablet.read()).frames.map((f) => f.text).join(' | ');
    lastSeen = `\n  desktop: ${d}\n  tablet:  ${t}`;
    if (d === t && d.includes('tablet third')) break;
    if (Date.now() > deadline) {
      throw new Error('WRITING MADE SECONDS APART DID NOT REACH BOTH DEVICES. '
        + 'Nobody was offline and nobody touched the same frame.' + lastSeen);
    }
    await desktop.page.waitForTimeout(1000);
  }
  say(`they agree: ${lastSeen}`);

  await desktop.close();
  await tablet.close();
});

// CLOSER TO THE RANDOM DAY (#364).
//
// The story above passes, so rearranging alone is not the fault. Its logs show
// two things this did not do: both devices also WRITING while apart, and both
// coming back at the same instant rather than one after the other.
//
// And the line that stands out in them is the tablet sending its own work with
// no change time at all — "777a3e@none". A change with no time loses every
// comparison there is, so the writing simply vanished under the other device's
// copy.
test('both write and rearrange while apart, and come back together', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Both busy', 6);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  for (let i = 0; i < 6; i++) await desktop.writeUnder(i, `frame ${i + 1}`);
  await desktop.settle();
  await Device.waitUntilTheyAgree(desktop, tablet);
  await tablet.settle();

  say('both devices go away');
  await desktop.offline(true);
  await tablet.offline(true);
  await desktop.page.waitForTimeout(4000);

  // Each works on ITS OWN frames — no contest over any single frame, so nothing
  // here should be lost by anyone.
  say('desktop: writes on two frames and moves one');
  await desktop.writeUnder(0, 'DESKTOP WROTE HERE');
  await desktop.writeUnder(1, 'AND HERE');
  await desktop.moveFrame(5, 0);
  await desktop.settle();

  say('tablet: writes on two others and moves one');
  await tablet.writeUnder(3, 'TABLET WROTE HERE');
  await tablet.writeUnder(4, 'AND HERE TOO');
  await tablet.moveFrame(1, 5);
  await tablet.settle();

  // Back at the same moment, which is what the random day does.
  say('both come back at once');
  const d2 = await desktop.mark();
  const t2 = await tablet.mark();
  await Promise.all([desktop.offline(false), tablet.offline(false)]);
  await Promise.all([
    desktop.waitForLogAfter(d2, 'back online', 20_000),
    tablet.waitForLogAfter(t2, 'back online', 20_000),
  ]);

  const deadline = Date.now() + 60_000;
  let lastSeen = '';
  for (;;) {
    await desktop.nudge(); await tablet.nudge();
    const dS = (await desktop.read()).frames.map((f) => f.text).join(' | ');
    const tS = (await tablet.read()).frames.map((f) => f.text).join(' | ');
    lastSeen = `\n  desktop: ${dS}\n  tablet:  ${tS}`;
    if (dS === tS) break;
    if (Date.now() > deadline) {
      throw new Error('THE TWO DEVICES NEVER AGREED.' + lastSeen);
    }
    await desktop.page.waitForTimeout(1000);
  }
  say(`they agree: ${lastSeen}`);

  // AND NOBODY'S WRITING WENT MISSING. Four separate pieces of work on four
  // separate frames — none of them in competition with anything.
  const text = (await desktop.read()).frames.map((f) => f.text);
  for (const written of ['DESKTOP WROTE HERE', 'AND HERE', 'TABLET WROTE HERE', 'AND HERE TOO']) {
    expect(text, `"${written}" was made while apart, on a frame nobody else `
      + `touched, and it is gone.${lastSeen}`).toContain(written);
  }

  await desktop.close();
  await tablet.close();
});
