// A PICTURE WHOSE UPLOAD FAILS (audit, 9 November — CRITICAL).
//
// The server hiccups (503), the connection drops, a timeout: until today the
// save went on WITHOUT the picture, the shot was recorded as "on the server",
// nothing ever retried it, and after 72 h the device copy was swept — the one
// silent way to lose a photograph.
//
// Now a failed upload fails the save: the work is filed as unsent, and the
// next push carries the picture up. This plays it: the upload route answers
// 503 for the first save, the server must hold NO picture and the device must
// still know it has unsent work; the route recovers, the next push lands the
// picture.
//
//     npm run t -- -g "upload fails"
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

test('upload fails: the save fails with it, and the next push carries the picture', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('UPLOAD FAILS', 1);
  await desktop.settle();
  expect(pid).toBeTruthy();

  say('the upload route answers 503 — a server hiccup');
  let refused = 0;
  await desktop.page.route('**/upload', async (route) => {
    refused++;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'hiccup', message: 'try later' } }) });
  });

  say('desktop: a picture on shot 1, and a push');
  await desktop.uploadPicture(0, 'main', PICTURE);
  await desktop.page.waitForTimeout(1500);
  const before = await desktop.mark();
  await desktop.push().catch(() => undefined);
  await desktop.waitForLogAfter(before, 'push FAILED', 30_000);
  expect(refused, 'the upload was tried').toBeGreaterThan(0);
  expect(await picturesOnServer(token, pid!), 'the server holds no picture yet').toBe(0);
  const oks = (lines: string[]) => lines.filter((l) => l.includes('push OK')).length;
  expect(oks(await desktop.log()), 'THE SAVE WENT UP WITHOUT ITS PICTURE (audit 9 Nov) — a failed upload was skipped and the shot recorded as sent')
    .toBe(oks(before));

  say('the server is back — the next push carries the picture');
  await desktop.page.unroute('**/upload');
  const again = await desktop.mark();
  await desktop.push();
  await desktop.waitForLogAfter(again, 'push OK', 30_000);
  await desktop.settle();
  expect(await picturesOnServer(token, pid!), 'the picture is on the server now').toBe(1);

  await desktop.close();
});
