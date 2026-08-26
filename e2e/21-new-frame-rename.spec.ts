// RENAMING SOMETHING THE SERVER HAS NEVER SEEN (#392).
//
// Roman: "when I renamed a version, and also when I renamed a last frame I just
// newly created… it took the name, showed it for a second and then renamed it
// back." And: "when I did the same renaming for the second time it stuck."
//
// That pattern is the whole clue. The second time works, so renaming is fine —
// what is not fine is renaming something in the moments before it has been to
// the server and come back.
//
// THE SUITE HAS NEVER PRESSED NEW. Every fault about a newly made frame has had
// to be found by hand, because nothing here could make one. That door exists as
// of #392, and this is the first test to use it.
//
// What is being asked: rename it at once, let a fetch land on top, and see
// whether the name is still there.
//
//     npm run t -- -g "never seen"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

// HELD BACK, AND NOT BECAUSE IT IS WRONG.
//
// This test kills the local wrangler two seconds in, in six runs out of six,
// with its empty error — and then takes the rest of the suite with it. Renaming
// with the same first letter did not help, so it is not the relabelling.
//
// What it HAS already shown: after #392 the rename is pushed (POST /sync in the
// log, where before there was nothing at all), the tablet pulls twice, and the
// tablet still shows the old name. So the sending side is fixed and something
// on the RECEIVING side does not take a strip name that arrives. That is the
// next thing to find, and it needs a server that stays up.
test.fixme('a renamed version keeps its name and reaches the other device', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Version names', 3);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // VIEWS, NOT ANGLE — deliberately keeping the same first letter.
  //
  // Renaming a strip takes its prefix from the first letter, and CHANGING that
  // letter relabels every version in the strip at once. Renaming ver → ANGLE
  // killed the local wrangler in five runs out of five, always two seconds in,
  // so nothing after it could be tested at all. Whether that is our payload or
  // wrangler's own crash is not known and is written down as its own item.
  //
  // What this test is about is whether a rename travels, so it renames without
  // dragging every version along with it.
  say('desktop: renaming the versions strip, and touching nothing else');
  await desktop.renameStrip('ver', 'VIEWS');

  say('tablet: waiting for the new name');
  const deadline = Date.now() + 60_000;
  for (;;) {
    await tablet.nudge();
    if (await tablet.stripName('ver') === 'VIEWS') break;
    if (Date.now() > deadline) {
      throw new Error('THE RENAMED VERSION NEVER LEFT THE DEVICE. The tablet '
        + `still calls it "${await tablet.stripName('ver')}". Renaming marked `
        + 'nothing as unsent and pushed nothing, so it waited for some other '
        + 'change to carry it.');
    }
    await tablet.page.waitForTimeout(1000);
  }

  // ...and it must not be undone by the fetch that follows.
  for (let i = 0; i < 10; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(500); }
  expect(await desktop.stripName('ver'), 'THE OLD NAME CAME BACK on the device '
    + 'that did the renaming.').toBe('VIEWS');

  await desktop.close();
  await tablet.close();
});

test('a frame renamed the moment it is made keeps its name', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Brand new', 3);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  say('desktop: pressing NEW on the last frame');
  // Held by ID, not by position. A new frame after "3" is called "3#1", and a
  // sync can move frames about — reading by position then asks about a
  // different frame entirely, which is how the first version of this test
  // reported "3" and sent me looking in the wrong place.
  const newId = await desktop.newFrameAfter(2);

  // AT ONCE — no settle, no pause. The frame has not been to the server yet,
  // which is the only thing that makes this different from any other rename.
  say('desktop: renaming it immediately, before it has ever been sent');
  await desktop.renameFrameById(newId, 'MY NEW ONE');
  expect(await desktop.frameLabelById(newId), 'the name should be on the card '
    + 'straight away').toBe('MY NEW ONE');

  // The other device works, so a fetch with something in it lands on the
  // desktop — an empty one changes nothing and would prove nothing (#349).
  say('tablet: writing, so a real fetch reaches the desktop');
  await tablet.writeUnder(0, 'the tablet was busy');
  await tablet.settle();

  say('desktop: letting everything settle on top of it');
  await desktop.settle();
  for (let i = 0; i < 20; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(500); }

  // ASKED OF THE WHOLE PROJECT, not of one frame. Neither position nor local id
  // survives a pull — the frames are rebuilt and the local numbers handed out
  // again — so both of those asked about a different frame and reported "3" and
  // then "2", sending me looking in the wrong place twice. What a person
  // actually sees is whether the name is still there at all.
  expect((await desktop.read()).frames.map((f) => f.label),
    'THE NAME CAME BACK TO WHAT IT WAS. The frame was renamed before it had '
    + 'ever reached the server, so the rename had nothing to argue with when '
    + 'the server\'s copy arrived.').toContain('MY NEW ONE');

  // ...and it has to be on the other device too, or it never really happened.
  say('tablet: waiting for the new frame to arrive with its name');
  const deadline = Date.now() + 60_000;
  for (;;) {
    await tablet.nudge();
    const labels = (await tablet.read()).frames.map((f) => f.label);
    if (labels.includes('MY NEW ONE')) break;
    if (Date.now() > deadline) {
      throw new Error(`THE NEW FRAME'S NAME NEVER ARRIVED. The tablet has `
        + `${JSON.stringify(labels)}.`);
    }
    await tablet.page.waitForTimeout(1000);
  }

  await desktop.close();
  await tablet.close();
});
