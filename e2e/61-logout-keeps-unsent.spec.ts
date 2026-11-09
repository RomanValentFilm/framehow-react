// LOGOUT KEEPS THE UNSENT COPIES, AND NOTHING ELSE (A13b, 9 November).
//
// A photo taken offline lives nowhere but on the device. Logging out used to
// leave everything on the device (cache, previews, the lot) — and the audit
// asked for a cleaner exit. The rule: logout clears the project cache, the
// project list and the previews, and KEEPS the unsent copies, which belong to
// the account that signs in again. Account deletion wipes all (test 34).
//
//     npm run t -- -g "logout keeps"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

const PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

async function onDevice(d: Device): Promise<{ state: number; pending: number; previews: number; session: boolean }> {
  return d.page.evaluate(async () => {
    const count = (dbName: string, store: string) => new Promise<number>((ok) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(store)) { db.close(); ok(0); return; }
        const c = db.transaction(store, 'readonly').objectStore(store).count();
        c.onsuccess = () => { db.close(); ok(c.result); };
        c.onerror = () => { db.close(); ok(-1); };
      };
      req.onerror = () => ok(-1);
    });
    return {
      state: await count('framehow', 'state'),
      pending: await count('framehow', 'pending'),
      previews: await count('framehow-picts', 'previews'),
      session: !!localStorage.getItem('fh_session_token'),
    };
  });
}

test('logout keeps the unsent copy of offline work, and clears the project cache, the previews and the session', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('OFFLINE WORK', 2);
  await desktop.settle();
  expect(pid).toBeTruthy();

  say('the server goes away (every call to it fails) and the desktop adds a picture — the push fails, the copy is filed on the device');
  // Not airplane mode: that would also cut the dev server the page loads its
  // own code from. The SERVER is unreachable; the app itself still runs.
  await desktop.page.route('**/127.0.0.1:8787/**', (r) => r.abort('connectionfailed'));
  await desktop.uploadPicture(0, 'ver', PICTURE);
  await desktop.page.waitForTimeout(1500);
  const mark = await desktop.mark();
  await desktop.push().catch(() => undefined);
  await desktop.waitForLogAfter(mark, 'push FAILED', 30_000);
  await desktop.page.waitForTimeout(500);
  const before = await onDevice(desktop);
  say(`   on the device: cache ${before.state}, unsent copies ${before.pending}, previews ${before.previews}, signed in ${before.session}`);
  expect(before.pending, 'an unsent copy is filed').toBeGreaterThan(0);
  expect(before.session).toBe(true);

  say('Logout, the server still away');
  await desktop.page.evaluate(() => { void (window as never as { __fh_test: { openAccountSettings(): Promise<void> } }).__fh_test.openAccountSettings(); });
  await desktop.page.locator('#settingsLogout').click({ timeout: 10_000 });
  // THE WARNING (Roman, 9 Nov): unsent work on the device is said before logging out.
  const ask = desktop.page.locator('#confirmModal');
  await expect(ask, 'the logout asks about the unsent work').toBeVisible({ timeout: 10_000 });
  const words = (await desktop.page.locator('#confirmMsg').textContent()) ?? '';
  say(`   the question: "${words}"`);
  expect(words).toMatch(/^You have unsent work on this device \(1 project\)\. It stays here and uploads when you sign in again on this device\. Log out anyway\?$/);
  await desktop.page.locator('#confirmModal .btn:not(#confirmNo)').click();
  await desktop.page.waitForTimeout(2000);
  const after = await onDevice(desktop);
  say(`   on the device: cache ${after.state}, unsent copies ${after.pending}, previews ${after.previews}, signed in ${after.session}`);
  expect(after.pending, 'THE UNSENT COPY IS KEPT — it lives nowhere else').toBe(before.pending);
  expect(after.state, 'the project cache is gone').toBe(0);
  expect(after.previews, 'the previews are gone').toBe(0);
  expect(after.session, 'signed out').toBe(false);

  await desktop.page.unroute('**/127.0.0.1:8787/**');
  await desktop.close();
});
