// A NEW FRAME HAS TO BE IN THE STORY FLOW AND IN THE SHOOTING ORDER (#400).
//
// Roman: a frame he had just made was not listed in either — "only when you
// actually draw on them, then they are visible".
//
// The two lists are built differently, so this asks both:
//   STORY FLOW      — every visible frame (getVisibleFrames)
//   SHOOTING ORDER  — the order's own list (getOrderedFrames)
//
// And it draws NOTHING. A frame with no picture and no strokes is still a frame.
//
//     npm run t -- -g "in the lists"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test('a new frame with nothing on it is in the lists', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('In the lists', 3);
  await desktop.settle();

  say('desktop: making a shooting order first');
  await desktop.newSortOrder('THE ORDER');
  await desktop.settle();

  say('desktop: pressing NEW on the last frame — and drawing nothing on it');
  const newId = await desktop.newFrameAfter(2);
  await desktop.renameFrameById(newId, '99');
  await desktop.settle();

  // AND LET THE WHOLE ROUND TRIP HAPPEN BEFORE ASKING.
  //
  // The first version of this test asked straight after making the frame and
  // passed — because locally the frame IS added to every order. What Roman sees
  // needs the push AND the fetch that follows it: the order goes up with the new
  // frame filtered out, because it has no server id yet, and then that same
  // copy comes back and replaces the good one. The device undoes its own work
  // using the copy it just sent.
  say('desktop: letting the push and the fetch go round');
  for (let i = 0; i < 12; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(500); }

  say('desktop: opening STORY FLOW');
  await desktop.pickStoryFlow(null);
  await desktop.page.waitForTimeout(500);
  expect(await desktop.sortViewFrames(), 'THE NEW FRAME IS NOT IN THE STORY '
    + 'FLOW. It is a frame like any other; having nothing drawn on it is not a '
    + 'reason to leave it out of the list of frames.').toContain('99');

  say('desktop: and the shooting order');
  await desktop.pickOrder(0);
  await desktop.page.waitForTimeout(500);
  expect(await desktop.sortViewFrames(), 'THE NEW FRAME IS NOT IN THE SHOOTING '
    + 'ORDER. Pressing NEW is supposed to add it to every existing order '
    + '(addFrameToSortOrders).').toContain('99');

  await desktop.close();
});
