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
  // The project list (or the account box) may still lie over the page: closed
  // first, or a press on CAM never reaches the card (run 849, red here — the
  // same slip as in run 814).
  for (const sel of ['#projectListClose', '#accountCancel']) {
    const b = d.page.locator(sel);
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  await d.page.evaluate(() => { localStorage.setItem('fh_camMode', 'phone'); localStorage.removeItem('fh_camForTests'); });
  expect(await camNow(d), 'A DESKTOP STILL OPENS PHONE CAM').toBe('fh');
  expect(await switchShown(d), 'THE SWITCH IS STILL SHOWN ON A DESKTOP').toEqual([false, false]);

  // NO CAMERA TO GIVE (24 Nov, Roman): no Finder window from nowhere — a box
  // that says why, and TRY AGAIN asks the browser once more. The browser's
  // answer is put in its mouth here: first "not allowed", then "none found".
  const refuseWith = (name: string) => d.page.evaluate((n) => {
    const w = window as never as { __asked: number };
    w.__asked = 0;
    // On the kind itself, not on the one object: the simulator's Safari takes
    // no notice of a function put on navigator.mediaDevices alone (run 850 —
    // the box came, from the simulator's own "not allowed", and the count stayed 0).
    const say = function () { w.__asked++; return Promise.reject(new DOMException('no', n)); };
    Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: say, configurable: true, writable: true });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: say, configurable: true, writable: true });
  }, name);
  const asked = () => d.page.evaluate(() => (window as never as { __asked: number }).__asked);
  const pressCam = () => d.page.locator('#mainScroll .frame-card [data-mact="camera"]').first().click();
  const note = d.page.locator('#importantNote');
  let fileWindow = false;
  d.page.on('filechooser', () => { fileWindow = true; });

  say('the browser says NOT ALLOWED: the permission box, with where to allow it in this browser');
  await refuseWith('NotAllowedError');
  await pressCam();
  await expect(note, 'THE BOX NEVER CAME').toBeVisible({ timeout: 10_000 });
  await expect(note).toContainText('FRAMEHOW DOES NOT HAVE PERMISSION TO REACH YOUR CAMERA');
  await expect(note).toContainText('allow the camera and then click the "TRY AGAIN" button.');
  await expect(note).toContainText('To allow it, open the menu Safari → Settings for');   // the simulator is a Safari
  expect(await asked()).toBe(1);
  say('TRY AGAIN asks the browser once more; still no: the box again');
  await note.locator('#importantNoteAction').click();
  await expect.poll(asked, { timeout: 10_000 }).toBe(2);
  await expect(note).toBeVisible();
  await note.getByRole('button', { name: 'Cancel' }).click();
  await expect(note).toHaveCount(0);

  say('the browser says NONE FOUND: the other box');
  await refuseWith('NotFoundError');
  await pressCam();
  await expect(note).toBeVisible({ timeout: 10_000 });
  await expect(note).toContainText('FRAMEHOW FOUND NO CAMERA');
  await expect(note).toContainText('This computer has no camera, or another program is using it.');
  await note.getByRole('button', { name: 'Cancel' }).click();
  expect(fileWindow, 'A FILE WINDOW OPENED — he pressed CAM, he wants the camera').toBe(false);
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
