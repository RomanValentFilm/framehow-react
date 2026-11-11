// iOS CLOSES THE DEVICE'S DATABASE BEHIND THE APP — THE NEXT SAVE STILL LANDS
// (Roman, 11 November: after a photo from the native camera the log said "The
// database connection is closing" and the app showed COULD NOT SAVE ON THIS
// DEVICE. The app kept using the closed database for good.)
//
// THE RULES IT HOLDS TO
//   · the database is closed under the app; the next change is still saved on
//     the device, with no COULD NOT SAVE notice
//   · the preview store (the LIBRARY's) works again too
//   · it works a second time as well
//
//     npm run t -- e2e/66-device-store-closed.spec.ts

import { test, expect, type Page } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

type Door = { closeDeviceStores(): Promise<void>; deviceSaveLabels(): Promise<string[]>; previewStoreWorks(): Promise<boolean> };
const door = <T>(page: Page, fn: (d: Door) => Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__fh_test)`) as Promise<T>;

test('the device database is closed behind the app: the next save still lands', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  await desktop.newProject('CLOSED STORE', 3);
  await desktop.settle();

  for (const name of ['AFTER ONE', 'AFTER TWO']) {
    say(`the database is closed behind the app, then shot 1 is named ${name}`);
    await door(desktop.page, (d) => d.closeDeviceStores());
    await desktop.renameFrame(0, name);
    await desktop.settle();
    expect(await desktop.page.locator('#importantNote').count(), 'NO "COULD NOT SAVE" NOTICE').toBe(0);
    expect((await door(desktop.page, (d) => d.deviceSaveLabels()))[0], 'THE SAVE ON THE DEVICE HAS THE NEW NAME').toBe(name);
    expect(await door(desktop.page, (d) => d.previewStoreWorks()), 'the preview store works again').toBe(true);
  }

  const log = (await desktop.log()).join('\n');
  expect(log, 'no preview trouble in the log').not.toContain('PICTS: the device would not');
  await desktop.close();
});
