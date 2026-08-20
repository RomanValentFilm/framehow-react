// TWO THINGS ROMAN FOUND BY USING THE APP (#357, #358).
//
// Both were found by reading the code after he described what he saw, and both
// are written down here BEFORE either is changed. If they pass on today's code
// then I read it wrong and I say so.
//
//     npm run t -- -g "shooting order you are in|breed"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

// ---------------------------------------------------------------------------
// #357 — A PULL MUST NOT CLOSE THE SHOOTING ORDER YOU ARE IN
// ---------------------------------------------------------------------------
//
// Roman: "when i created a group and i'm in shooting order of a group then the
// view jumps to 3x2… when i created new and started to name a break… it jumped
// to 3x2… when i started to move a break it jumped to 3x2."
//
// Every pull that rebuilds closes the shooting-order edit view first. Being
// thrown out of the order leaves 3x2 underneath, which is what he sees. It only
// bites when the pull actually carries something, which is why it is "sometimes".
test('a pull does not close the shooting order you are in', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Order stays open', 4);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  const orderId = await desktop.newSortOrder('THE ORDER');
  await desktop.settle();
  await desktop.openOrder(0);
  expect(await desktop.orderBeingEdited(), 'the order did not open').toBe(orderId);

  // The tablet does some work. That is what makes the desktop's next pull carry
  // something — an empty one leaves the screen alone (#349), so without this the
  // dangerous path is never taken.
  say('tablet: writing on two frames, so a real pull reaches the desktop');
  await tablet.writeUnder(1, 'the tablet was busy');
  await tablet.writeUnder(2, 'and busy again');
  await tablet.settle();

  // Wait until the desktop has actually taken it — that is the rebuild.
  const deadline = Date.now() + 60_000;
  for (;;) {
    await desktop.nudge();
    const s = await desktop.read();
    if (s.frames[1]?.text === 'the tablet was busy') break;
    if (Date.now() > deadline) throw new Error('the desktop never took the tablet\'s writing');
    await desktop.page.waitForTimeout(1000);
  }

  expect(await desktop.orderBeingEdited(), 'THE PULL CLOSED THE SHOOTING ORDER. '
    + 'Roman was in the middle of naming a break; the sync shut the order and '
    + 'left him looking at 3x2.').toBe(orderId);

  await desktop.close();
  await tablet.close();
});

// ---------------------------------------------------------------------------
// #358 — LOOKING AT A STRIP MUST NOT MAKE A VERSION
// ---------------------------------------------------------------------------
//
// Roman: "all of the HOW/VERSION frames… have two times the tab v1… in all frame
// cards of that strip… and then you touch a version in the other strips and
// suddenly they have more r1, r1, r1."
//
// Showing a strip makes an empty placeholder version for every frame. The
// placeholder has no name from the server, so the next push sends it up as a
// brand new version. Two devices looking at the same strip therefore make two
// versions of nothing, on every frame, and neither of them ever made anything.
test('looking at a strip on two devices does not breed versions', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Nobody made anything', 3);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // Both devices LOOK at the same strip. Nobody makes anything in it.
  say('both devices look at the refs strip — and touch nothing in it');
  await desktop.lookAtStrip(0, 'refs');
  await tablet.lookAtStrip(0, 'refs');

  // LOOKING ALONE IS NOT ENOUGH TO SHOW THIS, and the first version of this test
  // passed because of it: looking is not a change, so nothing is sent, so the
  // placeholder never leaves the device. It travels when the frame is pushed for
  // some OTHER reason — which on a real shoot is constantly. So each device now
  // does one ordinary thing to that same frame.
  say('and each device does one ordinary thing to that frame');
  await desktop.writeUnder(0, 'desktop wrote here');
  await tablet.writeUnder(0, 'tablet wrote here');
  await desktop.settle();
  await tablet.settle();

  // Let them talk for a while.
  for (let i = 0; i < 20; i++) {
    await desktop.nudge(); await tablet.nudge();
    await desktop.page.waitForTimeout(500);
  }

  const d = await desktop.versionLabels(0, 'refs');
  const t = await tablet.versionLabels(0, 'refs');

  // AT MOST ONE, not exactly one. A strip nobody has touched holds nothing worth
  // keeping, so the blank placeholder may quite properly be gone after a rebuild
  // — the app makes a fresh one the moment the strip is drawn again. What must
  // never happen is TWO, because two means one of them was invented.
  expect(d.length, `THE DESKTOP GREW VERSIONS BY LOOKING. It has ${d.length} `
    + `(${d.join(', ')}) and nobody made a single one of them.`).toBeLessThanOrEqual(1);
  expect(t.length, `THE TABLET GREW VERSIONS BY LOOKING. It has ${t.length} `
    + `(${t.join(', ')}).`).toBeLessThanOrEqual(1);

  await desktop.close();
  await tablet.close();
});
