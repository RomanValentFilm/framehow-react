// A VERSION'S TAG BELONGS TO THE SETUP IT WAS GIVEN (#375).
//
// Roman: "I create a setup, say blue, and mark a main frame with it. Then I tag
// a version — it becomes blue too, which is right. But when I then mark the main
// frame with a NEW setup, orange, the version's tag should not become orange. It
// should simply lose the tag it had."
//
// The reason it can happen: a tag has no colour of its own. It draws whatever
// setup the main frame is currently in. So the moment the frame changes setup,
// every tag on it changes with it, without anybody touching them.
//
// Written before looking any further, because reading the code suggests the tag
// IS cleared on reassignment — and twice this week what the code suggested and
// what the app did were different things.
//
//     npm run t -- -g "tag"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test('a version tag does not follow the frame to a new setup', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('Setup tags', 3);
  await desktop.settle();

  const blue = await desktop.newSetup('BLUE');
  const orange = await desktop.newSetup('ORANGE');

  say('the frame is put in BLUE, and one of its versions is tagged');
  await desktop.putSetupOnFrame(0, blue);
  await desktop.tagVersion(0);
  expect(await desktop.versionTag(0), 'the version did not take the tag at all')
    .toBe('BLUE');

  say('now the frame is put in ORANGE');
  await desktop.putSetupOnFrame(0, orange);

  const tagLog = (await desktop.log()).filter((l) => l.includes('tag:'));
  expect(await desktop.versionTag(0), 'THE TAG FOLLOWED THE FRAME. It was given '
    + 'to BLUE and is now wearing ORANGE, without anybody tagging it again. It '
    + 'should have lost its tag instead.\n  what touched the tags:\n'
    + (tagLog.length ? tagLog.map((l) => '    ' + l).join('\n') : '    (nothing did)'))
    .toBe('none');

  await desktop.close();
});

// AND WHAT IT IS GIVEN INSTEAD (#375).
//
// The other half of the rule, in Roman's words: "when a main frame joins a
// setup, the orange TAGGED picture should also be added to that main frame."
//
// So the two halves are:
//   - what the frame had tagged before is un-tagged, and waits
//   - and the new setup's tagged pictures arrive as versions of their own
//
// The first was written expecting a fault and found none. This one is written
// expecting none, so that if it ever changes we hear about it — the propagation
// is the whole point of a setup and nothing else in the suite watches it.
test('a frame joining a setup is given that setup\'s tagged picture', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('Joining a setup', 3);
  await desktop.settle();

  const blue = await desktop.newSetup('BLUE');
  const orange = await desktop.newSetup('ORANGE');

  // ORANGE already means something: another frame is in it, with a tagged
  // version of its own.
  say('frame 2 is in ORANGE and has a tagged version');
  await desktop.putSetupOnFrame(1, orange);
  await desktop.tagVersion(1);
  expect(await desktop.versionTag(1), 'the other frame did not take its tag').toBe('ORANGE');

  // WITH SOMETHING DRAWN ON IT. An empty version is a placeholder, and the app
  // quite properly fills placeholders rather than preserving them — the first
  // version of this test tagged an empty one and then complained that it had
  // been replaced.
  say('frame 1 is in BLUE, with something drawn on a version, and tagged');
  await desktop.setView('grid3x2');
  expect(await desktop.draw(0), 'the stroke never landed').toBe(1);
  await desktop.putSetupOnFrame(0, blue);
  await desktop.tagVersion(0);
  expect(await desktop.versionTag(0)).toBe('BLUE');

  say('and now frame 1 is moved into ORANGE');
  await desktop.putSetupOnFrame(0, orange);

  const tagLog = (await desktop.log()).filter((l) => l.includes('tag:'));
  const labels = await desktop.versionLabels(0);
  const shown = await desktop.versionTag(0);
  say(`  frame 1 now has ${labels.length} version(s); the first one says: ${shown}`);

  expect(shown, 'THE FRAME JOINED THE SETUP AND WAS GIVEN NOTHING. Joining a '
    + 'setup should bring that setup\'s tagged picture onto the frame — that is '
    + 'what a setup is for.'
    + '\n  what touched the tags:\n'
    + (tagLog.length ? tagLog.map((l) => '    ' + l).join('\n') : '    (nothing did)'))
    .toBe('ORANGE');

  // ...and the drawing that was on it is still there, behind the new one. A
  // setup adds; it does not paint over what somebody drew.
  expect(labels.length, 'THE FRAME LOST WHAT WAS DRAWN ON IT when it joined the '
    + 'setup. Joining should add the setup\'s picture, not replace the work.')
    .toBeGreaterThan(1);

  await desktop.close();
});
