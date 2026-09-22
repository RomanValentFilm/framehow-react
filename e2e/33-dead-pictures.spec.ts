// THE DEAD-PICTURE CLEANER, COUNTING MODE (22 Sept).
//
// Roman: "we cannot ever lose real work." The cleaner only counts for now,
// and this test says what it must call dead and what it must not:
//
//   · a picture in a live project — in use
//   · a picture whose shot was deleted, but a restore point still holds it — in use
//   · a file uploaded and never attached to any shot — dead once it is a day old,
//     in use (young) before that
//
// Then DELETE MODE for this one account: the orphan goes, nothing else does,
// and restoring to the point still brings the deleted shot back with its
// picture — the cleaner touched nothing that anyone can get back to.
//
//     npm run t -- -g "dead pictures"
//
// About a minute.

import { test, expect } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

const API = 'http://127.0.0.1:8787';
const ADMIN = 'e2e-admin';      // the local worker's admin word (package.json dev:local)

function noisePng(width: number, height: number): Buffer {
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

interface Count { files: number; inUse: number; young: number; dead: number; deadKeys: string[]; restorePoints: number }

async function count(now?: number): Promise<Count> {
  const url = `${API}/analytics/dead-pictures?token=${ADMIN}&format=json${now ? `&now=${now}` : ''}`;
  const res = await fetch(url);
  expect(res.status, 'the count answers').toBe(200);
  return await res.json() as Count;
}

async function keysOf(token: string, projectId: string): Promise<string[]> {
  const tree = await (await fetch(`${API}/projects/${projectId}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json() as { images: Array<{ r2_key: string }> };
  return tree.images.map((i) => i.r2_key);
}

test('dead pictures: the count calls only the truly dead files dead, and a restore point keeps its picture', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token, false);

  say('desktop: project KEEP with three pictures');
  const keepId = await desktop.newProject('KEEP', 2);
  await desktop.settle();
  const png = () => noisePng(64, 48).toString('base64');
  await desktop.uploadPictures(0, 'ver', [png(), png()]);
  await desktop.uploadPictures(1, 'ver', [png()]);
  await desktop.settle();
  const allKeys = await keysOf(token, keepId!);
  expect(allKeys.length, 'three pictures on the server').toBe(3);

  say('desktop: a restore point, then shot 2 is deleted — its picture lives on only in the point');
  await desktop.saveRestorePoint('before the delete');
  await desktop.settle();
  const points = await desktop.restorePoints();
  const point = points.find((p) => p.label === 'before the delete') ?? points[0];
  expect(point, 'the restore point exists').toBeTruthy();
  await desktop.deleteFrame(1);
  await desktop.push();
  await desktop.settle();
  const liveKeys = await keysOf(token, keepId!);
  expect(liveKeys.length, 'two pictures left in the project').toBe(2);
  const pointOnly = allKeys.filter((k) => !liveKeys.includes(k));
  expect(pointOnly.length, 'one picture is held by the restore point alone').toBe(1);

  say('a file uploaded and never attached to a shot (what a refused push leaves behind)');
  const up = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' }, body: new Uint8Array(noisePng(64, 48)) });
  expect(up.status).toBe(201);
  const orphan = (await up.json() as { r2_key: string }).r2_key;

  // The local bucket keeps files from earlier runs (their rows are wiped at
  // start), so the counts are read by NAME, never as exact totals.
  say('the count, today: the orphan is young — not dead yet');
  const today = await count();
  expect(today.deadKeys, 'a file uploaded a moment ago is not dead').not.toContain(orphan);
  expect(today.young, 'the orphan is young').toBeGreaterThanOrEqual(1);
  expect(today.files).toBeGreaterThanOrEqual(4);

  say('the count, as if a day had passed: only the orphan is dead');
  const later = await count(Date.now() + 25 * 60 * 60 * 1000);
  say(`   files ${later.files} · in use ${later.inUse} · dead ${later.dead} · restore points ${later.restorePoints}`);
  expect(later.deadKeys, 'the orphan is dead').toContain(orphan);
  for (const k of liveKeys) expect(later.deadKeys, `a live picture is not dead: ${k}`).not.toContain(k);
  expect(later.deadKeys, 'the picture a restore point still holds is not dead').not.toContain(pointOnly[0]);
  expect(later.dead, 'the count agrees with the list').toBe(later.deadKeys.length);
  expect(later.restorePoints).toBeGreaterThanOrEqual(1);

  // ── DELETE MODE ── one account, decided afresh at that moment.
  say('DELETE the dead files of this account, as if a day had passed');
  const meId = orphan.split('/')[1];
  const del = await fetch(`${API}/analytics/dead-pictures/delete?format=json`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: ADMIN, owner: meId, now: String(Date.now() + 25 * 60 * 60 * 1000) }),
  });
  expect(del.status, 'the delete answers').toBe(200);
  const deleted = await del.json() as { deleted: number; keys: string[] };
  say(`   deleted ${deleted.deleted} file(s)`);
  expect(deleted.keys, 'the orphan was deleted').toContain(orphan);
  for (const k of liveKeys) expect(deleted.keys, `a live picture was NOT deleted: ${k}`).not.toContain(k);
  expect(deleted.keys, 'the restore point picture was NOT deleted').not.toContain(pointOnly[0]);
  for (const k of deleted.keys) expect(k.startsWith(`users/${meId}/`), `only this account's files: ${k}`).toBe(true);
  const after = await count(Date.now() + 25 * 60 * 60 * 1000);
  expect(after.deadKeys, 'the orphan is gone from the bucket').not.toContain(orphan);
  expect((await fetch(`${API}/images/${liveKeys[0]}`, { headers: { Authorization: `Bearer ${token}` } })).status, 'a live picture still serves').toBe(200);

  // ── THE NIGHTLY SWEEP ── the same cleaner, all accounts, real clock. A
  // second orphan uploaded a moment ago must survive it: the 24-hour rule.
  say('the 3 a.m. sweep runs now; a fresh orphan must survive it');
  const up2 = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' }, body: new Uint8Array(noisePng(64, 48)) });
  const orphan2 = (await up2.json() as { r2_key: string }).r2_key;
  const sweep = await fetch(`${API}/__scheduled?cron=0+3+*+*+*`);
  expect(sweep.status, 'the sweep ran').toBe(200);
  await new Promise((r) => setTimeout(r, 3_000));
  const afterSweep = await count();
  expect(afterSweep.young, 'the fresh orphan is still there, young').toBeGreaterThanOrEqual(1);
  const stillThere = await count(Date.now() + 25 * 60 * 60 * 1000);
  expect(stillThere.deadKeys, 'the fresh orphan was not deleted by the sweep').toContain(orphan2);
  expect((await fetch(`${API}/images/${liveKeys[0]}`, { headers: { Authorization: `Bearer ${token}` } })).status, 'a live picture still serves after the sweep').toBe(200);

  say('desktop: restore to the point — the deleted shot comes back with its picture');
  await desktop.restoreTo(point.id);
  await desktop.settle();
  const back = await keysOf(token, keepId!);
  expect(back, 'the picture is back in the project').toContain(pointOnly[0]);
  expect((await desktop.read()).frames.length, 'two shots again').toBe(2);
  // And the file itself is still there to serve.
  const img = await fetch(`${API}/images/${pointOnly[0]}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(img.status, 'the restored picture can be fetched').toBe(200);

  await desktop.close();
});
