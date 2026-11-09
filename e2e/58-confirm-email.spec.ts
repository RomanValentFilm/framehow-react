// CONFIRM YOUR EMAIL (9 November, Roman): 150 MB until the link in the welcome
// mail is opened, the full allowance after.
//
// The account works from the first second — sync, devices, everything. What an
// unconfirmed account gets is less room: a robot making one account after
// another gets 150 MB a piece, not 500. The person sees it in the project
// list ("Confirm your email for 500 MB · Resend mail"), in the 80/90/95 %
// notices, and in the STORAGE FULL box, which points to the inbox instead of
// to DELETE NOW. The link opens the app, confirms, and every device learns it
// from the next storage figure; the waiting work goes up by itself.
//
// The test worker's unconfirmed allowance is 20 MB (package.json dev:local), so
// three 7 MB pictures fill it; the full allowance is the worker's default.
//
//     npm run t -- -g "confirm email"
//
// About a minute and a half.

import { test, expect } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, say } from './harness';

test.describe.configure({ timeout: 300_000 });

const API = 'http://127.0.0.1:8787';

/** A noise PNG: incompressible, so its size is its pixels × 4. */
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
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; for (let i = 1; i <= width * 4; i++) raw[y * (width * 4 + 1) + i] = (Math.random() * 256) | 0; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const BIG = () => noisePng(1400, 1300);   // ≈ 7.3 MB

test('confirm email: 150 MB until the link is opened, the box points to the inbox, the link unlocks the rest on every device', async ({ browser }) => {
  say('a new account — the welcome mail carries the confirmation link');
  const email = `confirm-${Date.now()}@example.com`;
  const password = 'confirm-password-1';
  const made = await (await fetch(`${API}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Confirm Me', email, password, terms_agreed_at: Date.now() }),
  })).json() as { session: { token: string }; user: { email_verified: boolean }; dev_token?: string };
  const token = made.session.token;
  expect(made.user.email_verified, 'not confirmed at birth').toBe(false);
  expect(made.dev_token, 'the simulator can follow the link').toBeTruthy();
  const firstLink = made.dev_token!;

  const desktop = await Device.open(browser, 'desktop', token);
  const pid = await desktop.newProject('CONFIRM', 3);
  await desktop.settle();
  expect(pid).toBeTruthy();

  say('the list says so: a small allowance, and the way to the full one');
  const line = await desktop.readStorageLine();
  expect(line.text, 'the figure shows the small allowance').toMatch(/of 20 MB/);
  await desktop.page.evaluate(() => { void (window as never as { __fh_test: { openProjectList(): Promise<void> } }).__fh_test.openProjectList(); });
  const hint = desktop.page.locator('#projectListConfirmHint');
  await expect(hint, 'the hint under the figure').toBeVisible({ timeout: 10_000 });
  const hintText = (await hint.textContent()) ?? '';
  const m = hintText.match(/^Confirm your email for (\d+) MB · Resend mail$/);
  expect(m, `what it says: "${hintText}"`).toBeTruthy();
  const FULL = Number(m![1]);   // the worker's full allowance (wrangler.toml), whatever it is
  say(`   the full allowance here is ${FULL} MB`);
  await desktop.page.locator('#projectListClose').click();

  say('three 7 MB pictures: the third is one too many — FULL, and the box points to the inbox');
  await desktop.uploadPictures(0, 'ver', [BIG()]);
  await desktop.page.waitForTimeout(2500);
  await desktop.push();
  await desktop.settle();
  await desktop.uploadPictures(1, 'ver', [BIG()]);
  await desktop.page.waitForTimeout(2500);
  await desktop.push();
  await desktop.settle();
  const markFull = await desktop.mark();
  await desktop.uploadPictures(2, 'ver', [BIG()]);
  await desktop.page.waitForTimeout(2500);
  await desktop.push().catch(() => undefined);
  await desktop.waitForLogAfter(markFull, 'storage FULL', 60_000);
  const note = desktop.page.locator('#importantNote');
  await expect(note).toBeVisible({ timeout: 10_000 });
  const words = (await note.textContent()) ?? '';
  say(`   the box: "${words.replace(/\s+/g, ' ').trim().slice(0, 160)}…"`);
  expect(words, 'the box names the way out: the mail').toContain('Confirm your email');
  expect(words, 'and how much it unlocks').toContain(`${FULL} MB`);
  expect(words, 'not the old DELETE NOW advice').not.toContain('DELETE NOW');
  await desktop.page.getByRole('button', { name: 'GOT IT' }).click();
  await expect(desktop.page.locator('#projectListModal')).toBeVisible({ timeout: 10_000 });
  await desktop.page.locator('#projectListClose').click();

  say('Resend mail: a fresh link; the first one is dead from now on');
  const again = await (await fetch(`${API}/auth/resend-verification`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}',
  })).json() as { ok: boolean; dev_token?: string };
  expect(again.dev_token, 'a new link came').toBeTruthy();

  say('the dead link, opened on another device: the app says it expired and offers a new one');
  const stale = await Device.open(browser, 'stale-link', token, false, { openWith: `&verify=${firstLink}` });
  await stale.waitForLog('email confirmation link refused', 30_000);
  const ask = stale.page.locator('#confirmModal');
  await expect(ask).toBeVisible({ timeout: 10_000 });
  expect(await stale.page.locator('#confirmMsg').textContent()).toBe('This confirmation link has expired. Send a new one to your email?');
  await stale.page.locator('#confirmNo').click();
  await stale.close();

  say('the fresh link, opened on the iPad: confirmed');
  const ipad = await Device.open(browser, 'ipad', token, true, { openWith: `&verify=${again.dev_token}` });
  await ipad.waitForLog('email confirmed from the link', 30_000);
  const me = await (await fetch(`${API}/user/me`, { headers: { Authorization: `Bearer ${token}` } })).json() as { user: { email_verified: boolean } };
  expect(me.user.email_verified, 'the server has it').toBe(true);

  say('the desktop learns it from the next figure, says so, and the waiting picture goes up');
  const markLearn = await desktop.mark();
  await desktop.push().catch(() => undefined);
  await desktop.waitForLogAfter(markLearn, 'email confirmed —', 60_000);
  await desktop.waitForLogAfter(markLearn, 'room again', 60_000);
  const t0 = Date.now();
  let st = await desktop.storage();
  while (st.full && Date.now() - t0 < 60_000) { await desktop.page.waitForTimeout(1000); st = await desktop.storage(); }
  expect(st.full, 'not full any more').toBe(false);
  expect(st.figure!.limit, 'the full allowance').toBe(FULL * 1048576);
  await expect.poll(async () => ((await (await fetch(`${API}/projects/${pid}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { images: unknown[] }).images.length,
    { timeout: 60_000, message: 'all three pictures on the server' }).toBe(3);
  const after = await desktop.readStorageLine();
  expect(after.text, 'the line shows the full allowance now').toContain(`of ${FULL} MB`);
  await desktop.page.evaluate(() => { void (window as never as { __fh_test: { openProjectList(): Promise<void> } }).__fh_test.openProjectList(); });
  await expect(desktop.page.locator('#projectListConfirmHint'), 'no hint any more').toHaveCount(0);
  await desktop.page.locator('#projectListClose').click();

  await desktop.close();
  await ipad.close();
});
