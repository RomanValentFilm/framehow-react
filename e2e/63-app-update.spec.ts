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
  // ...and the person goes to the 3×2 view: that is where they must come back (Roman, 10 Nov).
  await desktop.setView('grid3x2');
  await expect(note, 'the box that says what is happening').toBeVisible({ timeout: 40_000 });
  await expect(note).toContainText('UPDATING FRAMEHOW');
  await expect(note).toContainText('Loading the newest version — one moment.');
  await desktop.page.waitForFunction((born) => {
    const w = window as never as { __same_page?: number; __fh_booted?: boolean; __fh_test?: unknown };
    return w.__same_page !== born && Boolean(w.__fh_booted) && Boolean(w.__fh_test);
  }, pageBorn, { timeout: 40_000 });
  await expect(desktop.page.locator('#updatingNote'), 'the box is gone with the old page').toHaveCount(0);

  say('still signed in, the same project, the work of a second ago, back on the shot and in the 3×2 view');
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
  expect(await desktop.page.locator('.grid3x2-card-wrap').count(), 'BACK IN THE 3×2 VIEW').toBeGreaterThan(0);
  await desktop.waitForLog('view grid3x2', 5_000);
  const lit = () => desktop.page.evaluate(() => ({
    bar: Array.from(document.querySelectorAll('.view-btn.active')).map((b) => (b as HTMLElement).dataset.view || (b as HTMLElement).dataset.strip || b.id).sort().join(' '),
    group: document.getElementById('groupActiveLabel')?.textContent ?? '',
    groupRed: !!document.querySelector('.view-btn[data-view="group"].group-active'),
    // the version each strip card shows, and where the first shot card sits
    tabs: Array.from(document.querySelectorAll('.frame-card[data-vfid] .vtab.active')).map((t) => (t.textContent ?? '').trim()).join(' '),
    top: Math.round((document.querySelector('.frame-card[data-mfid]') as HTMLElement | null)?.getBoundingClientRect().top ?? -1),
    // for reading a difference: where each bar ends, how far the page is scrolled, the body's classes
    bars: ['mainToolbar', 'detailBar'].map((id) => { const e = document.getElementById(id); return `${id} ${e && getComputedStyle(e).display !== 'none' ? Math.round(e.getBoundingClientRect().bottom) : 'off'}`; })
      .concat([`viewBar ${Math.round((document.querySelector('.view-bar') as HTMLElement | null)?.getBoundingClientRect().bottom ?? -1)}`]).join(' · '),
    scroll: `window ${Math.round(window.scrollY)} · ` + Array.from(document.querySelectorAll('#mainScroll, #versionsScroll, .columns, #overviewScroll')).map((e) => `${(e as HTMLElement).id || 'columns'} ${Math.round((e as HTMLElement).scrollTop)}`).join(' · '),
    body: document.body.className,
  }));
  const in3x2 = await lit();
  say(`   lit in the bar: ${in3x2.bar}`);
  expect(in3x2.bar, 'THE 3×2 BUTTON IS LIT, and no strip button with it').toBe('3x2');

  // ── EVERY BUTTON LIT AS IT WAS (Roman, 10 Nov) ───────────────────────
  // A second update, from a busier bar: a group chosen, SHOT + two strips
  // lit, NEEDS open. The bar is read before and after — it must be the same.
  say('a second update, from a busy bar: a group chosen, SHOT + two strips lit, NEEDS open');
  const gid = await desktop.makeGroup('NIGHT', [1, 2, 4]);
  await desktop.enterGroup(gid);
  await desktop.page.evaluate(() => {
    const press = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.click();
    press('.view-btn[data-view="needs"]');            // out of 3×2: SHOT + NEEDS
    press('.view-btn.strip-toggle[data-strip="ver"]');
    press('.view-btn.strip-toggle[data-strip="floor"]');
  });
  // ...and shot 2's strip card is on its SECOND version, with a stroke on it.
  await desktop.pressNewVersion(1, 'ver');
  expect(await desktop.draw(1, 'ver', 1)).toBeGreaterThan(0);
  await desktop.settle();
  const before = await lit();
  say(`   versions on show: "${before.tabs}", first card at ${before.top}px`);
  say(`   bars: ${before.bars} | scroll: ${before.scroll} | body: ${before.body}`);
  expect(before.tabs, 'a card is showing its second version before the update').toContain('v2');
  say(`   before: bar "${before.bar}", group "${before.group}"`);
  expect(before.bar, 'NEEDS and the strips are lit before the update').toContain('needs');
  expect(before.group).toBe('NIGHT');
  const born2 = await stamp();
  await desktop.page.route('**/app/index.html?v=*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: NEW_PAGE }));
  await ask();
  await desktop.page.waitForFunction((born) => {
    const w = window as never as { __same_page?: number; __fh_booted?: boolean; __fh_test?: unknown };
    return w.__same_page !== born && Boolean(w.__fh_booted) && Boolean(w.__fh_test);
  }, born2, { timeout: 60_000 });
  await desktop.waitForLog('new version: running — back on shot', 20_000);
  await desktop.page.waitForTimeout(4000);
  const afterBar = await lit();
  say(`   after:  bar "${afterBar.bar}", group "${afterBar.group}"`);
  expect(afterBar.bar, 'EVERY BUTTON LIT AS BEFORE THE UPDATE').toBe(before.bar);
  expect(afterBar.group, 'the group name beside GROUP').toBe('NIGHT');
  expect(afterBar.groupRed, 'the GROUP button is red').toBe(before.groupRed);
  say(`   versions on show: "${afterBar.tabs}", first card at ${afterBar.top}px`);
  say(`   bars: ${afterBar.bars} | scroll: ${afterBar.scroll} | body: ${afterBar.body}`);
  expect(afterBar.tabs, 'EVERY CARD SHOWS THE VERSION IT SHOWED').toBe(before.tabs);
  expect(Math.abs(afterBar.top - before.top), 'the page sits where it sat — the same shot at the same height').toBeLessThanOrEqual(6);
  await desktop.close();
});
