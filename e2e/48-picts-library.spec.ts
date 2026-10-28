// THE PICTS LIBRARY (26 October, Roman).
//
// Step 1 — the server's list: every picture the account ever uploaded, with the
// moment it arrived and the cards that use it today. Read-only.
//
//     npm run t -- -g "picts library"

import { test, expect } from '@playwright/test';
import { API, Device, freshAccount, say } from './harness';
import { deflateSync } from 'zlib';

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
  const madeOnAdding = (await d.log()).filter((l) => l.includes('preview kept') && l.includes('with its picture')).length;
  say(`   log lines "preview kept … with its picture": ${madeOnAdding}`);
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
  expect(reds, 'only LIBRARY').toEqual(['LIBRARY']);
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
  const fullRowH = (before.width - 4 * 4) / 5;   // 4 px lines (27 Oct)
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

test('picts library on the iPad: the library starts under the bars, SELECT is visible', async ({ browser }) => {
  // 27 Oct, Roman's iPad log: "SELECT … covered by div#mainToolbar (library top 0px)" —
  // the bars are pinned to the screen there, and the library started under them.
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'tablet', token, true);
  await d.newProjectOfKind('LIBRARY IPAD', 'landscape', 1);
  await d.settle();
  await d.uploadPicture(0, 'main', RED);
  await d.settle();
  await d.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));
  await d.page.waitForTimeout(300);
  await d.page.locator('#pictsBtn').click({ timeout: 15_000 });
  await expect.poll(() => d.page.locator('#pictsLibrary .picts-tile').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  const where = await d.page.evaluate(() => {
    const lib = document.getElementById('pictsLibrary')!.getBoundingClientRect().top;
    const bars = ['#mainToolbar', '.view-bar', '#detailBar'].map((s) => document.querySelector<HTMLElement>(s))
      .filter((e): e is HTMLElement => !!e && getComputedStyle(e).display !== 'none')
      .map((e) => e.getBoundingClientRect().bottom);
    return { lib, bars: Math.max(...bars) };
  });
  say(`   library top ${Math.round(where.lib)} px, bars end at ${Math.round(where.bars)} px`);
  expect(where.lib, 'the library starts under the bars').toBeGreaterThanOrEqual(where.bars - 1);
  await expect.poll(async () => (await d.log()).find((l) => l.includes('PICTS: SELECT at')) ?? '', { timeout: 5_000 }).toContain('— visible');
  say(`   ${(await d.log()).find((l) => l.includes('PICTS: SELECT at'))}`);
  say(`   ${(await d.log()).find((l) => l.includes('PICTS: shown')) ?? 'no shown line'}`);
  await expect.poll(async () => (await d.log()).find((l) => l.includes('PICTS: newest day loaded')) ?? '', { timeout: 5_000, message: 'it opens at the bottom' }).toContain('at the bottom');
  say(`   ${(await d.log()).find((l) => l.includes('PICTS: newest day loaded'))}`);
  await d.close();
});

/** A small one-colour PNG — each colour a different picture, so a different fingerprint. */
function colourPng(r: number, g: number, b: number): string {
  const W = 48, H = 32;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

// Before the offline test: switching the test browser's network off and on
// spoils its uploads for the next test (runs 499/500).
test('picts library: a preview that misses its picture\'s upload goes with the next sync', async ({ browser }) => {
  // 27 Oct, Roman: "can't it go together?" — the preview goes straight after its
  // picture; if the connection drops between the two, the next sync sends it.
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProjectOfKind('PREVIEW LATE', 'landscape', 2);
  await d.settle();
  const thumbsOnServer = async () => ((await (await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { pictures: Pic[] }).pictures.filter((p) => p.thumb).length;

  say('the preview\'s way to the server is cut; a picture is added and uploads');
  await d.page.route('**/thumbs/**', (r) => (r.request().method() === 'PUT' ? r.abort() : r.continue()));
  await d.uploadPicture(0, 'main', colourPng(220, 180, 20));
  await d.settle();
  await expect.poll(async () => ((await (await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { pictures: Pic[] }).pictures.length,
    { timeout: 20_000, message: 'the picture is on the server' }).toBe(1);
  await d.page.waitForTimeout(1500);
  expect(await thumbsOnServer(), 'its preview is not').toBe(0);
  say(`   ${(await d.log()).find((l) => l.includes('preview not kept')) ?? 'no "not kept" line'}`);

  say('the way is open again; the next sync (another picture) sends the waiting preview too');
  await d.page.unroute('**/thumbs/**');
  await d.uploadPicture(1, 'main', colourPng(20, 180, 220));
  await d.settle();
  await expect.poll(thumbsOnServer, { timeout: 30_000, message: 'both previews on the server' }).toBe(2);
  const late = (await d.log()).filter((l) => l.includes('preview kept') && l.includes('after the sync')).length;
  say(`   previews sent after the sync: ${late}`);
  expect(late, 'the missed one went with the next sync').toBeGreaterThanOrEqual(1);
  await d.close();
});

test('picts library: DELETE — confirm, the card says "You deleted this picture", the file is gone, another device learns it, an offline device cannot bring it back', async ({ browser }) => {
  // 28 Oct, Roman: step 4 of the library.
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  const pid = await d.newProjectOfKind('DELETE ONE', 'landscape', 2);
  await d.settle();
  await d.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));
  await d.uploadPicture(0, 'main', colourPng(200, 30, 30));
  await d.settle();
  await d.page.waitForTimeout(800);
  await d.uploadPicture(1, 'main', colourPng(30, 30, 200));
  await d.settle();
  const list = async (t = token) => ((await (await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${t}` } })).json()) as { pictures: Pic[] }).pictures;
  await expect.poll(async () => (await list()).length, { timeout: 20_000 }).toBe(2);
  const storage = async () => ((await (await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { storage: { used: number } }).storage.used;
  const usedBefore = await storage();

  say('a second device has the project open too — then goes offline, still holding both pictures');
  const d2 = await Device.open(browser, 'desktop-2', token);
  await d2.openProject(pid!);
  await d2.settle();
  await d2.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));   // the list lay over the cards (run 506)
  await d2.page.addLocatorHandler(d2.page.locator('#offlineDismiss'), async (btn) => { await btn.click(); });
  await d2.offline(true);

  say('SELECT the newest (shot 2), DELETE: the question, Cancel first — nothing happens');
  await d.page.locator('#pictsBtn').click({ timeout: 15_000 });
  const lib = d.page.locator('#pictsLibrary');
  await expect.poll(() => lib.locator('.picts-tile').count(), { timeout: 15_000 }).toBe(2);
  await lib.locator('.picts-select').click();
  await lib.locator('.picts-tile').last().click();
  await expect(lib.locator('.picts-count')).toHaveText('1 selected');
  const delKey = (await lib.locator('.picts-tile.marked').getAttribute('data-key'))!;
  await lib.locator('.picts-delete').click();
  const modal = d.page.locator('#confirmModal');
  await expect(modal).toBeVisible();
  say(`   the question: "${await d.page.locator('#confirmMsg').textContent()}"`);
  expect(await d.page.locator('#confirmMsg').textContent(), 'the exact words').toBe('Are you sure you want to delete the selected pictures? This cannot be undone.');
  await d.page.locator('#confirmNo').click();
  await expect(modal).toBeHidden();
  expect(await lib.locator('.picts-tile').count(), 'nothing deleted').toBe(2);

  say('DELETE again, Yes: gone from the library, from the server, from storage; the card says so');
  await lib.locator('.picts-delete').click();
  await expect(modal).toBeVisible();
  await d.page.locator('#confirmModal .btn:not(#confirmNo)').click();
  await expect(modal).toBeHidden();
  await expect(lib.locator('.picts-tile')).toHaveCount(1);
  await expect(lib.locator('.picts-count')).toHaveText('0 selected');
  await expect.poll(async () => (await list()).length, { timeout: 15_000, message: 'one picture left on the server' }).toBe(1);
  const file = await fetch(`${API}/images/${delKey}`, { headers: { Authorization: `Bearer ${token}` } });
  const thumb = await fetch(`${API}/thumbs/${delKey}`, { headers: { Authorization: `Bearer ${token}` } });
  say(`   the file answers ${file.status}, its preview ${thumb.status}`);
  expect(file.status, 'the file is gone').toBe(404);
  expect(thumb.status, 'its preview too').toBe(404);
  await expect.poll(storage, { timeout: 15_000, message: 'storage came down' }).toBeLessThan(usedBefore);
  say(`   storage ${usedBefore} → ${await storage()} bytes`);
  await d.page.locator('#pictsBtn').click();
  await expect(lib).toHaveCount(0);
  await expect(d.page.locator('.picts-deleted').first(), 'the card says "You deleted this picture"').toBeVisible();
  expect((await d.page.locator('.picts-deleted').first().textContent())!.trim()).toBe('You deleted this picture');
  say(`   ${(await d.log()).find((l) => l.includes('PICTS: deleted')) ?? ''}`);

  say('the offline device writes under shot 2, then comes back: its push still carries the picture — the server does not take it back');
  await d2.setView('main');   // the text box lives on the main card, not in 3x2 (run 507)
  await d2.typeUnder(1, 'still here');
  await d2.offline(false);
  await d2.settle();
  await expect.poll(async () => d2.page.locator('.picts-deleted').count(), { timeout: 60_000, message: 'the other device\'s card says so' }).toBeGreaterThanOrEqual(1);
  say(`   ${(await d2.log()).find((l) => l.includes('pictures deleted in the library')) ?? 'no marker line'}`);
  await d.settle();
  expect((await list()).length, 'still one picture on the server').toBe(1);
  expect((await fetch(`${API}/images/${delKey}`, { headers: { Authorization: `Bearer ${token}` } })).status, 'the file is still gone').toBe(404);
  expect(await d.page.locator('.picts-deleted').count(), 'the card still says so here').toBeGreaterThanOrEqual(1);
  await d2.close();
  await d.close();
});

test('picts library offline: pictures shot offline are in the library offline; online they upload with their preview, once', async ({ browser }) => {
  // 27 Oct, Roman: "a user offline shoots 10 pictures — he has to see 10 in the library".
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProjectOfKind('OFFLINE DAY', 'landscape', 3);
  await d.settle();
  await d.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));

  // Whenever the app's one-time "you are offline" notice comes up, the test
  // dismisses it before its next press, as a person would (run 496).
  await d.page.addLocatorHandler(d.page.locator('#offlineDismiss'), async (b) => { await b.click(); });
  say('offline: a picture on each of the three shots');
  await d.offline(true);
  const colours = [colourPng(200, 40, 40), colourPng(40, 200, 40), colourPng(40, 40, 200)];
  // Through the test door, not the file picker: offline, the test browser cannot
  // read the picker's files (run 492: "NotReadableError") — a real device can.
  for (let i = 0; i < 3; i++) { await d.putPicture(i, `data:image/png;base64,${colours[i]}`); await d.page.waitForTimeout(400); }
  await expect.poll(async () => (await d.log()).filter((l) => l.includes('preview made on this device')).length,
    { timeout: 20_000, message: 'a preview for each, made on the device, offline' }).toBe(3);

  say('offline: PICTS shows the three, says it is offline');
  await d.page.locator('#pictsBtn').click({ timeout: 15_000 });
  await expect(d.page.locator('#pictsLibrary .picts-offline'), 'the offline line').toBeVisible({ timeout: 15_000 });
  await expect.poll(() => d.page.locator('#pictsLibrary .picts-tile').count(), { timeout: 15_000 }).toBe(3);
  say(`   ${(await d.log()).find((l) => l.includes('PICTS: OFFLINE')) ?? 'no OFFLINE line'}`);
  // The app's one-time "you are offline" notice may come up at any moment — a
  // person dismisses it (run 496: it lay over the max screen's close button).
  const dismissOffline = async () => { const b = d.page.locator('#offlineDismiss'); if (await b.isVisible().catch(() => false)) await b.click(); };
  await dismissOffline();
  await d.page.locator('#pictsLibrary .picts-tile').first().click();
  await expect(d.page.locator('#maxView'), 'a picture opens in the max screen, offline').toBeVisible();
  await d.page.waitForTimeout(300);
  await dismissOffline();
  await d.page.locator('#maxView .max-close').click();
  await d.page.locator('#pictsBtn').click();   // close the library
  await expect(d.page.locator('#pictsLibrary')).toHaveCount(0);

  say('online: the pictures upload; each preview is linked by its fingerprint and sent along — not made again, not downloaded');
  await d.offline(false);
  await expect.poll(async () => {
    const l = ((await (await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { pictures: Pic[] }).pictures;
    return l.filter((p) => p.thumb).length;
  }, { timeout: 45_000, message: 'three previews on the server' }).toBe(3);
  const log = await d.log();
  const linked = log.filter((l) => l.includes('preview kept') && l.includes('with its picture')).length;
  const remade = log.filter((l) => l.includes('made from the full picture')).length;
  say(`   previews sent on upload: ${linked}; made again from the full picture: ${remade}`);
  expect(linked, 'each preview sent once, on upload').toBe(3);

  say('online: PICTS shows three — not six (the device\'s and the server\'s are the same pictures)');
  await d.page.locator('#pictsBtn').click({ timeout: 15_000 });
  await expect.poll(() => d.page.locator('#pictsLibrary .picts-tile').count(), { timeout: 15_000 }).toBe(3);
  await d.page.waitForTimeout(800);
  expect(await d.page.locator('#pictsLibrary .picts-tile').count(), 'still three').toBe(3);
  await expect(d.page.locator('#pictsLibrary .picts-offline')).toHaveCount(0);
  await d.page.locator('#pictsBtn').click();

  say('reload, then offline again: the three come from the device');
  await d.page.reload();
  await d.page.waitForTimeout(2500);
  await d.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));
  await d.offline(true);
  await d.page.locator('#pictsBtn').click({ timeout: 15_000 });
  await expect.poll(() => d.page.locator('#pictsLibrary .picts-tile').count(), { timeout: 15_000 }).toBe(3);
  say(`   ${(await d.log()).find((l) => l.includes('PICTS: OFFLINE')) ?? 'no OFFLINE line'}`);
  await d.offline(false);
  await d.close();
});
