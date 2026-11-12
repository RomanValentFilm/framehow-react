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

  say('saving and uploading fail (the server drops them) and the desktop adds a picture — the push fails, the copy is filed on the device');
  // Not airplane mode: that would also cut the dev server the page loads its
  // own code from. Only the SAVE and the UPLOAD fail; the project list still
  // answers, so the list can be looked at with the copy unsent.
  const cut = (r: { abort(code: string): Promise<void> }) => r.abort('connectionfailed');
  await desktop.page.route('**/127.0.0.1:8787/projects/*/sync*', cut);
  await desktop.page.route('**/127.0.0.1:8787/upload', cut);
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

  say('the list shows ONE row for the project, with the note — no copy rows (G10)');
  await desktop.page.evaluate(() => { void (window as never as { __fh_test: { openProjectList(): Promise<void> } }).__fh_test.openProjectList(); });
  await desktop.page.waitForTimeout(1500);
  const rows = await desktop.page.evaluate(() => Array.from(document.querySelectorAll('#projectListContent .project-list-row'))
    .map((r) => ({ copy: r.classList.contains('project-list-copy'), text: (r.textContent ?? '').replace(/\s+/g, ' ').trim() })));
  for (const r of rows) say(`   row: ${r.copy ? '[copy] ' : ''}${r.text}`);
  const mine = rows.filter((r) => r.text.includes('OFFLINE WORK'));
  expect(mine.filter((r) => r.copy), 'no separate copy rows for a project that is in the cloud list').toHaveLength(0);
  expect(mine.some((r) => r.text.includes('unsent work on this device — opens with it')), 'the project row carries the note').toBe(true);
  await desktop.page.locator('#projectListClose').click();

  say('Logout — the copy is still unsent');
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

  // THE LIST OF COPIES AGREES WITH THE COPIES (12 Nov): the app reads the list,
  // never the whole copies — so the list must name exactly what is there.
  const agree = await desktop.page.evaluate(() =>
    (window as never as { __fh_test: { copyListAndStore(): Promise<{ list: string[]; store: string[] }> } }).__fh_test.copyListAndStore());
  expect(agree.list, 'THE LIST OF DEVICE COPIES NAMES EXACTLY THE COPIES ON THE DEVICE').toEqual(agree.store);

  await desktop.page.unroute('**/127.0.0.1:8787/projects/*/sync*');
  await desktop.page.unroute('**/127.0.0.1:8787/upload');
  await desktop.close();
});
