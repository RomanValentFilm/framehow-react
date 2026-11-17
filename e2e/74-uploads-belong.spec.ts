// PICTURES THAT GO UP BELONG SOMEWHERE (17 November, job 1).
//
// Roman's phone, 16 Nov: FILL 25 four times while signed in — 100 pictures in
// a few minutes into a nearly full account. The log said "picture upload
// failed (status 429)" and "picture refused: storage full"; the account stood
// at 516 of 500 MB; and after Delete now on the project, 125 pictures were
// still in the library, on no card, counted in the storage.
//
// Read in the code, the cause was one thing with three faces:
//   · every picture of a save went up AT THE SAME MOMENT, and when one failed
//     the save failed — and the retry sent ALL of them again. The first copies
//     stayed on the server, owned by nothing.
//   · those pictures arriving together each read the same storage figure, so
//     all of them passed the wall.
//   · a 429 ("too many at once") was a failure like any other.
//
// Four plays, one for each cure:
//   1. one of five uploads fails → the retry sends ONE picture, not five
//   2. "too many pictures" (429) is waited out; the save does not fail
//   3. pictures arriving together cannot pass the wall
//   4. Delete now takes the pictures sent for the project that never got onto
//      a card — and only that project's
//
//     npm run t -- -g "uploads belong"
//
// About two minutes.

import { test, expect } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

const API = 'http://127.0.0.1:8787';
const UPLOAD = /127\.0\.0\.1:8787\/upload(\?|$)/;

/** A PNG of noise, stored uncompressed: its size is what we say, and no two are the same file. */
function noisePng(width: number, height: number): Buffer {
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
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let i = 1; i <= width * 4; i++) raw[y * (width * 4 + 1) + i] = (Math.random() * 256) | 0;
  }
  const idat = zlib.deflateSync(raw, { level: 0 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const png = () => noisePng(64, 48).toString('base64');

type Pic = { key: string; size: number; thumb?: boolean };
const folderOf = async (token: string): Promise<Pic[]> =>
  ((await (await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { pictures: Pic[] }).pictures;
const usedOf = async (token: string): Promise<number> =>
  ((await (await fetch(`${API}/user/storage`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { storage: { used: number } }).storage.used;
const cardsOf = async (token: string, projectId: string): Promise<string[]> =>
  ((await (await fetch(`${API}/projects/${projectId}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { images: Array<{ r2_key: string }> })
    .images.map((i) => i.r2_key);

test('uploads belong: one of five fails — the retry sends the one, not all five again', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('ONE OF FIVE', 1);
  await desktop.settle();

  say('the third picture that arrives is refused once (a server hiccup); the others go through');
  let seen = 0, through = 0;
  await desktop.page.route(UPLOAD, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    seen++;
    if (seen === 3) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'hiccup', message: 'try later' } }) });
    through++;
    return route.continue();
  });

  say('desktop: five pictures at once on shot 1 — the app saves by itself, the save fails, and it tries again by itself');
  // (the mark is taken BEFORE the pictures: the app pushes the moment they land — run 778)
  const before = await desktop.mark();
  await desktop.uploadPictures(0, 'ver', [png(), png(), png(), png(), png()]);
  await desktop.waitForLogAfter(before, 'push FAILED', 30_000);
  const afterFail = await desktop.mark();
  say(`   first try: the save failed (${(afterFail.slice(before.length).find((l) => l.includes('picture upload failed')) ?? '').trim()})`);

  say('the next push: only the missing picture goes up');
  if (!afterFail.slice(before.length).some((l) => l.includes('push OK'))) {
    await desktop.push().catch(() => undefined);
    await desktop.waitForLogAfter(afterFail, 'push OK', 30_000);
  }
  await desktop.settle();
  say(`   ${seen} sent in all, ${through} arrived`);
  const line = (await desktop.log()).find((l) => l.includes('were on the server already from an earlier try'));
  say(`   ${line ?? 'NO "already on the server" LINE'}`);
  expect(seen, 'THE RETRY SENT PICTURES AGAIN THAT HAD ALREADY ARRIVED — the first copies stay on the server, owned by nothing').toBe(6);
  expect(line, 'the log says four were taken from the server').toContain('4 picture(s) were on the server already');
  const cards = await cardsOf(token, pid!);
  expect(cards.length, 'five pictures on five cards').toBe(5);
  await expect.poll(async () => (await folderOf(token)).filter((p) => !cards.includes(p.key)).length,
    { timeout: 15_000, message: 'no picture in the account that no card names' }).toBe(0);
  expect((await folderOf(token)).length, 'five files, not nine').toBe(5);

  await desktop.close();
});

test('uploads belong: "too many pictures at once" (429) is waited out — the save does not fail', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('TOO MANY', 1);
  await desktop.settle();

  say('the server answers 429 to the first two pictures that arrive');
  let refused = 0;
  await desktop.page.route(UPLOAD, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (refused < 2) {
      refused++;
      return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'rate_limited', message: 'Too many pictures at once. Please wait a moment.' } }) });
    }
    return route.continue();
  });
  await desktop.page.evaluate(() => { (window as never as { __fh_uploadDoorWaitMs: number }).__fh_uploadDoorWaitMs = 1_500; });   // (15 s in the app)

  say('desktop: three pictures on shot 1 — the app saves by itself');
  // (the mark is taken BEFORE the pictures: the app pushes the moment they land — run 778)
  const before = await desktop.mark();
  await desktop.uploadPictures(0, 'ver', [png(), png(), png()]);
  await desktop.waitForLogAfter(before, 'the server takes no more pictures this minute', 30_000);
  await desktop.waitForLogAfter(before, 'push OK', 60_000);
  await desktop.settle();
  const after = (await desktop.log()).slice(before.length);
  expect(after.some((l) => l.includes('push FAILED')), 'the save did not fail').toBe(false);
  expect(refused, 'two were refused first').toBe(2);
  expect((await cardsOf(token, pid!)).length, 'all three pictures are on their cards').toBe(3);
  expect((await folderOf(token)).length, 'three files').toBe(3);

  await desktop.close();
});

test('uploads belong: pictures arriving together cannot pass the wall', async () => {
  const { token } = await freshAccount();
  const one = noisePng(64, 48);
  const LIMIT_MB = (one.byteLength * 5 + 100) / (1024 * 1024);     // room for exactly five
  say(`twelve pictures of ${one.byteLength} bytes at the same moment, room for five`);
  const answers = await Promise.all(Array.from({ length: 12 }, () =>
    fetch(`${API}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png', 'X-FH-Storage-Limit-MB': String(LIMIT_MB) },
      body: new Uint8Array(noisePng(64, 48)),
    }).then((r) => r.status)));
  const took = answers.filter((s) => s === 201).length;
  const full = answers.filter((s) => s === 413).length;
  const used = await usedOf(token);
  say(`   ${took} taken, ${full} refused as full; the account holds ${used} bytes of ${Math.round(LIMIT_MB * 1024 * 1024)}`);
  expect(took, 'exactly as many as there is room for').toBe(5);
  expect(full, 'the rest are told the storage is full').toBe(7);
  expect(used, 'the figure is what was taken').toBe(one.byteLength * 5);
  expect((await folderOf(token)).length, 'five files in the folder').toBe(5);
});

test('uploads belong: Delete now takes the pictures sent for the project that never got onto a card — and only that project\'s', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  say('desktop: project STAYS with one picture');
  const staysId = await desktop.newProject('STAYS', 1);
  await desktop.settle();
  await desktop.uploadPicture(0, 'main', png());
  await desktop.push();
  await desktop.settle();
  const staysKeys = await cardsOf(token, staysId!);
  expect(staysKeys.length).toBe(1);

  say('desktop: project GOING with one picture on a card');
  const goingId = await desktop.newProject('GOING', 1);
  await desktop.settle();
  await desktop.uploadPicture(0, 'main', png());
  await desktop.push();
  await desktop.settle();
  expect((await cardsOf(token, goingId!)).length).toBe(1);

  say('the SAVE of GOING is cut; three more pictures go up and never reach a card');
  const cut = (r: { request(): { method(): string }; abort(code: string): Promise<void>; continue(): Promise<void> }) =>
    (r.request().method() === 'POST' ? r.abort('connectionfailed') : r.continue());
  await desktop.page.route('**/127.0.0.1:8787/projects/*/sync*', cut);
  await desktop.uploadPictures(0, 'ver', [png(), png(), png()]);
  await desktop.page.waitForTimeout(1500);
  const before = await desktop.mark();
  await desktop.push().catch(() => undefined);
  await desktop.waitForLogAfter(before, 'push FAILED', 30_000);
  await expect.poll(async () => (await folderOf(token)).length, { timeout: 15_000, message: 'five files on the server: two on cards, three on none' }).toBe(5);
  expect((await cardsOf(token, goingId!)).length, 'GOING still has one picture on a card').toBe(1);
  // (the save stays cut until the project is gone — a retry must not put them on cards first)

  say('DELETE NOW on GOING: its card\'s picture AND the three that never got onto a card go');
  await desktop.deleteProjectNow(goingId!);
  await expect.poll(async () => (await folderOf(token)).map((p) => p.key).sort().join(','),
    { timeout: 20_000, message: 'only the picture of STAYS is left in the account' }).toBe(staysKeys.slice().sort().join(','));
  await desktop.page.unroute('**/127.0.0.1:8787/projects/*/sync*');
  expect((await fetch(`${API}/images/${staysKeys[0]}`, { headers: { Authorization: `Bearer ${token}` } })).status, 'the picture of STAYS still serves').toBe(200);
  const left = await folderOf(token);
  const leftBytes = left.reduce((n, p) => n + p.size, 0);
  await expect.poll(async () => usedOf(token), { timeout: 15_000, message: 'the storage figure counts what is left, no more' }).toBeLessThanOrEqual(leftBytes + 60_000);
  say(`   the account holds ${await usedOf(token)} bytes; the one picture left weighs ${leftBytes}`);

  await desktop.close();
});
