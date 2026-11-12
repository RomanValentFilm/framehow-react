// THE DEVICE'S SAVE HOLDS NO PICTURE — EACH PICTURE IS ON THE DEVICE ONCE, BY
// ITSELF (Roman's phone, 12 November: a 26-shot project with hundreds of
// photos was saved as one block; iOS threw the page out the moment it was
// written, device storage went from 655 MB to 1941 MB in two minutes).
//
// THE RULES IT HOLDS TO
//   · after a save, the save on the device holds no picture: it names them
//   · every picture it names is on the device
//   · reading the save gives back every picture of the live project, to the byte count
//   · another picture, a rename, a picture taken away: the same holds each time
//   · iOS closing the databases behind the app changes nothing
//
// The logic itself (safety copies sharing pictures, removal only at a second
// look, saves from before this change) is driven in test/device-save-bench.ts.
//
//     npm run t -- e2e/67-pictures-by-themselves.spec.ts

import { test, expect, type Page } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, freshAccount, say } from './harness';

type Shape = { insideTheSave: number; namedByTheSave: number; onTheDevice: number; readBack: number; readBackLengths: number; live: number; liveLengths: number };
const shape = (page: Page): Promise<Shape> => page.evaluate(() =>
  (window as never as { __fh_test: { deviceSaveShape(): Promise<Shape> } }).__fh_test.deviceSaveShape());

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

/** A real, small picture that is a different one for each `n`. */
const png = (n: number): string => `data:image/png;base64,${flatPng(8 + n, 4)}`;

async function holds(page: Page, when: string, atLeast: number): Promise<void> {
  const s = await shape(page);
  say(`   ${when}: the save names ${s.namedByTheSave}, holds ${s.insideTheSave} inside; on the device ${s.onTheDevice}; live ${s.live}, read back ${s.readBack}`);
  expect(s.live, `${when}: the live project has its pictures`).toBeGreaterThanOrEqual(atLeast);
  expect(s.insideTheSave, `${when}: THE SAVE ON THE DEVICE HOLDS A PICTURE INSIDE IT`).toBe(0);
  expect(s.namedByTheSave, `${when}: the save names every picture of the project`).toBe(s.live);
  expect(s.onTheDevice, `${when}: every named picture is on the device`).toBeGreaterThanOrEqual(s.namedByTheSave);
  expect(s.readBack, `${when}: READING THE SAVE DOES NOT GIVE BACK EVERY PICTURE`).toBe(s.live);
  expect(s.readBackLengths, `${when}: …to the byte count`).toBe(s.liveLengths);
}

test('pictures by themselves: the device save names its pictures and reads back whole', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  await desktop.newProject('BY THEMSELVES', 3);
  await desktop.settle();

  say('two pictures go in');
  await desktop.putPicture(0, png(1));
  await desktop.putPicture(1, png(2));
  await desktop.settle();
  await holds(desktop.page, 'after two pictures', 2);

  say('a third, and a rename');
  await desktop.putPicture(2, png(3));
  await desktop.renameFrame(0, 'RENAMED');
  await desktop.settle();
  await holds(desktop.page, 'after a third and a rename', 3);

  say('iOS closes the databases behind the app; a fourth picture replaces the first');
  await desktop.page.evaluate(() => (window as never as { __fh_test: { closeDeviceStores(): Promise<void> } }).__fh_test.closeDeviceStores());
  await desktop.putPicture(0, png(4));
  await desktop.settle();
  await holds(desktop.page, 'after the databases were closed', 3);
  expect(await desktop.page.locator('#importantNote').count(), 'no COULD NOT SAVE notice').toBe(0);

  say('reload: the project comes back from the device with its pictures');
  await desktop.reload();
  await desktop.settle();
  await holds(desktop.page, 'after a reload', 3);

  await desktop.close();
});
