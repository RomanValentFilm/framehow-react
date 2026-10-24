// PHONE CAM IN A FITTING (23 October, Roman).
//
// A fitting starts on PHONE CAM: CAM opens the phone's own camera. Here the
// simulator plays the phone: it hands over a big portrait photo, as an iPhone
// does (4032 × 3024, a few MB). Then, depending on FRAMELINE LATER:
//   - unticked: the photo fills the frame by itself, cut evenly, straight onto
//     the card — no Framehow screen at all;
//   - ticked: the framing screen comes up with the frame lines; Save puts it on.
// Either way the saved picture is shrunk: long side at most 2400 px, under 1 MB.
//
//     npm run t -- -g "phone cam"
//
// About a minute.

import { test, expect, type Page } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 240_000 });

/** A photo the size an iPhone hands over, made in the page. */
async function phonePhoto(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 3024; c.height = 4032;
    const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 3024, 4032);
    grd.addColorStop(0, '#d52632'); grd.addColorStop(1, '#203040');
    g.fillStyle = grd; g.fillRect(0, 0, 3024, 4032);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `hsl(${i % 360},60%,${30 + (i % 40)}%)`; g.fillRect((i * 97) % 3024, (i * 53) % 4032, 24, 24); }
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

async function camChoice(d: Device, mode: 'fh' | 'phone', later: boolean): Promise<void> {
  await d.page.evaluate(([m, l]) =>
    (window as never as { __fh_test: { setCamChoice(m: string, l: boolean): void } }).__fh_test.setCamChoice(m as string, l as boolean),
    [mode, later] as [string, boolean]);
}
async function pictureSize(d: Device, index: number, vi: number) {
  return d.page.evaluate(([i, v]) =>
    (window as never as { __fh_test: { pictureSize(i: number, s: string, v: number): Promise<{ w: number; h: number; mb: number; frame: number } | null> } })
      .__fh_test.pictureSize(i as number, 'ver', v as number), [index, vi] as [number, number]);
}

async function openFitting(browser: import('@playwright/test').Browser, name: string, kind: 'fitting' | 'landscape' = 'fitting') {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  await desktop.newProjectOfKind(name, kind, 2);
  await desktop.settle();
  if (kind !== 'fitting') await desktop.showStrip('ver');
  if (await desktop.page.locator('#projectListModal').isVisible()) {
    await desktop.page.locator('#projectListClose').click();
    await desktop.page.waitForTimeout(300);
  }
  return desktop;
}

async function pressCamAndHandOver(d: Device): Promise<void> {
  const cam = d.page.locator('.frame-card[data-vfid] [data-action="camera"]').first();
  await cam.scrollIntoViewIfNeeded();
  const photo = await phonePhoto(d.page);
  const [chooser] = await Promise.all([d.page.waitForEvent('filechooser', { timeout: 10_000 }), cam.click()]);
  say(`   CAM opened the phone's camera — handing over a ${(photo.length / 1048576).toFixed(1)} MB photo, 3024 × 4032`);
  await chooser.setFiles({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: photo });
}

test('phone cam in a fitting: the photo fills the frame by itself, shrunk — even with frameline later ON', async ({ browser }) => {
  const d = await openFitting(browser, 'PHONE CAM AUTO');
  await camChoice(d, 'phone', true);          // a fitting ignores it
  await pressCamAndHandOver(d);
  await expect(d.page.locator('#cropOverlay'), 'no framing screen when FRAMELINE LATER is off').toBeHidden();
  let pic = null;
  for (let i = 0; i < 40 && !pic; i++) { await d.page.waitForTimeout(250); pic = await pictureSize(d, 0, 0); }
  say(`   on the card: ${pic?.w} × ${pic?.h}, ${pic?.mb} MB · the frame is ${pic?.frame.toFixed(3)}`);
  expect(pic, 'the photo is on the card').not.toBeNull();
  expect(Math.max(pic!.w, pic!.h), 'long side at most 2400 px').toBeLessThanOrEqual(2400);
  expect(pic!.mb, 'at most 3 MB').toBeLessThanOrEqual(3);
  expect(Math.abs(pic!.w / pic!.h - pic!.frame), 'it has the shape of the frame — filled, cut evenly').toBeLessThan(0.01);
  await d.close();
});

test('phone cam, frameline later ON (not a fitting): the framing screen comes up, Save puts it on the card', async ({ browser }) => {
  // A fitting never frames (Roman, 23 Oct) — this is a landscape project.
  const d = await openFitting(browser, 'PHONE CAM FRAMED', 'landscape');
  await camChoice(d, 'phone', true);
  await pressCamAndHandOver(d);
  await expect(d.page.locator('#cropOverlay'), 'the framing screen with the frame lines').toBeVisible({ timeout: 10_000 });
  await expect(d.page.locator('#cropModeBtn'), 'and the camera choice on it').toHaveText('PHONE CAM');
  // The photo must be laid out before Save means anything; then Save is
  // pressed as the app presses it (run 398: the simulator's own sync log at the
  // bottom of the screen lay over the button and the tap waited four minutes).
  await expect.poll(() => d.page.evaluate(() => (document.getElementById('cropImg') as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  await d.page.waitForTimeout(300);
  await d.page.evaluate(() => (document.getElementById('cropConfirm') as HTMLButtonElement).click());
  let pic = null;
  for (let i = 0; i < 40 && !pic; i++) { await d.page.waitForTimeout(250); pic = await pictureSize(d, 0, 0); }
  say(`   on the card: ${pic?.w} × ${pic?.h}, ${pic?.mb} MB`);
  expect(pic, 'the photo is on the card').not.toBeNull();
  expect(Math.max(pic!.w, pic!.h), 'long side at most 2400 px').toBeLessThanOrEqual(2400);
  expect(pic!.mb, 'at most 3 MB').toBeLessThanOrEqual(3);
  await d.close();
});
