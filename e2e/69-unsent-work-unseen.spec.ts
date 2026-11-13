// UNSENT WORK OF ANOTHER PROJECT GOES UP UNSEEN (G22, 13 November).
//
// Roman, 12 Nov, of the black full-screen "Uploading unsent work: …": "the user
// does not need to know there is something happening in the background … what
// if that takes long … it has to happen in small portions when there is time".
//
// THE RULES IT HOLDS TO
//   · the pictures of the project that was left go up first, in the background
//   · the rest goes up in one short step at a quiet moment — and through all of
//     it the black notice is never on the screen and the open project is the
//     open project
//   · the step takes three seconds at most: a slow server and the open project
//     is back; it is tried again later and arrives
//   · A TOUCH STOPS IT AND IS NOT LOST: the open project is back at once, and
//     what the touch did, it did in the open project
//
//     npm run t -- e2e/69-unsent-work-unseen.spec.ts

import { test, expect, type Page } from '@playwright/test';
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

const png = (n: number): string => `data:image/png;base64,${flatPng(8 + n, 4)}`;
const API = 'http://127.0.0.1:8787';

async function untitledWith(token: string, label: string): Promise<string> {
  const res = await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${token}` } });
  const list = ((await res.json()) as { projects: Array<{ id: string; name: string }> }).projects;
  for (const p of list.filter((x) => /^Untitled \d/.test(x.name))) {
    const tree = (await (await fetch(`${API}/projects/${p.id}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { frames?: Array<{ label?: string }>; images?: unknown[] };
    if ((tree.frames ?? []).some((f) => f.label === label)) return `${p.name} · ${(tree.images ?? []).length} picture(s)`;
  }
  return `no Untitled project holds "${label}" (projects: ${list.map((p) => p.name).join(', ')})`;
}

/** Leave an unsaved project (two shots, pictures) for `bigId`. */
async function leaveAnUnsavedProject(d: Device, bigId: string, label: string): Promise<void> {
  await d.page.evaluate(async () => {
    await (window as never as { __fh_test: { newUnsavedProject(n: number): Promise<void> } }).__fh_test.newUnsavedProject(2);
  });
  await d.putPicture(0, png(11)); await d.putPicture(1, png(12));
  await d.renameFrame(0, label);
  await d.page.waitForTimeout(800);
  void d.page.evaluate((pid) => { void (window as never as { __fh_test: { openProject(i: string): Promise<void> } }).__fh_test.openProject(pid as string).catch(() => undefined); }, bigId);
  await expect.poll(async () => (await d.read()).projectId, { timeout: 60_000 }).toBe(bigId);
}

const noticeIsUp = (page: Page): Promise<boolean> => page.evaluate(() => {
  const el = document.getElementById('unsentUploadNotice');
  return !!el && getComputedStyle(el).display !== 'none';
});

test('unsent work unseen: pictures ahead in the background, the rest in a short step, never a notice', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const bigId = await desktop.newProject('BIG', 3);
  await desktop.putPicture(0, png(1));
  await desktop.settle();

  // the black notice must never be on the screen, at any instant: watch for it
  await desktop.page.evaluate(() => {
    (window as never as { __sawNotice: boolean }).__sawNotice = false;
    setInterval(() => {
      const el = document.getElementById('unsentUploadNotice');
      if (el && getComputedStyle(el).display !== 'none') (window as never as { __sawNotice: boolean }).__sawNotice = true;
    }, 50);
  });

  say('an unsaved project with two pictures is left for BIG');
  await leaveAnUnsavedProject(desktop, bigId!, 'LEFT, UNSEEN');

  say('it arrives on the server by itself, with its pictures');
  await expect.poll(() => untitledWith(token, 'LEFT, UNSEEN'), { timeout: 150_000, intervals: [3_000] }).toMatch(/^Untitled \d.* · 2 picture/);
  const log = (await desktop.log()).join('\n');
  expect(log, 'its pictures went ahead, in the background').toContain('sent ahead, in the background');
  expect(log, 'the rest went up unseen').toMatch(/is in the cloud \(\d+ ms, unseen\)/);
  expect(await desktop.page.evaluate(() => (window as never as { __sawNotice: boolean }).__sawNotice), 'THE BLACK NOTICE WAS ON THE SCREEN').toBe(false);
  expect(await noticeIsUp(desktop.page)).toBe(false);
  const now = await desktop.read();
  expect(now.projectId, 'BIG is the open project throughout').toBe(bigId);
  expect(now.frames.length, 'with its three shots').toBe(3);
  await desktop.close();
});

test('unsent work unseen: three seconds at most, and a touch stops it without being lost', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);
  const bigId = await desktop.newProject('BIG', 3);
  await desktop.settle();

  say('the server is slow for every project but BIG: its answer to a push takes six seconds');
  let slowMs = 6_000;
  await desktop.page.route('**/projects/*/sync', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && !req.url().includes(bigId!) && slowMs > 0) await new Promise((r) => setTimeout(r, slowMs));
    await route.continue().catch(() => undefined);
  });

  await leaveAnUnsavedProject(desktop, bigId!, 'LEFT, SLOW');

  say('the short step runs into its three seconds: the open project is back, nothing lost');
  await expect.poll(async () => (await desktop.log()).some((l) => l.includes('three seconds are up')), { timeout: 120_000 }).toBe(true);
  let now = await desktop.read();
  expect(now.projectId, 'BIG is the open project again').toBe(bigId);
  expect(now.frames.length).toBe(3);

  say('the next try: this time a touch comes in the middle of it');
  const mark = await desktop.mark();
  await desktop.waitForLogAfter(mark, 'goes up now, unseen', 90_000);
  await desktop.page.waitForTimeout(300);
  await desktop.page.mouse.click(5, 5);                 // a touch, anywhere
  await expect.poll(async () => (await desktop.log()).some((l) => l.includes('a touch: the open project is back at once')), { timeout: 5_000 }).toBe(true);
  now = await desktop.read();
  expect(now.projectId, 'THE OPEN PROJECT IS BACK AT THE TOUCH').toBe(bigId);
  expect(now.frames.length).toBe(3);

  say('what is done right after is done in BIG, and travels');
  await desktop.renameFrame(0, 'DONE IN BIG');
  await desktop.settle();
  // (the step that was stopped is still in the air for a few seconds — the slow
  // server; BIG's change goes up the moment it has ended)
  await expect.poll(async () => {
    const tree = (await (await fetch(`${API}/projects/${bigId}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { frames?: Array<{ label?: string }> };
    return (tree.frames ?? []).map((f) => f.label).join('|');
  }, { timeout: 30_000, intervals: [1_000], message: 'BIG\'s change reaches the server within seconds' }).toContain('DONE IN BIG');
  await tablet.openProject(bigId!);
  await tablet.settle();
  expect((await tablet.read()).frames.map((f) => f.label), 'the change is BIG\'s, on the other device too').toContain('DONE IN BIG');

  say('the server answers quickly again: the left work arrives');
  slowMs = 0;
  await expect.poll(() => untitledWith(token, 'LEFT, SLOW'), { timeout: 180_000, intervals: [3_000] }).toMatch(/^Untitled \d/);
  await desktop.settle();
  now = await desktop.read();
  expect(now.projectId, 'and BIG is still the open project').toBe(bigId);
  expect(now.frames.map((f) => f.label)).toContain('DONE IN BIG');
  expect(now.frames.map((f) => f.label).join('|'), 'nothing of the left project in BIG').not.toContain('LEFT, SLOW');
  const log = (await desktop.log()).join('\n');
  expect(log, 'nothing of BIG was sent into another project').not.toContain('belong to ANOTHER project');
  await desktop.close();
  await tablet.close();
});
