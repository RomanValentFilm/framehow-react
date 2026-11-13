// LAZY LOADING, HALF 1 (13 November).
//
// Roman: "someone in the office loads a big project and walks out — he needs to
// be sure that he has all the 200 pictures with him." And he must be IN the
// project at once, not behind a curtain until the last picture has arrived.
//
// THE RULES IT HOLDS TO
//   · opening returns when the shots are on the screen; the pictures follow
//   · while they come: a bar along the bottom edge counts them, previews stand
//     on the cards, and the person can work — a name changed and a photo put on
//     a card in that time are kept, and the old picture arriving late does not
//     cover the new photo
//   · when every picture is here the bar is gone, the project is not marked as
//     changed by the arriving pictures, and the other device agrees
//   · no connection in the middle: the bar says how many are on this device;
//     with the line back it goes on to the end — no picture is given up
//   · the app closed in the middle: it starts again IN that project and fetches
//     what was still missing
//
//     npm run t -- e2e/70-lazy-loading.spec.ts

import { test, expect } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 420_000 });

/** A flat grey PNG of any size — a few hundred bytes however wide. */
function flatPng(width: number, height: number): string {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  const crc = (buf: Buffer): number => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;   // 8-bit RGB
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

const png = (n: number): string => `data:image/png;base64,${flatPng(40 + n, 30)}`;

type ToCome = { arriving: { done: number; total: number } | null; bar: string | null; standIns: number; mains: number[] };
const toCome = (d: Device): Promise<ToCome> =>
  d.page.evaluate(() => (window as never as { __fh_test: { picturesStillToCome(): Promise<ToCome> } }).__fh_test.picturesStillToCome());
const openAndBeIn = (d: Device, id: string): Promise<void> =>
  d.page.evaluate((pid) => (window as never as { __fh_test: { openProjectAndBeIn(i: string): Promise<void> } }).__fh_test.openProjectAndBeIn(pid as string), id);
/** Every picture takes this long from here on (a GET — nothing is lost on the way). */
async function slowPictures(d: Device, ms: number): Promise<void> {
  await d.page.route('**/images/**', async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue().catch(() => undefined);
  });
}

async function makeBig(desktop: Device): Promise<{ bigId: string; smallId: string }> {
  say('BIG: six shots with a picture each; SMALL: two shots');
  const bigId = await desktop.newProject('BIG', 6);
  for (let i = 0; i < 6; i++) await desktop.putPicture(i, png(i + 1));
  await desktop.renameFrame(0, 'BIG ONE');
  await desktop.settle();
  await desktop.push();
  await desktop.settle();
  const smallId = await desktop.newProject('SMALL', 2);
  await desktop.renameFrame(0, 'SMALL ONE');
  await desktop.settle();
  await desktop.push();
  await desktop.settle();
  await desktop.reload();                       // (forgets the pictures it has in hand, so BIG's must be fetched)
  await desktop.settle();
  return { bigId: bigId!, smallId: smallId! };
}

test('lazy loading: in at once, the bar counts, work done meanwhile is kept, every picture arrives', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);
  const { bigId } = await makeBig(desktop);

  say('BIG is opened; each of its pictures takes four seconds');
  await slowPictures(desktop, 4_000);
  const began = Date.now();
  await openAndBeIn(desktop, bigId);
  const took = Date.now() - began;
  say(`   in after ${took} ms`);
  expect(took, 'IN AT ONCE — the opening does not wait for the pictures').toBeLessThan(3_500);
  let now = await desktop.read();
  expect(now.projectId, 'the open project is BIG').toBe(bigId);
  expect(now.frames.length, 'its six shots are on the screen').toBe(6);

  let coming = await toCome(desktop);
  say(`   the bar: "${coming.bar}" · previews standing in: ${coming.standIns}`);
  expect(coming.arriving, 'pictures are still to come').not.toBeNull();
  expect(coming.arriving!.total, 'all six are counted').toBe(6);
  expect(coming.bar ?? '', 'THE BAR COUNTS THEM').toMatch(/^Loading pictures \d+ \/ 6$/);
  expect(coming.mains.filter((n) => n > 0).length, 'no sharp picture yet').toBe(0);
  await expect.poll(async () => (await toCome(desktop)).standIns, { timeout: 3_500, message: 'PREVIEWS STAND ON THE CARDS' }).toBeGreaterThan(0);

  say('work, while they come: a name, and a new photo on shot 3');
  await desktop.renameFrame(1, 'WORKED AT ONCE');
  await desktop.putPicture(2, png(30));
  const mine = (await toCome(desktop)).mains[2];
  expect(mine, 'the new photo is on shot 3').toBeGreaterThan(0);

  say('every picture arrives; the bar goes');
  await expect.poll(async () => (await toCome(desktop)).bar, { timeout: 90_000 }).toBeNull();
  await desktop.page.unroute('**/images/**');
  coming = await toCome(desktop);
  expect(coming.arriving, 'nothing is still to come').toBeNull();
  expect(coming.mains.filter((n) => n > 0).length, 'ALL SIX SHOTS HAVE THEIR PICTURE').toBe(6);
  expect(coming.mains[2], 'THE NEW PHOTO ON SHOT 3 WAS NOT COVERED BY THE OLD ONE ARRIVING LATE').toBe(mine);
  expect(coming.standIns, 'no preview is left standing in').toBe(0);
  const log = (await desktop.log()).join('\n');
  expect(log).toMatch(/shot\(s\) on the screen — 6 picture\(s\) follow in the background/);
  expect(log).toMatch(/every picture of the project is on this device/);

  say('the work done meanwhile goes up, and the tablet agrees — BIG is whole there too');
  await desktop.push();
  await desktop.settle();
  now = await desktop.read();
  expect(now.frames.map((f) => f.label)).toContain('WORKED AT ONCE');
  await tablet.openProject(bigId);
  await tablet.settle();
  await Device.waitUntilWholeAgrees(desktop, tablet, 'BIG after lazy loading');
  expect((await toCome(tablet)).mains.filter((n) => n > 0).length, 'six pictures on the tablet').toBe(6);

  await desktop.close();
  await tablet.close();
});

test('lazy loading: no connection in the middle — the bar says so, and it goes on to the end', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const { bigId } = await makeBig(desktop);

  await slowPictures(desktop, 3_000);
  await openAndBeIn(desktop, bigId);
  say('the line goes while the pictures come');
  await desktop.offline(true);
  await expect.poll(async () => (await toCome(desktop)).bar ?? '', { timeout: 20_000 }).toMatch(/^Offline — \d+ of 6 pictures on this device$/);
  await desktop.page.waitForTimeout(6_000);
  let coming = await toCome(desktop);
  say(`   the bar: "${coming.bar}"`);
  expect(coming.arriving, 'THE BAR STAYS — nothing is given up').not.toBeNull();
  expect((await desktop.read()).projectId, 'BIG is still the open project').toBe(bigId);

  say('the line is back: it goes on by itself');
  await desktop.page.unroute('**/images/**');
  await desktop.offline(false);
  await expect.poll(async () => (await toCome(desktop)).bar, { timeout: 120_000 }).toBeNull();
  coming = await toCome(desktop);
  expect(coming.mains.filter((n) => n > 0).length, 'ALL SIX PICTURES ARE HERE').toBe(6);
  await desktop.close();
});

test('lazy loading: the app is closed while the pictures come — it starts in that project and fetches the rest', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const { bigId } = await makeBig(desktop);

  await slowPictures(desktop, 20_000);
  await openAndBeIn(desktop, bigId);
  await desktop.page.waitForTimeout(3_000);     // (the device has saved BIG by now — its shots, no picture yet)
  expect((await toCome(desktop)).mains.filter((n) => n > 0).length, 'no picture has arrived').toBe(0);
  say('the app is closed and opened again');
  await desktop.page.unroute('**/images/**');
  await desktop.reload();
  await desktop.settle();

  const now = await desktop.read();
  expect(now.projectId, 'IT STARTS IN BIG').toBe(bigId);
  expect(now.frames.length, 'with its six shots').toBe(6);
  await expect.poll(async () => (await toCome(desktop)).mains.filter((n) => n > 0).length, { timeout: 90_000, message: 'THE MISSING PICTURES ARE FETCHED' }).toBe(6);
  await expect.poll(async () => (await toCome(desktop)).bar, { timeout: 30_000 }).toBeNull();
  await desktop.close();
});
