// A DRAWING MUST NOT DISAPPEAR (#356).
//
// Roman: "the moment you draw it disappears." I answered that with four guesses
// over two days and shipped three of them, which is the wrong way round. Nothing
// in the simulator could hold a pencil, so every one of those was a maybe.
//
// This is the report, written down as a test. It draws with the app's own
// drawing code on the app's own canvas, lets the sync do whatever it does, and
// then asks the PROJECT — not the screen — whether the stroke is still there.
//
// It is written BEFORE the fix, on purpose. If it passes on today's code then my
// explanation was wrong and I have to say so and look again.
//
//     npm run t -- -g "drawing"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test('a drawing is still there after the sync that follows it', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Drawing', 3);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // ONE stroke on the first frame's first version.
  say('desktop: drawing a stroke');
  const afterFirst = await desktop.draw(0);
  expect(afterFirst, 'the stroke never reached the project at all — this is not '
    + 'a sync problem, the drawing code did not keep it').toBe(1);

  // Now let the app do what it does after a drawing: notice the change, push it,
  // and (since #320) pull straight afterwards. This is the moment Roman is
  // describing — he draws, and a second later it is gone.
  await desktop.settle();
  for (let i = 0; i < 12; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(500); }

  expect(await desktop.strokes(0), 'THE DRAWING DISAPPEARED. The stroke was in '
    + 'the project, then a push and a pull went by and the project no longer has '
    + 'it.').toBe(1);

  // A SECOND stroke, drawn after a sync has already happened. This is the case
  // where the pen may be holding a copy of the version that the sync replaced:
  // the stroke goes somewhere real, but not into the version on screen.
  say('desktop: drawing a second stroke, after a sync has been through');
  const afterSecond = await desktop.draw(0);
  expect(afterSecond, 'the SECOND stroke did not land. The first one did, so the '
    + 'drawing code works — something between the two took the version away from '
    + 'under the pen.').toBe(2);

  await desktop.settle();
  for (let i = 0; i < 12; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(500); }
  expect(await desktop.strokes(0), 'the second drawing disappeared after its sync').toBe(2);

  // And the other device must end up with both. A drawing is work like any other.
  say('tablet: waiting for both strokes to arrive');
  const deadline = Date.now() + 60_000;
  for (;;) {
    await tablet.nudge();
    const n = await tablet.strokes(0);
    if (n === 2) break;
    if (Date.now() > deadline) {
      throw new Error(`the tablet has ${n} stroke(s) of 2 after a minute — `
        + `the drawing never travelled`);
    }
    await tablet.page.waitForTimeout(1000);
  }

  await desktop.close();
  await tablet.close();
});

// THE OTHER HALF OF THE QUESTION (#356).
//
// The two tests above ask the PROJECT whether the stroke is there, and it always
// was. Roman was telling me what he SEES. In a grid view, closing the big view
// put the card back to the main frame, so the drawing he had just made was no
// longer in front of him — which, to the person holding the iPad, is exactly the
// same as losing it.
//
// Every test written so far was blind to this. It is the same blindness that let
// the photo, the setups and the shooting order go missing off the screen for two
// days while thirteen tests said green.
test('after drawing in the big view, the card still shows what you drew on', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('Drawing stays in front of you', 3);
  await desktop.settle();

  // 3x2, because that is where Roman works and where the rule changed. A project
  // made from scratch starts in 'both', so the test presses the button the way a
  // person does rather than assuming.
  await desktop.setView('grid3x2');
  expect(await desktop.viewMode(), 'the 3x2 button did not take').toBe('grid3x2');

  say('drawing on frame 1, version 1, through the big view');
  expect(await desktop.draw(0), 'the stroke never reached the project').toBe(1);

  expect(await desktop.cardShowing(0), 'THE CARD STOPPED SHOWING WHAT YOU DREW ON. '
    + 'The drawing is safe in the version, but the card went back to the main '
    + 'frame the moment the big view closed — so on screen the drawing vanished.')
    .toBe('ver 1');

  await desktop.close();
});

test('a drawing survives the other device working at the same time', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Drawing while busy', 3);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // The tablet writes on a DIFFERENT frame. That change arriving is what forces
  // a real rebuild on the desktop — an empty pull leaves the screen alone (#349),
  // so without this the dangerous path is never taken.
  say('tablet: writing on frame 3');
  await tablet.writeUnder(2, 'the tablet was here');
  await tablet.settle();

  say('desktop: drawing on frame 1 while that arrives');
  const drawn = await desktop.draw(0);
  expect(drawn, 'the stroke never reached the project').toBe(1);

  // Wait until the desktop has actually taken the tablet's writing — that is the
  // rebuild happening.
  const deadline = Date.now() + 60_000;
  for (;;) {
    await desktop.nudge();
    const s = await desktop.read();
    if (s.frames[2]?.text === 'the tablet was here') break;
    if (Date.now() > deadline) throw new Error('the desktop never took the tablet\'s writing');
    await desktop.page.waitForTimeout(1000);
  }

  expect(await desktop.strokes(0), 'THE REBUILD ATE THE DRAWING. The desktop took '
    + 'the tablet\'s writing and lost its own stroke doing it.').toBe(1);

  await desktop.close();
  await tablet.close();
});
