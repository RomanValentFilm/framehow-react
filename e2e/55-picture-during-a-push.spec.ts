// A PICTURE ADDED WHILE A PUSH IS IN THE AIR (A9, 9 November — audit, HIGH).
//
// Test 33 went red in runs 581 and 582: three pictures loaded within a tenth of
// a second, the server kept two. The third was added while the first push was
// still travelling — and nothing ever carried it up. On a shooting day that is
// the second photo of a quick pair, lost without a word.
//
// Here the push is held open on purpose (the sync answer is delayed 3 s), the
// second picture is loaded inside that window, and the server must end up with
// both — within the retry's reach, not "eventually".
//
//     npm run t -- -g "during a push"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

const API = 'http://127.0.0.1:8787';

const PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

async function picturesOnServer(token: string, projectId: string): Promise<number> {
  const tree = await (await fetch(`${API}/projects/${projectId}/sync`, { headers: { Authorization: `Bearer ${token}` } }))
    .json() as { images: Array<{ r2_key: string }> };
  return tree.images.length;
}

test('during a push: a picture added while a push is in the air reaches the server with the next push', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('DURING A PUSH', 2);
  await desktop.settle();
  expect(pid).toBeTruthy();

  say('the sync answer is held for 3 s — every push now takes that long');
  await desktop.holdAnswerFor(pid!, 3000);

  say('desktop: picture on shot 1, push starts; while it travels, a picture on shot 2');
  await desktop.uploadPicture(0, 'ver', PICTURE);
  await desktop.page.waitForTimeout(600);           // the picture is read and the push is on its way
  const mark = await desktop.mark();
  await desktop.uploadPicture(1, 'ver', PICTURE);   // inside the window
  await desktop.waitForLogAfter(mark, 'push OK', 30_000);
  await desktop.holdNothing();

  say('both pictures must be on the server — the second with the push that follows');
  const t0 = Date.now();
  let n = await picturesOnServer(token, pid!);
  while (n < 2 && Date.now() - t0 < 30_000) {
    await desktop.page.waitForTimeout(1000);
    n = await picturesOnServer(token, pid!);
  }
  say(`   pictures on the server: ${n}, after ${Math.round((Date.now() - t0) / 1000)} s`);
  // The app's own account of what it did, for the reader of the log — always.
  for (const l of (await desktop.log()).filter((x) => /push|upload|picture|delta|changed|sending|nothing|skipped|held|fetch/i.test(x)).slice(0, 70)) say(`   · ${l}`);
  expect(n, 'THE SECOND PICTURE NEVER WENT UP (test 33, runs 581/582) — added while a push was in the air, and nothing carried it').toBe(2);
  // Run 586: it went up, after 10 s — the "sending again" push 300 ms after the
  // first one was swallowed and the picture waited for the next heartbeat. On a
  // shooting day that is a photo sitting on one device for no reason.
  expect(Date.now() - t0, 'the second picture took longer than 5 s — the follow-up push was swallowed').toBeLessThan(5000);

  await desktop.close();
});
