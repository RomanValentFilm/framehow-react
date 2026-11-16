// ONE FETCH, ONE REDRAW (16 Nov, Roman's iPad).
//
// 12:21:36–38, WF 7, 28 shots: one fetch from the server drew the whole project
// three times — 922 + 679 + 675 ms. For 2.3 seconds nothing answered. "The app
// is unresponsive" had a number at last: once inside the rebuild, once after
// it, once more after the view was put back.
//
// The tablet writes a sentence; the desktop fetches it. On the desktop the
// whole project may be drawn ONCE for that fetch — and the sentence is there.
//
//     npm run t -- -g "one fetch, one redraw"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { deflateSync } from 'zlib';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

test('one fetch, one redraw: what another device wrote arrives with a single drawing of the project', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const projectId = await desktop.newProject('One redraw', 6);
  await tablet.openProject(projectId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  const redraws = () => desktop.page.evaluate(() => (window as never as { __fh_redraws?: number }).__fh_redraws ?? 0);

  for (const round of [1, 2]) {
    // (the desktop quiet first: nothing of its own may be drawing)
    await desktop.page.waitForTimeout(1500);
    const logBefore = await desktop.log();
    const before = await redraws();
    say(`round ${round}: the tablet writes under shot 3; the desktop has drawn the project ${before} time(s) so far`);
    await tablet.writeUnder(2, `written on the tablet, round ${round}`);
    await tablet.settle();
    for (let i = 0; i < 40; i++) {
      await desktop.nudge();
      if ((await desktop.log()).filter((l) => l.includes('pull: remote is newer')).length
        > logBefore.filter((l) => l.includes('pull: remote is newer')).length) break;
      await desktop.page.waitForTimeout(500);
    }
    await desktop.waitForLogAfter(logBefore, 'pull: remote is newer');
    await desktop.waitForLogAfter(logBefore, 'as matching the server');
    await desktop.page.waitForTimeout(1500);       // anything that would still draw has drawn
    const drawn = (await redraws()) - before;
    say(`   the desktop drew the whole project ${drawn} time(s) for that fetch`);
    expect(drawn, `ONE FETCH DREW THE PROJECT ${drawn} TIMES (Roman's iPad, 16 Nov: three times, 2.3 s of standstill)`).toBe(1);
    // …and what was written is on the desktop: both show the same project.
    await Device.waitUntilTheyAgree(desktop, tablet);
  }

  await desktop.close();
  await tablet.close();
});

// AN OPEN PROJECT WAITS FOR NOTHING (16 Nov, Roman). A fetch that brought
// pictures threw the black curtain over the work — "Loading image 3 of 5…" —
// until the last one was in. Now: no curtain, the shots at once, the pictures
// behind them in the background, the thin bar at the bottom counting.
test('a fetch that brings pictures throws no curtain: the pictures come in the background', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);
  const projectId = await desktop.newProject('No curtain', 4);
  await tablet.openProject(projectId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();

  // Every time the curtain comes on the desktop from here on is counted.
  await desktop.page.evaluate(() => {
    const w = window as never as { __curtain: number };
    w.__curtain = 0;
    const el = document.getElementById('progressOverlay')!;
    new MutationObserver(() => { if (!el.classList.contains('hidden')) w.__curtain++; }).observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  say('the tablet puts a picture on three shots');
  await tablet.uploadPicture(0, 'main', colourPng(200, 40, 40));
  await tablet.uploadPicture(1, 'main', colourPng(40, 200, 40));
  await tablet.uploadPicture(2, 'main', colourPng(40, 40, 200));
  await tablet.settle();

  say('the desktop fetches them');
  // (run 747: "they agree" looks at the shots' names, which were the same before
  // the fetch — the test looked before the desktop had fetched anything. It
  // waits for the fetch itself now, nudging as a person at the desktop would.)
  for (let i = 0; i < 60; i++) {
    await desktop.nudge();
    if ((await desktop.log()).some((l) => l.includes('follow in the background'))) break;
    await desktop.page.waitForTimeout(500);
  }
  await desktop.waitForLog('follow in the background', 5_000);
  type ToCome = { arriving: { done: number; total: number } | null; bar: string | null; standIns: number };
  const toCome = () => desktop.page.evaluate(() => (window as never as { __fh_test: { picturesStillToCome(): Promise<ToCome> } }).__fh_test.picturesStillToCome());
  await expect.poll(async () => { const t = await toCome(); return t.arriving === null && t.bar === null && t.standIns === 0; },
    { timeout: 60_000, message: 'every picture is in: no count, no bar, no preview left standing in' }).toBe(true);
  const pictures = await desktop.page.evaluate(() => [...document.querySelectorAll('canvas')].length);
  const log = await desktop.log();
  const fresh = log;   // (this project had no picture before: any such line is from this fetch)
  say(`   ${fresh.filter((l) => l.includes('follow in the background')).join(' | ') || 'no "follow in the background" line'}`);
  expect(fresh.some((l) => l.includes('follow in the background')), 'the pictures of the fetch came in the background').toBe(true);
  const curtain = await desktop.page.evaluate(() => (window as never as { __curtain: number }).__curtain);
  say(`   the curtain came ${curtain} time(s); ${pictures} drawing surface(s) on the page`);
  expect(curtain, 'THE BLACK CURTAIN CAME OVER THE WORK DURING A FETCH').toBe(0);
  await desktop.expectNeverInLog('PULL FAILED');

  await desktop.close();
  await tablet.close();
});

/** A small one-colour PNG — each colour a different picture. */
function colourPng(r: number, g: number, b: number): string {
  const W = 48, H = 32;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
