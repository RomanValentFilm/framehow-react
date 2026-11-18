// A CAMERA SERIES THE APP WAS CLOSED ON (18 November, job 2 of the list).
//
// A series is up to four shots with the camera open. Until DONE they are on no
// card and in no save. Roman's rule number 1 is "never lose work", and iOS does
// throw the page out under a heavy project — so each real photo is filed on the
// device the moment the camera hands it over, with a note saying whose it is,
// and a start that finds the note puts the shots on their card.
//
// The native camera cannot be played here. What it does at that moment — file
// the picture, write the note — is done through the same function it calls;
// then the page is reloaded, as iOS would have it:
//   · the three shots are on the shot's card after the start, as versions
//   · they are saved and sent: the server holds three pictures for the shot
//   · the note is gone, and another start does not put them there twice
//
//     npm run t -- -g "series left behind"

import { test, expect } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

const API = 'http://127.0.0.1:8787';

function noisePng(width: number, height: number): string {
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
  for (let y = 0; y < height; y++) for (let i = 1; i <= width * 4; i++) raw[y * (width * 4 + 1) + i] = (Math.random() * 256) | 0;
  return 'data:image/png;base64,' + Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

type Door = {
  leaveASeriesBehind(i: number, strip: string, fromMain: boolean, pictures: string[]): Promise<string[]>;
  seriesNotes(): Array<{ fid: number; strip: string; names: number; landed: boolean }>;
};
const door = (d: Device) => ({
  leave: (i: number, pics: string[]) => d.page.evaluate(([n, p]) =>
    (window as never as { __fh_test: Door }).__fh_test.leaveASeriesBehind(n as number, 'ver', false, p as string[]), [i, pics] as [number, string[]]),
  notes: () => d.page.evaluate(() => (window as never as { __fh_test: Door }).__fh_test.seriesNotes()),
});
const picturesOnServer = async (token: string, projectId: string): Promise<number> =>
  ((await (await fetch(`${API}/projects/${projectId}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { images: unknown[] }).images.length;
const versionsOfShot1 = async (d: Device): Promise<number> =>
  ((JSON.parse(await d.whole()) as { shots: Array<{ versions: Record<string, Array<{ picture: boolean }>> }> }).shots[0].versions['ver'] ?? [])
    .filter((v) => v.picture).length;

test('series left behind: shots taken with the camera open land at the next start, are sent, and never twice', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  const pid = await d.newProject('SERIES LEFT', 2);
  await d.settle();
  expect(await picturesOnServer(token, pid!), 'no picture yet').toBe(0);

  say('three shots are taken with the camera open: on the device, with their note, on no card');
  const names = await door(d).leave(0, [noisePng(48, 32), noisePng(48, 32), noisePng(48, 32)]);
  expect(names.length).toBe(3);
  const noted = await door(d).notes();
  say(`   the note: ${JSON.stringify(noted)}`);
  expect(noted.length, 'one series is noted').toBe(1);
  expect(noted[0].names, 'with its three shots').toBe(3);
  await d.page.waitForTimeout(1200);
  expect(await picturesOnServer(token, pid!), 'they are on no card: the server has none').toBe(0);

  say('the app is closed and started again');
  await d.reload();
  await expect.poll(async () => (await d.log()).some((l) => l.includes('shot(s) of a series that never landed are put on shot 1')),
    { timeout: 20_000, message: 'the start says it put the shots on their card' }).toBe(true);
  say(`   ${(await d.log()).find((l) => l.includes('of a series that never landed')) ?? ''}`);
  await expect.poll(() => versionsOfShot1(d), { timeout: 10_000, message: 'three versions with a picture on shot 1' }).toBe(3);
  expect((await door(d).notes()).length, 'the note is gone').toBe(0);

  say('they are saved and sent');
  await d.push().catch(() => undefined);
  await expect.poll(() => picturesOnServer(token, pid!), { timeout: 45_000, message: 'the server holds the three pictures' }).toBe(3);
  await d.settle();

  say('another start: nothing is put there twice');
  await d.reload();
  await d.page.waitForTimeout(3000);
  expect(await versionsOfShot1(d), 'still three versions with a picture').toBe(3);
  expect(await picturesOnServer(token, pid!), 'still three pictures on the server').toBe(3);

  await d.close();
});
