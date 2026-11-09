// A LOADED PICTURE IS SHRUNK LIKE A CAMERA'S (A12, 9 November — privacy).
//
// LOAD, Load Images from Folder and drag-and-drop used to store the file as it
// was: a 12-megapixel photo at full size, EXIF and GPS inside. Only the cameras
// shrank to 2400. Now every picture goes the same way: long side at most
// 2400 px, shape kept, re-encoded (metadata gone); a small picture stays as it is.
//
// A 3000×60 PNG goes onto the main card and onto a version strip; what the
// server holds must be 2400×48. A 400×30 one must come out 400×30.
//
//     npm run t -- -g "loaded picture"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

const API = 'http://127.0.0.1:8787';

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

/** Width and height of a PNG or JPEG file, read from its header. */
function sizeOf(buf: Buffer): { w: number; h: number; kind: string } {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), kind: 'PNG' };
  // JPEG: walk the segments to the first SOF
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), kind: 'JPEG' };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: 0, h: 0, kind: '?' };
}

async function filesOnServer(token: string, projectId: string): Promise<Array<{ w: number; h: number; kind: string; bytes: number }>> {
  const tree = await (await fetch(`${API}/projects/${projectId}/sync`, { headers: { Authorization: `Bearer ${token}` } }))
    .json() as { images: Array<{ r2_key: string }> };
  const out = [];
  for (const img of tree.images) {
    const res = await fetch(`${API}/images/${img.r2_key}`, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await res.arrayBuffer());
    out.push({ ...sizeOf(buf), bytes: buf.length });
  }
  return out;
}

test('loaded picture: a wide picture is shrunk to 2400 on the long side, a small one stays as it is', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('LOADED SIZE', 2);
  await desktop.settle();
  expect(pid).toBeTruthy();

  say('desktop: a 3000×60 picture on shot 1 (main) and a 400×30 one on shot 2 (ver)');
  await desktop.uploadPicture(0, 'main', flatPng(3000, 60));
  await desktop.page.waitForTimeout(1500);
  await desktop.push();
  await desktop.settle();
  await desktop.uploadPicture(1, 'ver', flatPng(400, 30));
  await desktop.page.waitForTimeout(1500);
  await desktop.push();
  await desktop.settle();

  const t0 = Date.now();
  let files = await filesOnServer(token, pid!);
  while (files.length < 2 && Date.now() - t0 < 20_000) { await desktop.page.waitForTimeout(1000); files = await filesOnServer(token, pid!); }
  for (const f of files) say(`   on the server: ${f.kind} ${f.w}×${f.h}, ${f.bytes} bytes`);
  expect(files.length, 'both pictures on the server').toBe(2);
  const sizes = files.map((f) => `${f.w}x${f.h}`).sort();
  expect(sizes, 'THE WIDE PICTURE WENT UP AT FULL SIZE (A12) — a loaded picture must be shrunk to 2400 like a camera photo; the small one untouched')
    .toEqual(['2400x48', '400x30']);
  expect(files.every((f) => f.kind === 'PNG'), 'PNG stays PNG').toBe(true);

  await desktop.close();
});
