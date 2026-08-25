// A SHOOTING ORDER MADE INSIDE A GROUP (#382).
//
// Roman: "when a shooting order is created in a group, it should be visible in
// the normal SORT BY menu, marked with red text at the end of the name… and the
// moment the user selects it, it changes into that group view."
//
// What was wrong: sortOrders is one flat list for the whole project, and an
// order made while a group was open held only that group's frames — because it
// is built from getVisibleFrames() — with nothing recorded to say which group.
// Picked from ALL it showed a short list of frames and no reason why.
//
//     npm run t -- -g "group"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test('an order made in a group says so, and takes you back into that group', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('Two groups', 6);
  await desktop.settle();

  // Frames 0,1,2 are the kitchen. The rest are not.
  const kitchen = await desktop.makeGroup('KITCHEN', [0, 1, 2]);
  await desktop.enterGroup(kitchen);

  say('desktop: making a shooting order while inside the group');
  await desktop.newSortOrder('KITCHEN DAY 1');
  await desktop.settle();

  // It holds the group's frames only — which is exactly why it has to be
  // marked, and why picking it has to take you into the group.
  const held = (await desktop.read()).orders[0].frames.length;
  expect(held, 'the order should hold the three frames of the group, not all six')
    .toBe(3);

  // Back out to ALL, as if the order were being picked another day.
  await desktop.enterGroup(null);
  expect(await desktop.whichGroup(), 'we should be in ALL now').toBe(null);

  // THE MENU SAYS WHICH GROUP.
  const lines = await desktop.sortMenuLines();
  expect(lines[0], `THE MENU DOES NOT SAY WHICH GROUP. It reads "${lines[0]}". `
    + `An order holding only some of the frames must say where it came from, `
    + `or it looks like an order that has lost frames.`)
    .toBe('KITCHEN DAY 1 / KITCHEN');

  // AND PICKING IT PUTS YOU IN THE GROUP.
  await desktop.pickOrder(0);
  expect(await desktop.whichGroup(), 'PICKING THE ORDER DID NOT GO INTO THE '
    + 'GROUP. Roman: "the moment the user selects it, it changes into that '
    + 'group view." Without it the order is a short list of frames sitting in '
    + 'ALL with no explanation.').toBe(kitchen);

  // ...and leaving the SORT BY view leaves you there, looking at the group.
  await desktop.closeOrder();
  expect(await desktop.whichGroup(), 'leaving the order should leave you in the '
    + 'group you were just ordering').toBe(kitchen);

  await desktop.close();
});

// ---------------------------------------------------------------------------
// AND THE OTHER WAY ROUND
// ---------------------------------------------------------------------------
//
// Not separately asked for, and here so that it is visible rather than hidden
// in the code: picking a whole-project order while a group is open goes back to
// ALL. Otherwise the order is full of frames the view is hiding.
test('picking a whole-project order comes back out to ALL', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('Out again', 6);
  await desktop.settle();

  // Made in ALL, so it belongs to the whole project.
  await desktop.newSortOrder('EVERYTHING');
  await desktop.settle();
  expect((await desktop.sortMenuLines())[0], 'an order made in ALL must carry no '
    + 'group mark at all').toBe('EVERYTHING');

  const kitchen = await desktop.makeGroup('KITCHEN', [0, 1, 2]);
  await desktop.enterGroup(kitchen);

  await desktop.pickOrder(0);
  expect(await desktop.whichGroup(), 'picking an order that holds every frame '
    + 'while a group is open should come back out to ALL, or most of the order '
    + 'is hidden from view').toBe(null);

  await desktop.close();
});

// ---------------------------------------------------------------------------
// IT HAS TO SURVIVE THE TRIP TO THE SERVER
// ---------------------------------------------------------------------------
//
// The push and the pull both build a sort order field by field, so a field that
// is not named in BOTH is quietly dropped — the order would arrive on the other
// device having forgotten its group, and the mark would vanish. This is the
// half that is easy to leave out and impossible to see by looking.
test('the group comes through to the other device', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('It travels', 6);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  const kitchen = await desktop.makeGroup('KITCHEN', [0, 1, 2]);
  await desktop.enterGroup(kitchen);
  await desktop.newSortOrder('KITCHEN DAY 1');
  await desktop.settle();

  say('tablet: waiting for the order to arrive with its group');
  const deadline = Date.now() + 60_000;
  for (;;) {
    await tablet.nudge();
    const lines = await tablet.sortMenuLines();
    if (lines.includes('KITCHEN DAY 1 / KITCHEN')) break;
    if (Date.now() > deadline) {
      throw new Error('THE GROUP DID NOT TRAVEL. The tablet has '
        + `${JSON.stringify(lines)}. The order arrived and its group did not — `
        + 'which means the field is missing from the sending or the receiving '
        + 'side, both of which name their fields one by one.');
    }
    await tablet.page.waitForTimeout(1000);
  }

  await desktop.close();
  await tablet.close();
});
