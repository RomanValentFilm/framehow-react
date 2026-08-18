// RELOAD, TOUCH NOTHING (#309).
//
// The cheapest test in the suite and the one that would have saved the most time.
// Two devices open the same project and are reloaded. Nothing is changed. All
// that must happen is: ask the server, take nothing because there is nothing
// new, sit still.
//
// Every fault of the last two days shows up here:
//   #306  a crash inside the pull, on every reload, silent
//   #305  a device holding a pull back for ever with no push in between
//   #300  a device reading its own empty memory as a brand new project
//   #302  a device asking itself which of two pictures to keep

import { test, expect } from '@playwright/test';
import { Device, freshAccount } from './harness';

test('two devices reload and quietly agree', async ({ browser }) => {
  const { token } = await freshAccount();

  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  // The desktop makes the project. The second device is not told anything by
  // magic: it opens the project from the server, exactly as tapping the name in
  // the project list does.
  const projectId = await desktop.newProject('Reload test', 6);
  expect(projectId, 'the project should have been created on the server').toBeTruthy();
  await tablet.openProject(projectId!);

  const agreed = await Device.waitUntilTheyAgree(desktop, tablet);
  expect(agreed).toContain('1:');

  // --- and now the whole point: reload both, change nothing ----------------
  // Let the local save land first: a reload inside two seconds finds nothing on
  // the device, which is true but is a different test.
  await desktop.settle();
  await tablet.settle();
  await desktop.reload();
  await tablet.reload();
  await desktop.nudge();
  await tablet.nudge();

  // Neither may crash inside a pull...
  await desktop.expectNeverInLog('PULL FAILED');
  await tablet.expectNeverInLog('PULL FAILED');
  // ...nor sit there with a pull held back and nothing being sent (#305)...
  await desktop.expectNeverInLog('pull held back');
  await tablet.expectNeverInLog('pull held back');
  // ...nor decide the project is new and replace it wholesale (#300).
  await desktop.expectNeverInLog('FULL REPLACE');
  await tablet.expectNeverInLog('FULL REPLACE');

  // Both still show the same six frames.
  const after = await Device.waitUntilTheyAgree(desktop, tablet);
  expect(after).toBe(agreed);

  // And each one knows what the server holds, so the next push is small.
  for (const d of [desktop, tablet]) {
    await d.waitForLog('recorded 6 frames as matching the server');
    const state = await d.read();
    expect(state.frames, `${d.name} should still have six frames`).toHaveLength(6);
    expect(state.unsent, `${d.name} should have nothing unsent`).toEqual([]);
  }

  await desktop.close();
  await tablet.close();
});
