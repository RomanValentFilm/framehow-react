// SEVERAL PICTURES INTO AN EMPTY VERSION STRIP (G1, 9 November).
//
// An old note (TOMORROW "SOON 4") said: loaded into an EMPTY version strip,
// the pictures landed in v2 onwards and v1 stayed empty. Nobody has looked
// since several changes to the load path. This asks the question plainly:
// three files on an untouched VERSN strip → exactly three versions, v1 v2 v3,
// every one with a picture, none empty — on the desktop and on the iPad.
//
//     npm run t -- -g "empty strip"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

const PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

type Whole = { shots: Array<{ versions: Record<string, Array<{ label: string; picture: boolean }>> }> };

test('empty strip: three pictures loaded at once fill v1, v2, v3 — none stays empty, on both devices', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('EMPTY STRIP', 2);
  await desktop.settle();
  expect(pid).toBeTruthy();
  const ipad = await Device.open(browser, 'ipad', token, true);
  await ipad.openProject(pid!);
  await ipad.settle();

  say('desktop: three pictures at once onto the untouched VERSN strip of shot 1');
  await desktop.uploadPictures(0, 'ver', [PICTURE, PICTURE, PICTURE]);
  await desktop.page.waitForTimeout(2000);
  await desktop.push();
  await desktop.settle();

  const mine = JSON.parse(await desktop.whole()) as Whole;
  const vers = mine.shots[0].versions.ver ?? [];
  say(`   desktop versions: ${vers.map((v) => `${v.label}${v.picture ? '●' : '○'}`).join(' ')}`);
  expect(vers.map((v) => v.label), 'exactly three versions').toEqual(['v1', 'v2', 'v3']);
  expect(vers.every((v) => v.picture), 'V1 STAYED EMPTY (G1) — every version must carry a picture').toBe(true);

  say('the iPad sees the same three, each with its picture');
  await ipad.nudge();
  await ipad.settle();
  await expect.poll(async () => {
    const w = JSON.parse(await ipad.whole()) as Whole;
    return (w.shots[0]?.versions.ver ?? []).map((v) => `${v.label}${v.picture ? '●' : '○'}`).join(' ');
  }, { timeout: 60_000, message: 'the iPad has v1● v2● v3●' }).toBe('v1● v2● v3●');

  say('shot 2: a picture on v1, DELETE that only version (a blank stands in), then three pictures at once');
  await desktop.uploadPicture(1, 'ver', PICTURE);
  await desktop.page.waitForTimeout(1500);
  await desktop.deleteVersion(1, 'ver', 0);
  expect(await desktop.versionLabels(1, 'ver'), 'one blank version stands in its place').toHaveLength(1);
  await desktop.uploadPictures(1, 'ver', [PICTURE, PICTURE, PICTURE]);
  await desktop.page.waitForTimeout(2000);
  await desktop.push();
  await desktop.settle();
  const after = (JSON.parse(await desktop.whole()) as Whole).shots[1].versions.ver ?? [];
  say(`   shot 2 versions: ${after.map((v) => `${v.label}${v.picture ? '●' : '○'}`).join(' ')}`);
  expect(after.map((v) => `${v.label}${v.picture ? '●' : '○'}`), 'after a delete the blank v1 takes the first picture, the rest follow').toEqual(['v1●', 'v2●', 'v3●']);
  await ipad.nudge();
  await ipad.settle();
  await expect.poll(async () => {
    const w = JSON.parse(await ipad.whole()) as Whole;
    return (w.shots[1]?.versions.ver ?? []).map((v) => `${v.label}${v.picture ? '●' : '○'}`).join(' ');
  }, { timeout: 60_000, message: 'the iPad agrees on shot 2' }).toBe('v1● v2● v3●');

  await desktop.close();
  await ipad.close();
});
