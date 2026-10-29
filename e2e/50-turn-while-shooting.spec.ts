// TURN THE DEVICE WHILE THE CAMERA IS OPEN (29 October, Roman):
// "if I shoot to shot 7, then however I turn the device in between, I want to
// end up seeing shot 7 when the picture is taken — mid screen. Not above, not
// below. Period."
//
// The camera is opened on shot 7 in portrait, the device is turned to
// landscape, the photo is handed over — and shot 7's card must sit in the
// middle of the screen. Then the same the other way round.
//
//     npm run t -- -g "turn while shooting"

import { test, expect, type Page } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 240_000 });

async function photo(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
    const g = c.getContext('2d')!; g.fillStyle = '#d52632'; g.fillRect(0, 0, 1600, 1200);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

/** How far the card's middle is from the middle of the screen, in px. */
async function offCentre(page: Page, fid: string): Promise<number> {
  return page.evaluate((id) => {
    const el = document.querySelector(`#versionsScroll .frame-card[data-vfid="${id}"]`) as HTMLElement | null;
    if (!el) return 9999;
    const r = el.getBoundingClientRect();
    return Math.round(r.top + r.height / 2 - window.innerHeight / 2);
  }, fid);
}

for (const [from, to] of [[[820, 1180], [1180, 820]], [[1180, 820], [820, 1180]]] as const) {
  test(`turn while shooting: ${from[0] < from[1] ? 'portrait → landscape' : 'landscape → portrait'}, the shot ends mid screen`, async ({ browser }) => {
    const { token } = await freshAccount();
    const d = await Device.open(browser, 'desktop', token);
    await d.page.setViewportSize({ width: from[0], height: from[1] });
    await d.newProjectOfKind('TURN WHILE SHOOTING', 'landscape', 15);
    await d.settle();
    await d.showStrip('ver');
    if (await d.page.locator('#projectListModal').isVisible()) {
      await d.page.locator('#projectListClose').click(); await d.page.waitForTimeout(300);
    }
    await d.page.evaluate(() => (window as never as { __fh_test: { setCamChoice(m: string, l: boolean): void } }).__fh_test.setCamChoice('phone', false));

    // Shot 7 is known by its id from here on. Two shots are then added ABOVE it,
    // so its place in the list changes — the page must still end on THIS shot.
    const fid = (await d.page.locator('#versionsScroll .frame-card[data-vfid]').nth(6).getAttribute('data-vfid'))!;
    await d.newFrameAfter(1); await d.newFrameAfter(2); await d.page.waitForTimeout(500);
    const card = d.page.locator(`#versionsScroll .frame-card[data-vfid="${fid}"]`);
    const nowNo = await d.page.locator('#versionsScroll .frame-card[data-vfid]').evaluateAll((els, id) => els.findIndex((e) => (e as HTMLElement).dataset.vfid === id) + 1, fid);
    say(`   two shots added above — that shot is now number ${nowNo}`);
    await card.scrollIntoViewIfNeeded();
    say(`that shot (card ${fid}): CAM pressed at ${from[0]}×${from[1]}`);
    const pic = await photo(d.page);
    const [chooser] = await Promise.all([
      d.page.waitForEvent('filechooser', { timeout: 10_000 }),
      card.locator('[data-action="camera"]').click(),
    ]);
    say(`   turning the device to ${to[0]}×${to[1]} with the camera open`);
    await d.page.setViewportSize({ width: to[0], height: to[1] });
    await d.page.waitForTimeout(700);
    await chooser.setFiles({ name: 'turned.jpg', mimeType: 'image/jpeg', buffer: pic });
    await d.page.waitForTimeout(2200);

    // the photo went into THIS shot's version strip
    const log = (await d.log()).join('\n');
    expect(log, 'the photo did not land in the shot the camera was opened for')
      .toContain(`camera: landed on the card (shot ${nowNo}, ver`);
    const off = await offCentre(d.page, fid);
    say(`   the shot is ${off} px from the middle of the screen`);
    expect(Math.abs(off), 'SHOT 7 IS NOT IN THE MIDDLE after the turn (Roman: "mid screen, not above, not below").')
      .toBeLessThanOrEqual(4);
    await d.close();
  });
}
