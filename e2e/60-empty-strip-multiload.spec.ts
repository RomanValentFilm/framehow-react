// SEVERAL PICTURES INTO AN EMPTY VERSION STRIP (G1, 9 November).
//
// An old note (TOMORROW "SOON 4") said: loaded into an EMPTY version strip,
// the pictures landed in v2 onwards and v1 stayed empty. Nobody has looked
// since several changes to the load path. This asks the question plainly:
// three files on an untouched VERSN strip → exactly three versions, v1 v2 v3,
// every one with a picture, none empty — on the desktop and on the iPad.
//
//     npm run t -- -g "empty strip"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';
import * as zlib from 'zlib';

/** A BIG first picture (10 Nov, Roman's iPhone): a phone photo takes long to
 *  read, the small ones after it finish first — and the first one, arriving
 *  last, used to open a FOURTH version and leave v1 empty. A noise PNG is slow
 *  to read; the tiny ones are instant. */
function slowPng(width: number, height: number): string {
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
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; for (let i = 1; i <= width * 4; i++) raw[y * (width * 4 + 1) + i] = (Math.random() * 256) | 0; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

test.describe.configure({ timeout: 180_000 });

const PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

type Whole = { shots: Array<{ versions: Record<string, Array<{ label: string; picture: boolean }>> }> };

test('empty strip: three pictures loaded at once fill v1, v2, v3 — none stays empty, on both devices', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('EMPTY STRIP', 2);
  await desktop.settle();
  expect(pid).toBeTruthy();
  const ipad = await Device.open(browser, 'ipad', token, true);
  await ipad.openProject(pid!);
  await ipad.settle();

  say('desktop: three pictures at once onto the untouched VERSN strip of shot 1 — the FIRST a big, slow one');
  await desktop.uploadPictures(0, 'ver', [slowPng(1500, 1100), PICTURE, PICTURE]);
  await desktop.page.waitForTimeout(5000);
  await desktop.push();
  await desktop.settle();

  const mine = JSON.parse(await desktop.whole()) as Whole;
  const vers = mine.shots[0].versions.ver ?? [];
  say(`   desktop versions: ${vers.map((v) => `${v.label}${v.picture ? '●' : '○'}`).join(' ')}`);
  expect(vers.map((v) => v.label), 'exactly three versions').toEqual(['v1', 'v2', 'v3']);
  expect(vers.every((v) => v.picture), 'V1 STAYED EMPTY (G1) — every version must carry a picture').toBe(true);

  say('the iPad sees the same three, each with its picture');
  await ipad.nudge();
  await ipad.settle();
  await expect.poll(async () => {
    const w = JSON.parse(await ipad.whole()) as Whole;
    return (w.shots[0]?.versions.ver ?? []).map((v) => `${v.label}${v.picture ? '●' : '○'}`).join(' ');
  }, { timeout: 60_000, message: 'the iPad has v1● v2● v3●' }).toBe('v1● v2● v3●');

  say('shot 2: a picture on v1, DELETE that only version (a blank stands in), then three pictures at once');
  await desktop.uploadPicture(1, 'ver', PICTURE);
  await desktop.page.waitForTimeout(1500);
  await desktop.deleteVersion(1, 'ver', 0);
  expect(await desktop.versionLabels(1, 'ver'), 'one blank version stands in its place').toHaveLength(1);
  await desktop.uploadPictures(1, 'ver', [PICTURE, PICTURE, PICTURE]);
  await desktop.page.waitForTimeout(2000);
  await desktop.push();
  await desktop.settle();
  const after = (JSON.parse(await desktop.whole()) as Whole).shots[1].versions.ver ?? [];
  say(`   shot 2 versions: ${after.map((v) => `${v.label}${v.picture ? '●' : '○'}`).join(' ')}`);
  expect(after.map((v) => `${v.label}${v.picture ? '●' : '○'}`), 'after a delete the blank v1 takes the first picture, the rest follow').toEqual(['v1●', 'v2●', 'v3●']);
  await ipad.nudge();
  await ipad.settle();
  await expect.poll(async () => {
    const w = JSON.parse(await ipad.whole()) as Whole;
    return (w.shots[1]?.versions.ver ?? []).map((v) => `${v.label}${v.picture ? '●' : '○'}`).join(' ');
  }, { timeout: 60_000, message: 'the iPad agrees on shot 2' }).toBe('v1● v2● v3●');

  await desktop.close();
  await ipad.close();
});
