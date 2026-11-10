// THE NEWEST VERSION, BY ITSELF — AND SMOOTH (Roman, 10 November).
//
// The first time each day the app comes to the front it asks whether a newer
// build is out. "This has to be super smooth": the project is on the screen
// first; the new build is fetched WHOLE in the background; the switch waits
// for a quiet moment (no box open, nothing to send); a box says UPDATING
// FRAMEHOW; and afterwards the person is still signed in, on the same project,
// with the work they did a second ago. A bad line, or none: nothing happens,
// the app goes on as it is, and it is tried again next time.
//
// The bench has no built files, so the test says which build is "running" and
// answers the app's questions itself (the page naming a newer build, and that
// build's files).
//
//     npm run t -- -g "new version"
//
// About a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 240_000 });

const NEW_PAGE = '<!doctype html><html><head><link rel="stylesheet" href="/app/assets/index-NEWBUILD.css">'
  + '<script type="module" src="/app/assets/index-NEWBUILD.js"></script></head><body></body></html>';

test('new version: a bad line changes nothing; a good one is fetched whole, waits for a quiet moment, and the person is back where they were', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('UPDATE ME', 6);
  await desktop.settle();
  expect(pid).toBeTruthy();
  // On the bench the start's own boxes stay open (the tests press no buttons);
  // a person has closed them by now — and they would rightly hold everything back.
  for (const sel of ['#projectListClose', '#accountCancel']) {
    const b = desktop.page.locator(sel);
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  const ask = () => desktop.page.evaluate(() =>
    (window as never as { __fh_test: { askForUpdate(b: string): Promise<void> } }).__fh_test.askForUpdate('index-OLDBUILD.js'));
  const note = desktop.page.locator('#updatingNote');
  const stamp = () => desktop.page.evaluate(() => (window as never as { __same_page?: number }).__same_page ??= Date.now());
  const pageBorn = await stamp();

  say('NO LINE AT ALL: the question gets no answer — nothing happens, the app goes on');
  await desktop.page.route('**/app/index.html?v=*', (r) => r.abort('connectionfailed'));
  await ask();
  await desktop.page.waitForTimeout(5000);
  await expect(note).toHaveCount(0);
  expect(await stamp(), 'the page was not reloaded').toBe(pageBorn);
  await desktop.page.unroute('**/app/index.html?v=*');

  say('A BAD LINE: a newer build is out, but one of its files does not arrive — nothing happens');
  await desktop.page.route('**/app/index.html?v=*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: NEW_PAGE }));
  await desktop.page.route('**/app/assets/index-NEWBUILD.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: 'body{}' }));
  await desktop.page.route('**/app/assets/index-NEWBUILD.js', (r) => r.abort('connectionfailed'));
  let mark = await desktop.mark();
  await ask();
  await desktop.waitForLogAfter(mark, 'new version: not fetched', 20_000);
  await desktop.page.waitForTimeout(5000);
  await expect(note).toHaveCount(0);
  expect(await stamp(), 'the page was not reloaded').toBe(pageBorn);
  expect(await desktop.page.evaluate(() => localStorage.getItem('fh_update_checked_day')), 'the day is NOT marked — it is tried again').toBeNull();

  say('A GOOD LINE, but the WRITE box is open: the build is fetched whole, and the switch WAITS');
  await desktop.page.unroute('**/app/assets/index-NEWBUILD.js');
  await desktop.page.route('**/app/assets/index-NEWBUILD.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* new */' }));
  await desktop.openWriteBox(4, 'main', 0);
  mark = await desktop.mark();
  await ask();
  await desktop.waitForLogAfter(mark, 'is on the device', 20_000);
  await desktop.page.waitForTimeout(6000);
  await expect(note, 'NO SWITCH WHILE A BOX IS OPEN').toHaveCount(0);
  expect(await stamp(), 'the page was not reloaded under the write box').toBe(pageBorn);

  say('the text is typed and saved; then, at the quiet moment: UPDATING FRAMEHOW, and the app comes back by itself');
  // From here the real page answers again — that is the "new version" arriving.
  await desktop.page.unroute('**/app/index.html?v=*');
  await desktop.finishWriteBox('BEFORE THE UPDATE');
  await expect(note, 'the box that says what is happening').toBeVisible({ timeout: 40_000 });
  await expect(note).toContainText('UPDATING FRAMEHOW');
  await expect(note).toContainText('Loading the newest version — one moment.');
  await desktop.page.waitForFunction((born) => {
    const w = window as never as { __same_page?: number; __fh_booted?: boolean; __fh_test?: unknown };
    return w.__same_page !== born && Boolean(w.__fh_booted) && Boolean(w.__fh_test);
  }, pageBorn, { timeout: 40_000 });
  await expect(desktop.page.locator('#updatingNote'), 'the box is gone with the old page').toHaveCount(0);

  say('still signed in, the same project, the work of a second ago, and back on the shot');
  await desktop.settle();
  const after = await desktop.page.evaluate(() => {
    const w = window as never as { __fh_test: { textOnCard(i: number, s: string, v: number): string } };
    return {
      signedIn: (document.getElementById('menuAccount')?.textContent ?? '').trim(),
      name: (document.querySelector('#projectName, .project-name, #toolbarProjectName')?.textContent ?? '').trim(),
      text: w.__fh_test.textOnCard(4, 'main', 0),
    };
  });
  say(`   menu says "${after.signedIn}", text on shot 5: "${after.text}"`);
  expect(after.signedIn, 'NOBODY SIGNS IN AGAIN').toBe('Account');
  expect(after.text, 'the text written just before the update is there').toContain('BEFORE THE UPDATE');
  expect(JSON.parse(await desktop.whole()).shots.length, 'the same project, all six shots').toBe(6);
  await desktop.waitForLog('new version: running — back on shot', 20_000);
  await desktop.close();
});
