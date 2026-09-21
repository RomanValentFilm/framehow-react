// THE ACCOUNT'S STORAGE (#533).
//
// Roman, 21 September: the beta has a limit per account. The user must see it
// coming — a notice at 80, 90 and 95 % — and the figure in the OPEN modal
// (grey below 80 %, red from 80 %). When the account is full the app says so
// once, the work stays safe on the device, pushes wait, and DELETE NOW in the
// project list frees a project's space at once — after which the waiting work
// goes up by itself.
//
// The simulator's worker honours a header that lowers the limit for one
// device, so the account fills in a minute with 200 KB pictures of noise.
//
//     npm run t -- -g "storage"
//
// About three minutes.

import { test, expect } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

// A PNG OF NOISE, STORED UNCOMPRESSED, so its size is what we say it is
// (256 × 200 × 4 bytes ≈ 200 KB). Random bytes so no two are the same file.
function noisePng(width: number, height: number): string {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc = (buf: Buffer): number => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;                                        // filter: none
    for (let i = 1; i <= width * 4; i++) raw[y * (width * 4 + 1) + i] = (Math.random() * 256) | 0;
  }
  const idat = zlib.deflateSync(raw, { level: 0 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

const LIMIT_MB = 6;
const PICTURE = () => noisePng(256, 200);   // ≈ 205 KB each

test('storage: the figure, the 80/90/95 % notices, full, DELETE NOW, and the waiting work goes up', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token, false, { storageLimitMb: LIMIT_MB });

  // ── A SMALL PROJECT TO DELETE LATER ─────────────────────────────────────
  say('desktop: project "OLD" with 5 pictures (about 1 MB)');
  const oldId = await desktop.newProject('OLD', 2);
  await desktop.settle();
  await desktop.uploadPictures(0, 'ver', [PICTURE(), PICTURE(), PICTURE(), PICTURE(), PICTURE()]);
  await desktop.settle();
  let st = await desktop.storage();
  expect(st.figure, 'the push answer must carry the storage figure').toBeTruthy();
  expect(st.figure!.limit, 'the simulator limit').toBe(LIMIT_MB * 1024 * 1024);
  expect(st.figure!.used, '5 pictures of ~205 KB').toBeGreaterThan(1_000_000);
  expect(st.noticedStep, 'no notice below 80 %').toBe(0);

  const line0 = await desktop.readStorageLine();
  expect(line0.text).toMatch(/^Storage \d+(\.\d)? of 6 MB · \d+ %$/);
  expect(line0.red, 'grey below 80 %').toBe(false);

  // ── THE BIG PROJECT ──────────────────────────────────────────────────────
  say('desktop: project "BIG" — 20 pictures at once → past 80 %');
  const bigId = await desktop.newProject('BIG', 3);
  await desktop.settle();
  // The iPad is on BIG too, so a sync can land while the desktop's picker is open.
  const ipad = await Device.open(browser, 'ipad', token, true, { storageLimitMb: LIMIT_MB });
  await ipad.openProject(bigId!);
  await ipad.settle();
  const twenty = Array.from({ length: 20 }, PICTURE);
  await desktop.uploadPicturesDuringPull(0, 'ver', twenty, ipad);
  await desktop.settle();
  const wholeAfter = JSON.parse(await desktop.whole()) as { shots: Array<{ versions: Record<string, unknown[]> }> };
  expect(wholeAfter.shots[0].versions['ver']?.length ?? 0, 'the 20 pictures must land despite the pull').toBeGreaterThanOrEqual(20);
  await desktop.page.waitForFunction(() => {
    const s = (window as never as { __fh_test: { storage(): { noticedStep: number } } }).__fh_test.storage();
    return s.noticedStep >= 80;
  }, undefined, { timeout: 60_000 });
  st = await desktop.storage();
  say(`   used ${(st.figure!.used / 1048576).toFixed(2)} MB — step ${st.noticedStep}`);
  expect(st.noticedStep, 'the 80 % notice').toBe(80);
  const lineHigh = await desktop.readStorageLine();
  expect(lineHigh.red, 'red from 80 %').toBe(true);

  say('desktop: 3 more → past 90 %');
  await desktop.uploadPictures(1, 'ver', [PICTURE(), PICTURE(), PICTURE()]);
  await desktop.settle();
  await desktop.page.waitForFunction(() =>
    (window as never as { __fh_test: { storage(): { noticedStep: number } } }).__fh_test.storage().noticedStep >= 90,
    undefined, { timeout: 60_000 });
  st = await desktop.storage();
  say(`   used ${(st.figure!.used / 1048576).toFixed(2)} MB — step ${st.noticedStep}`);
  expect(st.noticedStep, 'the 90 % notice').toBe(90);

  say('desktop: 2 more → past 95 %');
  await desktop.uploadPictures(2, 'ver', [PICTURE(), PICTURE()]);
  await desktop.settle();
  await desktop.page.waitForFunction(() =>
    (window as never as { __fh_test: { storage(): { noticedStep: number } } }).__fh_test.storage().noticedStep >= 95,
    undefined, { timeout: 60_000 });
  st = await desktop.storage();
  say(`   used ${(st.figure!.used / 1048576).toFixed(2)} MB — step ${st.noticedStep}`);
  expect(st.noticedStep, 'the 95 % notice').toBe(95);
  expect(st.full, 'not full yet').toBe(false);
  const usedBeforeFull = st.figure!.used;

  // ── FULL ────────────────────────────────────────────────────────────────
  say('desktop: one more → the server says FULL; the work stays on the device');
  const markFull = await desktop.mark();
  await desktop.uploadPictures(2, 'ver', [PICTURE()]);
  await desktop.waitForLogAfter(markFull, 'storage FULL', 60_000);
  st = await desktop.storage();
  expect(st.full, 'the app knows it is full').toBe(true);
  // The STORAGE FULL note is on screen, and behind it the project list opened by itself.
  await expect(desktop.page.getByText('STORAGE FULL', { exact: true })).toBeVisible({ timeout: 10_000 });
  await desktop.page.getByRole('button', { name: 'GOT IT' }).click();
  await expect(desktop.page.locator('#projectListModal')).toBeVisible({ timeout: 10_000 });
  await desktop.page.locator('#projectListClose').click();
  // Left alone, it must not keep asking: the retry holds while full.
  const markHold = await desktop.mark();
  await desktop.page.waitForTimeout(12_000);
  const since = (await desktop.log()).length - markHold.length;
  const asks = (await desktop.log()).slice(0, Math.max(since, 0)).filter((l) => l.includes('retry push start')).length;
  expect(asks, 'no retry while the account is full').toBe(0);
  expect((await desktop.read()).frames.length, 'nothing lost on screen').toBe(3);

  // ── DELETE NOW ──────────────────────────────────────────────────────────
  say('desktop: DELETE NOW on "OLD" — space at once, and the waiting picture goes up by itself');
  const markFreed = await desktop.mark();
  await desktop.deleteProjectNow(oldId!);
  await desktop.waitForLogAfter(markFreed, 'room again', 30_000);
  await desktop.waitForLogAfter(markFreed, 'push OK', 60_000);
  await desktop.settle();
  st = await desktop.storage();
  say(`   used ${(st.figure!.used / 1048576).toFixed(2)} MB — full=${st.full}`);
  expect(st.full, 'room again').toBe(false);
  expect(st.figure!.used, 'the 26th picture went up; OLD is gone').toBeGreaterThan(usedBeforeFull - 1_100_000);
  expect(st.figure!.used).toBeLessThan(LIMIT_MB * 1024 * 1024);

  // The server agrees: OLD is gone for good, BIG holds every picture.
  const listed = await Device.projectsWithState(token);
  expect(listed.map((p) => p.name), 'OLD gone for good, not just deleted').toEqual(['BIG']);
  const tree = await (await fetch(`http://127.0.0.1:8787/projects/${bigId}`, { headers: { Authorization: `Bearer ${token}` } })).json() as { images: unknown[] };
  expect(tree.images.length, '26 pictures on the server').toBe(26);

  // The other device sees the same figure from the list alone.
  const ipadLine = await ipad.readStorageLine();
  expect(ipadLine.red, 'still above 80 %').toBe(true);
  expect(ipadLine.text).toMatch(/of 6 MB/);

  await desktop.close();
  await ipad.close();
});
