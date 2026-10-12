// THE WALL, THE CEILING, AND THE PICTURE THAT IS TOO LARGE (12 October, Roman).
//
// Roman: "how can I prevent being billed zillions?" Cloudflare never refuses
// storage, it bills — so the brake is ours, at the upload door:
//
//   THE WALL      an account may not pass its limit, orphans included — checked
//                 at the door itself, not only when a project is saved. Before
//                 today the door refused nothing but a single picture over 10 MB.
//   THE CEILING   the whole of Framehow may not pass the number Roman set.
//   TOO LARGE     a picture over 10 MB used to be refused in silence and stay on
//                 one device for ever; now the person is told, in a box.
//   THE RECOUNT   the nightly sweep lists the bucket and sets the figures to
//                 the truth; the analytics bar is drawn from them.
//
//     npm run t -- -g "ceiling"
//
// About a minute.

import { test, expect } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

const API = 'http://127.0.0.1:8787';
const ADMIN = 'e2e-admin';

function noisePngBuffer(width: number, height: number): Buffer {
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
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

async function figures(): Promise<{ total: number; ceiling: number; estimatedUsd: number; step: number }> {
  const res = await fetch(`${API}/analytics/storage?token=${ADMIN}&format=json`);
  expect(res.status, 'the figures answer').toBe(200);
  return await res.json() as { total: number; ceiling: number; estimatedUsd: number; step: number };
}

async function upload(token: string, png: Buffer, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${API}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png', ...headers },
    body: new Uint8Array(png),
  });
}

test('the ceiling: the wall holds at the door, the ceiling holds for everyone, a too-large picture is said, the night recounts', async ({ browser }) => {
  const { token } = await freshAccount();
  const png = noisePngBuffer(256, 200);           // ≈ 205 KB
  const KB = 1024;

  // ── THE WALL, AT THE DOOR ITSELF ────────────────────────────────────────
  // Straight at the upload door, the way a found door would be used — no
  // project, no save. The limit is lowered to 500 KB for this account.
  say('the wall: a 500 KB account takes two pictures and refuses the third, at the door');
  const wall = { 'X-FH-Storage-Limit-MB': '0.5' };
  const before = (await figures()).total;
  expect((await upload(token, png, wall)).status, 'the first goes in').toBe(201);
  expect((await upload(token, png, wall)).status, 'the second goes in').toBe(201);
  const third = await upload(token, png, wall);
  expect(third.status, 'the third is refused').toBe(413);
  const refused = await third.json() as { error: { code: string }; storage: { used: number; limit: number } };
  expect(refused.error.code, 'with the storage-full answer the app knows').toBe('storage_full');
  expect(refused.storage.used, 'and the account figure counts the orphans').toBeGreaterThanOrEqual(2 * png.length);
  const after = (await figures()).total;
  expect(after - before, 'the running total grew by exactly the two that went in').toBe(2 * png.length);

  // ── THE CEILING ─────────────────────────────────────────────────────────
  // The ceiling is set just above what Framehow holds now: one more picture
  // fits, the next does not — for this account, with room in its own wall.
  say('the ceiling: one more fits, the next is refused for everyone');
  const room = { 'X-FH-Storage-Limit-MB': '50', 'X-FH-Global-Limit-MB': String((after + png.length + 10 * KB) / (1024 * KB)) };
  expect((await upload(token, png, room)).status, 'fits under the ceiling').toBe(201);
  const over = await upload(token, png, room);
  expect(over.status, 'the next is refused').toBe(413);
  expect(((await over.json()) as { error: { code: string } }).error.code).toBe('storage_full');

  // ── TOO LARGE, IN THE APP ───────────────────────────────────────────────
  // A real picture over 10 MB, loaded the way a person loads one. The server
  // refuses it and the app says so in a box — it used to say nothing.
  say('the app: a picture over 10 MB is refused and the person is told');
  const desktop = await Device.open(browser, 'desktop', token, false);
  await desktop.newProject('BIG PICTURE', 1);
  await desktop.settle();
  const huge = noisePngBuffer(1800, 1500);        // ≈ 10.8 MB of noise
  expect(huge.length, 'the picture really is over 10 MB').toBeGreaterThan(10 * 1024 * KB);
  await desktop.uploadPictures(0, 'ver', [huge.toString('base64')]);
  await desktop.push();
  await expect(desktop.page.locator('#importantNote')).toBeVisible({ timeout: 60_000 });
  const said = await desktop.page.locator('#importantNote').innerText();
  expect(said, "Roman's wording").toContain('This picture exceeds the maximum limit of 10 MB per photo, please use smaller pictures.');
  await desktop.page.locator('#importantNote button').click();
  await desktop.close();

  // ── THE NIGHT RECOUNTS ──────────────────────────────────────────────────
  say('the night: the sweep lists the bucket and the figures match it');
  const sweep = await fetch(`${API}/__scheduled?cron=0+3+*+*+*`);
  expect(sweep.status, 'the sweep ran').toBe(200);
  const counted = await (await fetch(`${API}/analytics/dead-pictures?token=${ADMIN}&format=json`)).json() as { files: number; bytes: number };
  const f = await figures();
  say(`   bucket ${counted.bytes} bytes in ${counted.files} files · running total ${f.total} · ceiling ${f.ceiling} · $${f.estimatedUsd}/month`);
  expect(f.total, 'the running total equals the bucket').toBe(counted.bytes);
  expect(f.estimatedUsd, 'under 10 GB costs nothing').toBe(0);
  expect(f.step, 'and no step is reached').toBe(0);
});
