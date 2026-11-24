// A DESKTOP HAS ONE CAMERA (24 November, Roman).
//
// PHONE CAM opens the device's own camera. A desktop has none: there it was
// only a file picker, which LOAD is already. Roman: "let's not show the FH
// button, and keep only the FH cam as basic (which cannot be switched
// elsewhere, because there is no button)".
//   · a desktop: FH CAM always, the switch is not shown — also for someone who
//     chose PHONE CAM there before (with no button he could never go back)
//   · an iPad in a browser: the switch is there, and its choice is kept
//
//     npm run t -- -g "desktop has one camera"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

type Door = { __fh_test: { camModeNow(): Promise<string> } };
const camNow = (d: Device) => d.page.evaluate(() => (window as never as Door).__fh_test.camModeNow());
const switchShown = (d: Device) => d.page.evaluate(() =>
  ['cameraModeBtn', 'cropModeBtn'].map((id) => getComputedStyle(document.getElementById(id)!).display !== 'none'));

test('desktop has one camera: FH CAM always and no switch, even after an old PHONE CAM choice; an iPad keeps the choice', async ({ browser }) => {
  const { token } = await freshAccount();

  say('a desktop where PHONE CAM was chosen in the past (the old way, by the switch)');
  const d = await Device.open(browser, 'desktop', token);
  await d.newProject('ONE CAMERA', 2);
  await d.settle();
  await d.page.evaluate(() => { localStorage.setItem('fh_camMode', 'phone'); localStorage.removeItem('fh_camForTests'); });
  expect(await camNow(d), 'A DESKTOP STILL OPENS PHONE CAM').toBe('fh');
  expect(await switchShown(d), 'THE SWITCH IS STILL SHOWN ON A DESKTOP').toEqual([false, false]);
  await d.close();

  say('an iPad in a browser: the switch is there, and PHONE CAM chosen stays chosen');
  const t = await Device.open(browser, 'tablet', token, true);
  // THE SIMULATOR'S TABLET SAYS IT HAS ONE FINGER AT MOST (run 847, red here):
  // by the app's rule — more than one touch point — it counts as a desktop. A
  // real iPad says five. So this one is told to say five too, before the app
  // starts, and started again.
  await t.page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 }));
  await t.reload();
  await t.settle();
  await t.page.evaluate(() => { localStorage.setItem('fh_camMode', 'phone'); localStorage.removeItem('fh_camForTests'); });
  expect(await camNow(t)).toBe('phone');
  expect(await switchShown(t), 'THE SWITCH IS GONE ON AN iPAD').toEqual([true, true]);
  await t.page.evaluate(() => localStorage.setItem('fh_camMode', 'fh'));
  expect(await camNow(t)).toBe('fh');
  await t.close();
});
