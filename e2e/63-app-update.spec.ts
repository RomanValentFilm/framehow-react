// A NEW VERSION: THE PERSON IS TOLD, AND DECIDES (Roman, 10 November).
//
// Nothing at the start. After five minutes of use the app asks the server one
// small question — which build is out? — and downloads nothing. A newer one:
// a small card, at a quiet moment, "A new version of Framehow is available.
// Reload only if you are on a stable internet connection." NOT NOW · RELOAD.
// At most twice per version, on two days; then silence until a newer one.
// RELOAD: saved, the line checked (none: nothing restarts, and it says so),
// UPDATING FRAMEHOW, and the person is back signed in, on the same project,
// shot, view, with every button lit as it was and the work of a second ago.
//
// The bench has no built files, so the test says which build is "running",
// answers the app's question itself, and says the five minutes have passed.
//
//     npm run t -- -g "new version"
//
// About a minute and a half.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 240_000 });

const NEW_PAGE = '<!doctype html><html><head><link rel="stylesheet" href="/app/assets/index-NEWBUILD.css">'
  + '<script type="module" src="/app/assets/index-NEWBUILD.js"></script></head><body></body></html>';

test('new version: the person is told, twice at most — NOT NOW changes nothing, RELOAD brings them back where they were', async ({ browser }) => {
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

  say('A NEWER BUILD IS OUT, but the WRITE box is open: nothing is downloaded, nothing restarts, and the card WAITS');
  const NEWER_PAGE = NEW_PAGE.replace(/NEWBUILD/g, 'NEWERBUILD');
  await desktop.page.route('**/app/index.html?v=*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: NEW_PAGE }));
  let fetchedBehindTheBack = 0;
  await desktop.page.route('**/app/assets/index-NEW*', (r) => { fetchedBehindTheBack++; return r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* new */' }); });
  const mark = await desktop.mark();
  await desktop.openWriteBox(4, 'main', 0);
  await ask();
  await desktop.waitForLogAfter(mark, 'is out, this is', 20_000);
  const card = desktop.page.locator('#updateCard');
  await desktop.page.waitForTimeout(6000);
  await expect(card, 'THE QUESTION DOES NOT COME WHILE A BOX IS OPEN').toHaveCount(0);
  await expect(note, 'and nothing switches by itself').toHaveCount(0);
  expect(await stamp(), 'the page was not reloaded under the write box').toBe(pageBorn);

  say('the text is typed and saved; the person goes to 3×2 — NOW the question comes: TOMORROW or NOW');
  await desktop.finishWriteBox('BEFORE THE UPDATE');
  // ...and the person goes to the 3×2 view: that is where they must come back (Roman, 10 Nov).
  await desktop.setView('grid3x2');
  await expect(card, 'THE QUESTION NEVER CAME').toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('A new version of Framehow is available.');
  await expect(card).toContainText('Reload only if you are on a stable internet connection.');
  await expect(desktop.page.locator('#updateCardLater')).toHaveText('NOT NOW');
  await expect(desktop.page.locator('#updateCardNow')).toHaveText('RELOAD');
  expect(await stamp(), 'NOTHING HAPPENS UNTIL THE PERSON ANSWERS').toBe(pageBorn);
  expect(fetchedBehindTheBack, 'NOTHING WAS DOWNLOADED BEHIND THE PERSON\'S BACK').toBe(0);

  say('NOT NOW — the card goes and is not shown again that day; the app is untouched');
  await desktop.page.locator('#updateCardLater').click();
  await expect(card).toHaveCount(0);
  await desktop.page.waitForTimeout(7000);
  await expect(card, 'SHOWN AGAIN THE SAME DAY').toHaveCount(0);
  expect(await stamp()).toBe(pageBorn);

  say('a later day: shown once more — NOT NOW again; and then NEVER AGAIN for this version');
  const asked = (days: string[]) => desktop.page.evaluate((d) =>
    localStorage.setItem('fh_update_asked', JSON.stringify({ build: 'index-NEWBUILD.js', days: d })), days);
  await asked(['1999-1-1']);
  await ask();
  await expect(card, 'NOT SHOWN THE SECOND TIME, a day later').toBeVisible({ timeout: 20_000 });
  await desktop.page.locator('#updateCardLater').click();
  await asked(['1999-1-1', '1999-1-2']);
  await ask();
  await desktop.page.waitForTimeout(7000);
  await expect(card, 'A THIRD TIME for the same version').toHaveCount(0);

  say('a NEWER version still is out: told again — RELOAD');
  await desktop.page.unroute('**/app/index.html?v=*');
  await desktop.page.route('**/app/index.html?v=*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: NEWER_PAGE }));
  await ask();
  await expect(card, 'NOT TOLD ABOUT THE NEWER VERSION').toBeVisible({ timeout: 20_000 });
  await desktop.page.locator('#updateCardNow').click();
  await expect(note, 'the box that says what is happening').toBeVisible({ timeout: 20_000 });
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
  // (the NEWER build again: the first one has had its two NOT NOWs. On the bench the page that came
  // back is not really the newer build, so the note that it was shown today is cleared by hand —
  // a real restart onto the new version clears it itself.)
  await desktop.page.evaluate(() => localStorage.removeItem('fh_update_asked'));
  await desktop.page.route('**/app/index.html?v=*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: NEWER_PAGE }));
  await ask();
  await expect(desktop.page.locator('#updateCard'), 'the question, the second time').toBeVisible({ timeout: 30_000 });
  await desktop.page.locator('#updateCardNow').click();
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

// NOBODY SIGNED IN (the simulator, 10 Nov): the update waited for ever for
// "the project settings still to send" on a device with nowhere to send them.
// Such a project lives on the device — the update saves it there and switches;
// afterwards the project and the work of a second ago are on the screen.
test('new version, nobody signed in, the line drops: RELOAD restarts nothing and says so; with a line, the unsaved project is there afterwards', async ({ browser }) => {
  const desktop = await Device.open(browser, 'desktop', '');
  await desktop.page.evaluate(() => (window as never as { __fh_test: { newUnsavedProject(n: number): Promise<void> } }).__fh_test.newUnsavedProject(3));
  for (const sel of ['#projectListClose', '#accountCancel']) {
    const b = desktop.page.locator(sel);
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  await desktop.openWriteBox(1, 'main', 0);
  await desktop.finishWriteBox('NOT SIGNED IN');
  await desktop.page.route('**/app/index.html?v=*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: NEW_PAGE }));
  await desktop.page.route('**/app/assets/index-NEWBUILD.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: 'body{}' }));
  await desktop.page.route('**/app/assets/index-NEWBUILD.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* new */' }));
  const born = await desktop.page.evaluate(() => (window as never as { __same_page?: number }).__same_page ??= Date.now());
  say('a newer build is out — nobody is signed in, the project has never been saved');
  await desktop.page.evaluate(() => (window as never as { __fh_test: { askForUpdate(b: string): Promise<void> } }).__fh_test.askForUpdate('index-OLDBUILD.js'));
  await expect(desktop.page.locator('#updateCard'), 'the question comes for somebody not signed in too').toBeVisible({ timeout: 30_000 });

  // THE LINE GOES between the download and the answer (Roman, 10 Nov: "a big
  // no go" — a restart with no line cannot bring the project back). NOW must
  // then restart NOTHING, change nothing, and say so.
  say('the line goes — NOW: nothing is restarted, the app says why, the work stays on the screen');
  await desktop.page.unroute('**/app/index.html?v=*');
  await desktop.page.route('**/app/index.html?v=*', (r) => r.abort('connectionfailed'));
  await desktop.page.locator('#updateCardNow').click();
  const noLine = desktop.page.locator('#importantNote');
  await expect(noLine, 'IT SAYS WHY').toBeVisible({ timeout: 15_000 });
  await expect(noLine).toContainText('NO CONNECTION');
  await expect(noLine).toContainText('Framehow was not reloaded.');
  await expect(desktop.page.locator('#updatingNote'), 'the UPDATING box is gone again').toHaveCount(0);
  expect(await desktop.page.evaluate(() => (window as never as { __same_page?: number }).__same_page), 'THE APP WAS NOT RESTARTED WITHOUT A LINE').toBe(born);
  expect(await desktop.textOnCard(1, 'main', 0)).toContain('NOT SIGNED IN');
  await noLine.getByRole('button').click();

  say('the line is back — asked again, NOW');
  await desktop.page.unroute('**/app/index.html?v=*');
  await desktop.page.route('**/app/index.html?v=*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: NEW_PAGE }));
  await desktop.page.evaluate(() => (window as never as { __fh_test: { askForUpdate(b: string): Promise<void> } }).__fh_test.askForUpdate('index-OLDBUILD.js'));
  await expect(desktop.page.locator('#updateCard'), 'asked again once the line is back').toBeVisible({ timeout: 30_000 });
  await desktop.page.locator('#updateCardNow').click();
  await desktop.page.waitForFunction((b) => {
    const w = window as never as { __same_page?: number; __fh_booted?: boolean; __fh_test?: unknown };
    return w.__same_page !== b && Boolean(w.__fh_booted) && Boolean(w.__fh_test);
  }, born, { timeout: 60_000 });
  say('the app is back: the same three shots and the text, from the device');
  await expect.poll(async () => (JSON.parse(await desktop.whole()) as { shots: unknown[] }).shots.length, { timeout: 20_000 }).toBe(3);
  expect(await desktop.textOnCard(1, 'main', 0), 'THE UNSAVED WORK IS THERE AFTER THE UPDATE').toContain('NOT SIGNED IN');
  await desktop.close();
});
