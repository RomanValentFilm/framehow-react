// THE PICTS LIBRARY (26 October, Roman).
//
// Step 1 — the server's list: every picture the account ever uploaded, with the
// moment it arrived and the cards that use it today. Read-only.
//
//     npm run t -- -g "picts library"

import { test, expect } from '@playwright/test';
import { API, Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

const RED = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

type Pic = { key: string; uploaded_at: number; size: number; uses: { project: string; shot: string | null; version: string | null }[] };

test('picts library: the server lists every picture of the account, oldest first, with where it is used', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProjectOfKind('LIBRARY ONE', 'landscape', 2);
  await d.settle();

  say('a picture on shot 1, then one on shot 2');
  await d.uploadPicture(0, 'main', RED);
  await d.settle();
  await d.page.waitForTimeout(1200);
  await d.uploadPicture(1, 'main', RED);
  await d.settle();
  await d.page.waitForTimeout(1500);

  const res = await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok, 'the list answers').toBe(true);
  const { pictures } = await res.json() as { pictures: Pic[] };
  for (const p of pictures) say(`   ${new Date(p.uploaded_at).toISOString()} · ${p.size} bytes · ${p.uses.map((u) => `${u.project} / shot ${u.shot} / ${u.version}`).join(', ') || 'not on a card'}`);
  expect(pictures.length, 'both pictures').toBeGreaterThanOrEqual(2);
  expect(pictures.every((p) => p.key.includes('/users/') || p.key.startsWith('users/')), 'only this account\'s files').toBe(true);
  expect([...pictures].sort((a, b) => a.uploaded_at - b.uploaded_at).map((p) => p.key), 'oldest first').toEqual(pictures.map((p) => p.key));
  expect(pictures.filter((p) => p.uses.some((u) => u.project === 'LIBRARY ONE')).length, 'and where they are used').toBeGreaterThanOrEqual(2);

  const storageNow = async () => ((await (await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { storage: { used: number } }).storage.used;
  say('previews are made when a picture is added — before the library is ever opened (27 Oct)');
  await expect.poll(async () => {
    const l = ((await (await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { pictures: Pic[] }).pictures;
    return l.filter((p) => p.thumb).length;
  }, { timeout: 20_000, message: 'both previews, made on adding' }).toBe(2);
  const madeOnAdding = (await d.log()).filter((l) => l.includes('preview kept') && l.includes('on adding')).length;
  say(`   log lines "preview kept … on adding": ${madeOnAdding}`);
  expect(madeOnAdding, 'made by the adding, not by the library').toBe(2);

  say('step 2: PICTS opens the library — both pictures, under a date line; a tap opens the max screen, which returns here');
  // The project list may still lie over the bars after making the project
  // (runs 481/482: the PICTS tap waited three minutes behind it).
  await d.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));
  await d.page.waitForTimeout(300);
  await d.page.locator('#pictsBtn').click({ timeout: 15_000 });
  await expect(d.page.locator('#pictsLibrary'), 'the library').toBeVisible();
  await expect(d.page.locator('#pictsBtn'), 'the button is lit').toHaveClass(/active/);
  say('   one red outline at a time: while the library is open, PICTS is the only one (27 Oct)');
  const reds = await d.page.evaluate(() => {
    const accent = getComputedStyle(document.getElementById('pictsBtn')!).borderTopColor;
    return [...document.querySelectorAll<HTMLElement>('.view-bar button, .detail-bar button')]
      .filter((b) => b.offsetParent && getComputedStyle(b).borderTopColor === accent).map((b) => b.textContent!.trim());
  });
  say(`   red outlines: ${reds.join(', ')}`);
  expect(reds, 'only PICTS').toEqual(['PICTS']);
  await expect.poll(() => d.page.locator('#pictsLibrary .picts-tile').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const dates = await d.page.locator('#pictsLibrary .picts-date').allTextContents();
  say(`   date lines: ${dates.join(' | ')}`);
  expect(dates.length, 'one line for today').toBe(1);

  say('step 3: the library made a preview of each picture — small, in the account\'s folder, counted in its storage (27 Oct)');
  let listed: Pic[] = [];
  await expect.poll(async () => {
    listed = ((await (await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { pictures: Pic[] }).pictures;
    return listed.filter((p) => p.thumb).length;
  }, { timeout: 15_000 }).toBe(listed.length || 2);
  let thumbBytes = 0;
  for (const p of listed) {
    const r = await fetch(`${API}/thumbs/${p.key}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.ok, 'the preview is there').toBe(true);
    expect(r.headers.get('content-type'), 'a JPEG').toBe('image/jpeg');
    const n = (await r.arrayBuffer()).byteLength;
    thumbBytes += n;
    expect(n, 'small').toBeLessThan(200 * 1024);
  }
  const usedAfter = await storageNow();
  const pictureBytes = listed.reduce((a, p) => a + p.size, 0);
  say(`   pictures ${pictureBytes} bytes + previews ${thumbBytes} bytes; storage says ${usedAfter}`);
  expect(usedAfter, 'the previews count in the account').toBe(pictureBytes + thumbBytes);
  await expect.poll(async () => (await d.log()).some((l) => l.includes('PICTS: SELECT at')), { timeout: 5_000 }).toBe(true);
  const log = await d.log();
  say(`   ${log.find((l) => l.includes('PICTS: previews:')) ?? 'no preview-size line'}`);
  say(`   ${log.find((l) => l.includes('PICTS: SELECT at')) ?? 'no SELECT line'}`);
  expect(log.some((l) => l.includes('PICTS: SELECT at') && l.includes('— visible')), 'SELECT is visible, nothing over it').toBe(true);
  const other0 = await freshAccount();
  const peek = await fetch(`${API}/thumbs/${listed[0].key}`, { headers: { Authorization: `Bearer ${other0.token}` } });
  expect(peek.status, 'another account cannot see a preview').toBe(404);

  // The rows as they stand: which pictures, how high, how wide the library is.
  const rows = () => d.page.evaluate(() => ({
    width: document.querySelector<HTMLElement>('#pictsLibrary .picts-days')!.clientWidth,
    rows: [...document.querySelectorAll<HTMLElement>('#pictsLibrary .picts-row')].map((r) => ({
      h: r.getBoundingClientRect().height,
      keys: [...r.querySelectorAll<HTMLElement>('.picts-tile')].map((t) => t.dataset.key),
    })),
  }));
  say('   a short last row is as high as a full row of the same pictures — not taller (26 Oct)');
  const before = await rows();
  const last = before.rows[before.rows.length - 1];
  // Square pictures, 5 to a full row on a desktop.
  const fullRowH = (before.width - 3 * 4) / 5;   // 3 px lines (27 Oct)
  say(`   last row ${Math.round(last.h)} px high, a full row would be ${Math.round(fullRowH)} px`);
  expect(Math.abs(last.h - fullRowH), 'the same height as a full row').toBeLessThanOrEqual(3);

  say('   turned: the same pictures in the same rows, only smaller (26 Oct)');
  const vp = d.page.viewportSize()!;
  await d.page.setViewportSize({ width: Math.round(vp.height * 0.75), height: vp.width });
  await d.page.waitForTimeout(700);
  const after = await rows();
  say(`   width ${before.width} → ${after.width} px, last row ${Math.round(last.h)} → ${Math.round(after.rows[after.rows.length - 1].h)} px`);
  expect(after.rows.map((r) => r.keys), 'no picture moved to another row').toEqual(before.rows.map((r) => r.keys));
  after.rows.forEach((r, i) => expect(Math.abs(r.h - before.rows[i].h * after.width / before.width), `row ${i + 1} grew or shrank with the width`).toBeLessThanOrEqual(3));
  await d.page.setViewportSize(vp);
  await d.page.waitForTimeout(700);

  await d.page.locator('#pictsLibrary .picts-tile').last().click();
  await expect(d.page.locator('#maxView'), 'the max screen').toBeVisible();
  say(`   max screen says: ${await d.page.locator('#maxView .max-label').textContent()}`);
  await d.page.locator('#maxView .max-close').click();
  await expect(d.page.locator('#maxView')).toBeHidden();
  await expect(d.page.locator('#pictsLibrary'), 'back in the library').toBeVisible();

  say('step 3: SELECT — a tap marks (red tick), the bar counts, the date line marks the day, a drag marks, SHARE downloads a ZIP, CANCEL clears');
  const lib = d.page.locator('#pictsLibrary');
  const tiles = lib.locator('.picts-tile');
  const count = lib.locator('.picts-count');
  await expect(lib.locator('.picts-bar'), 'no bar before SELECT').toBeHidden();
  await lib.locator('.picts-select').click();
  await expect(lib.locator('.picts-select')).toHaveText('CANCEL');
  await expect(lib.locator('.picts-select'), 'CANCEL grey while nothing is marked').not.toHaveClass(/ready|active/);
  await expect(tiles.first().locator('.picts-tick'), 'an empty white circle on every picture').toBeVisible();
  expect(await tiles.first().locator('.picts-tick').evaluate((e) => getComputedStyle(e).backgroundColor), 'empty, not red').not.toBe(
    await lib.locator('.picts-select').evaluate(() => getComputedStyle(document.getElementById('pictsBtn')!).borderTopColor));
  await expect(lib.locator('.picts-bar'), 'the bar').toBeVisible();
  await expect(count).toHaveText('0 selected');
  await expect(lib.locator('.picts-share'), 'nothing to share yet').toBeDisabled();
  await expect(lib.locator('.picts-delete'), 'DELETE grey until step 4').toBeDisabled();
  await tiles.first().click();
  await expect(d.page.locator('#maxView'), 'marking, not the max screen').toBeHidden();
  await expect(tiles.first()).toHaveClass(/marked/);
  await expect(tiles.first().locator('.picts-tick'), 'the red tick').toBeVisible();
  await expect(count).toHaveText('1 selected');
  await expect(lib.locator('.picts-select'), 'CANCEL white once something is marked').toHaveClass(/ready/);
  await expect(lib.locator('.picts-share'), 'SHARE white too').toHaveClass(/ready/);
  await lib.locator('.picts-date').first().click();
  await expect(count, 'the date line marks the whole day').toHaveText('2 selected');
  await expect(lib.locator('.picts-day-all').first()).toHaveText('UNSELECT DAY');
  await lib.locator('.picts-date').first().click();
  await expect(count, 'and unmarks it').toHaveText('0 selected');
  const b1 = (await tiles.nth(0).boundingBox())!, b2 = (await tiles.nth(1).boundingBox())!;
  await d.page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await d.page.mouse.down();
  await d.page.mouse.move(b1.x + b1.width / 2 + 20, b1.y + b1.height / 2, { steps: 4 });
  await d.page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 8 });
  await d.page.mouse.up();
  await expect(count, 'a drag across both marks both').toHaveText('2 selected');
  const [zipDl] = await Promise.all([d.page.waitForEvent('download', { timeout: 20_000 }), lib.locator('.picts-share').click()]);
  const zipPath = await zipDl.path();
  const zipBytes = zipPath ? (await import('fs')).readFileSync(zipPath) : Buffer.alloc(0);
  say(`   downloaded "${zipDl.suggestedFilename()}", ${zipBytes.length} bytes`);
  expect(zipDl.suggestedFilename(), 'one ZIP for two pictures').toBe('Framehow pictures – 2.zip');
  expect(zipBytes[0] === 0x50 && zipBytes[1] === 0x4b, 'a ZIP').toBe(true);
  await lib.locator('.picts-select').click();
  await expect(lib.locator('.picts-select')).toHaveText('SELECT');
  await expect(lib.locator('.picts-bar')).toBeHidden();
  await expect(lib.locator('.picts-tile.marked'), 'CANCEL clears the marks').toHaveCount(0);

  say('   another view button takes over: the library closes, the button goes back to normal');
  await d.page.locator('.strip-toggle[data-strip="ver"]').click();
  await expect(d.page.locator('#pictsLibrary')).toHaveCount(0);
  await expect(d.page.locator('#pictsBtn')).not.toHaveClass(/active/);

  say('another account sees none of them');
  const other = await freshAccount();
  const res2 = await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${other.token}` } });
  const { pictures: theirs } = await res2.json() as { pictures: Pic[] };
  expect(theirs.length, 'a fresh account has an empty library').toBe(0);
  await d.close();
});
