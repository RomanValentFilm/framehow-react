// SEVERAL PICTURES ON A MAIN LOAD (A15, 9 November, Roman).
//
// START FROM SCRATCH takes a whole folder; inside a project, LOAD on a shot
// took one picture. Now it takes several: the first onto the shot LOAD was
// pressed on, every further one becomes a NEW SHOT right after it, in file
// order, numbered as NEW numbers them — between shots 2 and 3 that is 2#1,
// 2#2; at the end the next numbers. Version-strip LOAD is unchanged.
//
// Four shots; LOAD on shot 2 with three files → 1, 2, 2#1, 2#2, 3, 4 — and the
// iPad sees the same six, with the three pictures on the server.
//
//     npm run t -- -g "several main pictures"
//
// About a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

const API = 'http://127.0.0.1:8787';

const PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

test('several main pictures: LOAD on a shot with three files — the first on it, two new shots after it, in order, on both devices', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('SEVERAL', 4);
  await desktop.settle();
  expect(pid).toBeTruthy();
  const ipad = await Device.open(browser, 'ipad', token, true);
  await ipad.openProject(pid!);
  await ipad.settle();

  say('desktop: LOAD on shot 2 (main, empty) with three files at once');
  const press = () => desktop.page.evaluate(() =>
    (window as never as { __fh_test: { pressUpload(i: number, st: string): void } }).__fh_test.pressUpload(1, 'main'));
  const [chooser] = await Promise.all([desktop.page.waitForEvent('filechooser', { timeout: 10_000 }), press()]);
  expect(chooser.isMultiple(), 'the main picker takes several files').toBe(true);
  await chooser.setFiles([1, 2, 3].map((i) => ({ name: `shot-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(PICTURE, 'base64') })));
  await desktop.waitForLog('2 more picture(s) became new shots after shot', 30_000);

  const labels = (await desktop.read()).frames.map((f) => f.label);
  say(`   shots now: ${labels.join(' | ')}`);
  expect(labels, 'the first on shot 2, two new shots after it, numbered as NEW would').toEqual(['1', '2', '2#1', '2#2', '3', '4']);

  say('the iPad sees the same six, and the server holds the three pictures');
  await desktop.push();
  await desktop.settle();
  await ipad.nudge();
  await ipad.settle();
  await expect.poll(async () => (await ipad.read()).frames.map((f) => f.label).join(' | '), { timeout: 60_000, message: 'the iPad has the six shots' })
    .toBe('1 | 2 | 2#1 | 2#2 | 3 | 4');
  await expect.poll(async () => ((await (await fetch(`${API}/projects/${pid}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { images: unknown[] }).images.length,
    { timeout: 60_000, message: 'three pictures on the server' }).toBe(3);

  say('at the end: LOAD on the last shot with two files → the next numbers, 5 and 6');
  const [chooser2] = await Promise.all([desktop.page.waitForEvent('filechooser', { timeout: 10_000 }),
    desktop.page.evaluate(() => (window as never as { __fh_test: { pressUpload(i: number, st: string): void } }).__fh_test.pressUpload(5, 'main'))]);
  await chooser2.setFiles([1, 2].map((i) => ({ name: `end-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(PICTURE, 'base64') })));
  await desktop.waitForLog('1 more picture(s) became new shots after shot', 30_000);
  const labels2 = (await desktop.read()).frames.map((f) => f.label);
  say(`   shots now: ${labels2.join(' | ')}`);
  expect(labels2).toEqual(['1', '2', '2#1', '2#2', '3', '4', '5']);

  // A SHOT THAT ALREADY HAS A PICTURE (Roman, 10 Nov): several pictures loaded
  // onto it ALL become new shots after it — the shot is not touched. The first
  // used to become a VERSION of it (five pictures: one version, four shots).
  say('LOAD on shot 2 — it has a picture — with two files: two NEW shots, and no new version on shot 2');
  const versionsBefore = (await desktop.versionLabels(1, 'ver')).length;
  const mark = await desktop.mark();
  const [chooser3] = await Promise.all([desktop.page.waitForEvent('filechooser', { timeout: 10_000 }),
    desktop.page.evaluate(() => (window as never as { __fh_test: { pressUpload(i: number, st: string): void } }).__fh_test.pressUpload(1, 'main'))]);
  await chooser3.setFiles([1, 2].map((i) => ({ name: `onto-a-full-shot-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(PICTURE, 'base64') })));
  await desktop.waitForLogAfter(mark, 'all become new shots after it', 30_000);
  await expect.poll(async () => (await desktop.read()).frames.length, { timeout: 30_000, message: 'two more shots' }).toBe(9);
  const labels3 = (await desktop.read()).frames.map((f) => f.label);
  say(`   shots now: ${labels3.join(' | ')}`);
  expect(labels3.slice(0, 2), 'shots 1 and 2 are where they were').toEqual(['1', '2']);
  expect((await desktop.versionLabels(1, 'ver')).length, 'SHOT 2 GOT NO NEW VERSION').toBe(versionsBefore);

  await desktop.close();
  await ipad.close();
});
