// A FRAME'S PLACE MUST NOT MOVE ON ITS OWN (#401).
//
// Roman made a frame after frame 6 and found it at position 18. Every test we
// had was green through all of it, because they all asked where a frame ENDED
// UP — and the order settles within a second or two, so that question can never
// fail. It has to be asked differently: did the position move AT ALL.
//
// So these watch. They take the order once, then keep taking it while the sync
// goes round, and complain the first time it differs.
//
//     npm run t -- -g "place"
//
// HELD BACK — and worth reading before anyone tries this again.
//
// These were written for #403: give every frame its own number and retire the
// whole-project arrangement. Two of them went red immediately and said why:
// rearranging was undone, because per-frame numbers merge frame by frame and the
// arrangement no longer decided. That collides head-on with #294 — one
// arrangement, the later one wins whole — which exists BECAUSE per-frame merging
// produced an order neither person had made.
//
// Roman chose #294. So the numbers are out, and the new-frame case is to be
// fixed INSIDE that rule: a frame the arrangement cannot mention stays next to
// the frame it currently follows.
//
// NOTE: these were written for a fault that turned out not to be one: the frames were
// in the lists all along, drawn as short cards because nothing is on them yet,
// and Roman took a short card for a missing one. The trace said so plainly —
// "showing 29 of 29 · none missing".
//
// Kept because the question they ask is the right one, and no other test asks
// it: not WHERE a frame ends up, but whether it moved at all. If the order ever
// misbehaves again, take the fixme off and start here.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

/** The frames in order, as labels — what a person sees down the page. */
async function orderNow(d: Device): Promise<string> {
  return (await d.read()).frames.map((f) => f.label).join(' ');
}

test.fixme('a new frame keeps its place while everything settles', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Stay put', 8);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  say('desktop: pressing NEW after the sixth frame');
  await desktop.newFrameAfter(5);

  const wanted = await orderNow(desktop);
  say(`desktop: the order is now  ${wanted}`);

  // WATCHING, not waiting. Fifteen seconds of pushes, fetches and heartbeats,
  // asking every half second whether the order is still what it was.
  for (let i = 0; i < 30; i++) {
    await desktop.nudge();
    await desktop.page.waitForTimeout(500);
    const now = await orderNow(desktop);
    expect(now, `THE ORDER MOVED ON ITS OWN, ${((i + 1) / 2).toFixed(1)}s after the `
      + `frame was made.\n  was:  ${wanted}\n  now:  ${now}\n`
      + 'A frame does not change place because a sync happened.').toBe(wanted);
  }

  say('tablet: and it must arrive in the same place');
  const deadline = Date.now() + 60_000;
  for (;;) {
    await tablet.nudge();
    if (await orderNow(tablet) === wanted) break;
    if (Date.now() > deadline) {
      throw new Error(`THE OTHER DEVICE PUT IT SOMEWHERE ELSE.\n`
        + `  desktop: ${wanted}\n  tablet:  ${await orderNow(tablet)}`);
    }
    await tablet.page.waitForTimeout(1000);
  }

  await desktop.close();
  await tablet.close();
});

test.fixme('three frames made one after another all keep their places', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Three in a row', 8);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // One after another, with no time to settle in between — which is what Roman
  // does, and what made it visible in the first place.
  say('desktop: three NEWs in a row, in the middle of the project');
  await desktop.newFrameAfter(2);
  await desktop.newFrameAfter(4);
  await desktop.newFrameAfter(6);

  const wanted = await orderNow(desktop);
  say(`desktop: the order is now  ${wanted}`);

  for (let i = 0; i < 30; i++) {
    await desktop.nudge();
    await desktop.page.waitForTimeout(500);
    const now = await orderNow(desktop);
    expect(now, `THE ORDER MOVED ON ITS OWN.\n  was:  ${wanted}\n  now:  ${now}`)
      .toBe(wanted);
  }

  await desktop.close();
  await tablet.close();
});


// ---------------------------------------------------------------------------
// A PROJECT WHOSE NUMBERS HAVE DRIFTED (#403)
// ---------------------------------------------------------------------------
//
// This is the one that matches Roman's project and that a fresh one never
// reproduces. Only CHANGED frames are pushed, so a frame untouched for a while
// keeps whatever number it was last sent with. Move things about, push in
// between, and the stored numbers stop matching the order on screen — then a new
// frame claiming "I am number 4" lands among frames still claiming 4, 5 and 6.
//
// He put a frame after number 3 and watched it settle after number 6.
test.fixme('a new frame holds its place in a project whose numbers have drifted', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Drifted', 10);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();

  // MAKE THE NUMBERS DRIFT. Each move sends only the frames that changed, so
  // after a few of these the stored numbers and the order disagree — which is
  // what weeks of ordinary work do to a real project.
  say('desktop: shuffling, with a sync after each move, so the numbers drift');
  for (const [from, to] of [[8, 1], [2, 7], [5, 0], [9, 3]] as [number, number][]) {
    await desktop.moveFrame(from, to);
    await desktop.settle();
    for (let i = 0; i < 4; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(250); }
  }

  say('desktop: NOW pressing NEW after the fourth frame');
  await desktop.newFrameAfter(3);
  const wanted = await orderNow(desktop);
  say(`desktop: the order is now  ${wanted}`);

  for (let i = 0; i < 24; i++) {
    await desktop.nudge();
    await desktop.page.waitForTimeout(500);
    const now = await orderNow(desktop);
    expect(now, `THE NEW FRAME MOVED, ${((i + 1) / 2).toFixed(1)}s after it was made.`
      + `\n  was:  ${wanted}\n  now:  ${now}\n`
      + 'Its number was its index at the moment of the push, and the frames '
      + 'around it are still claiming indexes from an older arrangement.').toBe(wanted);
  }

  say('tablet: and it has to agree');
  const deadline = Date.now() + 60_000;
  for (;;) {
    await tablet.nudge();
    if (await orderNow(tablet) === wanted) break;
    if (Date.now() > deadline) {
      throw new Error(`THE TWO DEVICES DISAGREE ABOUT THE ORDER.\n`
        + `  desktop: ${wanted}\n  tablet:  ${await orderNow(tablet)}`);
    }
    await tablet.page.waitForTimeout(1000);
  }

  await desktop.close();
  await tablet.close();
});
