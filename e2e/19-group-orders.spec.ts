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

  // THE MENU IS IN TWO PARTS, AND THE GROUP'S IS BELOW THE LINE (#383).
  //
  // The project comes first with its own story flow, then the black separator,
  // then each group with its own story flow and its own orders. Roman: "above
  // separator ALL, below separator story flow and shooting order of all groups,
  // unified by groups."
  //
  // The project has no order of its own here, so its placeholder line stands in
  // — without it there would be no way to ever make one for ALL.
  expect(await desktop.sortMenuLines(), 'THE MENU IS NOT IN THE RIGHT SHAPE.')
    .toEqual([
      'STORY FLOW',
      'SHOOTING ORDER',
      '+ ADD ORDER',
      '---',
      'STORY FLOW / KITCHEN',
      'KITCHEN DAY 1 / KITCHEN',
      '+ ADD ORDER',
    ]);

  // AND PICKING IT PUTS YOU IN THE GROUP.
  await desktop.pickOrder(0);
  expect(await desktop.whichGroup(), 'PICKING THE ORDER DID NOT GO INTO THE '
    + 'GROUP. Roman: "the moment the user selects it, it changes into that '
    + 'group view." Without it the order is a short list of frames sitting in '
    + 'ALL with no explanation.').toBe(kitchen);

  // AND THE VIEW BAR HAS TO SAY IT (#383).
  //
  // Roman, on #382 as shipped: "when you select the shooting order it takes you
  // to that order, this should be also visible in the red group name in the
  // view mode bar and is not." The store and the screen are asked separately,
  // because the two lines below fail differently: the first means the switch
  // never happened, the second means it happened and the bar was not redrawn.
  expect(await desktop.groupLabelOnScreen(), 'THE VIEW BAR DOES NOT SAY WHICH '
    + 'GROUP. The app went into the group — the line above proves it — and the '
    + 'name next to the GROUP button is missing, so on screen there is nothing '
    + 'to explain why only some frames are showing.').toBe('KITCHEN');

  // ...and leaving the SORT BY view leaves you there, looking at the group.
  await desktop.closeOrder();
  expect(await desktop.whichGroup(), 'leaving the order should leave you in the '
    + 'group you were just ordering').toBe(kitchen);

  // AND THE NAME IS STILL THERE WHEN YOU ARE BACK IN 3x2, which is when a
  // person is actually looking at the bar. Closing an order asks the server for
  // whatever arrived while it was open, so this is also the moment a redraw
  // could quietly put the bar back the way it was before the group was entered.
  expect(await desktop.groupLabelOnScreen(), 'THE NAME IS GONE FROM THE BAR '
    + 'AFTER LEAVING THE ORDER. Only some frames are showing and nothing on '
    + 'screen says why.').toBe('KITCHEN');

  await desktop.close();
});

// ---------------------------------------------------------------------------
// THROUGH THE REAL MENU, WITH REAL CLICKS (#383)
// ---------------------------------------------------------------------------
//
// The test above calls the app's own openOrderView and passes. Roman, doing the
// same thing with his hand, sees no group name in the bar. So the difference is
// not in what openOrderView does — it is in what else happens when the menu is
// opened and a line in it is clicked.
//
// This one presses SORT BY and clicks the line, exactly as a person does.
test('clicking a group order in the real SORT BY menu shows the group name', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('By hand', 6);
  await desktop.settle();

  const kitchen = await desktop.makeGroup('KITCHEN', [0, 1, 2]);
  await desktop.enterGroup(kitchen);
  await desktop.newSortOrder('KITCHEN DAY 1');
  await desktop.settle();

  say('desktop: back out to ALL, the way the group menu does it');
  await desktop.enterGroup(null);
  await desktop.settle();

  // The project list panel is left showing after a project is made, and it
  // covers the whole screen — every other test drives the app through its own
  // functions and never meets it. A person has already closed it by this point.
  await desktop.page.evaluate(() =>
    document.getElementById('projectListModal')?.classList.add('hidden'));

  say('desktop: pressing SORT BY');
  await desktop.page.click('#sortByBtn');
  await desktop.page.waitForSelector('#sortDropdown .sort-dd-item[data-sort-id]');

  say('desktop: clicking the group order in the menu');
  await desktop.page.click('#sortDropdown .sort-dd-item:has-text("KITCHEN DAY 1")');
  await desktop.page.waitForTimeout(500);

  expect(await desktop.whichGroup(), 'CLICKING THE LINE DID NOT GO INTO THE '
    + 'GROUP. Driving openOrderView directly does; a real click does not, so '
    + 'something between the two is undoing it.').toBe(kitchen);

  expect(await desktop.groupLabelOnScreen(), 'THE VIEW BAR DOES NOT SAY WHICH '
    + 'GROUP after a real click on the menu line. This is what Roman sees.')
    .toBe('KITCHEN');

  await desktop.close();
});

// ---------------------------------------------------------------------------
// A GROUP'S STORY FLOW CAN BE CHOSEN, AND GOES THERE (#383)
// ---------------------------------------------------------------------------
//
// Roman: "when you select story flow it does not take you to that flow… we
// should have also each group's story flow in the menu as well, otherwise it's
// confusing."
//
// There was one STORY FLOW line meaning "the flow of wherever I am", so
// choosing it did nothing. Each group now has its own line.
test('a group story flow can be chosen from ALL, and takes you into the group', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('Flows', 6);
  await desktop.settle();

  const kitchen = await desktop.makeGroup('KITCHEN', [0, 1, 2]);
  const street = await desktop.makeGroup('STREET', [3, 4]);
  expect(await desktop.whichGroup(), 'making a group should not move you').toBe(null);

  expect(await desktop.sortMenuLines(), 'every group needs a story flow line of '
    + 'its own, below one single separator, and its own + ADD ORDER').toEqual([
      'STORY FLOW',
      'SHOOTING ORDER',
      '+ ADD ORDER',
      '---',
      'STORY FLOW / KITCHEN',
      '+ ADD ORDER',
      'STORY FLOW / STREET',
      '+ ADD ORDER',
    ]);

  say('desktop: choosing the KITCHEN story flow from ALL');
  await desktop.pickStoryFlow(kitchen);
  expect(await desktop.whichGroup(), 'CHOOSING A GROUP STORY FLOW DID NOTHING. '
    + 'It has to take you into that group, the same as its shooting order does.')
    .toBe(kitchen);
  expect(await desktop.groupLabelOnScreen(), 'and the bar must say which group')
    .toBe('KITCHEN');

  say('desktop: and the project story flow brings you back out');
  await desktop.pickStoryFlow(null);
  expect(await desktop.whichGroup(), 'the project story flow belongs to ALL, so '
    + 'choosing it comes back out of the group').toBe(null);
  expect(await desktop.groupLabelOnScreen(), 'and ALL shows no name').toBe(null);

  // The other group is still reachable in one step, without going through ALL.
  await desktop.pickStoryFlow(street);
  expect(await desktop.whichGroup(), 'you should be able to go straight from one '
    + 'group to another').toBe(street);

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
  expect(await desktop.sortMenuLines(), 'an order made in ALL belongs above the '
    + 'line, with no group mark at all')
    .toEqual(['STORY FLOW', 'EVERYTHING', '+ ADD ORDER']);

  const kitchen = await desktop.makeGroup('KITCHEN', [0, 1, 2]);
  await desktop.enterGroup(kitchen);

  await desktop.pickOrder(0);
  expect(await desktop.whichGroup(), 'picking an order that holds every frame '
    + 'while a group is open should come back out to ALL, or most of the order '
    + 'is hidden from view').toBe(null);

  // AND ALL CARRIES NO NAME. Roman: "all does not need the name there in the
  // view mode bar." The label belongs to a group; in ALL there is nothing to
  // say, so there must be nothing there — not the word ALL, not an empty space.
  expect(await desktop.groupLabelOnScreen(), 'ALL SHOULD SHOW NO NAME AT ALL in '
    + 'the view bar, and something is there.').toBe(null);

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
