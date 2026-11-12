// A FETCH FOR THE OLD PROJECT MUST NOT LAND IN THE ONE BEING OPENED
// (Roman's phone, 12 November: "i tapped the screen while loading W7... and i
// think it mixed up the two projects!!!").
//
// Opening a project from the list puts the new project's shots on the screen
// first, then loads its pictures — twenty seconds for a big one — and only then
// calls it the open project. A fetch in that time was still for the OLD
// project: its answer was laid over the NEW project's shots, the new shots were
// "kept as local work" inside the old one, and both went on mixed (30 shots:
// 26 of WF 7 and 4 of "9x16 proj"; WF 7 turned upright). He had shot photos in
// the old project seconds before, so there was something to fetch.
//
// THE RULES IT HOLDS TO
//   · while a project is being opened, nothing is fetched for the old one —
//     not when asked by hand, not by the heartbeat
//   · after the opening: exactly the opened project's shots, its name, its pictures
//   · the old project, on the server and on another device, is untouched by it
//
//     npm run t -- e2e/68-fetch-while-opening.spec.ts

import { test, expect } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 240_000 });

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

const png = (n: number): string => `data:image/png;base64,${flatPng(8 + n, 4)}`;

test('a fetch while a project is being opened: the two projects are not mixed', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  say('BIG: three shots with a picture each. SMALL: two shots. The desktop ends in SMALL.');
  const bigId = await desktop.newProject('BIG', 3);
  await desktop.putPicture(0, png(1)); await desktop.putPicture(1, png(2)); await desktop.putPicture(2, png(3));
  await desktop.renameFrame(0, 'BIG ONE');
  await desktop.settle();
  const smallId = await desktop.newProject('SMALL', 2);
  await desktop.renameFrame(0, 'SMALL ONE');
  await desktop.settle();
  await desktop.reload();                       // (forgets the pictures it has in hand, so BIG's must be fetched)
  await desktop.settle();
  await tablet.openProject(smallId!);
  await tablet.settle();

  say('BIG\'s pictures are slow: the opening takes about eight seconds');
  await desktop.page.route('**/images/**', async (route) => {
    await new Promise((r) => setTimeout(r, 8_000));
    await route.continue();
  });
  void desktop.page.evaluate((pid) => { void (window as never as { __fh_test: { openProject(id: string): Promise<void> } }).__fh_test.openProject(pid as string); }, bigId!);
  await desktop.page.waitForTimeout(1_500);

  say('meanwhile the tablet changes SMALL — so there IS something to fetch for the old project');
  await tablet.renameFrame(1, 'FROM THE TABLET');
  await tablet.settle();

  say('…and the desktop is asked to fetch, in the middle of the opening (as the heartbeat did)');
  await desktop.startPullWithoutWaiting();
  await desktop.page.waitForTimeout(1_000);
  await desktop.startPullWithoutWaiting();

  say('the opening finishes');
  await expect.poll(async () => (await desktop.read()).projectName, { timeout: 60_000 }).toBe('BIG');
  await desktop.page.unroute('**/images/**');
  await desktop.settle();

  const now = await desktop.read();
  say(`   the desktop holds: ${now.frames.map((f) => f.label).join(', ')}`);
  expect(now.projectId, 'the open project is BIG').toBe(bigId);
  expect(now.frames.length, 'EXACTLY BIG\'S THREE SHOTS — nothing of SMALL among them').toBe(3);
  expect(now.frames.map((f) => f.label), 'BIG\'s own shot is there').toContain('BIG ONE');
  expect(now.frames.map((f) => f.label).join('|'), 'no shot of SMALL in BIG').not.toMatch(/SMALL ONE|FROM THE TABLET/);
  const log = (await desktop.log()).join('\n');
  expect(log, 'the fetch was turned away while the project was being opened').toMatch(/not fetching: a project is being opened|answer came back while another project was being opened/);

  say('SMALL is untouched by it: the tablet still holds its two shots, with its own change');
  const small = await tablet.read();
  expect(small.frames.length, 'SMALL has its two shots').toBe(2);
  expect(small.frames.map((f) => f.label)).toContain('FROM THE TABLET');

  say('and BIG is the same on the server: the tablet opens it and both agree');
  await tablet.openProject(bigId!);
  await tablet.settle();
  await Device.waitUntilWholeAgrees(desktop, tablet, 'BIG after the opening');
  expect((await tablet.read()).frames.length, 'BIG has three shots on the tablet too').toBe(3);

  say('SMALL once more, on the desktop: its two shots, the tablet\'s change arrived');
  await desktop.openProject(smallId!);
  await desktop.settle();
  const back = await desktop.read();
  expect(back.frames.length, 'SMALL has two shots on the desktop').toBe(2);
  expect(back.frames.map((f) => f.label)).toContain('FROM THE TABLET');

  await desktop.close();
  await tablet.close();
});
