// ONE DEVICE, ON ITS OWN (#309).
//
// The faults that hurt most were not about two devices disagreeing. They were a
// single device arguing with itself:
//
//   #302  it opened a picker between its own copy and the server's, with the
//         other device switched off
//   #300  it forgot what the server held and offered to replace the project
//   #299  it pushed, called itself up to date, and stopped listening
//
// So this file has only one device in it, doing ordinary things.

import { test, expect } from '@playwright/test';
import { Device, freshAccount } from './harness';

test('one device, one change, after a reload: no questions asked', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('Alone test', 6);
  // The FIRST push is the one that creates the project, and it does not print
  // "push OK" — it prints what the server accepted. Wait for the local save
  // instead, which happens after all of it.
  await desktop.settle();

  // Reload — which is where the pull folds an answer onto what is here (#306)
  await desktop.reload();
  await desktop.nudge();

  // ...then change ONE frame, exactly as Roman did when a picker appeared.
  await desktop.writeUnder(2, 'changed after a reload');
  await desktop.push();
  await desktop.waitForLog('server accepted');

  await desktop.expectNeverInLog('PULL FAILED');
  await desktop.expectNeverInLog('decision(s) waiting');    // no picker, ever
  await desktop.expectNeverInLog('FULL REPLACE');
  await desktop.expectNeverInLog('were older than the server');   // nothing refused

  const state = await desktop.read();
  expect(state.frames[2].text).toBe('changed after a reload');
  expect(state.frames, 'nothing may vanish').toHaveLength(6);

  await desktop.close();
});

test('a push does not make a device stop listening', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Listening test', 3);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  // Let the app take its first look before anything is changed. Its stamping
  // happens on the local save, and the FIRST pass is deliberately read as "this
  // is how the project already was" (#289) — so a change made in the same
  // instant as the project is created carries no time, and "later wins" has
  // nothing to compare. A person is never that fast; a test is.
  await desktop.settle();
  await tablet.settle();

  // The desktop writes something and sends it. The tablet, meanwhile, is holding
  // work of its own — so its pull is held back until it has pushed. This is the
  // exact order that made an iPad believe it was current and go deaf (#299).
  await tablet.offline(true);
  await tablet.writeUnder(0, 'tablet work, made offline');

  await desktop.writeUnder(2, 'desktop work, sent while the tablet was away');
  await desktop.push();
  await desktop.waitForLog('push OK');

  await tablet.offline(false);
  await tablet.waitForLog('back online');

  // The tablet must end up with BOTH: its own work, and what was already there.
  const agreed = await Device.waitUntilTheyAgree(desktop, tablet);
  expect(agreed).toContain('tablet work, made offline');
  expect(agreed).toContain('desktop work, sent while the tablet was away');

  await desktop.close();
  await tablet.close();
});
