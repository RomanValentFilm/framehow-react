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
    const viewBefore = await d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode());
    say(`that shot (card ${fid}): CAM pressed at ${from[0]}×${from[1]} in the ${viewBefore} view`);
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
    const viewAfter = await d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode());
    expect(viewAfter, 'THE VIEW CHANGED while shooting (Roman: "come back to the same view")').toBe(viewBefore);
    const off = await offCentre(d.page, fid);
    say(`   the shot is ${off} px from the middle of the screen`);
    expect(Math.abs(off), 'SHOT 7 IS NOT IN THE MIDDLE after the turn (Roman: "mid screen, not above, not below").')
      .toBeLessThanOrEqual(4);
    await d.close();
  });
}

// STARTED IN 3x2 — BACK IN 3x2 (29 Oct, Roman). Turning an iPad to portrait in
// 3x2 normally swaps to two strips; with the camera open it must not.
test('turn while shooting: started in 3x2, comes back to 3x2 with the shot mid screen', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.page.setViewportSize({ width: 1180, height: 820 });
  await d.newProjectOfKind('TURN IN 3x2', 'landscape', 15);
  await d.settle();
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click(); await d.page.waitForTimeout(300);
  }
  await d.setView('grid3x2'); await d.page.waitForTimeout(600);
  await d.page.evaluate(() => (window as never as { __fh_test: { setCamChoice(m: string, l: boolean): void } }).__fh_test.setCamChoice('phone', false));
  const wraps = d.page.locator('#overviewScroll .grid3x2-card-wrap[data-g3fid]');
  const fid = (await wraps.nth(9).getAttribute('data-g3fid'))!;
  const wrap = d.page.locator(`#overviewScroll .grid3x2-card-wrap[data-g3fid="${fid}"]`);
  await wrap.scrollIntoViewIfNeeded();
  const pic = await photo(d.page);
  // First a photo WITHOUT turning: shot 10 gets its main picture, so the next
  // photo becomes a version — Roman's case ("the version photo was shown, and
  // then the picture jumped to main").
  {
    const [ch] = await Promise.all([
      d.page.waitForEvent('filechooser', { timeout: 10_000 }),
      wrap.locator('[data-mact="camera"]').first().click(),
    ]);
    await ch.setFiles({ name: 'first.jpg', mimeType: 'image/jpeg', buffer: pic });
    await d.page.waitForTimeout(1500);
    say('   first photo (no turn) taken for shot 10');
  }
  say(`shot 10 in 3x2 (card ${fid}): CAM pressed in landscape`);
  const [chooser] = await Promise.all([
    d.page.waitForEvent('filechooser', { timeout: 10_000 }),
    wrap.locator('[data-mact="camera"]').first().click(),   // the 3x2 card's own CAM
  ]);
  say('   turning to portrait with the camera open');
  await d.page.setViewportSize({ width: 820, height: 1180 });
  await d.page.waitForTimeout(700);
  await chooser.setFiles({ name: 'turned.jpg', mimeType: 'image/jpeg', buffer: pic });
  await d.page.waitForTimeout(2200);
  const view = await d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode());
  say(`   the view now: ${view}`);
  expect(view, 'NOT BACK IN 3x2 after shooting from 3x2').toBe('grid3x2');
  // the card shows the photo just taken — not the main picture (Roman: "the
  // version photo was shown, and then the picture jumped to main")
  // Where the photo landed (the app's own log line), and the card must show exactly that.
  const landed = (await d.log()).find((l) => l.includes('camera: landed on the card (shot 10, ver')) ?? '';
  say(`   ${landed.trim()}`);
  expect(landed, 'the second photo did not land as a version of shot 10').not.toBe('');
  const m = landed.match(/\(shot 10, (\w+) (\d+)\)/);
  const expected = m ? `${m[1]} ${m[2]}` : 'main';
  const showing = await d.page.evaluate(() => (window as never as { __fh_test: { cardShowing(i: number): string } }).__fh_test.cardShowing(9));
  say(`   the card shows: ${showing} (the photo is in: ${expected})`);
  expect(showing, 'THE CARD DOES NOT SHOW THE PHOTO JUST TAKEN (Roman: "the version photo was shown, and then the picture jumped to main")').toBe(expected);
  const off = await d.page.evaluate((id) => {
    const el = document.querySelector(`#overviewScroll .grid3x2-card-wrap[data-g3fid="${id}"]`) as HTMLElement | null;
    if (!el) return 9999; const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2 - window.innerHeight / 2);
  }, fid);
  say(`   the card is ${off} px from the middle of the screen`);
  expect(Math.abs(off), 'the 3x2 card is not in the middle').toBeLessThanOrEqual(4);
  await d.close();
});

// iPHONE (29 Oct, Roman: "I think it's an iPhone problem only"). The phone's
// own turn rules are the harshest: portrait forces the single SHOT strip and
// resets what every card shows. The camera is opened in portrait on the SHOT
// card of a shot that already has its main picture, the phone is turned to
// landscape, the photo is taken: same view, same card, showing the new photo,
// in the middle.
test('turn while shooting on an iPhone: portrait → landscape, same view, same card, the new photo, mid screen', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.page.setViewportSize({ width: 390, height: 844 });
  await d.newProjectOfKind('IPHONE TURN', 'landscape', 15);
  await d.settle();
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click(); await d.page.waitForTimeout(300);
  }
  await d.page.evaluate(() => (window as never as { __fh_test: { setCamChoice(m: string, l: boolean): void } }).__fh_test.setCamChoice('phone', false));
  const viewBefore = await d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode());
  const fid = (await d.page.locator('#mainScroll .frame-card[data-mfid]').nth(6).getAttribute('data-mfid'))!;
  const card = d.page.locator(`#mainScroll .frame-card[data-mfid="${fid}"]`);
  await card.scrollIntoViewIfNeeded();
  const pic = await photo(d.page);
  { // shot 7 gets its main picture first (no turn), so the next photo is a version
    const [ch] = await Promise.all([d.page.waitForEvent('filechooser', { timeout: 10_000 }), card.locator('[data-mact="camera"]').first().click()]);
    await ch.setFiles({ name: 'first.jpg', mimeType: 'image/jpeg', buffer: pic });
    await d.page.waitForTimeout(1500);
  }
  say(`iPhone portrait, ${viewBefore} view: CAM on shot 7`);
  const [chooser] = await Promise.all([d.page.waitForEvent('filechooser', { timeout: 10_000 }), card.locator('[data-mact="camera"]').first().click()]);
  say('   turning the iPhone to landscape with the camera open');
  await d.page.setViewportSize({ width: 844, height: 390 });
  await d.page.waitForTimeout(700);
  await chooser.setFiles({ name: 'turned.jpg', mimeType: 'image/jpeg', buffer: pic });
  await d.page.waitForTimeout(1500);
  const viewAfter = await d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode());
  say(`   the view: ${viewBefore} → ${viewAfter}`);
  expect(viewAfter, 'THE VIEW CHANGED while shooting on the iPhone').toBe(viewBefore);
  const landed = (await d.log()).find((l) => l.includes('camera: landed on the card (shot 7, ver')) ?? '';
  expect(landed, 'the second photo did not land as a version of shot 7').not.toBe('');
  const m = landed.match(/\(shot 7, (\w+) (\d+)\)/);
  const showing = await d.page.evaluate(() => (window as never as { __fh_test: { cardShowing(i: number): string } }).__fh_test.cardShowing(6));
  say(`   ${landed.trim()} — the card shows: ${showing}`);
  expect(showing, 'THE CARD JUMPED BACK TO THE MAIN PICTURE (iPhone)').toBe(m ? `${m[1]} ${m[2]}` : 'main');
  const off = await d.page.evaluate((id) => {
    const el = document.querySelector(`#mainScroll .frame-card[data-mfid="${id}"]`) as HTMLElement | null;
    if (!el) return 9999; const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2 - window.innerHeight / 2);
  }, fid);
  say(`   the card is ${off} px from the middle of the screen`);
  expect(Math.abs(off), 'the card is not in the middle (iPhone)').toBeLessThanOrEqual(4);
  await d.close();
});
